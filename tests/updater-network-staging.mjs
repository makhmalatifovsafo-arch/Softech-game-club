// Real packaged, unlicensed server: failing Windows default DNS, redirected
// manifest/ZIP download, integrity verification and staging. Never installs on
// the developer's real server; the isolated fixture is held below the idle gate.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const version=process.argv[2];
const applyBusy=process.argv.includes('--apply-busy');
const release=path.resolve('Releases/v'+version);
const manifest=JSON.parse(fs.readFileSync(path.join(release,'version.json')));
const zip=path.join(release,'SoftechServer.zip');
const root=fs.mkdtempSync(path.resolve('.test-output/ota-network-'));
const dir=path.join(root,'server');fs.mkdirSync(dir);
const unpack=spawnSync('tar.exe',['-xf',zip,'-C',dir],{windowsHide:true,encoding:'utf8'});
assert.equal(unpack.status,0,unpack.stderr);
const pkg=JSON.parse(fs.readFileSync(path.join(dir,'package.json')));
pkg.version='0.0.1';fs.writeFileSync(path.join(dir,'package.json'),JSON.stringify(pkg));
fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({updateIdleSeconds:3600}));
const stub=http.createServer((req,res)=>{
  if(req.url==='/latest'){res.writeHead(302,{Location:'/manifest'});res.end();}
  else if(req.url==='/manifest'){res.end(JSON.stringify({...manifest,server:{...manifest.server,downloadUrl:`http://localhost:${stub.address().port}/asset`}}));}
  else if(req.url==='/asset'){res.writeHead(302,{Location:'/file'});res.end();}
  else if(req.url==='/file'){res.writeHead(200,{'Content-Length':fs.statSync(zip).size});fs.createReadStream(zip).pipe(res);}
  else{res.end('{"success":true,"status":"PENDING"}');}
});
stub.listen(0,'127.0.0.1');await once(stub,'listening');
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const preload=path.join(root,'dns-fixture.mjs');
const pidFile=path.join(root,'server.pid');
fs.writeFileSync(preload,`
import dns from 'node:dns';import {syncBuiltinESMExports} from 'node:module';
const original=dns.lookup;
dns.lookup=function(host,options,callback){
 if(host!=='localhost')return original.apply(this,arguments);
 if(options.family===4&&options.hints===0){console.log('SAFE_UPDATE_DNS');return process.nextTick(()=>callback(null,'127.0.0.1',4));}
 process.nextTick(()=>callback(Object.assign(new Error('getaddrinfo ENOENT'),{code:'ENOENT',syscall:'getaddrinfo'})));
};syncBuiltinESMExports();
if(process.argv[1] && (await import('node:path')).default.resolve(process.argv[1])===${JSON.stringify(path.join(dir,'src/server.js'))}) {
 const {ServerUpdater}=await import(${JSON.stringify(pathToFileURL(path.join(dir,'src/services/updater.js')).href)});
 ServerUpdater.probeIdle=async()=>0;
 (await import('node:fs')).writeFileSync(${JSON.stringify(pidFile)},String(process.pid));
}
`);
const cloud=`http://127.0.0.1:${stub.address().port}`;
const child=spawn(path.join(dir,'runtime/node.exe'),['--import',pathToFileURL(preload).href,'src/server.js'],{
  cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],
  env:{...process.env,NODE_OPTIONS:applyBusy?'--import='+pathToFileURL(preload).href:'',PORT:String(port),SOFTECH_CLOUD_URL:cloud,UPDATE_MANIFEST_URL:`http://localhost:${stub.address().port}/latest`,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',NODE_ENV:'production'}
});
let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
try{
  let status;const deadline=Date.now()+120000;
  while(Date.now()<deadline){
    assert.equal(child.exitCode,null,logs);
    try{status=await(await fetch(`http://127.0.0.1:${port}/api/updates/status`)).json();}catch{}
    if(status?.error)throw Error(status.error+'\n'+logs);
    if(status?.isStaged)break;
    await new Promise(r=>setTimeout(r,250));
  }
  assert.equal(status?.isStaged,true,logs);
  assert.equal(status.currentVersion,'0.0.1');assert.equal(status.latestVersion,version);
  assert.equal(status.stagedVersion,version);assert.equal(status.downloadedBytes,fs.statSync(zip).size);
  assert.equal(status.isApplying,false);assert.equal(status.error,null);
  const license=await(await fetch(`http://127.0.0.1:${port}/api/license/status`)).json();
  assert.equal(license.state,'PENDING_ACTIVATION');assert.match(logs,/SAFE_UPDATE_DNS/);
  console.log('PASS: unlicensed packaged server downloads redirected release with Windows-safe DNS, verifies SHA256 and stages '+version+' automatically');
  if(applyBusy){
    const dbFile=path.join(dir,'netcafe.db');
    let db=new DatabaseSync(dbFile);db.exec('PRAGMA busy_timeout=5000');
    const tariff=db.prepare('SELECT id FROM tariffs LIMIT 1').get().id;
    const end=new Date(Date.now()+3600000).toISOString();
    db.prepare("INSERT INTO computers(id,club_id,pc_number,name,status,current_session_id) VALUES('busy-pc',1,77,'PC-77','OCCUPIED','busy-session')").run();
    db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,ends_at,total_amount,paid_amount,status) VALUES('busy-session',1,'busy-pc',?,?,25000,25000,'ACTIVE')").run(tariff,end);
    db.prepare("INSERT INTO bar_items(club_id,name,sell_price,stock_quantity) VALUES(1,'Update preservation drink',9000,17)").run();
    db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,payment_method) VALUES(1,'UPDATE-TEST',77,'busy-session',9000,'PENDING_AT_CHECKOUT','ON_PC_SESSION')").run();
    db.prepare("UPDATE clubs SET is_active=1,expires_at=? WHERE id=1").run(end);
    const userId=Number(db.prepare("INSERT INTO users(club_id,username,password_hash,role,permissions) VALUES(1,'update-test-admin','unused','administrator','[]')").run().lastInsertRowid);
    const token='fixture_'+crypto.randomUUID(),expiresAt=Date.now()+3600000;
    db.exec('CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,session_json TEXT NOT NULL,expires_at INTEGER NOT NULL)');
    db.prepare('INSERT INTO auth_sessions VALUES(?,?,?)').run(crypto.createHash('sha256').update(token).digest('hex'),JSON.stringify({userId,expiresAt}),expiresAt);
    db.close();
    const url=`http://127.0.0.1:${port}`;
    const headers={'Content-Type':'application/json',Authorization:'Bearer '+token};
    assert.equal((await fetch(url+'/api/updates/apply',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"force":true}'})).status,401);
    assert.equal((await fetch(url+'/api/updates/apply',{method:'POST',headers,body:'{"force":false}'})).status,400);
    status=await(await fetch(url+'/api/updates/status')).json();
    assert.equal(status.activeSessions,1);assert.equal(status.canApply,false);
    const response=await fetch(url+'/api/updates/apply',{method:'POST',headers,body:'{"force":true}',signal:AbortSignal.timeout(90000)});
    assert.equal(response.status,200,await response.text());
    const installed=Date.now()+120000;let healthy=false;
    while(Date.now()<installed){
      try { const h=await(await fetch(url+'/api/health',{signal:AbortSignal.timeout(1500)})).json();
        if(h.version===version&&fs.existsSync(path.join(dir,'updates-last-success.json'))){healthy=true;break;}
      }catch{}
      await new Promise(r=>setTimeout(r,500));
    }
    assert.equal(healthy,true,fs.existsSync(path.join(dir,'logs/updater.log'))?fs.readFileSync(path.join(dir,'logs/updater.log'),'utf8'):logs);
    db=new DatabaseSync(dbFile,{readOnly:true});
    const session=db.prepare("SELECT * FROM sessions WHERE id='busy-session'").get();
    assert.equal(session.status,'ACTIVE');assert.equal(session.ends_at,end);
    assert.equal(session.total_amount,25000);assert.equal(session.paid_amount,25000);
    assert.equal(db.prepare("SELECT stock_quantity FROM bar_items WHERE name='Update preservation drink'").get().stock_quantity,17);
    assert.equal(db.prepare("SELECT payment_status FROM bar_orders WHERE order_number='UPDATE-TEST'").get().payment_status,'PENDING_AT_CHECKOUT');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n>0,true);
    db.close();
    status=await(await fetch(url+'/api/updates/status')).json();
    assert.equal(status.currentVersion,version);assert.equal(status.activeSessions,1);
    console.log('PASS: authenticated administrator installs while busy; native helper restarts healthy; active session, money, bar stock/order and login survive');
  }
}finally{
  if(child.exitCode===null){const done=once(child,'exit');child.kill();await done;}
  if(applyBusy&&fs.existsSync(pidFile)){
    const restartedPid=Number(fs.readFileSync(pidFile,'utf8'));
    if(restartedPid!==child.pid&&Number.isInteger(restartedPid)&&restartedPid>0){try{process.kill(restartedPid);}catch{}}
  }
  stub.closeAllConnections();await new Promise(r=>stub.close(r));
}
