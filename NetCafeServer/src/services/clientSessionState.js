import { db, getClubSettings } from '../db.js';
import { calculateIntervalPrice, resolveZoneIdForComputer } from './pricingEngine.js';
import { canClientCloseSession, isPostpaidSession } from './sessionMode.js';

// Both cashier checkout and the client display use this calculation.
export function postpaidGameBill(session, now = Date.now()) {
  const elapsed = Math.max(0, now - Date.parse(session.started_at));
  if (!elapsed) return 0;
  const settings = getClubSettings(session.club_id);
  if (settings.vip_pricing_mode === 'CUSTOM')
    return Math.round(Math.max(1,Math.ceil(elapsed/60000)) / 60 * settings.vip_custom_price);
  return calculateIntervalPrice(session.started_at,new Date(now),true,session.club_id,
    resolveZoneIdForComputer(session.computer_id,session.club_id)).totalAmount;
}

export function clientSessionState(id, now = Date.now()) {
  const session = db.prepare("SELECT * FROM sessions WHERE id=? AND status='ACTIVE'").get(id);
  if (!session) return {};
  const postpaid = isPostpaidSession(session);
  const startedAt = Date.parse(session.started_at);
  let gameAmount = Number(session.paid_amount || session.total_amount || 0), billingError = null;
  if (postpaid) {
    try { gameAmount = postpaidGameBill(session,now); }
    catch { gameAmount = null; billingError = 'Hisobni aniqlash uchun kassirga murojaat qiling.'; }
  }
  const member = /^CLIENT_BALANCE_(PREPAID|LIVE):/.test(session.notes || '');
  return {
    canSelfClose:canClientCloseSession(session), isPostpaid:postpaid, startedAt,
    remainingSeconds:postpaid ? -1 : Math.max(0,Math.ceil((Date.parse(session.ends_at)-now)/1000)),
    clientBalance:member ? db.prepare('SELECT balance FROM users WHERE id=? AND club_id=?').get(session.user_id,session.club_id)?.balance : null,
    sessionInfo:{sessionId:id,isPostpaid:postpaid,canSelfClose:canClientCloseSession(session),startedAt,asOf:now,gameAmount,billingError}
  };
}
