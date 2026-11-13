import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ServerDiagnostics,sanitizeDiagnostic,handleServerDiagnostics} from '../src/services/serverDiagnostics.js';
import {renderServerDiagnostics} from '../public/views/serverDiagnostics.js';
import {recordBackupHealth} from '../NetCafeServer/src/services/databaseBackup.js';

const report=(delta=0)=>({observedAt:new Date(Date.now()+delta).toISOString(),backendState:'FAILED',errorCode:'CONFIG_INVALID',configState:'INVALID',serverVersion:'1.1.18',launcherVersion:'1.1.18',lastBackupAt:new Date().toISOString(),backupError:'NONE',freeDiskBytes:500000,databasePresent:true,rawLog:'PRIVATE_SECRET',password:'PRIVATE_PASSWORD'});
function signed(clubId=10,hwid='fixture-hwid'){
  const payload={clubId,hardwareFingerprint:hwid,status:'ACTIVE',expiresAt:new Date(Date.now()+86400000).toISOString()};
  return {payload,signature:crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex')};
}
function database(){const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE clubs(id INTEGER PRIMARY KEY, hardware_fingerprint TEXT,status TEXT,last_heartbeat_at TEXT,server_version TEXT);INSERT INTO clubs VALUES(10,'fixture-hwid','OFFLINE','2026-01-01','1.1.11')");return db;}

test('launcher diagnostics are isolated from heartbeat/licensing, authenticated and ordered; secrets never persist',async()=>{
  const db=database();try{
    const service=new ServerDiagnostics({db}),body={clubId:10,signedLicense:signed(),report:report()};
    const before=db.prepare('SELECT * FROM clubs').get();
    await service.ingest(body);
    const row=await service.get(10);
    assert.equal(row.report.errorCode,'CONFIG_INVALID');assert.ok(!JSON.stringify(row).includes('PRIVATE'));
    assert.deepEqual(db.prepare('SELECT * FROM clubs').get(),before);
    await service.ingest({...body,report:{...report(-10000),backendState:'RUNNING',errorCode:'NONE'}});
    assert.equal((await service.get(10)).report.backendState,'FAILED');
    await service.ingest({...body,report:{...report(1000),backendState:'RUNNING',errorCode:'NONE'}});
    assert.equal((await service.get(10)).report.backendState,'RUNNING');
    await service.ingest({...body,report:{...report(2000),backendState:'EMERGENCY',errorCode:'DATABASE_INVALID'}});
    assert.equal((await service.get(10)).report.backendState,'EMERGENCY');
    for(const bad of [{...body,clubId:11},{...body,signedLicense:signed(10,'other-hwid')},{...body,signedLicense:{...signed(),signature:'0'.repeat(64)}}])
      await assert.rejects(()=>service.ingest(bad),{statusCode:401});
    assert.equal(await service.get(11),null);
    assert.throws(()=>sanitizeDiagnostic(report(86400000)),{statusCode:400});
    assert.throws(()=>sanitizeDiagnostic({...report(),errorCode:'SECRET_RAW_ERROR'}),{statusCode:400});
  }finally{db.close();}
});

test('diagnostics route restricts downloads, bounds bodies and handles missing migrations without exposing errors',async()=>{
  const db=database();
  async function call(method,url,body,allowed=false,storage={db}){let output;const res={setHeader(){},end(text){output={status:this.statusCode,body:JSON.parse(text)};}};
    await handleServerDiagnostics({method,url,body},res,storage,()=>{if(!allowed){res.statusCode=401;res.end('{"success":false}');}return allowed;});return output;}
  try{
    assert.equal((await call('GET','/api/clubs/10/diagnostics')).status,401);
    assert.equal((await call('POST','/api/telemetry/diagnostics','x'.repeat(17000))).status,413);
    assert.equal((await call('POST','/api/telemetry/diagnostics','{')).status,400);
    assert.equal((await call('POST','/api/telemetry/diagnostics',{clubId:10,signedLicense:signed(),report:report()})).status,200);
    assert.equal((await call('GET','/api/clubs/10/diagnostics',undefined,true)).body.diagnostic.report.serverVersion,'1.1.18');
    const unavailable={client:{from(){return {select(){return this;},eq(){return this;},maybeSingle(){return Promise.resolve({error:{message:'PRIVATE_STORAGE_ERROR'}});}};}}};
    const result=await call('GET','/api/clubs/10/diagnostics',undefined,true,unavailable);
    assert.equal(result.status,503);assert.ok(!JSON.stringify(result).includes('PRIVATE_STORAGE_ERROR'));
  }finally{db.close();}
});

test('diagnostic UI distinguishes old data, disk/backup warnings, absent reports and escaped text',()=>{
  const diagnostic={receivedAt:new Date().toISOString(),report:sanitizeDiagnostic(report())};
  let html=renderServerDiagnostics(diagnostic);
  assert.match(html,/Launcher bilan aloqa bor/);assert.match(html,/1 GB/);assert.match(html,/Sozlama fayli buzilgan/);
  html=renderServerDiagnostics(diagnostic,'ready',Date.now()+3*3600000);
  assert.match(html,/eski ma’lumot/);assert.match(html,/2 soat/);assert.ok(!html.includes('Launcher bilan aloqa bor'));
  assert.match(renderServerDiagnostics(null),/Eski versiyalar/);
  assert.match(renderServerDiagnostics(null,'unavailable'),/yuklab bo‘lmadi/);
  assert.ok(!renderServerDiagnostics({...diagnostic,report:{...diagnostic.report,serverVersion:'<img src=x onerror=alert(1)>'}}).includes('<img'));
  for(const [code,label] of [['SERVER_ALREADY_RUNNING','boshqa server jarayoni'],['SERVER_INSTANCE_LOCK_FAILED','himoyasini ochib'],['UPDATE_RECOVERY_REQUIRED','Uzilgan yangilanishni']]){
    const safe=sanitizeDiagnostic({...report(),errorCode:code});
    assert.ok(renderServerDiagnostics({...diagnostic,report:safe}).includes(label));
  }
});

test('backup health records failure and recovery without raw errors, credentials or paths',()=>{
  fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/backup-diagnostic-'));fs.mkdirSync(path.join(dir,'data'));
  const file=path.join(dir,'netcafe.db'),health=path.join(dir,'data/backup-health.json');
  recordBackupHealth(file);const previous=JSON.parse(fs.readFileSync(health));
  recordBackupHealth(file,Object.assign(Error('PRIVATE_CREDENTIALS_PATH'),{code:'ENOSPC'}));
  const failed=JSON.parse(fs.readFileSync(health));assert.equal(failed.errorCode,'DISK_FULL');assert.equal(failed.lastSuccessAt,previous.lastSuccessAt);assert.ok(!JSON.stringify(failed).includes('PRIVATE'));
  recordBackupHealth(file);assert.equal(JSON.parse(fs.readFileSync(health)).errorCode,'NONE');
});

test('root and mirrored Vercel diagnostics route requires superadmin for reads and uses the Supabase RPC for writes',async()=>{
  process.env.VERCEL='1';process.env.SUPERADMIN_JWT_SECRET='diagnostic-fixture-secret-at-least-32-characters';
  process.env.SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';
  for(const prefix of ['','SoftechCloudAdmin/']){
    const {default:handler}=await import('../'+prefix+'api/index.js');
    const {SupabaseCloudService}=await import('../'+prefix+'src/services/supabaseClient.js');
    const {signAccessToken}=await import('../'+prefix+'src/utils/jwt.js');
    let saved=null,calls=0;
    SupabaseCloudService.client={
      from(table){let filters={};return {select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){
        return {data:table==='clubs'?(filters.id===10&&filters.hardware_fingerprint==='fixture-hwid'?{id:10}:null):saved,error:null};
      }};},
      async rpc(name,args){assert.equal(name,'softech_server_diagnostic_upsert');assert.equal(args.p_club_id,10);calls++;saved={payload:args.p_payload,received_at:new Date().toISOString()};return {data:null,error:null};}
    };
    async function request(method,url,body,role){let result;await handler({method,url,body,headers:{host:'localhost',...(role?{authorization:'Bearer '+signAccessToken({sub:1,role})}:{})}},
      {setHeader(){},end(text){result={status:this.statusCode,body:JSON.parse(text)};}});return result;}
    assert.equal((await request('POST','/api/telemetry/diagnostics',{clubId:10,signedLicense:signed(),report:report()})).status,200);
    assert.equal(calls,1);assert.ok(!JSON.stringify(saved).includes('PRIVATE'));
    assert.equal((await request('GET','/api/clubs/10/diagnostics',undefined,'manager')).status,401);
    assert.equal((await request('GET','/api/clubs/10/diagnostics')).status,401);
    assert.equal((await request('GET','/api/clubs/10/diagnostics',undefined,'superadmin')).body.diagnostic.report.errorCode,'CONFIG_INVALID');
  }
});
