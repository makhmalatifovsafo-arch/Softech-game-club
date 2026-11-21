import { runMoneyOperation } from './moneyOperations.js';
import crypto from 'node:crypto';
import {captureBookingFunds,bookingFunds,releaseBookingFunds} from './bookingFunds.js';
import { assertBookingAvailability, bookingError, bookingInterval } from './bookingAvailability.js';

// Local reservation writes and receipts; no billing formulas.
function authorize(actor, manage = false) {
  if (!actor || !Number.isInteger(actor.clubId) || actor.clubId <= 0 || actor.id == null ||
    !['administrator', 'club_owner', 'superadmin'].includes(actor.role))
    throw bookingError('Bron amaliga ruxsat yo‘q.', 403, 'FORBIDDEN');
  const permissions = Array.isArray(actor.permissions) ? actor.permissions : [];
  if (manage && actor.role === 'administrator' && !permissions.some(p => ['*', 'session:manage', 'sessions:manage'].includes(p)))
    throw bookingError('Seans boshqarish ruxsati kerak.', 403, 'FORBIDDEN');
}

function request(db, actor, operation, input, write, manage = true) {
  authorize(actor, manage);
  if (typeof input?.requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId))
    throw bookingError('Amal uchun to‘g‘ri requestId kerak.');
  return runMoneyOperation(db, { clubId: actor.clubId, actorId: actor.id, operation,
    requestId: input.requestId, payload: input }, write);
}

function audit(db, actor, action, details, now) {
  // Fail with the transaction if the audit cannot be saved. No pre-commit WS.
  db.prepare(`INSERT INTO audit_logs(club_id,actor_user_id,actor_username,category,action_type,details,created_at)
    VALUES(?,?,?,'SYSTEM',?,?,?)`).run(actor.clubId, actor.id, actor.username || String(actor.id), action,
      JSON.stringify(details), new Date(now).toISOString());
}

export function readBookingSettings(db, actor) {
  authorize(actor, false);
  const row = db.prepare('SELECT grace_minutes,revision,creation_enabled FROM booking_settings WHERE club_id=?').get(actor.clubId);
  return { graceMinutes: row?.grace_minutes ?? 10, revision: row?.revision ?? 0, creationEnabled: row?.creation_enabled !== 0 };
}

export function saveBookingSettings(db, actor, input, now = Date.now()) {
  return request(db, actor, 'BOOKING_SETTINGS', input, () => {
    if (!Number.isInteger(input.graceMinutes) || input.graceMinutes < 1 || input.graceMinutes > 180)
      throw bookingError('Kutish vaqti 1–180 oralig‘idagi butun daqiqa bo‘lsin.');
    const before = readBookingSettings(db, actor);
    if (input.creationEnabled !== undefined && typeof input.creationEnabled !== 'boolean')
      throw bookingError('Yangi bron holati noto‘g‘ri.');
    if (input.expectedRevision !== before.revision) throw bookingError('Sozlama o‘zgargan. Qayta yuklang.', 409, 'REVISION_CONFLICT');
    db.prepare(`INSERT INTO booking_settings(club_id,grace_minutes,creation_enabled,revision) VALUES(?,?,?,1)
      ON CONFLICT(club_id) DO UPDATE SET grace_minutes=excluded.grace_minutes,creation_enabled=excluded.creation_enabled,revision=booking_settings.revision+1`)
      .run(actor.clubId, input.graceMinutes, Number(input.creationEnabled ?? before.creationEnabled));
    const settings = readBookingSettings(db, actor);
    audit(db, actor, 'BOOKING_SETTINGS_CHANGED', { before, after: settings }, now);
    return { status: 200, body: { success: true, settings } };
  }, false);
}

function bookingRow(db, clubId, id) {
  const row = db.prepare('SELECT * FROM bookings WHERE club_id=? AND id=?').get(clubId, id);
  if (!row) throw bookingError('Bron topilmadi.', 404, 'NOT_FOUND');
  return row;
}

