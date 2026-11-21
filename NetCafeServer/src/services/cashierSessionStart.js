import crypto from 'node:crypto';
import { getClubSettings } from '../db.js';
import { requireRateForMoment, resolveZoneIdForComputer, calculateIntervalPrice } from './pricingEngine.js';
import { prepaidQuote, sessionStartTime } from './prepaidQuote.js';
import { freezePrepaidRates } from './memberBilling.js';
import { runMoneyOperation } from './moneyOperations.js';
import { assertBookingAvailability, bookingError } from './bookingAvailability.js';
import {bookingFundingQuote,applyBookingFunds} from './bookingFunds.js';

function bookingForStart(db, actor, bookingId, data, now) {
  if (bookingId == null) return null;
  if (!['administrator','club_owner','superadmin'].includes(actor.role) ||
      (actor.role==='administrator' && !actor.permissions?.some(p=>['*','session:manage','sessions:manage'].includes(p))))
    throw bookingError('Bronni ishga tushirishga ruxsat yo‘q.',403);
  const row=db.prepare('SELECT * FROM bookings WHERE club_id=? AND id=?').get(actor.clubId,bookingId);
  if(!row)throw bookingError('Bron topilmadi.',404);
  if(row.needs_review || !row.computer_ref)throw bookingError('Bronning PC va vaqt ma’lumotlarini tekshiring.',409);
  if(!['PENDING','CONFIRMED'].includes(row.status)||row.session_id)throw bookingError('Bu bron allaqachon ishga tushirilgan yoki bekor qilingan.',409,'BOOKING_STATE_CONFLICT');
  if(data.expectedRevision!==row.revision)throw bookingError('Bron o‘zgargan. Oynani qayta oching.',409,'REVISION_CONFLICT');
  if(now<Date.parse(row.start_time))throw bookingError('Bron boshlanish vaqti hali kelmagan.',409);
  if(now>=Math.min(Date.parse(row.no_show_at)||Date.parse(row.end_time),Date.parse(row.end_time)))
    throw bookingError('Bronning kutish muddati tugagan.',409,'BOOKING_EXPIRED');
  if(data.computerId!=null && data.computerId!==row.computer_ref)throw bookingError('Seans aynan bron qilingan PCda ochilishi kerak.',409);
  return row;
}

