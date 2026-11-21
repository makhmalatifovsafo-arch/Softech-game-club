import { isPostpaidSession } from './sessionMode.js';

export const bookingError = (message, statusCode = 400, code = 'BOOKING_INVALID') =>
  Object.assign(new Error(message), { statusCode, code });

export function bookingInterval(start, end) {
  // Require an unambiguous instant, never the browser's implicit timezone.
  const explicit = value => {
    if (typeof value !== 'string') return false;
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/);
    if (!m) return false;
    const [,y,month,day,h,min,sec] = m.map(Number);
    const date = new Date(0); date.setUTCFullYear(y, month - 1, day);
    return date.getUTCFullYear() === y && date.getUTCMonth() === month - 1 && date.getUTCDate() === day && h < 24 && min < 60 && sec < 60;
  };
  const a = Date.parse(start), b = Date.parse(end);
  if (!explicit(start) || !explicit(end) || !Number.isFinite(a) || !Number.isFinite(b) || b <= a)
    throw bookingError('Boshlanish va tugash sanasi vaqt zonasi bilan to‘g‘ri ko‘rsatilishi kerak.');
  return { start: new Date(a).toISOString(), end: new Date(b).toISOString(), startMs: a, endMs: b };
}

// Call inside the same writer transaction as a start/extend/transfer/create.
// Preview may also call this, but is never authority to skip the final check.
export function assertBookingAvailability(db, { clubId, computerId, start, end, excludeBookingId = 0, excludeSessionId = null, openEnded = false }) {
  const interval = bookingInterval(start, end);
  const pc = db.prepare('SELECT * FROM computers WHERE club_id=? AND id=? AND pc_number>0').get(clubId, computerId);
  if (!pc) throw bookingError('Kompyuter topilmadi.', 404);
  const bookings = db.prepare(`SELECT * FROM bookings WHERE club_id=? AND id<>?
    AND (status IN ('PENDING','CONFIRMED') OR (status='ACTIVE' AND session_id IS NULL))
    AND (computer_ref=? OR (computer_ref IS NULL AND computer_id=?))`).all(clubId, excludeBookingId, pc.id, pc.pc_number);
  for (const row of bookings) {
    const a = Date.parse(row.start_time), b = Date.parse(row.end_time);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a)
      throw bookingError('Ushbu PCning eski bron vaqtini tekshirish kerak.', 409, 'BOOKING_REVIEW_REQUIRED');
    if (b > interval.startMs && (openEnded || a < interval.endMs))
      throw Object.assign(bookingError('Ushbu kompyuter tanlangan vaqtda bron qilingan.', 409, 'BOOKING_CONFLICT'),
        { conflict: { bookingId: row.id, startTime: row.start_time, endTime: row.end_time } });
  }
  const sessions = db.prepare("SELECT * FROM sessions WHERE club_id=? AND computer_id=? AND status='ACTIVE'").all(clubId, pc.id);
  if (pc.current_session_id && pc.current_session_id !== excludeSessionId && !sessions.some(s => s.id === pc.current_session_id)) {
    const pointed = db.prepare('SELECT status FROM sessions WHERE id=? AND club_id=?').get(pc.current_session_id,clubId);
    if (!pointed || pointed.status==='ACTIVE')
      throw bookingError('Kompyuterning faol seans holatini tekshiring.', 409, 'SESSION_STATE_CONFLICT');
  }
  for (const session of sessions) {
    if (session.id === excludeSessionId) continue;
    const a = Date.parse(session.started_at), b = Date.parse(session.ends_at);
    const unlimited = isPostpaidSession(session) || String(session.notes || '').startsWith('CLIENT_BALANCE_LIVE:');
    if (!Number.isFinite(a) || !Number.isFinite(b) || unlimited ||
      (b > interval.startMs && (openEnded || a < interval.endMs)))
      throw bookingError('Kompyuterda tanlangan vaqtga to‘g‘ri keladigan faol seans bor.', 409, 'SESSION_CONFLICT');
  }
  return { pc, ...interval };
}
