import crypto from 'node:crypto';
import { ManagerAccountService } from './managerAccountService.js';
import { MobileRelay } from './mobileRelay.js';
import { verifyTelemetryLicense } from './telemetryAuth.js';
const fail=(message,statusCode=400)=>Object.assign(Error(message),{statusCode});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const decode=value=>typeof value==='string'?JSON.parse(value):value;
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
export class MobileDashboard {
 constructor(storage){Object.assign(this,storage);this.storage=storage;
  if(this.db)this.db.exec(`CREATE TABLE IF NOT EXISTS mobile_dashboard_data(club_id INTEGER NOT NULL,data_key TEXT NOT NULL,payload TEXT NOT NULL,captured_at TEXT NOT NULL,PRIMARY KEY(club_id,data_key));
   CREATE TABLE IF NOT EXISTS mobile_dashboard_sessions(token_hash TEXT PRIMARY KEY,club_id INTEGER NOT NULL,role TEXT NOT NULL,username TEXT NOT NULL,revision INTEGER NOT NULL,expires_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS mobile_dashboard_limits(bucket TEXT PRIMARY KEY,attempts INTEGER NOT NULL,reset_at TEXT NOT NULL);`);
 }
 async query(q){if(!q)throw fail('Bulut bazasi sozlanmagan.',503);const r=await q;if(r.error)throw fail('Mobil hisobot bazasi tayyor emas. migrations/20261110_mobile_dashboard.sql migratsiyasini tekshiring.',503);return r.data;}
 async limit(bucket,maximum){
  bucket=hash(bucket);let allowed;
  if(this.db){const now=new Date().toISOString();this.db.prepare('DELETE FROM mobile_dashboard_limits WHERE reset_at<?').run(now);const r=this.db.prepare('INSERT INTO mobile_dashboard_limits VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').get(bucket,new Date(Date.now()+600000).toISOString());allowed=r.attempts<=maximum;}
  else allowed=await this.query(this.client?.rpc('softech_mobile_login_limit',{p_bucket:bucket,p_limit:maximum}));
  if(!allowed)throw fail('Urinishlar ko‘p. 10 daqiqadan keyin qayta kiring.',429);
 }
 async club(id){if(!Number.isSafeInteger(id)||id<1)throw fail('Klub raqamini kiriting.');return new MobileRelay(this.storage).club(id);}
 async row(id,key){const r=this.db?this.db.prepare('SELECT * FROM mobile_dashboard_data WHERE club_id=? AND data_key=?').get(id,key):await this.query(this.client?.from('mobile_dashboard_data').select('*').eq('club_id',id).eq('data_key',key).maybeSingle());return r?{...r,payload:decode(r.payload)}:null;}
 async login(body,ip){
  const id=Number(body.clubId),username=String(body.username||'').trim();
  if(!Number.isSafeInteger(id)||id<1||!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)||typeof body.password!=='string'||body.password.length>128)throw fail('Klub, login yoki parol noto‘g‘ri.',401);
  await this.limit('ip:'+ip,80);await this.limit('account:'+id+':'+username.toLowerCase(),20);
  const club=await this.club(id);let account;
  for(const role of ['manager','administrator']){account=await new ManagerAccountService({...this.storage,role}).authenticate(id,username,body.password);if(account)break;}
  if(!account)throw fail('Login yoki parol noto‘g‘ri. Super admin belgilagan akkaunt bilan kiring.',401);
  const token='mbl_'+crypto.randomBytes(32).toString('hex');
  const row={token_hash:hash(token),club_id:id,...account,expires_at:new Date(Date.now()+12*3600000).toISOString()};
  if(this.db){this.db.prepare('DELETE FROM mobile_dashboard_sessions WHERE expires_at<?').run(new Date().toISOString());this.db.prepare('INSERT INTO mobile_dashboard_sessions VALUES(?,?,?,?,?,?)').run(row.token_hash,id,row.role,username,row.revision,row.expires_at);}
  else {await this.query(this.client.from('mobile_dashboard_sessions').delete().lt('expires_at',new Date().toISOString()));await this.query(this.client.from('mobile_dashboard_sessions').insert(row));}
  return {token,...await this.sessionInfo(row,club)};
 }
 async authorize(token){
  if(typeof token!=='string'||!/^mbl_[a-f0-9]{64}$/.test(token))throw fail('Qayta login qiling.',401);
  const session=this.db?this.db.prepare('SELECT * FROM mobile_dashboard_sessions WHERE token_hash=?').get(hash(token)):await this.query(this.client?.from('mobile_dashboard_sessions').select('*').eq('token_hash',hash(token)).maybeSingle());
  if(!session||!(Date.parse(session.expires_at)>Date.now()))throw fail('Sessiya tugagan. Qayta login qiling.',401);
  const club=await this.club(Number(session.club_id));
  const account=await new ManagerAccountService({...this.storage,role:session.role}).latest(Number(session.club_id));
  if(!account||Number(account.id)!==Number(session.revision)||account.payload.username!==session.username)throw fail('Akkaunt yangilangan. Qayta login qiling.',401);
  return {session,club};
 }
 async sessionInfo(session,club){
  const meta=await this.row(Number(club.id),'metadata');
  const staff=meta?.payload.staff?.find(s=>s.role===session.role&&s.username===session.username&&Number(s.revision)===Number(session.revision));
  const user={username:session.username,role:session.role==='manager'?'club_owner':'administrator',permissions:session.role==='manager'?['*']:(staff?.permissions||['session:manage'])};
  const payload={kind:'MOBILE_STAFF_SESSION',clubId:Number(club.id),hardwareFingerprint:club.hardware_fingerprint,username:session.username,role:session.role,revision:Number(session.revision),expiresAt:new Date(Date.now()+120000).toISOString()};
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('mobile-staff:'+JSON.stringify(payload)).digest('hex');
  return {user,name:club.name,clubId:Number(club.id),grant:{payload,signature}};
 }
 async logout(token){if(typeof token!=='string')return {success:true};if(this.db)this.db.prepare('DELETE FROM mobile_dashboard_sessions WHERE token_hash=?').run(hash(token));else await this.query(this.client?.from('mobile_dashboard_sessions').delete().eq('token_hash',hash(token)));return {success:true};}
 async upload(body){
  const proof=verifyTelemetryLicense(body.signedLicense);if(!proof)throw fail('Server litsenziyasi yaroqsiz.',401);
  const club=await this.club(Number(proof.clubId));if(club.hardware_fingerprint!==proof.hardwareFingerprint)throw fail('Boshqa server.',403);
  if(!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>6)throw fail('Sinxronlash paketi yaroqsiz.');
  const rows=body.entries.map(e=>{
   if(!['metadata','computers','cash','bar'].includes(e.key)&&!(e.key?.startsWith('report:')&&validDate(e.key.slice(7))))throw fail('Ma’lumot turi yaroqsiz.');
   if(!e.data||typeof e.data!=='object'||!Number.isFinite(Date.parse(e.capturedAt))||Date.parse(e.capturedAt)>Date.now()+300000)throw fail('Ma’lumot yoki sana yaroqsiz.');
   if(e.key==='computers'&&!Array.isArray(e.data))throw fail('Kompyuterlar ro‘yxati kerak.');
   if(e.key.startsWith('report:')&&(!e.data.breakdown||!Array.isArray(e.data.breakdown.rows)||e.data.filter?.from!==e.key.slice(7)||e.data.filter?.to!==e.key.slice(7)))throw fail('Hisobot sanasi mos emas.');
   return {club_id:Number(club.id),data_key:e.key,payload:e.data,captured_at:new Date(e.capturedAt).toISOString()};
  });
  // Each complete resource/day is replaced, never added to yesterday's totals.
  if(this.db){this.db.exec('BEGIN');try{for(const r of rows)this.db.prepare('INSERT INTO mobile_dashboard_data VALUES(?,?,?,?) ON CONFLICT(club_id,data_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at WHERE excluded.captured_at>=mobile_dashboard_data.captured_at').run(r.club_id,r.data_key,JSON.stringify(r.payload),r.captured_at);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}}
  else await this.query(this.client.rpc('softech_mobile_snapshot_upsert',{p_rows:rows}));
  return {success:true};
 }
 async read(session,club,url){
  const id=Number(club.id),resource=url.searchParams.get('resource');
  if(!['computers','cash','bar','reports'].includes(resource))throw fail('Bo‘lim topilmadi.',404);
  if(resource==='reports'&&session.role!=='manager')throw fail('Hisobot menejer uchun.',403);
  if(resource==='bar'&&session.role==='manager')throw fail('Menejer mobil dasturida savdo bo‘limi yo‘q.',403);
  const metadata=await this.row(id,'metadata');
  let data,capturedAt,missingDates=[];
  if(resource==='reports'){
   const defaultDate=metadata?.payload.serverDate;
   const from=url.searchParams.get('from')||defaultDate,to=url.searchParams.get('to')||from;
   if(!from)throw fail('Server hali hisobot yubormagan. Server dasturini yangilang va bir marta internetga ulang.',409);
   if(!validDate(from)||!validDate(to)||from>to||(Date.parse(to)-Date.parse(from))/86400000>365)throw fail('1–366 kunlik sana oralig‘ini tanlang.');
   const snapshots=this.db?this.db.prepare('SELECT * FROM mobile_dashboard_data WHERE club_id=? AND data_key BETWEEN ? AND ? ORDER BY data_key').all(id,'report:'+from,'report:'+to):await this.query(this.client.from('mobile_dashboard_data').select('*').eq('club_id',id).gte('data_key','report:'+from).lte('data_key','report:'+to).order('data_key').limit(366));
   const rows=snapshots.filter(r=>decode(r.payload).accountingVersion===2);
   const dates=new Set(rows.map(r=>r.data_key.slice(7)));for(let d=Date.parse(from);d<=Date.parse(to);d+=86400000){const date=new Date(d).toISOString().slice(0,10);if(!dates.has(date))missingDates.push(date);}
   if(!rows.length)throw fail('Tanlangan sanalar uchun yangilangan hisobot tayyor emas. Server dasturini yangilang va internetga ulang.',409);
   data=combineDailyReports(rows.map(r=>decode(r.payload)),from,to);
   capturedAt=rows.map(r=>r.captured_at).sort()[0];
  } else {const row=await this.row(id,resource);if(!row)throw fail('Bu bo‘lim hali sinxronlanmagan. Server dasturini yangilang va internetga ulang.',409);data=row.payload;capturedAt=row.captured_at;}
  if(resource==='cash'&&session.role==='administrator')data={success:true,hasOpenShift:!!data.shift,shift:data.shift?{id:data.shift.id,openedAt:data.shift.openedAt}:null};
  const recent=metadata&&Date.parse(metadata.captured_at)>Date.now()-90000;
  return {data,meta:{source:'cloud',capturedAt,serverOnline:!!recent,serverDate:metadata?.payload.serverDate,missingDates},...await this.sessionInfo(session,club)};
 }
}
export function combineDailyReports(reports,from,to){
 const breakdown={receipts:Object.fromEntries(['GAME','BAR','TOPUP','OTHER'].map(k=>[k,{CASH:0,CARD:0}])),cash:0,card:0,total:0,gameReceipts:0,topupReceipts:0,gameBalance:0,barBalance:0,rows:[]};
 for(const report of reports){const b=report.breakdown;for(const k of ['cash','card','total','gameReceipts','topupReceipts','gameBalance','barBalance'])breakdown[k]+=Number(b[k]||0);for(const category of Object.keys(breakdown.receipts))for(const method of ['CASH','CARD'])breakdown.receipts[category][method]+=Number(b.receipts?.[category]?.[method]||0);breakdown.rows.push(...b.rows);}
 breakdown.rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 const dailyTotals=reports.map(r=>({date:r.filter.from,total:r.breakdown.total,cash:r.breakdown.cash,card:r.breakdown.card})).sort((a,b)=>a.date.localeCompare(b.date));
 const summaryComplete=reports.every(r=>r.summary&&typeof r.summary.barProfit==='number');
 const summary=summaryComplete?Object.fromEntries(Object.keys(reports[0].summary).map(k=>[k,reports.reduce((sum,r)=>sum+Number(r.summary[k]||0),0)])):null;
 const products=new Map();for(const row of breakdown.rows.filter(r=>r.category==='BAR')){const name=row.description||'Mahsulot';const p=products.get(name)||{name,quantity:0,sales:0};p.quantity+=Number(row.quantity||0);p.sales+=Number(row.amount||0);products.set(name,p);}
 return {filter:{from,to},breakdown,dailyTotals,summary,products:[...products.values()].sort((a,b)=>b.quantity-a.quantity)};
}
export async function handleMobileDashboard(req,res,storage){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/api/mobile/dashboard/'))return false;
 res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
 try{
  let body=req.body||{};if(req.method==='POST'&&req.body===undefined){let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>3500000)throw fail('Sinxronlash paketi katta.',413);}body=raw||'{}';}
  if(typeof body==='string')body=JSON.parse(body);if(!body||typeof body!=='object'||Array.isArray(body)||Buffer.byteLength(JSON.stringify(body))>3500000)throw fail('So‘rov yaroqsiz.',413);
  const service=new MobileDashboard(storage),action=url.pathname.split('/').at(-1),token=String(req.headers.authorization||'').replace(/^Bearer /,'');let result;
  if(action==='sync'&&req.method==='POST')result=await service.upload(body);
  else if(action==='login'&&req.method==='POST')result=await service.login(body,String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0]);
  else if(action==='logout'&&req.method==='POST')result=await service.logout(token);
  else {const {session,club}=await service.authorize(token);if(action==='session'&&req.method==='GET')result=await service.sessionInfo(session,club);else if(action==='data'&&req.method==='GET')result=await service.read(session,club,url);else throw fail('Yo‘l topilmadi.',404);}
  res.statusCode=200;res.end(JSON.stringify(result));
 }catch(e){res.statusCode=e.statusCode||(e instanceof SyntaxError?400:503);res.end(JSON.stringify({error:e.statusCode?e.message:'Mobil bulut xizmati javob bermadi.'}));}return true;
}
