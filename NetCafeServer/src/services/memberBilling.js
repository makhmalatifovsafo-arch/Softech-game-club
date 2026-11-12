import crypto from 'node:crypto';
import { db } from '../db.js';
import { verifyPassword } from '../auth.js';
import { requireRateForMoment, calculateMinuteCost, calculateTimeFromAmount, resolveZoneIdForComputer } from './pricingEngine.js';
export const isLiveMember = session => Boolean(session?.notes?.startsWith('CLIENT_BALANCE_LIVE:'));
export const isPrepaidMember = session => Boolean(session?.notes?.startsWith('CLIENT_BALANCE_PREPAID:'));
export const isMemberSession = session => isLiveMember(session) || isPrepaidMember(session);

// Read after settlement, inside the closing transaction. Never include credentials.
export function getMemberSessionSummary(sessionId, barDebt = 0) {
  const session = db.prepare(`SELECT s.*, u.username, u.balance FROM sessions s
    JOIN users u ON u.id=s.user_id AND u.club_id=s.club_id WHERE s.id=?`).get(sessionId);
  if (!isMemberSession(session)) return null;
  const refunded = db.prepare("SELECT COALESCE(SUM(amount),0) AS amount FROM client_transactions WHERE session_id=? AND type='REFUND'").get(sessionId);
  return { sessionId, username:session.username, accountId:session.user_id,
    playedMinutes:Math.max(0,Math.round((Date.parse(session.ends_at)-Date.parse(session.started_at))/60000)),
    gameAmount:Number(session.paid_amount), refundAmount:Number(refunded.amount),
    balance:Number(session.balance), barDebt:Number(barDebt) };
}

