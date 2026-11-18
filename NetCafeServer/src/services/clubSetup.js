import { isIP } from 'node:net';
import { validateSchedule } from './tariffValidation.js';
import { normalizeMacAddress } from './macAddress.js';
import { setupIp, setupConnection, setupConnectionMessage } from './setupConnection.js';

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const steps = ['rooms', 'computers', 'tariffs', 'review'];
export const emptySetupDraft = () => ({ schemaVersion:1, step:'rooms', expectedComputers:0, rooms:[], computers:[], tariffs:[] });

// Run inside the existing schema migration transaction, before any clients connect.
// This is a rollout marker, not a new gate on existing business operations.
export function initializeClubSetup(db, { existingInstallation = true } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS club_setup_drafts (
    club_id INTEGER PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
    installation_kind TEXT NOT NULL CHECK(installation_kind IN ('NEW','EXISTING')),
    revision INTEGER NOT NULL DEFAULT 0,
    draft_json TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const columns=new Set(db.prepare('PRAGMA table_info(club_setup_drafts)').all().map(c=>c.name));
  for(const name of ['completed_at','base_fingerprint'])if(!columns.has(name))db.exec(`ALTER TABLE club_setup_drafts ADD COLUMN ${name} TEXT`);
  db.exec(`CREATE TABLE IF NOT EXISTS club_setup_receipts (
    club_id INTEGER NOT NULL, request_id TEXT NOT NULL, revision INTEGER NOT NULL, receipt_json TEXT NOT NULL,
    PRIMARY KEY(club_id,request_id), FOREIGN KEY(club_id) REFERENCES clubs(id) ON DELETE CASCADE)`);
  const insert=db.prepare('INSERT OR IGNORE INTO club_setup_drafts(club_id,installation_kind,draft_json) VALUES(?,?,?)');
  for(const club of db.prepare('SELECT id FROM clubs').all())
    insert.run(club.id, existingInstallation ? 'EXISTING' : 'NEW', JSON.stringify(emptySetupDraft()));
  // Earlier draft-only builds did not gate NEW clubs. Never interrupt a club
  // that has already traded before this workflow was introduced.
  if(!columns.has('completed_at'))for(const table of ['sessions','transactions','zones']){
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE name=? AND type='table'").get(table))
      db.exec(`UPDATE club_setup_drafts SET installation_kind='EXISTING' WHERE installation_kind='NEW' AND EXISTS(SELECT 1 FROM ${table} WHERE ${table}.club_id=club_setup_drafts.club_id)`);
  }
}

function text(value, max, field) {
  if(typeof value !== 'string' || value.length > max)throw fail(`${field}: matn noto‘g‘ri.`);
  return value.trim();
}
function id(value) {
  if(typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(value))throw fail('Qoralamadagi element raqami noto‘g‘ri.');
  return value;
}
function coordinate(value) {
  if(typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value)>100000)throw fail('Xarita koordinatasi noto‘g‘ri.');
  return value;
}
function shape(room) {
  if(room.polygonPoints===undefined)return {};
  if(!Array.isArray(room.polygonPoints)||room.polygonPoints.length<3||room.polygonPoints.length>128)throw fail('Xona shakli noto‘g‘ri.');
  return {polygonPoints:room.polygonPoints.map(p=>({x:coordinate(p?.x),y:coordinate(p?.y)}))};
}
function insideRoom(pc, room) {
  if(!room.polygonPoints)return pc.x>=room.x&&pc.y>=room.y&&pc.x<room.x+room.width&&pc.y<room.y+room.height;
  let inside=false;const points=room.polygonPoints;
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const a=points[i],b=points[j];
    if((a.y>pc.y)!==(b.y>pc.y)&&pc.x<(b.x-a.x)*(pc.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }
  return inside;
}
function list(value,max) {
  if(!Array.isArray(value) || value.length>max || value.some(x=>!x || typeof x!=='object' || Array.isArray(x)))throw fail('Sozlash ro‘yxati noto‘g‘ri yoki juda katta.');
  return value;
}
// Partial drafts are allowed. Missing names, IPs and tariffs remain editable and
// become readiness issues; malformed structures are never persisted.
export function normalizeSetupDraft(raw) {
  if(!raw || raw.schemaVersion!==1 || !steps.includes(raw.step) || !Number.isInteger(raw.expectedComputers) || raw.expectedComputers<0 || raw.expectedComputers>500)
    throw fail('Sozlash qoralamasi formati noto‘g‘ri.');
  const draft={schemaVersion:1,step:raw.step,expectedComputers:raw.expectedComputers,
    rooms:list(raw.rooms,64).map(r=>({id:id(r.id),name:text(r.name,80,'Xona nomi'),type:['STANDARD','VIP','PS5','BOOTCAMP_5V5'].includes(r.type)?r.type:'STANDARD',
      x:coordinate(r.x),y:coordinate(r.y),width:coordinate(r.width),height:coordinate(r.height),...shape(r)})),
    computers:list(raw.computers,500).map(c=>({id:id(c.id),number:Number.isInteger(c.number)?c.number:0,name:text(c.name,80,'PC nomi'),roomId:c.roomId?id(c.roomId):'',
      ip:setupIp(text(c.ip,64,'IP manzil')),mac:text(c.mac??'',32,'MAC manzil'),x:coordinate(c.x),y:coordinate(c.y)})),
    tariffs:list(raw.tariffs,256).map(t=>({id:id(t.id),roomId:t.roomId?id(t.roomId):'',name:text(t.name,120,'Tarif nomi'),
      start_time:text(t.start_time,5,'Boshlanish'),end_time:text(t.end_time,5,'Tugash'),
      days_of_week:Array.isArray(t.days_of_week)&&t.days_of_week.length<=7?[...t.days_of_week]:[],
      price_per_hour:typeof t.price_per_hour==='number'&&Number.isFinite(t.price_per_hour)?t.price_per_hour:null,
      ...(t.vipAllowed!==undefined?{vipAllowed:t.vipAllowed===true}:{})}))};
  if(Buffer.byteLength(JSON.stringify(draft))>128*1024)throw fail('Sozlash qoralamasi juda katta.');
  return draft;
}

const usableIp = value => isIP(value)===4 && ![0,127].includes(Number(value.split('.')[0])) && Number(value.split('.')[0])<224;
// Only exact database IDs from this tenant can contribute live readiness.
// Never use ClientManager's user-friendly/fuzzy PC name lookup here.
export function setupLiveClients(db, clubId, clients) {
  const rows=new Map(db.prepare('SELECT id,mac_address FROM computers WHERE club_id=? AND pc_number>0').all(clubId).map(row=>[row.id,row]));
  // Older clients can omit MAC in HELLO. The same registered database PC
  // retains its last known MAC; a newly reported MAC always takes precedence.
  return [...clients].filter(c=>rows.has(c.pcId)).map(c=>({number:Number(c.pcNumber),ip:setupIp(c.ipAddress),mac:c.macAddress||rows.get(c.pcId).mac_address||'',
    connected:c.socket?.readyState===1 && c.isAlive!==false,lastHeartbeat:c.lastHeartbeat}));
}
export function evaluateSetupDraft(raw, { maxComputers, liveClients = [], now = Date.now(), heartbeatTimeoutMs = 15000 } = {}) {
  const draft=normalizeSetupDraft(raw),issues=[];
  const add=(step,code,message,elementId=null)=>issues.push({step,code,message,elementId});
  const rooms=new Map();
  for(const r of draft.rooms){
    if(rooms.has(r.id))add('rooms','DUPLICATE_ROOM','Xona raqami takrorlangan.',r.id);
    rooms.set(r.id,r);
    if(!r.name)add('rooms','ROOM_NAME','Xona nomini kiriting.',r.id);
    if(r.width<120||r.height<120)add('rooms','ROOM_SIZE','Xona o‘lchami kamida 120 × 120 bo‘lsin.',r.id);
  }
  if(!rooms.size)add('rooms','NO_ROOMS','Kamida bitta xona qo‘shing.');
  if(draft.expectedComputers<1)add('computers','PC_COUNT','Kamida bitta kompyuter qo‘shing.');
  if(draft.computers.length!==draft.expectedComputers)add('computers','COUNT_MISMATCH',`Ro‘yxatda ${draft.computers.length} ta PC, saqlangan son esa ${draft.expectedComputers}. Kompyuterlar bosqichini qayta ochib saqlang.`);
  if(!Number.isInteger(maxComputers)||maxComputers<1)add('computers','LIMIT_UNKNOWN','Litsenziyadagi kompyuterlar limiti aniqlanmadi.');
  else if(draft.expectedComputers>maxComputers||draft.computers.length>maxComputers)add('computers','LICENSE_LIMIT',`Litsenziya ${maxComputers} ta kompyuter uchun.`);
  const numbers=new Set(),ids=new Set(),ips=new Set(),macs=new Set();
  let onlineCount=0;
  const freshClients=liveClients.filter(c=>Number.isFinite(c.lastHeartbeat)&&now-c.lastHeartbeat>=0&&now-c.lastHeartbeat<=heartbeatTimeoutMs);
  for(const pc of draft.computers){
    const label=pc.name||`PC-${pc.number}`;
    if(!pc.name)add('computers','PC_NAME','Kompyuter nomini kiriting.',pc.id);
    if(ids.has(pc.id)||numbers.has(pc.number)||pc.number<1||pc.number>9999)add('computers','PC_NUMBER',`${label}: raqami noto‘g‘ri yoki takrorlangan.`,pc.id);
    ids.add(pc.id);numbers.add(pc.number);
    if(!rooms.has(pc.roomId))add('computers','PC_ROOM',`${label}: xonani tanlang.`,pc.id);
    else if(!insideRoom(pc,rooms.get(pc.roomId)))add('computers','PC_POSITION',`${label}: xona ichiga joylashtiring.`,pc.id);
    if(!usableIp(pc.ip)||ips.has(pc.ip))add('computers','PC_IP',`${label}: haqiqiy, takrorlanmagan IPv4 manzil kiriting.`,pc.id);
    ips.add(pc.ip);
    let mac=null;
    try{mac=normalizeMacAddress(pc.mac);if(mac&&macs.has(mac))throw Error();if(mac)macs.add(mac);}
    catch{add('computers','PC_MAC',`${label}: MAC manzil noto‘g‘ri yoki takrorlangan.`,pc.id);}
    const connection=setupConnection(pc,freshClients);
    if(connection.ok)onlineCount++;
    else add('computers','PC_OFFLINE',setupConnectionMessage(pc,connection),pc.id);
  }
  const tariffIds=new Set(),coverage=new Map();
  for(const tariff of draft.tariffs){
    if(tariffIds.has(tariff.id))add('tariffs','TARIFF_ID','Tarif raqami takrorlangan.',tariff.id);
    tariffIds.add(tariff.id);
    if(!rooms.has(tariff.roomId)){add('tariffs','TARIFF_ROOM','Tarif uchun xonani tanlang.',tariff.id);continue;}
    let rule;
    try{rule=validateSchedule(tariff);}catch(error){add('tariffs','TARIFF_INVALID',error.message,tariff.id);continue;}
    let minutes=coverage.get(tariff.roomId);if(!minutes){minutes=new Uint8Array(7*1440);coverage.set(tariff.roomId,minutes);}
    const time=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
    const start=time(rule.start),end=time(rule.end),duration=end>start?end-start:1440-start+end;
    const offset=start===end?0:start; // Equal times mean the selected calendar day, as in pricingEngine.
    let overlap=false;
    for(const day of JSON.parse(rule.days))for(let i=0;i<duration;i++){
      const index=((day-1)*1440+offset+i)%minutes.length;
      if(minutes[index])overlap=true;minutes[index]=1;
    }
    if(overlap)add('tariffs','TARIFF_OVERLAP',`${rooms.get(tariff.roomId).name}: tarif vaqtlari ustma-ust tushmoqda.`,tariff.id);
  }
  const warnings=[];
  for(const room of rooms.values()){
    const minutes=coverage.get(room.id);
    if(!minutes)add('tariffs','NO_TARIFF',`${room.name}: kamida bitta tarif kiriting.`,room.id);
    else if(minutes.includes(0))warnings.push({step:'tariffs',code:'TARIFF_GAPS',elementId:room.id,message:`${room.name}: haftaning barcha kunlari 24 soat tarif bilan qoplanishi shart. Bo‘sh vaqt oraliqlarini to‘ldiring.`});
  }
  // Finalization also checks current inventory, active sessions and the baseline.
  return {draftValid:issues.length===0,canCommit:false,onlineCount,expectedComputers:draft.expectedComputers,
    steps:Object.fromEntries(['rooms','computers','tariffs'].map(step=>[step,!issues.some(i=>i.step===step)])),issues,warnings};
}

export class ClubSetupDrafts {
  constructor(db){this.db=db;}
  read(clubId){
    const row=this.db.prepare('SELECT * FROM club_setup_drafts WHERE club_id=?').get(clubId);
    if(!row)throw fail('Klubning sozlash holati topilmadi.',404);
    let draft;try{draft=normalizeSetupDraft(JSON.parse(row.draft_json));}catch{throw fail('Sozlash qoralamasini o‘qib bo‘lmadi. Mavjud klub sozlamalari o‘zgarmadi.',503);}
    const appliedDraft=Boolean(row.completed_at&&this.db.prepare('SELECT 1 FROM club_setup_receipts WHERE club_id=? AND revision=?').get(clubId,row.revision-1));
    return {installationKind:row.installation_kind,revision:row.revision,updatedAt:row.updated_at,completedAt:row.completed_at,appliedDraft,
      baseFingerprint:row.base_fingerprint,draft};
  }
  save(clubId,actorId,revision,raw,baseFingerprint){
    if(!Number.isSafeInteger(revision)||revision<0)throw fail('Qoralama versiyasi noto‘g‘ri.');
    const draft=normalizeSetupDraft(raw);
    if(baseFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(baseFingerprint))throw fail('Klub sozlamalari nusxasi noto‘g‘ri.');
    // Compare-and-swap: one atomic SQLite statement, never last-writer-wins.
    const result=this.db.prepare(`UPDATE club_setup_drafts SET draft_json=?,revision=revision+1,updated_by=?,updated_at=?,base_fingerprint=COALESCE(?,base_fingerprint)
      WHERE club_id=? AND revision=?`).run(JSON.stringify(draft),String(actorId),new Date().toISOString(),baseFingerprint??null,clubId,revision);
    if(!result.changes)throw fail('Sozlama boshqa oynada yangilangan. Yangi qoralamani qayta oching.',409);
    return this.read(clubId);
  }
}
