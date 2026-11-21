import crypto from 'node:crypto';
import {bookingError} from './bookingAvailability.js';

// Funding only: prices, consumed time and refund entitlement come from the
// existing quote/checkout engines. All writes require the caller's transaction.
export function initializeBookingFunds(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS booking_funds(
    id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL,
    booking_id INTEGER NOT NULL REFERENCES bookings(id),
    kind TEXT NOT NULL CHECK(kind IN ('CAPTURE','APPLY','REFUND')),
    channel TEXT NOT NULL CHECK(channel IN ('CASH','BALANCE')),
    user_id INTEGER REFERENCES users(id), amount INTEGER NOT NULL CHECK(amount>0),
    session_id TEXT, actor_id TEXT NOT NULL, created_at TEXT NOT NULL,
    UNIQUE(booking_id,kind), CHECK(channel<>'BALANCE' OR user_id IS NOT NULL));
    CREATE INDEX IF NOT EXISTS idx_booking_funds_club_date ON booking_funds(club_id,created_at);
    CREATE TABLE IF NOT EXISTS session_funding_allocations(
      session_id TEXT PRIMARY KEY REFERENCES sessions(id), club_id INTEGER NOT NULL,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id),
      source_id INTEGER NOT NULL UNIQUE REFERENCES booking_funds(id),
      amount INTEGER NOT NULL CHECK(amount>0));
    CREATE TABLE IF NOT EXISTS session_funding_settlements(
      session_id TEXT PRIMARY KEY REFERENCES sessions(id), settled_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TRIGGER IF NOT EXISTS immutable_booking_funds_update BEFORE UPDATE ON booking_funds
      BEGIN SELECT RAISE(ABORT,'Bron pul tarixini o‘zgartirib bo‘lmaydi.'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_booking_funds_delete BEFORE DELETE ON booking_funds
      BEGIN SELECT RAISE(ABORT,'Bron pul tarixini o‘chirib bo‘lmaydi.'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_session_funding_update BEFORE UPDATE ON session_funding_allocations
      BEGIN SELECT RAISE(ABORT,'Seans pul manbasini o‘zgartirib bo‘lmaydi.'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_session_funding_delete BEFORE DELETE ON session_funding_allocations
      BEGIN SELECT RAISE(ABORT,'Seans pul manbasini o‘chirib bo‘lmaydi.'); END;
    CREATE TRIGGER IF NOT EXISTS booking_funds_protect_pc BEFORE DELETE ON computers
      WHEN EXISTS(SELECT 1 FROM bookings b JOIN booking_funds f ON f.booking_id=b.id AND f.club_id=b.club_id
        WHERE b.club_id=OLD.club_id AND b.computer_ref=OLD.id GROUP BY b.id
        HAVING sum(CASE WHEN f.kind='CAPTURE' THEN f.amount ELSE -f.amount END)>0)
      BEGIN SELECT RAISE(ABORT,'Avval bron depozitining qaytimini yakunlang.'); END;`);
}

export function bookingFunds(db,booking) {
  const rows=db.prepare('SELECT * FROM booking_funds WHERE club_id=? AND booking_id=? ORDER BY id').all(booking.club_id,booking.id);
  const source=rows.find(r=>r.kind==='CAPTURE');
  if(booking.payment_kind!=='NONE'&&!source)throw bookingError('Bron depoziti yozuvi topilmadi. Pul tarixini tekshiring.',409);
  const applied=rows.filter(r=>r.kind==='APPLY').reduce((n,r)=>n+r.amount,0);
  const refunded=rows.filter(r=>r.kind==='REFUND').reduce((n,r)=>n+r.amount,0);
  const held=(source?.amount||0)-applied-refunded;
  if(held<0)throw bookingError('Bron depozitini tekshirish kerak.',409);
  return {source,applied,refunded,held,cashRefundPending:source?.channel==='CASH' &&
    (booking.session_id||['CANCELLED','NO_SHOW'].includes(booking.status))?held:0};
}

function event(db,b,kind,source,amount,actor,now,sessionId=null) {
  if(!(amount>0))return;
  db.prepare(`INSERT INTO booking_funds(club_id,booking_id,kind,channel,user_id,amount,session_id,actor_id,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(b.club_id,b.id,kind,source.channel,source.user_id??null,amount,sessionId,String(actor.id??'system'),new Date(now).toISOString());
  db.prepare(`INSERT INTO audit_logs(club_id,actor_user_id,actor_username,category,action_type,details,created_at)
    VALUES(?,?,?,'SYSTEM',?,?,?)`).run(b.club_id,actor.id??null,actor.username||'Tizim','BOOKING_FUNDS_'+kind,
      JSON.stringify({bookingId:b.id,sessionId,amount,channel:source.channel}),new Date(now).toISOString());
}

export function captureBookingFunds(db,b,payment,actor,now) {
  if(!payment||payment.kind==='NONE')return;
  if(!['CASH','BALANCE'].includes(payment.kind)||!Number.isSafeInteger(payment.amount)||payment.amount<=0||payment.amount>100000000)
    throw bookingError('Depozit naqd yoki balansdan, 1–100 000 000 so‘m bo‘lishi kerak.');
  let userId=null;
  if(payment.kind==='BALANCE'){
    userId=payment.userId;
    if(!Number.isSafeInteger(userId)||db.prepare("UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND role='client' AND balance>=?")
      .run(payment.amount,userId,b.club_id,payment.amount).changes!==1)throw bookingError('Mijoz topilmadi yoki depozit uchun balans yetarli emas.',409);
  }
  db.prepare('UPDATE bookings SET payment_kind=?,user_id=? WHERE id=? AND club_id=?').run(payment.kind,userId,b.id,b.club_id);
  event(db,b,'CAPTURE',{channel:payment.kind,user_id:userId},payment.amount,actor,now);
}

export function releaseBookingFunds(db,b,actor,now,{confirmCash=false}={}) {
  const state=bookingFunds(db,b);
  if(!state.held)return state;
  if(state.source.channel==='CASH'&&!confirmCash)return state;
  if(state.source.channel==='BALANCE' && db.prepare('UPDATE users SET balance=balance+? WHERE id=? AND club_id=?')
    .run(state.held,state.source.user_id,b.club_id).changes!==1)throw bookingError('Depozit egasining hisobi topilmadi.',409);
  event(db,b,'REFUND',state.source,state.held,actor,now);
  return bookingFunds(db,b);
}

export function bookingFundingQuote(db,b,price,isPostpaid) {
  if(!b)return null;
  const f=bookingFunds(db,b);
  if(!f.source)return null;
  if(f.applied||f.refunded)throw bookingError('Depozit holatini qayta tekshiring.',409);
  const applied=isPostpaid?f.held:Math.min(f.held,price),excess=f.held-applied;
  return {...f,depositApplied:applied,additionalPayment:isPostpaid?0:price-applied,
    cashRefundPending:f.source.channel==='CASH'?excess:0,balanceRelease:f.source.channel==='BALANCE'?excess:0};
}

// Register the same ordinary session receipts, preserving the date of capture.
// Applying a hold never debits the wallet a second time.
export function recordSessionPayment(db,{clubId,sessionId,userId,amount,channel,actor,createdAt}) {
  if(amount<=0)return;
  if(channel==='BALANCE')db.prepare(`INSERT INTO client_transactions(club_id,user_id,amount,type,payment_method,category,session_id,created_at)
    VALUES(?,?,?,'SESSION_DEDUCT','BALANCE','GAME',?,?)`).run(clubId,userId,amount,sessionId,createdAt);
  else db.prepare(`INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_by,created_at)
    VALUES(?,?,?,?,?,?,'PREPAID',?,?)`).run('tx_'+crypto.randomUUID(),clubId,sessionId,amount,channel,channel,String(actor.id),createdAt);
}

export function applyBookingFunds(db,plan,actor,sessionId,now) {
  const {booking:b,funding:f}=plan;
  if(f.depositApplied>0){
    event(db,b,'APPLY',f.source,f.depositApplied,actor,now,sessionId);
    db.prepare('INSERT INTO session_funding_allocations(session_id,club_id,booking_id,source_id,amount) VALUES(?,?,?,?,?)')
      .run(sessionId,b.club_id,b.id,f.source.id,f.depositApplied);
    recordSessionPayment(db,{clubId:b.club_id,sessionId,userId:f.source.user_id,amount:f.depositApplied,channel:f.source.channel,actor,createdAt:f.source.created_at});
  }
  releaseBookingFunds(db,{...b,session_id:sessionId},actor,now);
}

export function hasBookingFunding(db,sessionId) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_funding_allocations'").get())return false;
  return !!db.prepare('SELECT 1 FROM session_funding_allocations WHERE session_id=?').get(sessionId);
}

export function bookingFundingPreview(db,session,gameBill,barBill) {
  if(!hasBookingFunding(db,session.id))return null;
  const wallet=db.prepare(`SELECT user_id,sum(CASE WHEN type='REFUND' THEN -amount ELSE amount END) amount
    FROM client_transactions WHERE club_id=? AND session_id=? AND category='GAME' AND type IN ('SESSION_DEDUCT','REFUND') GROUP BY user_id`)
    .all(session.club_id,session.id);
  const cash=db.prepare(`SELECT CASE WHEN COALESCE(payment_type,payment_method) IN ('CARD','CLICK','PAYME') THEN 'CARD' ELSE 'CASH' END channel,sum(amount) amount
    FROM transactions WHERE club_id=? AND session_id=? AND transaction_type IN ('PREPAID','POSTPAID_SETTLEMENT','REFUND')
    GROUP BY channel ORDER BY channel`).all(session.club_id,session.id);
  let remaining=gameBill;
  const walletRefunds=wallet.map(w=>{const spent=Math.min(Math.max(0,w.amount),remaining);remaining-=spent;return {...w,refund:Math.max(0,w.amount-spent)};});
  const cashTotal=cash.reduce((n,c)=>n+Math.max(0,c.amount),0);
  const gameAmountToCollect=Math.max(0,remaining-cashTotal),prepaidCredit=Math.max(0,cashTotal-remaining);
  const balanceRefund=walletRefunds.reduce((n,w)=>n+w.refund,0);
  return {walletRefunds,cash,gameAmountToCollect,prepaidCredit,balanceRefund,
    amountToCollect:Math.max(0,gameAmountToCollect+barBill-prepaidCredit),refundAmount:Math.max(0,prepaidCredit-barBill)};
}

export function settleBookingFunding(db,session,preview,paymentMethod,actorId) {
  const f=bookingFundingPreview(db,session,preview.gameBill,preview.barBill);
  if(!f)return false;
  refundFundingWallet(db,session,f);
  const write=(amount,method,type,notes)=>{if(amount)db.prepare(`INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_by,notes)
    VALUES(?,?,?,?,?,?,?,?,?)`).run('tx_'+crypto.randomUUID(),session.club_id,session.id,amount,method,method,type,String(actorId??'system'),notes);};
  let credit=f.prepaidCredit,bar=preview.barBill;
  for(const source of f.cash){
    const refund=Math.min(Math.max(0,source.amount),credit);credit-=refund;
    write(-refund,source.channel,'REFUND','REFUND (Zdacha)');
    const applied=Math.min(bar,refund);bar-=applied;
    write(applied,source.channel,'BAR_SALE','BAR_SALE_CHECKOUT_PREPAID_CREDIT');
  }
  write(f.gameAmountToCollect,paymentMethod,'POSTPAID_SETTLEMENT','GAME_TIME_SETTLEMENT');
  write(bar,paymentMethod,'BAR_SALE','BAR_SALE_CHECKOUT_COLLECTED');
  for(const id of preview.pendingOrderIds)db.prepare("UPDATE bar_orders SET payment_status='PAID',payment_method=?,paid_at=CURRENT_TIMESTAMP WHERE id=? AND club_id=? AND payment_status='PENDING_AT_CHECKOUT'")
    .run(paymentMethod,id,session.club_id);
  db.prepare('INSERT OR IGNORE INTO session_funding_settlements(session_id) VALUES(?)').run(session.id);
  return true;
}

export function refundFundingWallet(db,session,f) {
  for(const w of f.walletRefunds)if(w.refund>0){
    if(db.prepare('UPDATE users SET balance=balance+? WHERE id=? AND club_id=?').run(w.refund,w.user_id,session.club_id).changes!==1)
      throw bookingError('Qaytim uchun mijoz hisobi topilmadi.',409);
    db.prepare(`INSERT INTO client_transactions(club_id,user_id,amount,type,payment_method,category,session_id)
      VALUES(?,?,?,'REFUND','BALANCE','GAME',?)`).run(session.club_id,w.user_id,w.refund,session.id);
  }
}

export function bookingFundsReport(db,from,to,clubId=null) {
  // Explicit separate liability/movement summary; never added to GAME/TOPUP.
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='booking_funds'").get())return {cashCaptured:0,cashRefunded:0,cashHeld:0,balanceHeld:0,cashRefundPending:0};
  const scope=clubId===null?'':' AND f.club_id=?';
  const movement=db.prepare(`SELECT kind,sum(amount) amount FROM booking_funds f WHERE channel='CASH'
    AND date(created_at,'localtime') BETWEEN ? AND ?${scope} GROUP BY kind`).all(...(clubId===null?[from,to]:[from,to,clubId]));
  const rows=db.prepare(`SELECT b.status,b.session_id,f.channel,
    sum(CASE WHEN f.kind='CAPTURE' THEN f.amount ELSE -f.amount END) held
    FROM booking_funds f JOIN bookings b ON b.id=f.booking_id AND b.club_id=f.club_id
    WHERE 1=1${scope} GROUP BY f.club_id,f.booking_id,f.channel`).all(...(clubId===null?[]:[clubId]));
  const result={cashCaptured:movement.find(r=>r.kind==='CAPTURE')?.amount||0,cashRefunded:movement.find(r=>r.kind==='REFUND')?.amount||0,cashHeld:0,balanceHeld:0,cashRefundPending:0};
  for(const r of rows){result[r.channel==='CASH'?'cashHeld':'balanceHeld']+=r.held;
    if(r.channel==='CASH'&&(r.session_id||['CANCELLED','NO_SHOW'].includes(r.status)))result.cashRefundPending+=r.held;}
  return result;
}
