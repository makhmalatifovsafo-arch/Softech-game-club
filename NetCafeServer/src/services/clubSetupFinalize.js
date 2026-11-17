import {randomUUID} from 'node:crypto';
import {ClubSetupDrafts,evaluateSetupDraft} from './clubSetup.js';
import {clubSetupContext,setupFingerprint} from './clubSetupContext.js';
import {normalizeMacAddress} from './macAddress.js';
const fail=(message,statusCode=409)=>Object.assign(Error(message),{statusCode});
export function clubSetupStatus(db,clubId){
  const row=db.prepare('SELECT installation_kind,completed_at FROM club_setup_drafts WHERE club_id=?').get(clubId);
  if(!row)throw fail('Klub sozlash holati topilmadi.',503);
  return {required:row.installation_kind==='NEW'&&!row.completed_at,completedAt:row.completed_at,installationKind:row.installation_kind};
}
export function finalizeClubSetup(db,clubId,actorId,input,options={}){
  const {requestId,revision}=input||{};
  if(!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId||'')||!Number.isSafeInteger(revision)||revision<0)throw fail('Saqlash so‘rovi noto‘g‘ri.',400);
  db.exec('BEGIN IMMEDIATE');
  try{
    const prior=db.prepare('SELECT * FROM club_setup_receipts WHERE club_id=? AND request_id=?').get(clubId,requestId);
    if(prior){if(prior.revision!==revision)throw fail('Bu so‘rov raqami boshqa qoralama uchun ishlatilgan.');db.exec('COMMIT');return JSON.parse(prior.receipt_json);}
    const state=new ClubSetupDrafts(db).read(clubId);
    if(state.revision!==revision)throw fail('Qoralama boshqa oynada o‘zgargan. Yangi nusxani oching.');
    if(!state.baseFingerprint||state.baseFingerprint!==setupFingerprint(db,clubId))throw fail('Klub sozlamalari o‘zgargan. “Amaldagi holatni tekshirish” orqali farqlarni ko‘rib chiqing.');
    const current=clubSetupContext(db,clubId,options),draft=state.draft;
    if(current.activeSessions)throw fail('Faol seanslar bor. Ular tugagach sozlamalarni qo‘llang.');
    const ready=evaluateSetupDraft(draft,{...options,liveClients:current.liveClients});
    if(!ready.draftValid||ready.warnings.length)throw fail(ready.issues[0]?.message||'Har bir xonaga 24/7 tarif kiriting. Bo‘sh vaqt oralig‘i qolmasin.',422);
    // Identity is the registered PC, never a guessed ID or a new duplicate row.
    const pcs=db.prepare('SELECT * FROM computers WHERE club_id=? AND pc_number>0').all(clubId);
    if(pcs.length!==draft.computers.length||pcs.some(p=>draft.computers.filter(c=>c.number===p.pc_number).length!==1))
      throw fail('Ro‘yxat barcha haqiqiy clientlarga mos bo‘lsin. Mavjud PC’ni o‘chirish yoki qayta raqamlash uchun asosiy sozlamalardan foydalaning.');
    for(const room of current.initialDraft.rooms)if(!draft.rooms.some(r=>r.id===room.id))
      throw fail('Mavjud xonani o‘chirish uchun asosiy xarita sozlamalaridan foydalaning. Usta uning tarixini o‘chirmaydi.');
    const roomIds=new Map();
    for(const room of draft.rooms){
      const original=current.initialDraft.rooms.find(r=>r.id===room.id);
      let zoneId;
      if(original){zoneId=Number(room.id.slice(5));db.prepare('UPDATE zones SET name=?,zone_type=?,x=?,y=?,width=?,height=?,polygon_points=? WHERE id=? AND club_id=?')
        .run(room.name,room.type,room.x,room.y,room.width,room.height,room.polygonPoints?JSON.stringify(room.polygonPoints):null,zoneId,clubId);}
      else zoneId=Number(db.prepare('INSERT INTO zones(club_id,name,zone_type,x,y,width,height,polygon_points) VALUES(?,?,?,?,?,?,?,?)')
        .run(clubId,room.name,room.type,room.x,room.y,room.width,room.height,room.polygonPoints?JSON.stringify(room.polygonPoints):null).lastInsertRowid);
      roomIds.set(room.id,zoneId);
      // Retain old tariff IDs and values for historical sessions.
      db.prepare("UPDATE tariffs SET is_active=0 WHERE club_id=? AND zone_id=? AND type='HOURLY'").run(clubId,zoneId);
    }
    for(const rate of draft.tariffs)db.prepare(`INSERT INTO tariffs(id,club_id,zone_id,name,price_per_hour,type,start_time,end_time,days_of_week,is_vip_postpaid_allowed,is_active)
      VALUES(?,?,?,?,?,'HOURLY',?,?,?,?,1)`).run('setup_'+randomUUID(),clubId,roomIds.get(rate.roomId),rate.name,rate.price_per_hour,
        rate.start_time,rate.end_time,JSON.stringify(rate.days_of_week),rate.vipAllowed===false?0:1);
    for(const pc of draft.computers){
      const original=pcs.find(p=>p.pc_number===pc.number),zoneId=roomIds.get(pc.roomId),room=draft.rooms.find(r=>r.id===pc.roomId);
      db.prepare('UPDATE computers SET name=?,ip_address=?,mac_address=?,zone_id=?,zone=? WHERE id=? AND club_id=?')
        .run(pc.name,pc.ip,pc.mac?normalizeMacAddress(pc.mac):(original.mac_address||null),zoneId,room.type==='VIP'?'VIP':room.type==='PS5'?'PLAYSTATION':'STANDARD',original.id,clubId);
      db.prepare(`INSERT INTO grid_layout(club_id,computer_id,x,y,zone_id,is_visible) VALUES(?,?,?,?,?,1)
        ON CONFLICT(club_id,computer_id) DO UPDATE SET x=excluded.x,y=excluded.y,zone_id=excluded.zone_id,is_visible=1`)
        .run(clubId,pc.number,pc.x,pc.y,zoneId);
    }
    const completedAt=new Date().toISOString();
    const canonical=clubSetupContext(db,clubId,options);canonical.initialDraft.step='review';
    const receipt={requestId,clubId,revision,appliedRevision:revision+1,completedAt,rooms:draft.rooms.length,computers:draft.computers.length,tariffs:draft.tariffs.length};
    db.prepare('UPDATE club_setup_drafts SET completed_at=COALESCE(completed_at,?),draft_json=?,base_fingerprint=?,revision=revision+1,updated_by=?,updated_at=? WHERE club_id=?')
      .run(completedAt,JSON.stringify(canonical.initialDraft),canonical.fingerprint,String(actorId),completedAt,clubId);
    db.prepare('INSERT INTO club_setup_receipts VALUES(?,?,?,?)').run(clubId,requestId,revision,JSON.stringify(receipt));
    db.exec('COMMIT');return receipt;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