export function reservationAllocation(db,actor,input) {
  authorize(actor,true);
  const ids=input.computerIds??[input.computerId];
  if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
    throw bookingError('1–100 ta turli kompyuterni tanlang.');
  if(input.computerIds&&input.computerId!=null)throw bookingError('Kompyuter tanlovini qayta tekshiring.');
  const payment=input.payment??{kind:'NONE',amount:0};
  if(!['NONE','CASH','BALANCE'].includes(payment.kind)||!Number.isSafeInteger(payment.amount)||payment.amount<0||payment.amount>100000000||
    (payment.kind==='NONE'?payment.amount!==0:payment.amount===0))throw bookingError('Depozit summasini to‘g‘ri kiriting.');
  if(payment.kind==='BALANCE'&&!db.prepare("SELECT 1 FROM users WHERE club_id=? AND id=? AND role='client'").get(actor.clubId,Number.isSafeInteger(payment.userId)?payment.userId:-1))throw bookingError('Balans egasini tanlang.');
  const pcs=ids.map(id=>{const pc=db.prepare('SELECT id,name,pc_number FROM computers WHERE club_id=? AND id=? AND pc_number>0').get(actor.clubId,id);if(!pc)throw bookingError('Kompyuter topilmadi.',404);return pc;}).sort((a,b)=>a.pc_number-b.pc_number||a.id.localeCompare(b.id));
  const each=Math.floor(payment.amount/pcs.length),remainder=payment.amount%pcs.length;
  return {totalDeposit:payment.amount,count:pcs.length,payment,allocations:pcs.map((pc,i)=>({computerId:pc.id,computerName:pc.name,deposit:each+(i<remainder?1:0)}))};
}

export function createFreeReservation(db, actor, input, now = Date.now()) {
  return request(db, actor, 'BOOKING_CREATE_FREE', input, () => {
    const allocation=reservationAllocation(db,actor,input),groupId=allocation.count>1?crypto.randomUUID():null;
    const entries=allocation.allocations.map(item=>writeReservation(db,actor,{...input,computerId:item.computerId,
      payment:item.deposit?{...allocation.payment,amount:item.deposit}:{kind:'NONE',amount:0}},now,groupId));
    return {status:201,body:{success:true,groupId,totalDeposit:allocation.totalDeposit,allocations:allocation.allocations,
      booking:entries[0].booking,funds:entries[0].funds,bookings:entries.map(e=>({...e.booking,funds:e.funds}))}};
  });
}

function writeReservation(db,actor,input,now,groupId) {
    // Check only new writes: a committed request must remain replayable while paused.
    if (!readBookingSettings(db, actor).creationEnabled)
      throw bookingError('Yangi bron qabul qilish vaqtincha to‘xtatilgan. Mavjud bronlar ishlashda davom etadi.', 409, 'BOOKING_CREATION_PAUSED');
    if (input.payment?.kind==='NONE' && input.payment.amount!==0)
      throw bookingError('To‘lovsiz bron summasi 0 bo‘lishi kerak.');
    if (input.depositAmount != null || input.status != null || input.sessionId != null || input.clubId != null)
      throw bookingError('Bronning holati, klubi va to‘lovi server tomonidan belgilanadi.');
    const name = String(input.customerName ?? '').trim();
    if (!name || name.length > 160) throw bookingError('Mijoz ismini kiriting (160 belgigacha).');
    const interval = bookingInterval(input.startTime, input.endTime);
    if (interval.startMs < now) throw bookingError('O‘tgan vaqtga yangi bron yaratib bo‘lmaydi.');
    const { pc } = assertBookingAvailability(db, { clubId: actor.clubId, computerId: input.computerId,
      start: interval.start, end: interval.end });
    const { graceMinutes } = readBookingSettings(db, actor);
    if(graceMinutes<1)throw bookingError('Avval bron kutish vaqtini kamida 1 daqiqa qilib saqlang.');
    const noShow = new Date(Math.min(interval.endMs, interval.startMs + graceMinutes * 60000)).toISOString();
    const result = db.prepare(`INSERT INTO bookings(club_id,computer_id,computer_ref,customer_name,customer_phone,
      start_time,end_time,note,status,created_by,created_at,grace_minutes,no_show_at,booking_version)
      VALUES(?,?,?,?,?,?,?,?,'CONFIRMED',?,?,?,?,2)`).run(actor.clubId, pc.pc_number, pc.id, name,
        String(input.customerPhone ?? '').slice(0,60), interval.start, interval.end, String(input.note ?? '').slice(0,2000),
        String(actor.id), new Date(now).toISOString(), graceMinutes, noShow);
    const id=Number(result.lastInsertRowid);
    if(groupId)db.prepare('UPDATE bookings SET group_id=? WHERE id=? AND club_id=?').run(groupId,id,actor.clubId);
    let booking = bookingRow(db, actor.clubId, id);
    captureBookingFunds(db,booking,input.payment,actor,now);
    booking=bookingRow(db,actor.clubId,booking.id);
    audit(db, actor, 'BOOKING_CREATED', { bookingId: booking.id, computerId: pc.id,
      startTime: booking.start_time, endTime: booking.end_time, graceMinutes, amount: 0,groupId,depositAmount:input.payment.amount }, now);
    return {booking, funds:bookingFunds(db,booking)};
}

