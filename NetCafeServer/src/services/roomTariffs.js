import {createHash,randomUUID} from 'node:crypto';
import {validateSchedule} from './tariffValidation.js';
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});

export function initializeRoomTariffs(db){
  if(!db.prepare('PRAGMA table_info(zones)').all().some(c=>c.name==='tariff_source'))
    db.exec("ALTER TABLE zones ADD COLUMN tariff_source TEXT NOT NULL DEFAULT 'LEGACY'");
}
export function roomTariffState(db,clubId,zoneId){
  const zone=db.prepare('SELECT * FROM zones WHERE id=? AND club_id=?').get(zoneId,clubId);
  if(!zone)throw fail('Xona topilmadi.',404);
  const tariffs=db.prepare("SELECT * FROM tariffs WHERE club_id=? AND zone_id=? AND type='HOURLY' AND is_active=1 ORDER BY id").all(clubId,zoneId);
  const inherited=tariffs.length===0&&zone.tariff_source!=='ROOM';
  const legacy=inherited?db.prepare('SELECT * FROM tariff_schedules WHERE club_id=? ORDER BY priority DESC,id DESC').all(clubId):[];
  const revision=createHash('sha256').update(JSON.stringify([zone.tariff_source||'LEGACY',tariffs,legacy])).digest('hex');
  return {zone:{id:zone.id,name:zone.name},tariffs,revision,inherited,legacy};
}
export function validateRoomTariffs(rows){
  if(!Array.isArray(rows)||rows.length>256)throw fail('Vaqt oraliqlari ro‘yxati noto‘g‘ri.');
  const coverage=new Uint8Array(7*1440);
  const tariffs=rows.map(row=>{
    const rate=validateSchedule(row),days=JSON.parse(rate.days);
    const minutes=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
    const start=minutes(rate.start),end=minutes(rate.end),offset=start===end?0:start;
    const duration=end>start?end-start:1440-start+end;
    for(const day of days)for(let m=0;m<duration;m++){
      const i=((day-1)*1440+offset+m)%coverage.length;
      if(coverage[i])throw fail('Vaqt oraliqlari ustma-ust tushmoqda. Kun va soatlarni tekshiring.');
      coverage[i]=1;
    }
    return {id:row.id||null,name:rate.name,start_time:rate.start,end_time:rate.end,price_per_hour:rate.price,
      days_of_week:rate.days,is_vip_postpaid_allowed:row.is_vip_postpaid_allowed===false||row.is_vip_postpaid_allowed===0?0:1};
  });
  return {tariffs,fullCoverage:!coverage.includes(0)};
}
export function saveRoomTariffs(db,clubId,zoneId,body){
  const validated=validateRoomTariffs(body?.tariffs);
  db.exec('BEGIN IMMEDIATE');
  try{
    const current=roomTariffState(db,clubId,zoneId);
    if(!body.revision||body.revision!==current.revision)throw fail('Tariflar boshqa oynada o‘zgargan. Yangi nusxani ochib qayta tahrirlang.',409);
    // VIP SCHEDULE billing still reads the room's time rules. Do not change
    // those rules underneath an active session, including prepaid refunds.
    const active=db.prepare(`SELECT 1 FROM sessions s JOIN computers c ON c.id=s.computer_id AND c.club_id=s.club_id
      LEFT JOIN grid_layout g ON g.computer_id=c.pc_number AND g.club_id=c.club_id
      WHERE s.club_id=? AND s.status='ACTIVE' AND COALESCE(c.zone_id,g.zone_id)=? LIMIT 1`).get(clubId,zoneId);
    if(active)throw fail('Bu xonada faol seans bor. Hisob o‘zgarmasligi uchun tariflarni seanslar tugagach saqlang.',409);
    const old=new Map(current.tariffs.map(t=>[t.id,t])),used=new Set();
    for(const rate of validated.tariffs){
      if(rate.id&&(!old.has(rate.id)||used.has(rate.id)))throw fail('Tarif ushbu xonaga tegishli emas yoki takrorlangan.');
      if(rate.id)used.add(rate.id);
    }
    db.prepare("UPDATE tariffs SET is_active=0 WHERE club_id=? AND zone_id=? AND type='HOURLY' AND is_active=1").run(clubId,zoneId);
    const insert=db.prepare(`INSERT INTO tariffs(id,club_id,zone_id,name,type,price_per_hour,start_time,end_time,days_of_week,is_vip_postpaid_allowed,is_active)
      VALUES(?,?,?,?,'HOURLY',?,?,?,?,?,1)`);
    for(const rate of validated.tariffs){
      const previous=old.get(rate.id);
      const same=previous&&Object.keys(rate).filter(k=>k!=='id').every(k=>String(previous[k])===String(rate[k]));
      if(same)db.prepare('UPDATE tariffs SET is_active=1 WHERE id=? AND club_id=?').run(rate.id,clubId);
      else insert.run('room_'+randomUUID(),clubId,zoneId,rate.name,rate.price_per_hour,rate.start_time,rate.end_time,rate.days_of_week,rate.is_vip_postpaid_allowed);
    }
    // Empty is intentional: never fall back to a hidden old club-wide price
    // after the manager deletes the last interval.
    db.prepare("UPDATE zones SET tariff_source='ROOM' WHERE id=? AND club_id=?").run(zoneId,clubId);
    const result=roomTariffState(db,clubId,zoneId);
    db.exec('COMMIT');return {...result,fullCoverage:validated.fullCoverage};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
