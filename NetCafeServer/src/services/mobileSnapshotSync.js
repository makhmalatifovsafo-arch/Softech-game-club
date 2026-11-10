import { BarLedgerService } from './barLedgerService.js';
const dateString=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const previous=date=>new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
export class MobileSnapshotSync {
 constructor({db,getLicense,getCloudUrl,isOperational,localPort,createSession,destroySession,fetcher=fetch}){
  Object.assign(this,{db,getLicense,getCloudUrl,isOperational,localPort,createSession,destroySession,fetcher});
  db.exec('CREATE TABLE IF NOT EXISTS mobile_snapshot_cursor(id INTEGER PRIMARY KEY,day TEXT NOT NULL)');
  db.exec('CREATE TABLE IF NOT EXISTS mobile_report_refresh(day TEXT PRIMARY KEY);CREATE TABLE IF NOT EXISTS mobile_report_cursor(ledger TEXT PRIMARY KEY,last_rowid INTEGER NOT NULL)');
 }
 tick(){
  if(this.inFlight)return this.inFlight;
  this.inFlight=this.runSync().finally(()=>{this.inFlight=null;});return this.inFlight;
 }
 async flush(){
  if(this.inFlight)await this.inFlight;
  await this.tick();return !this.lastError;
 }
 requestSoon(){
  if(this.stopped||this.soonTimer)return;
  this.soonTimer=setTimeout(()=>{this.soonTimer=null;this.flush();},1000);this.soonTimer.unref();
 }
 async runSync(){
  if(!this.isOperational())return;this.running=true;let token;
  try{
   const signedLicense=this.getLicense();if(!signedLicense?.payload)return;
   const owner=this.db.prepare("SELECT * FROM users WHERE club_id=1 AND role IN ('club_owner','manager') ORDER BY id LIMIT 1").get();
   if(!owner)throw Error('Menejer akkaunti topilmadi.');
   token=this.createSession(owner).token;
   const capturedAt=new Date().toISOString(),today=dateString(new Date());
   const entries=[];
   for(const [key,path] of [['computers','/api/computers'],['cash','/api/shifts/current'],['bar','/api/bar/items']]){
    const r=await this.fetcher('http://127.0.0.1:'+this.localPort+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('Mahalliy '+key+' HTTP '+r.status);
    entries.push({key,data:await r.json(),capturedAt});
   }
   const staff=[];
   for(const role of ['manager','administrator']){
    const table=role==='manager'?'cloud_manager_state':'cloud_administrator_state';
    const row=this.db.prepare(`SELECT u.username,u.permissions,s.revision FROM ${table} s JOIN users u ON u.id=s.user_id WHERE s.club_id=?`).get(signedLicense.payload.clubId);
    if(row)staff.push({role,username:row.username,revision:row.revision,permissions:JSON.parse(row.permissions||'[]')});
   }
   entries.push({key:'metadata',data:{serverDate:today,staff},capturedAt});
   const upload=async batch=>{
    const body=JSON.stringify({signedLicense,entries:batch});if(Buffer.byteLength(body)>3400000)throw Error('Hisobot paketi 3.4 MB dan katta; bulutga saqlanmadi.');
    const r=await this.fetcher(this.getCloudUrl()+'/api/mobile/dashboard/sync',{method:'POST',headers:{'Content-Type':'application/json'},body,signal:AbortSignal.timeout(15000)});
    if(!r.ok){const data=await r.json().catch(()=>({}));throw Error(data.error||'HTTP '+r.status);}
   };
   await upload(entries);
   const sendDay=async day=>{const report=BarLedgerService.getDailyFinancialReport({clubId:1,fromDate:day,toDate:day});await upload([{key:'report:'+day,data:{accountingVersion:2,filter:{from:day,to:day},breakdown:report.breakdown,summary:report.summary},capturedAt}]);};
   // A refund can revise an older payment day. Persist that work across restarts
   // and retry failed uploads before advancing the ordinary history backfill.
   this.db.exec('BEGIN');
   try {
    for(const ledger of ['transactions','client_transactions']){
     const cursor=this.db.prepare('SELECT last_rowid FROM mobile_report_cursor WHERE ledger=?').get(ledger)?.last_rowid||0;
     const latest=this.db.prepare(`SELECT COALESCE(MAX(rowid),0) AS n FROM ${ledger}`).get().n;
     const days=this.db.prepare(`SELECT DISTINCT date(p.created_at,'localtime') AS day FROM ${ledger} p
      WHERE p.club_id=1 AND (p.rowid>? OR EXISTS(SELECT 1 FROM ${ledger} r
       WHERE r.rowid>? AND r.club_id=p.club_id AND r.session_id=p.session_id))`).all(cursor,cursor);
     for(const {day} of days)if(day&&day<today)this.db.prepare('INSERT OR IGNORE INTO mobile_report_refresh(day) VALUES(?)').run(day);
     this.db.prepare('INSERT INTO mobile_report_cursor VALUES(?,?) ON CONFLICT(ledger) DO UPDATE SET last_rowid=excluded.last_rowid').run(ledger,latest);
    }
    this.db.exec('COMMIT');
   }catch(error){this.db.exec('ROLLBACK');throw error;}
   await sendDay(today);
   for(const {day} of this.db.prepare('SELECT day FROM mobile_report_refresh ORDER BY day DESC LIMIT 5').all()){
    await sendDay(day);this.db.prepare('DELETE FROM mobile_report_refresh WHERE day=?').run(day);
   }
   // Backfill all calendar days, including closed/zero-revenue days. Revisit them
   // on later cycles so refunds and late settlements replace previous snapshots.
   const oldest=this.db.prepare(`SELECT min(day) AS day FROM (
    SELECT date(created_at,'localtime') day FROM transactions WHERE club_id=1
    UNION ALL SELECT date(created_at,'localtime') FROM bar_orders WHERE club_id=1
    UNION ALL SELECT date(created_at,'localtime') FROM client_transactions WHERE club_id=1
   )`).get().day||today;
   let day=this.db.prepare('SELECT day FROM mobile_snapshot_cursor WHERE id=1').get()?.day;
   if(!day||day<oldest||day>=today||(this.lastDay&&this.lastDay!==today))day=previous(today);
   if(day>=oldest){await sendDay(day);this.db.prepare('INSERT INTO mobile_snapshot_cursor VALUES(1,?) ON CONFLICT(id) DO UPDATE SET day=excluded.day').run(previous(day));}
   this.lastDay=today;this.lastError=null;
  }catch(error){this.lastError=error.message;console.warn('[Mobile reports]',error.message);}
  finally{if(token)this.destroySession(token);this.running=false;}
 }
 start(){this.stopped=false;const run=async()=>{await this.tick();if(!this.stopped){this.timer=setTimeout(run,process.env.NODE_ENV==='test'?500:30000);this.timer.unref();}};run();}
 stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.soonTimer);}
}