export function cancelFreeReservation(db, actor, input, now = Date.now()) {
  return request(db, actor, 'BOOKING_CANCEL_FREE', input, () => {
    const row = bookingRow(db, actor.clubId, input.bookingId);
    if (![1,2].includes(row.booking_version)) throw bookingError('Bu bron uchun boshqa bekor qilish oqimi kerak.', 409);
    if (input.expectedRevision !== row.revision) throw bookingError('Bron o‘zgargan. Qayta yuklang.', 409, 'REVISION_CONFLICT');
    if (!['PENDING','CONFIRMED'].includes(row.status) || row.session_id)
      throw bookingError('Bu holatdagi bronni bekor qilib bo‘lmaydi.', 409, 'BOOKING_STATE_CONFLICT');
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) throw bookingError('Bekor qilish sababini kiriting (500 belgigacha).');
    db.prepare(`UPDATE bookings SET status='CANCELLED',revision=revision+1,cancelled_at=?,cancellation_reason=? WHERE id=? AND club_id=?`)
      .run(new Date(now).toISOString(), reason, row.id, actor.clubId);
    audit(db, actor, 'BOOKING_CANCELLED', { bookingId: row.id, computerId: row.computer_ref, reason }, now);
    const booking=bookingRow(db,actor.clubId,row.id);
    const funds=releaseBookingFunds(db,booking,actor,now);
    return { status: 200, body: { success: true, booking, funds } };
  });
}

// Explicit bounded sweep, also used by the server's accepted-startup timer.
// A separate transaction per booking; cash refunds require a cashier confirmation.
export function expireFreeReservations(db, clubId, now = Date.now(), limit = 50) {
  if (!Number.isInteger(clubId) || clubId <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 100)
    throw bookingError('Bron navbati parametrlari noto‘g‘ri.');
  const ids = db.prepare(`SELECT id FROM bookings WHERE club_id=? AND booking_version=2
    AND needs_review=0 AND session_id IS NULL AND status IN ('PENDING','CONFIRMED') AND no_show_at<=? ORDER BY no_show_at,id LIMIT ?`)
    .all(clubId, new Date(now).toISOString(), limit);
  let expired = 0;
  for (const { id } of ids) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const row = bookingRow(db, clubId, id);
      if (row.booking_version === 2 && !row.needs_review && !row.session_id &&
        ['PENDING','CONFIRMED'].includes(row.status) && Date.parse(row.no_show_at) <= now) {
        db.prepare(`UPDATE bookings SET status='NO_SHOW',revision=revision+1,cancelled_at=?,cancellation_reason='NO_SHOW' WHERE id=? AND club_id=?`)
          .run(new Date(now).toISOString(), id, clubId);
        audit(db, { clubId, id: null, username: 'Tizim' }, 'BOOKING_NO_SHOW', { bookingId: id, computerId: row.computer_ref }, now);
        releaseBookingFunds(db,{...row,status:'NO_SHOW'},{id:null,username:'Tizim'},now);
        expired++;
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return expired;
}

export function confirmBookingCashRefund(db,actor,input,now=Date.now()) {
  return request(db,actor,'BOOKING_CASH_REFUND',input,()=>{
    const b=bookingRow(db,actor.clubId,input.bookingId),funds=bookingFunds(db,b);
    if(input.expectedRevision!==b.revision)throw bookingError('Bron o‘zgargan. Qayta yuklang.',409);
    if(!funds.cashRefundPending || input.amount!==funds.cashRefundPending || input.confirmed!==true)
      throw bookingError('Qaytariladigan naqd summa va pul berilganini tasdiqlang.',409);
    const result=releaseBookingFunds(db,b,actor,now,{confirmCash:true});
    db.prepare('UPDATE bookings SET revision=revision+1 WHERE id=? AND club_id=?').run(b.id,b.club_id);
    return {status:200,body:{success:true,booking:bookingRow(db,b.club_id,b.id),funds:result}};
  });
}