// Both the ordinary cashier and booking check-in call this exact quote/write
// path. Pricing remains in prepaidQuote/pricingEngine/memberBilling.
export function prepareCashierSession(db,actor,raw,{bookingId=null,now=Date.now()}={}) {
  const clubId=actor.clubId;
  const booking=bookingForStart(db,actor,bookingId,raw,now);
  const data={...raw};
  if(booking){data.computerId=booking.computer_ref;data.customerName ||= booking.customer_name;
    if(booking.payment_kind==='BALANCE'){
      if(data.customerId!=null&&data.customerId!==booking.user_id)throw bookingError('Depozit boshqa mijoz hisobiga tegishli.',409);
      data.customerId=booking.user_id;
    }
    data.mode ||= 'endtime';if(['ENDTIME','END_TIME'].includes(String(data.mode).toUpperCase())&&!data.targetEndTime&&!data.value)data.targetEndTime=booking.end_time;}
  const mode=data.mode || 'hours',customerId=data.customerId??null,customerName=data.customerName || 'Mijoz';
  const paymentType=data.paymentType || (String(mode).toLowerCase()==='client'?'BALANCE':'CASH');
  const rawId=String(data.computerId??''),number=/^\d+$/.test(rawId)?Number(rawId):-1;
  const pc=db.prepare('SELECT * FROM computers WHERE club_id=? AND (id=? OR name=? OR pc_number=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1').get(clubId,rawId,rawId,number,rawId);
  if(!pc || pc.pc_number<=0)throw bookingError('Kompyuter topilmadi.',404);
  if(db.prepare("SELECT id FROM sessions WHERE computer_id=? AND club_id=? AND status='ACTIVE'").get(pc.id,clubId))
    throw bookingError('Kompyuterda faol seans mavjud.',409);
  if((customerId!=null||String(mode).toLowerCase()==='client'||paymentType==='BALANCE') &&
    !db.prepare("SELECT id FROM users WHERE id=? AND club_id=? AND role='client'").get(customerId,clubId))throw bookingError('Mijoz hisobi topilmadi.');
  const isPostpaid=['POSTPAID','VIP'].includes(String(mode).toUpperCase()) || Boolean(data.isPostpaid) || paymentType==='POSTPAID';
  if(isPostpaid&&paymentType==='BALANCE')throw bookingError('Postpaid seansni balansdan oldindan to‘lab bo‘lmaydi.');
  const startedAt=sessionStartTime(data,new Date(now)),zoneId=resolveZoneIdForComputer(pc.id,clubId);
  const rate=requireRateForMoment(startedAt,isPostpaid,clubId,zoneId);
  const settings=getClubSettings(clubId);
  if(isPostpaid&&(!settings.vip_enabled||rate.isVipPostpaidAllowed===false))throw bookingError('VIP Postpaid bu xona yoki klubda yoqilmagan.',403);
  let amount=0,durationMinutes=1440,endsAt=new Date(startedAt.getTime()+86400000);
  if(!isPostpaid){const q=prepaidQuote(data,startedAt,clubId,zoneId);amount=q.totalAmount;durationMinutes=q.totalMinutes;endsAt=new Date(q.endTime);
    calculateIntervalPrice(startedAt,endsAt,false,clubId,zoneId);}
  assertBookingAvailability(db,{clubId,computerId:pc.id,start:startedAt.toISOString(),end:endsAt.toISOString(),
    excludeBookingId:booking?.id || 0,openEnded:isPostpaid});
  const tariff=(data.tariffId&&db.prepare('SELECT * FROM tariffs WHERE id=? AND club_id=?').get(data.tariffId,clubId)) ||
    db.prepare('SELECT * FROM tariffs WHERE club_id=? ORDER BY price_per_hour LIMIT 1').get(clubId);
  const funding=bookingFundingQuote(db,booking,amount,isPostpaid);
  const rates=!isPostpaid&&(paymentType==='BALANCE'||funding)?freezePrepaidRates(pc.id,startedAt,endsAt):null;
  const currentRate=isPostpaid&&settings.vip_pricing_mode==='CUSTOM'?Number(settings.vip_custom_price):rate.pricePerHour;
  if(isPostpaid&&(!Number.isFinite(currentRate)||currentRate<=0))throw bookingError('VIP tarifi belgilanmagan.');
  const quoteRevision=crypto.createHash('sha256').update(JSON.stringify({bookingId:booking?.id,revision:booking?.revision,
    // Canonicalize insignificant floating-point noise only in the signature.
    // Persisted prices/rates stay untouched; real price/rule changes still invalidate it.
    computerId:pc.id,mode,customerId,paymentType,isPostpaid,amount,durationMinutes:Number(durationMinutes.toFixed(8)),currentRate,
    rates:rates?.map(value=>Number(value.toFixed(8))),funding,
    settings,tariffs:db.prepare('SELECT * FROM tariffs WHERE club_id=? ORDER BY id').all(clubId),
    schedules:db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY id').all(clubId)})).digest('hex');
  return {booking,funding,pc,clubId,data,mode,customerId,customerName,paymentType,isPostpaid,startedAt,endsAt,amount,durationMinutes,rate,tariff,rates,currentRate,pricingMode:settings.vip_pricing_mode,quoteRevision};
}

export function cashierSessionQuote(plan) {
  return {success:true,bookingId:plan.booking?.id,expectedRevision:plan.booking?.revision,computerId:plan.pc.id,
    isPostpaid:plan.isPostpaid,price:plan.amount,amount:plan.amount,durationMinutes:plan.durationMinutes,
    endTime:plan.isPostpaid?null:plan.endsAt.toISOString(),currentRate:plan.currentRate,pricingMode:plan.pricingMode,
    asOf:plan.startedAt.toISOString(),quoteRevision:plan.quoteRevision,
    depositApplied:plan.funding?.depositApplied||0,additionalPayment:plan.funding?.additionalPayment??plan.amount,
    cashRefundPending:plan.funding?.cashRefundPending||0,balanceRelease:plan.funding?.balanceRelease||0};
}

function insertSession(db,p,actor,sessionId) {
  // No transaction ownership here; the caller commits the session, payment,
  // booking lifecycle and idempotency receipt together.
  const notes=p.paymentType==='BALANCE'&&!p.funding?'CLIENT_BALANCE_PREPAID:'+p.customerId:p.isPostpaid?'POSTPAID':p.mode;
  const fresh=p.funding?.additionalPayment??p.amount;
  if(p.paymentType==='BALANCE'&&fresh>0){
    if(db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND balance>=?').run(fresh,p.customerId,p.clubId,fresh).changes!==1)
      throw bookingError('Mijoz balansi yetarli emas.',409);
    db.prepare("INSERT INTO client_transactions(club_id,user_id,amount,type,payment_method,category,session_id) VALUES(?,?,?,'SESSION_DEDUCT','BALANCE','GAME',?)")
      .run(p.clubId,p.customerId,fresh,sessionId);
  }
  db.prepare(`INSERT INTO sessions(id,club_id,computer_id,tariff_id,user_id,customer_name,started_at,ends_at,total_amount,paid_amount,status,notes,prepaid_rate_plan)
    VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?)`).run(sessionId,p.clubId,p.pc.id,p.rate.tariffId || p.tariff?.id,
      p.customerId,p.customerName,p.startedAt.toISOString(),p.endsAt.toISOString(),p.amount,p.isPostpaid?(p.funding?.depositApplied||0):p.amount,notes,p.rates?JSON.stringify(p.rates):null);
  if(!p.isPostpaid&&fresh>0&&p.paymentType!=='BALANCE'){
    const payment=['CASH','CARD','CLICK','PAYME'].includes(p.paymentType)?p.paymentType:'CASH';
    db.prepare(`INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_by)
      VALUES(?,?,?,?,?,?,'PREPAID',?)`).run('tx_'+crypto.randomUUID(),p.clubId,sessionId,fresh,payment,payment,String(actor.id));
  }
  if(p.funding)applyBookingFunds(db,p,actor,sessionId,p.startedAt.getTime());
  db.prepare("UPDATE computers SET status='OCCUPIED',current_session_id=? WHERE id=? AND club_id=?").run(sessionId,p.pc.id,p.clubId);
}

export function startCashierSession(db,actor,data,{bookingId=null,now=Date.now()}={}) {
  if(bookingId!=null && typeof data?.requestId!=='string')throw bookingError('Bronni ishga tushirish uchun requestId kerak.');
  let plan;
  const result=runMoneyOperation(db,{clubId:actor.clubId,actorId:actor.id,operation:bookingId==null?'CASHIER_SESSION_START':'BOOKING_CHECK_IN',
    requestId:data.requestId,payload:{bookingId,data}},()=>{
    plan=prepareCashierSession(db,actor,data,{bookingId,now});
    if(bookingId!=null&&data.quoteRevision!==plan.quoteRevision)throw bookingError('Seans hisobini qayta ko‘rib tasdiqlang.',409,'QUOTE_CHANGED');
    const sessionId='ses_'+crypto.randomUUID();
    insertSession(db,plan,actor,sessionId);
    if(plan.booking){
      db.prepare("UPDATE bookings SET status='ACTIVE',session_id=?,revision=revision+1 WHERE id=? AND club_id=?")
        .run(sessionId,plan.booking.id,actor.clubId);
      db.prepare(`INSERT INTO audit_logs(club_id,actor_user_id,actor_username,category,action_type,details,created_at)
        VALUES(?,?,?,'SESSION','BOOKING_CHECKED_IN',?,?)`).run(actor.clubId,actor.id,actor.username || String(actor.id),
        JSON.stringify({bookingId,sessionId,computerId:plan.pc.id,mode:plan.mode,amount:plan.amount}),new Date(now).toISOString());
    }
    return {status:201,body:{success:true,sessionId,bookingId,mode:plan.mode,durationMinutes:plan.durationMinutes,amount:plan.amount,isPostpaid:plan.isPostpaid,
      depositApplied:plan.funding?.depositApplied||0,additionalPayment:plan.funding?.additionalPayment??plan.amount,
      cashRefundPending:plan.funding?.cashRefundPending||0,balanceRelease:plan.funding?.balanceRelease||0}};
  });
  return {...result,plan};
}
