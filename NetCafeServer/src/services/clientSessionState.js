import { db, getClubSettings } from '../db.js';
import { calculateIntervalPrice, resolveZoneIdForComputer } from './pricingEngine.js';
import { canClientCloseSession, isPostpaidSession } from './sessionMode.js';

// Both cashier checkout and the client display use this calculation.
export function postpaidGameBill(session, now = Date.now()) {
  const started = Date.parse(session.started_at);
  if (!Number.isFinite(started) || !Number.isFinite(now)) throw new Error('Seans vaqti noto‘g‘ri. Hisobni tekshiring.');
  const elapsed = Math.max(0, now - started);
  if (!elapsed) return 0;
  const settings = getClubSettings(session.club_id);
  if (settings.vip_pricing_mode === 'CUSTOM') {
    const rate = Number(settings.vip_custom_price);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('VIP soatlik narxi noto‘g‘ri. Tarifni tekshiring.');
    return Math.round(elapsed / 3600000 * rate);
  }
  return calculateIntervalPrice(session.started_at,new Date(now),true,session.club_id,
    resolveZoneIdForComputer(session.computer_id,session.club_id)).totalAmount;
}

export function sessionGameAmount(session, now = Date.now()) {
  if (!isPostpaidSession(session)) return { gameAmount:Number(session.paid_amount || session.total_amount || 0), billingError:null };
  try { return { gameAmount:postpaidGameBill(session,now), billingError:null }; }
  catch (error) { return { gameAmount:null, billingError:error.message || 'Hisobni aniqlash uchun kassirga murojaat qiling.' }; }
}

export function clientSessionState(id, now = Date.now()) {
  const session = db.prepare("SELECT * FROM sessions WHERE id=? AND status='ACTIVE'").get(id);
  if (!session) return {};
  const postpaid = isPostpaidSession(session);
  const startedAt = Date.parse(session.started_at);
  const {gameAmount,billingError} = sessionGameAmount(session,now);
  const member = /^CLIENT_BALANCE_(PREPAID|LIVE):/.test(session.notes || '');
  return {
    canSelfClose:canClientCloseSession(session), isPostpaid:postpaid, startedAt,
    remainingSeconds:postpaid ? -1 : Math.max(0,Math.ceil((Date.parse(session.ends_at)-now)/1000)),
    clientBalance:member ? db.prepare('SELECT balance FROM users WHERE id=? AND club_id=?').get(session.user_id,session.club_id)?.balance : null,
    sessionInfo:{sessionId:id,isPostpaid:postpaid,canSelfClose:canClientCloseSession(session),startedAt,asOf:now,gameAmount,billingError}
  };
}
