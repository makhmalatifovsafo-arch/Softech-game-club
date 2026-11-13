// Real Windows worker + Node + updater, isolated from installed clubs and SCM.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
const dotnet=process.env.DOTNET_EXE||path.resolve('.tools/dotnet-sdk/dotnet.exe');
const hostDll=path.resolve('NetCafeServer/Service/bin/Debug/net8.0-windows/win-x64/SoftechService.dll');
const hostExecutable=process.env.SOFTECH_SERVICE_EXE?path.resolve(process.env.SOFTECH_SERVICE_EXE):null;
const hostCommand=hostExecutable||dotnet;
const hostArguments=root=>hostExecutable?['--console',root]:[hostDll,'--console',root];
const helperDll=path.resolve('SoftechUpdater/bin/Debug/net8.0-windows/win-x64/SoftechUpdater.dll');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=40000){const end=Date.now()+timeout;while(Date.now()<end){const result=await check();if(result)return result;await pause(100);}throw Error('Service fixture timed out');}
fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/service-'));
for(const name of ['src','public','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(root,name),{recursive:true});
fs.mkdirSync(path.join(root,'runtime'));fs.copyFileSync(process.execPath,path.join(root,'runtime/node.exe'));fs.writeFileSync(path.join(root,'config.json'),'{}');
fs.mkdirSync(path.join(root,'.service/private'),{recursive:true});fs.writeFileSync(path.join(root,'.service/private/control.key'),Buffer.alloc(99));
const seed=new DatabaseSync(path.join(root,'netcafe.db'));seed.exec('CREATE TABLE service_saved_money(amount);INSERT INTO service_saved_money VALUES(5320)');seed.close();
const cloud=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"success":true,"status":"PENDING"}');});cloud.listen(0,'127.0.0.1');await once(cloud,'listening');
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
const base='http://127.0.0.1:'+port;
const env={...process.env,NODE_ENV:'test',PORT:String(port),SOFTECH_SERVICE_TEST_STOP_FILE:'fixture-stop',SOFTECH_CLOUD_URL:'http://127.0.0.1:'+cloud.address().port,UPDATE_MANIFEST_URL:'http://127.0.0.1:'+cloud.address().port};
let logs='',host,hostExit,updater,updaterExit,lastPid;
function launchHost(){host=spawn(hostCommand,hostArguments(root),{env,windowsHide:true,stdio:['ignore','pipe','pipe']});host.stdout.on('data',d=>logs+=d);host.stderr.on('data',d=>logs+=d);hostExit=once(host,'exit');}
async function health(){try{const h=await(await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).json();lastPid=h.processId;return h;}catch{return null;}}
async function stopNode(secret){return fetch(base+'/api/internal/service-stop',{method:'POST',headers:{'X-Softech-Service-Key':secret}});}
try {
  launchHost();const first=await until(health);assert.ok(first.processId);
  const secret=JSON.parse(fs.readFileSync(path.join(root,'.service/private/control.key'))).secret;
  assert.equal(secret.length,64);assert.ok(fs.readdirSync(path.join(root,'.service/private')).some(n=>n.startsWith('control.key.corrupt-')));
  assert.equal((await stopNode('wrong')).status,403);
  const duplicate=spawn(hostCommand,hostArguments(root),{env,windowsHide:true,stdio:'ignore'});
  assert.equal((await once(duplicate,'exit'))[0],1);assert.equal((await health()).processId,first.processId);
  process.kill(first.processId);const second=await until(async()=>{const h=await health();return h&&h.processId!==first.processId?h:null;});
  const check=new DatabaseSync(path.join(root,'netcafe.db'),{readOnly:true});assert.equal(check.prepare('SELECT amount FROM service_saved_money').get().amount,5320);check.close();
  host.kill();await hostExit;assert.equal((await health()).processId,second.processId,'Host crash must not kill a healthy backend');
  launchHost();await pause(2000);assert.equal((await health()).processId,second.processId,'Replacement host must adopt, not duplicate Node');
  console.log('PASS backend crash recovery, WAL money, host crash/adoption and single-owner guard');
  const source=path.join(root,'fixture-package');fs.mkdirSync(source);
  for(const name of ['src','public','schema.sql','package.json'])fs.cpSync(path.join(root,name),path.join(source,name),{recursive:true});
  fs.writeFileSync(path.join(source,'package.json'),JSON.stringify({type:'module',version:'9.0.0'}));fs.writeFileSync(path.join(source,'SoftechUpdater.exe'),'fixture');
  const files={};for(const name of fs.readdirSync(source,{recursive:true})){const file=path.join(source,name);if(fs.statSync(file).isFile())files[name.replaceAll('\\','/')]=crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');}
  fs.writeFileSync(path.join(source,'update-package.json'),JSON.stringify({kind:'server',version:'9.0.0',files}));
  const plan={Source:source,Target:root,Version:'9.0.0',Kind:'server',ParentPids:[second.processId],RestartExecutable:path.join(root,'runtime/node.exe'),RestartArguments:['src/server.js'],ReadyFile:path.join(root,'ready'),CommitFile:path.join(root,'commit'),CancelFile:path.join(root,'cancel'),HealthFile:path.join(root,'healthy'),HealthUrl:base+'/api/health',TimeoutSeconds:30};
  const planFile=path.join(root,'fixture-plan.json');fs.writeFileSync(planFile,JSON.stringify(plan));
  updater=spawn(dotnet,[helperDll,'--plan',planFile],{env:{...env,SOFTECH_SERVICE_ROOT:root,SOFTECH_SERVICE_CONTROL_SECRET:secret},windowsHide:true,stdio:'ignore'});updaterExit=once(updater,'exit');
  await until(()=>fs.existsSync(plan.ReadyFile)||updater.exitCode!==null);assert.ok(fs.existsSync(plan.ReadyFile));
  fs.writeFileSync(plan.CommitFile,'commit');assert.equal((await stopNode(secret)).status,202);
  assert.equal((await updaterExit)[0],0);await until(async()=>{const h=await health();return h?.version==='9.0.0'&&!h.updatePending;});
  await pause(1500);assert.equal((await health()).version,'9.0.0');
  console.log('PASS service defers to OTA lock, updater accepts new backend, host adopts updated Node');
  fs.writeFileSync(path.join(root,'fixture-stop'),'stop');assert.equal((await hostExit)[0],0,logs);
  assert.equal(await health(),null,'Graceful service stop left Node running');
  const final=new DatabaseSync(path.join(root,'netcafe.db'),{readOnly:true});assert.equal(final.prepare('SELECT amount FROM service_saved_money').get().amount,5320);assert.equal(final.prepare('PRAGMA integrity_check').get().integrity_check,'ok');final.close();
  console.log('PASS authenticated graceful stop and database integrity');
}catch(error){console.error(logs);throw error;}
finally {
  if(updater&&updater.exitCode===null){updater.kill();await updaterExit;}
  if(host&&host.exitCode===null){fs.writeFileSync(path.join(root,'fixture-stop'),'stop');await Promise.race([hostExit,pause(15000)]);if(host.exitCode===null){host.kill();await hostExit;}}
  if(lastPid)try{process.kill(lastPid);}catch{}
  cloud.closeAllConnections();await new Promise(r=>cloud.close(r));
}