// Freeze the agreed minute prices so a later tariff edit cannot change a refund.
export function quoteMemberMinutes(pcId, minutes, now = new Date()) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
    throw new Error('1 dan 1440 gacha o‘ynash daqiqasini tanlang. Client dasturini yangilang.');
  const pc = db.prepare('SELECT * FROM computers WHERE id=?').get(pcId);
  if (!pc) throw new Error('Kompyuter topilmadi.');
  const zone = resolveZoneIdForComputer(pc.id, pc.club_id);
  const rates = Array.from({length:minutes}, (_, i) => calculateMinuteCost(
    new Date(now.getTime() + i * 60000), false, pc.club_id, zone));
  if (rates.some(rate => !Number.isFinite(rate) || rate < 0)) throw new Error('Tarif noto‘g‘ri.');
  return { pc, rates, amount:Math.round(rates.reduce((a,b)=>a+b,0)),
    rate:requireRateForMoment(now,false,pc.club_id,zone) };
}
export function startMemberSession(pcId, username, password, durationMinutes) {
  const now = new Date();
  const {pc,rates,amount,rate} = quoteMemberMinutes(pcId, durationMinutes, now);
  const user = db.prepare("SELECT * FROM users WHERE (username=? OR phone_number=?) AND club_id=? AND role='client'").get(username,username,pc.club_id);
  if (!user || !verifyPassword(password,user.password_hash)) throw new Error('Login yoki parol noto‘g‘ri.');
  const club = db.prepare('SELECT * FROM clubs WHERE id=?').get(pc.club_id);
  if (!club?.is_active || Date.parse(club.expires_at)<Date.now()) throw new Error('Klub litsenziyasi faol emas.');
  const id = 'ses_'+crypto.randomUUID(), endsAt = new Date(now.getTime()+durationMinutes*60000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT id FROM sessions WHERE status='ACTIVE' AND (computer_id=? OR user_id=?)").get(pc.id,user.id))
      throw new Error('Kompyuter yoki mijozning seansi allaqachon faol.');
    if (db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND balance>=?').run(amount,user.id,pc.club_id,amount).changes!==1)
      throw new Error('Tanlangan vaqt uchun balans yetarli emas.');
    db.prepare("INSERT INTO sessions (id,club_id,computer_id,tariff_id,user_id,customer_name,started_at,ends_at,total_amount,paid_amount,status,notes,prepaid_rate_plan) VALUES (?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)")
      .run(id,pc.club_id,pc.id,rate.tariffId || db.prepare('SELECT id FROM tariffs WHERE club_id=? ORDER BY price_per_hour LIMIT 1').get(pc.club_id)?.id,user.id,user.username,now.toISOString(),endsAt,amount,amount,'CLIENT_BALANCE_PREPAID:'+user.id,JSON.stringify(rates));
    db.prepare("INSERT INTO client_transactions (club_id,user_id,amount,type,payment_method,category,session_id) VALUES (?,?,?,'SESSION_DEDUCT','BALANCE','GAME',?)").run(pc.club_id,user.id,amount,id);
    db.prepare("UPDATE computers SET status='OCCUPIED',current_session_id=? WHERE id=?").run(id,pc.id);
    db.exec('COMMIT');
  } catch(e) { db.exec('ROLLBACK'); throw e; }
  return {sessionId:id,username:user.username,customerName:user.username,clientBalance:Number(user.balance)-amount,balance:Number(user.balance)-amount,amount,
    remainingSeconds:durationMinutes*60,totalMinutes:durationMinutes,durationMinutes,endsAt,tariffName:rate.name,isPostpaid:false};
}

export function prepaidRefund(session, now = new Date()) {
  const paid = Number(session.paid_amount || 0);
  if (session.prepaid_settled_at) return {amount:0,usedAmount:paid};
  const start = Date.parse(session.started_at), end = Date.parse(session.ends_at);
  const elapsed = Math.max(0, Math.min(now.getTime(),end)-start);
  let rates; try {rates=JSON.parse(session.prepaid_rate_plan || 'null');} catch {}
  let used;
  if (Array.isArray(rates) && rates.length) {
    used = rates.reduce((sum,rate,i)=>sum+Number(rate)*Math.max(0,Math.min(1,elapsed/60000-i)),0);
  } else {
    // Existing prepaid sessions retain their agreed total and duration.
    used = end>start ? paid*Math.min(1,elapsed/(end-start)) : paid;
  }
  const usedAmount = Math.max(0,Math.min(paid,Math.round(used)));
  return {amount:Math.max(0,paid-usedAmount),usedAmount};
}
function settlePrepaidMember(session, now, inTransaction) {
  if (session.status!=='ACTIVE' || session.prepaid_settled_at) return null;
  const {amount,usedAmount} = prepaidRefund(session,now);
  if (!inTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    const updated=db.prepare('UPDATE sessions SET prepaid_settled_at=?,paid_amount=?,total_amount=? WHERE id=? AND prepaid_settled_at IS NULL').run(now.toISOString(),usedAmount,usedAmount,session.id);
    if(updated.changes!==1) throw new Error('Seans allaqachon hisoblangan.');
    if(amount>0){
      if(db.prepare('UPDATE users SET balance=balance+? WHERE id=? AND club_id=?').run(amount,session.user_id,session.club_id).changes!==1) throw new Error('Mijoz topilmadi.');
      db.prepare("INSERT INTO client_transactions (club_id,user_id,amount,type,payment_method,category,session_id) VALUES (?,?,?,'REFUND','BALANCE','GAME',?)").run(session.club_id,session.user_id,amount,session.id);
    }
    const balance=db.prepare('SELECT balance FROM users WHERE id=? AND club_id=?').get(session.user_id,session.club_id)?.balance;
    if (!inTransaction) db.exec('COMMIT');
    return {refundAmount:amount,currentBalance:balance,totalAmount:usedAmount,amount:0};
  } catch(e){if (!inTransaction) db.exec('ROLLBACK');throw e;}
}

// Persist the billed instant and fractional sum so ticks and restarts never bill twice.
export function settleMemberUsage(sessionId, now=new Date(), final=false, inTransaction=false) {
  const session=db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if (isPrepaidMember(session)) return final ? settlePrepaidMember(session, now, inTransaction) : null;
  if (!isLiveMember(session) || session.status!=='ACTIVE') return null;
  const user=db.prepare('SELECT balance FROM users WHERE id=? AND club_id=?').get(session.user_id,session.club_id);
  if (!user) throw new Error('Mijoz topilmadi.');
  const end=Math.min(now.getTime(),Date.parse(session.ends_at));
  let cursor=Date.parse(session.billing_last_at || session.started_at);
  let cost=Number(session.billing_remainder || 0);
  const zone=resolveZoneIdForComputer(session.computer_id,session.club_id);
  while(cursor<end) {
    const next=Math.min(end,(Math.floor(cursor/60000)+1)*60000);
    cost+=requireRateForMoment(new Date(cursor),false,session.club_id,zone).pricePerHour*(next-cursor)/3600000;
    cursor=next;
  }
  const due=Math.max(0,final?Math.round(cost):Math.floor(cost+1e-8));
  const amount=Math.min(Number(user.balance),due);
  const remaining=Number(user.balance)-amount;
  const time=remaining>0?calculateTimeFromAmount(now,remaining,false,session.club_id,zone):null;
  const exhausted=remaining<=0 || end>=Date.parse(session.ends_at);
  const nextEnd=exhausted?now.toISOString():time.endTime;
  if (!inTransaction) db.exec('BEGIN IMMEDIATE');
  try {
    if(amount>0) {
      const debit=db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND balance>=?').run(amount,session.user_id,session.club_id,amount);
      if(debit.changes!==1)throw new Error('Balans o‘zgargan.');
      db.prepare("INSERT INTO client_transactions (club_id,user_id,amount,type,payment_method,category,session_id) VALUES (?,?,?,'SESSION_DEDUCT','BALANCE','GAME',?)").run(session.club_id,session.user_id,amount,session.id);
    }
    db.prepare('UPDATE sessions SET billing_last_at=?,billing_remainder=?,total_amount=total_amount+?,paid_amount=paid_amount+?,ends_at=? WHERE id=?')
      .run(new Date(Math.max(cursor,end)).toISOString(),final?0:cost-due,amount,amount,nextEnd,session.id);
    if (!inTransaction) db.exec('COMMIT');
  } catch(e){ if (!inTransaction) db.exec('ROLLBACK');throw e; }
  return {currentBalance:remaining,amount,totalAmount:Number(session.paid_amount)+amount,exhausted,endsAt:nextEnd,remainingSeconds:exhausted?0:time.totalMinutes*60};
}

export function extendPrepaidMember(sessionId, minutes) {
  const session=db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
  if(!isPrepaidMember(session) || session.status!=='ACTIVE' || session.prepaid_settled_at || Date.parse(session.ends_at)<=Date.now())
    throw new Error('Uzaytirish uchun faol, to‘langan mijoz seansi kerak.');
  const duration=(Date.parse(session.ends_at)-Date.parse(session.started_at))/60000;
  if(!Number.isInteger(duration) || duration+minutes>1440) throw new Error('Jami seans 1440 daqiqadan oshmasin.');
  const quote=quoteMemberMinutes(session.computer_id,minutes,new Date(session.ends_at));
  let previous;try{previous=JSON.parse(session.prepaid_rate_plan || 'null');}catch{}
  if(!Array.isArray(previous) || previous.length!==duration) previous=Array.from({length:duration},()=>Number(session.paid_amount)/duration);
  const endsAt=new Date(Date.parse(session.ends_at)+minutes*60000).toISOString();
  db.exec('BEGIN IMMEDIATE');
  try{
    if(db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND balance>=?').run(quote.amount,session.user_id,session.club_id,quote.amount).changes!==1)
      throw new Error('Qo‘shimcha vaqt uchun balans yetarli emas.');
    db.prepare('UPDATE sessions SET ends_at=?,paid_amount=paid_amount+?,total_amount=total_amount+?,prepaid_rate_plan=? WHERE id=?')
      .run(endsAt,quote.amount,quote.amount,JSON.stringify([...previous,...quote.rates]),session.id);
    db.prepare("INSERT INTO client_transactions (club_id,user_id,amount,type,payment_method,category,session_id) VALUES (?,?,?,'SESSION_DEDUCT','BALANCE','GAME',?)")
      .run(session.club_id,session.user_id,quote.amount,session.id);
    db.exec('COMMIT');
    return {amount:quote.amount,endsAt};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
