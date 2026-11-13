import { db, getClubSettings } from '../db.js';
import { createHash } from 'node:crypto';
import { isPostpaidSession } from './sessionMode.js';
import { postpaidGameAmount } from './clientSessionState.js';
import { frozenPriceSegments } from './prepaidTransferPlan.js';
import { isLiveMember, settleMemberUsage, prepaidRefund } from './memberBilling.js';
import { getActiveRateForMoment, requireRateForMoment, resolveZoneIdForComputer, calculateIntervalPrice, calculateTimeFromAmount } from './pricingEngine.js';

const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function findComputer(value,clubId) {
  const ref=String(value),number=/^\d+$/.test(ref)?Number(ref):-1;
  return db.prepare(`SELECT * FROM computers WHERE (? IS NULL OR club_id=?) AND (id=? OR name=? OR pc_number=?)
    ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1`).get(clubId,clubId,ref,ref,number,ref);
}

function prepareTransfer({fromComputerId,toComputerId,clubId,now=Date.now()}) {
  if (!fromComputerId || !toComputerId) throw fail('Manba va maqsad kompyuterni tanlang.');
    const from=findComputer(fromComputerId,clubId),to=findComputer(toComputerId,clubId);
    if (!from || !to) throw fail('Kompyuter topilmadi yoki boshqa klubga tegishli.');
    if (from.id===to.id) throw fail('Bir xil kompyuterga ko‘chirib bo‘lmaydi.');
    if (from.club_id!==to.club_id) throw fail('Turli klublar o‘rtasida ko‘chirib bo‘lmaydi.');
    if (to.current_session_id || db.prepare("SELECT id FROM sessions WHERE computer_id=? AND status='ACTIVE'").get(to.id))
      throw fail('Maqsad kompyuterda faol seans mavjud.');
    let session=db.prepare("SELECT * FROM sessions WHERE id=? AND computer_id=? AND club_id=? AND status='ACTIVE'")
      .get(from.current_session_id,from.id,from.club_id);
    if (!session) throw fail('Manba kompyuterda faol seans yo‘q.');
    const postpaid=isPostpaidSession(session);
    if (!postpaid && Date.parse(session.ends_at)<=now) throw fail('Seans vaqti tugagan. Avval hisobini yoping.');
    const sourceZone=resolveZoneIdForComputer(from.id,session.club_id),targetZone=resolveZoneIdForComputer(to.id,session.club_id);
    const oldRate=getActiveRateForMoment(new Date(now),postpaid,session.club_id,sourceZone);
    const newRate=requireRateForMoment(new Date(now),postpaid,session.club_id,targetZone);
    let carriedAmount=null,remainingAmount=null,usedAmount=null,newEndsAt=session.ends_at,plan=null;
    if (postpaid) {
      if (newRate.isVipPostpaidAllowed===false) throw fail('Maqsad xonada VIP Postpaid taqiqlangan.');
      carriedAmount=postpaidGameAmount(session,now);
      const settings=getClubSettings(session.club_id);
      if (settings.vip_pricing_mode==='CUSTOM') oldRate.pricePerHour=newRate.pricePerHour=settings.vip_custom_price;
    } else if (!isLiveMember(session)) {
      const paid=Number(session.paid_amount || session.total_amount);
      const refund=session.prepaid_rate_plan ? prepaidRefund(session,new Date(now)) : {
        usedAmount:Math.min(paid,calculateIntervalPrice(session.started_at,new Date(now),false,session.club_id,sourceZone).totalAmount)
      };
      usedAmount=refund.usedAmount;remainingAmount=Math.max(0,paid-usedAmount);
      if (!(remainingAmount>0)) throw fail('Ko‘chirish uchun to‘langan qoldiq qolmagan.');
      const quote=calculateTimeFromAmount(new Date(now),remainingAmount,false,session.club_id,targetZone,true);
      newEndsAt=quote.endTime;
      plan=frozenPriceSegments(to.id,session.club_id,new Date(now).toISOString(),newEndsAt);
      if (usedAmount>0) plan.segments.unshift([Date.parse(session.started_at),now,usedAmount]);
      let saved;try {saved=JSON.parse(session.prepaid_rate_plan || 'null');} catch {}
      if (saved?.version===2) {
        const slice=saved.segments.find(([a,b])=>a<=now&&b>now);
        if(slice)oldRate.pricePerHour=slice[2]/(slice[1]-slice[0])*3600000;
      } else if (Array.isArray(saved)) {
        const perMinute=saved[Math.floor((now-Date.parse(session.started_at))/60000)];
        if(perMinute>0)oldRate.pricePerHour=perMinute*60;
      }
    }
    const revision=createHash('sha256').update(JSON.stringify({session,from:from.id,to:to.id,sourceZone,targetZone,
      oldRate,newRate,settings:getClubSettings(session.club_id),
      tariffs:db.prepare('SELECT * FROM tariffs WHERE club_id=? ORDER BY id').all(session.club_id),
      schedules:db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY id').all(session.club_id)})).digest('hex');
    const preview={sessionId:session.id,fromComputerId:from.id,toComputerId:to.id,isPostpaid:postpaid,isLiveBalance:isLiveMember(session),
      oldRemainingSeconds:postpaid?-1:Math.max(0,(Date.parse(session.ends_at)-now)/1000),
      newRemainingSeconds:postpaid?-1:Math.max(0,(Date.parse(newEndsAt)-now)/1000),
      carriedAmount:carriedAmount===null?null:Math.round(carriedAmount),remainingAmount,usedAmount,
      oldRate:oldRate.pricePerHour,newRate:newRate.pricePerHour,newEndsAt,quoteRevision:revision,quotedAt:new Date(now).toISOString()};
    return {from,to,session,postpaid,carriedAmount,plan,preview};
}

export function previewSessionTransfer(options) { return prepareTransfer(options).preview; }

export function transferSession(options) {
  const {now=Date.now(),quoteRevision}=options;
  db.exec('BEGIN IMMEDIATE');
  try {
    const {from,to,session,postpaid,carriedAmount,plan,preview}=prepareTransfer({...options,now});
    // Older clients may only transfer a prepaid session when its remaining duration is unchanged.
    if ((!postpaid && Math.abs(preview.oldRemainingSeconds-preview.newRemainingSeconds)>1 && !quoteRevision) ||
        (quoteRevision && quoteRevision!==preview.quoteRevision))
      throw fail('Ko‘chirish hisobini qayta ko‘rib, yangi vaqtni tasdiqlang.',409);
    if (postpaid) {
      db.prepare('UPDATE sessions SET postpaid_carried_amount=?,postpaid_billing_started_at=? WHERE id=?')
        .run(carriedAmount,new Date(now).toISOString(),session.id);
    } else if (isLiveMember(session)) {
      const settled=settleMemberUsage(session.id,new Date(now),false,true);
      if (settled?.exhausted) throw fail('Mijoz balansi yoki seans vaqti tugagan.');
    } else {
      db.prepare('UPDATE sessions SET prepaid_rate_plan=?,ends_at=? WHERE id=?').run(JSON.stringify(plan),preview.newEndsAt,session.id);
    }
    // Legacy debt without a session id must follow the customer, not the next user of this PC.
    db.prepare(`UPDATE bar_orders SET session_id=? WHERE club_id=? AND session_id IS NULL
      AND payment_status='PENDING_AT_CHECKOUT' AND (computer_id=? OR computer_id=?)`)
      .run(session.id,session.club_id,from.id,from.pc_number);
    db.prepare("UPDATE sessions SET computer_id=?,notes=COALESCE(notes,'') || ' | TRANSFER: ' || ? || '->' || ?,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(to.id,from.name,to.name,session.id);
    db.prepare("UPDATE computers SET status='LOCKED',current_session_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(from.id);
    db.prepare("UPDATE computers SET status='OCCUPIED',current_session_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(session.id,to.id);
    const updated=db.prepare('SELECT * FROM sessions WHERE id=?').get(session.id);
    db.exec('COMMIT');
    return {session:updated,from,to,isPostpaid:postpaid,carriedAmount:preview.carriedAmount,preview,
      remainingSeconds:postpaid?-1:Math.max(0,Math.ceil((Date.parse(updated.ends_at)-now)/1000)),transferredAt:new Date(now).toISOString()};
  } catch(error) {db.exec('ROLLBACK');throw error;}
}
