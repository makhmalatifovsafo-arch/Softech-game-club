import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import { MobileDashboard, combineDailyReports } from '../src/services/mobileDashboard.js';
import { ManagerAccountService } from '../src/services/managerAccountService.js';
import { mobileCloudUser } from '../NetCafeServer/src/services/mobileCloudSession.js';
const key=process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';
test('multi-day insights sum exact receipts and profit while excluding unpaid bar products',()=>{
 const a=report('2026-11-09',100),b=report('2026-11-10',200);
 a.summary={barProfit:40,barRevenue:100};b.summary={barProfit:60,barRevenue:200};
 a.breakdown.rows=[{category:'BAR',description:'Cola',quantity:1,amount:100,createdAt:'2026-11-09'},{category:'BAR_PENDING',description:'Water',quantity:4,amount:400,createdAt:'2026-11-09'}];
 b.breakdown.rows=[{category:'BAR',description:'Cola',quantity:2,amount:200,createdAt:'2026-11-10'}];
 const r=combineDailyReports([b,a],'2026-11-09','2026-11-10');
 assert.equal(r.breakdown.total,300);assert.equal(r.summary.barProfit,100);
 assert.deepEqual(r.products,[{name:'Cola',quantity:3,sales:300}]);
 assert.deepEqual(r.dailyTotals.map(d=>d.date),['2026-11-09','2026-11-10']);
});
function report(date,amount){return {filter:{from:date,to:date},breakdown:{cash:amount,card:0,total:amount,sessionsAndTopups:amount,receipts:{GAME:{CASH:amount,CARD:0}},rows:[{id:'tx:'+date,createdAt:date,amount}]}};}
async function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE clubs(id INTEGER PRIMARY KEY,name TEXT,status TEXT,license_expires_at TEXT,hardware_fingerprint TEXT);
 INSERT INTO clubs VALUES(7,'Offline club','ACTIVE','2099-01-01','TEST-HWID-7'),(8,'Other club','ACTIVE','2099-01-01','TEST-HWID-8');
 CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);`);
 const manager=new ManagerAccountService({db,role:'manager'}),admin=new ManagerAccountService({db,role:'administrator'});
 await manager.save(7,{username:'owner',password:'1234'});await admin.save(7,{username:'cashier',password:'5678'});
 const payload={clubId:7,hardwareFingerprint:'TEST-HWID-7',status:'ACTIVE',expiresAt:'2099-01-01'};
 const signedLicense={payload,signature:crypto.createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex')};
 return {db,service:new MobileDashboard({db}),manager,admin,signedLicense};
}
test('cloud login and reports work with no running club server; dates, roles and revocation are enforced',async()=>{
 const f=await fixture();const {db,service:s,signedLicense}=f;
 try{
  const yesterday=new Date(Date.now()-86400000).toISOString();
  await s.upload({signedLicense,entries:[{key:'metadata',capturedAt:yesterday,data:{serverDate:'2026-11-09'}},{key:'computers',capturedAt:yesterday,data:[{id:1,name:'PC-1',isOnline:true}]},{key:'report:2026-11-09',capturedAt:yesterday,data:report('2026-11-09',150)}]});
  const login=await s.login({clubId:7,username:' owner ',password:'1234'},'ip');
  const {session,club}=await s.authorize(login.token);
  const read=await s.read(session,club,new URL('http://test/?resource=reports'));
  assert.equal(read.data.breakdown.total,150);assert.equal(read.meta.serverOnline,false);assert.equal(read.meta.capturedAt,yesterday);
  const partial=await s.read(session,club,new URL('http://test/?resource=reports&from=2026-11-08&to=2026-11-09'));
  assert.deepEqual(partial.meta.missingDates,['2026-11-08']);assert.equal(partial.data.breakdown.total,150);
  await assert.rejects(()=>s.read(session,club,new URL('http://test/?resource=reports&from=2026-02-30')),e=>e.statusCode===400);
  await assert.rejects(()=>s.read(session,club,new URL('http://test/?resource=reports&from=2026-01-01')),e=>e.statusCode===409);
  const cashier=await s.login({clubId:7,username:'cashier',password:'5678'},'ip');const a=await s.authorize(cashier.token);
  await assert.rejects(()=>s.read(a.session,a.club,new URL('http://test/?resource=reports')),e=>e.statusCode===403);
  assert.equal((await s.read(a.session,a.club,new URL('http://test/?resource=computers'))).data.length,1);
  await assert.rejects(()=>s.login({clubId:8,username:'owner',password:'1234'},'ip'),e=>e.statusCode===401);
  await f.manager.save(7,{username:'owner',password:'4321'});
  await assert.rejects(()=>s.authorize(login.token),e=>e.statusCode===401);
  await s.logout(cashier.token);await assert.rejects(()=>s.authorize(cashier.token),e=>e.statusCode===401);
 }finally{db.close();}
});
test('snapshot retries replace daily totals; older snapshots, bad hardware and blocked clubs cannot overwrite data',async()=>{
 const f=await fixture();const {db,service:s,signedLicense}=f;
 try{
  const capturedAt=new Date().toISOString(),entry={key:'report:2026-11-10',capturedAt,data:report('2026-11-10',100)};
  await s.upload({signedLicense,entries:[entry]});await s.upload({signedLicense,entries:[entry]});
  await s.upload({signedLicense,entries:[{...entry,capturedAt:'2000-01-01',data:report('2026-11-10',999)}]});
  assert.equal((await s.row(7,entry.key)).payload.breakdown.total,100);
  const wrong={...signedLicense,payload:{...signedLicense.payload,hardwareFingerprint:'WRONG'}};
  wrong.signature=crypto.createHmac('sha256',key).update(JSON.stringify(wrong.payload)).digest('hex');
  await assert.rejects(()=>s.upload({signedLicense:wrong,entries:[entry]}),e=>e.statusCode===403);
  await assert.rejects(()=>s.upload({signedLicense,entries:[{...entry,data:report('2026-11-09',100)}]}),e=>e.statusCode===400);
  db.exec("UPDATE clubs SET status='BLOCKED' WHERE id=7");
  await assert.rejects(()=>s.upload({signedLicense,entries:[entry]}),e=>e.statusCode===403);
 }finally{db.close();}
});
test('cloud login limits survive new service instances and normalize whitespace',async()=>{
 const f=await fixture();try{
  for(let i=0;i<20;i++)await assert.rejects(()=>new MobileDashboard({db:f.db}).login({clubId:7,username:' '.repeat(i)+'owner',password:'bad'},'ip'),e=>e.statusCode===401);
  await assert.rejects(()=>f.service.login({clubId:7,username:'owner',password:'1234'},'ip'),e=>e.statusCode===429);
 }finally{f.db.close();}
});
test('short-lived cloud grants preserve local user identity, permissions and account revision',async()=>{
 const f=await fixture();const local=new DatabaseSync(':memory:');
 try{
  const login=await f.service.login({clubId:7,username:'cashier',password:'5678'},'ip');
  const p=login.grant.payload;
  local.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY,club_id INTEGER,username TEXT,role TEXT,permissions TEXT);CREATE TABLE cloud_administrator_state(club_id INTEGER,revision INTEGER,user_id INTEGER);`);
  local.prepare('INSERT INTO users VALUES(1,1,?,?,?)').run('cashier','administrator','["session:manage"]');
  local.prepare('INSERT INTO cloud_administrator_state VALUES(7,?,1)').run(p.revision);
  const user=mobileCloudUser(local,login.grant,f.signedLicense.payload);assert.equal(user.id,1);assert.equal(user.role,'administrator');assert.equal(user.permissions,'["session:manage"]');
  assert.equal(mobileCloudUser(local,{...login.grant,payload:{...p,role:'manager'}},f.signedLicense.payload),null);
  assert.equal(mobileCloudUser(local,login.grant,{...f.signedLicense.payload,clubId:8}),null);
  local.exec('UPDATE cloud_administrator_state SET revision=revision+1');assert.equal(mobileCloudUser(local,login.grant,f.signedLicense.payload),null);
 }finally{local.close();f.db.close();}
});
