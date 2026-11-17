import { emptySetupDraft, normalizeSetupDraft, setupLiveClients } from './clubSetup.js';
import { createHash } from 'node:crypto';
export function setupFingerprint(db,clubId){
  const values=[db.prepare('SELECT * FROM zones WHERE club_id=? ORDER BY id').all(clubId),
    db.prepare('SELECT * FROM tariffs WHERE club_id=? ORDER BY id').all(clubId),
    db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY id').all(clubId),
    db.prepare('SELECT * FROM grid_layout WHERE club_id=? ORDER BY computer_id').all(clubId),
    db.prepare('SELECT id,pc_number,name,zone_id FROM computers WHERE club_id=? AND pc_number>0 ORDER BY id').all(clubId)];
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

// Read-only source for the editor. Does not invent rooms or flatten fallback,
// priority, VIP-specific or package pricing into a different business rule.
export function clubSetupContext(db,clubId,{clients=[],maxComputers,heartbeatTimeoutMs=15000,now=Date.now()}={}) {
  const roomRows=db.prepare('SELECT * FROM zones WHERE club_id=? ORDER BY id').all(clubId);
  const pcRows=db.prepare(`SELECT c.*,g.x,g.y,COALESCE(c.zone_id,g.zone_id) AS room_id
    FROM computers c LEFT JOIN grid_layout g ON g.club_id=c.club_id AND g.computer_id=c.pc_number
    WHERE c.club_id=? AND c.pc_number>0 ORDER BY c.pc_number`).all(clubId);
  const rates=db.prepare("SELECT * FROM tariffs WHERE club_id=? AND is_active=1 ORDER BY id").all(clubId);
  const general=db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY priority DESC,id').all(clubId);
  const notices=[];const draft=emptySetupDraft();
  draft.rooms=roomRows.map(r=>{
    let polygonPoints;
    if(r.polygon_points){try{polygonPoints=JSON.parse(r.polygon_points);}catch{throw Object.assign(Error('Mavjud xona shaklini o‘qib bo‘lmadi. Xaritani sozlamalarda tekshiring.'),{statusCode:422});}}
    return {id:'room_'+r.id,name:r.name,type:r.zone_type,x:r.x,y:r.y,width:r.width,height:r.height,...(polygonPoints?{polygonPoints}:{})};
  });
  draft.computers=pcRows.map(c=>({id:'pc_'+c.pc_number,number:c.pc_number,name:c.name,roomId:c.room_id?'room_'+c.room_id:'',
    ip:c.ip_address||'',mac:c.mac_address||'',x:Number(c.x)||0,y:Number(c.y)||0}));
  draft.expectedComputers=draft.computers.length;
  draft.tariffs=rates.filter(r=>r.type==='HOURLY'&&r.zone_id&&roomRows.some(z=>z.id===r.zone_id)).map(r=>{
    let days;try{days=typeof r.days_of_week==='string'?JSON.parse(r.days_of_week):r.days_of_week;}catch{days=[];}
    return {id:'rate_'+createHash('sha256').update(String(r.id)).digest('hex').slice(0,40),roomId:'room_'+r.zone_id,name:r.name,start_time:r.start_time||'00:00',end_time:r.end_time||'00:00',
      days_of_week:days??[1,2,3,4,5,6,7],price_per_hour:r.price_per_hour,vipAllowed:Boolean(r.is_vip_postpaid_allowed)};
  });
  if(general.length)notices.push('Umumiy dinamik tariflar mavjud. Ular pastda alohida ko‘rsatiladi; xona tariflariga avtomatik aylantirilmaydi.');
  if(rates.some(r=>r.type!=='HOURLY'||!r.zone_id))notices.push('Umumiy yoki paket tariflari amaldagi sozlamalarda saqlanadi. Bu usta hozir xona soatlik tariflarini tahrirlaydi.');
  const activeSessions=db.prepare("SELECT count(*) AS n FROM sessions WHERE club_id=? AND status='ACTIVE'").get(clubId).n;
  const liveClients=setupLiveClients(db,clubId,clients).map(c=>({...c,connected:c.connected&&Number.isFinite(c.lastHeartbeat)&&now-c.lastHeartbeat>=0&&now-c.lastHeartbeat<=heartbeatTimeoutMs}));
  const club=db.prepare('SELECT name FROM clubs WHERE id=?').get(clubId);
  return {fingerprint:setupFingerprint(db,clubId),clubName:club?.name||'Klub',maxComputers:Number.isInteger(maxComputers)?maxComputers:null,serverTime:new Date(now).toISOString(),
    initialDraft:normalizeSetupDraft(draft),liveClients,activeSessions,notices,
    otherTariffs:[...general.map(r=>({name:r.name,price:r.price_per_hour,start:r.start_time,end:r.end_time,days:r.days_of_week,vip:Boolean(r.is_vip)})),
      ...rates.filter(r=>r.type!=='HOURLY'||!r.zone_id).map(r=>({name:r.name,price:r.type==='HOURLY'?r.price_per_hour:r.fixed_price,type:r.type,durationMinutes:r.fixed_duration_minutes}))]};
}
