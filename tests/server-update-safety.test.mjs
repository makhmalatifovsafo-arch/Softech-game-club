import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import {claimServerInstance} from '../NetCafeServer/src/services/serverInstance.js';
import {UpdateProbation} from '../NetCafeServer/src/services/updateProbation.js';

test('manual launch refuses interrupted or unreadable update journals before accepting business work',()=>{
  fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/pending-journal-'));
  const token=crypto.randomUUID().replaceAll('-',''),dir=path.join(root,'.ota',token);fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,'journal.json');
  fs.writeFileSync(file,JSON.stringify({Phase:'APPLYING'}));
  assert.throws(()=>new UpdateProbation(root,''),/UPDATE_RECOVERY_REQUIRED/);
  assert.equal(new UpdateProbation(root,token).pending,true);
  fs.writeFileSync(file,'broken');assert.throws(()=>new UpdateProbation(root,''),/UPDATE_RECOVERY_REQUIRED/);
  fs.writeFileSync(file,JSON.stringify({Phase:'ACCEPTED'}));assert.equal(new UpdateProbation(root,'').pending,false);
});

test('server ownership uses an exclusive OS lock and releases it without PID assumptions',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/instance-lock-')),file=path.join(dir,'instance.db');
  const release=claimServerInstance(file);
  try{assert.throws(()=>claimServerInstance(file),{code:'SERVER_ALREADY_RUNNING'});}finally{release();}
  claimServerInstance(file)();
});

test('real server probation blocks all business channels and duplicate processes until exact durable approval', {timeout:30000},async()=>{
  fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/update-probation-'));
  for(const name of ['src','public','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(dir,name),{recursive:true});
  const token=crypto.randomUUID().replaceAll('-',''),transaction=path.join(dir,'.ota',token);fs.mkdirSync(transaction,{recursive:true});
  fs.writeFileSync(path.join(dir,'config.json'),'{}');
  const file=path.join(dir,'netcafe.db'),seed=new DatabaseSync(file);seed.exec('CREATE TABLE saved_balance(amount);INSERT INTO saved_balance VALUES(5320)');seed.close();
  let cloudCalls=0;const cloud=http.createServer((req,res)=>{cloudCalls++;res.setHeader('Content-Type','application/json');res.end('{"success":true,"status":"PENDING"}');});
  cloud.listen(0,'127.0.0.1');await once(cloud,'listening');
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const env={...process.env,NODE_ENV:'test',PORT:String(port),SOFTECH_UPDATE_TOKEN:token,SOFTECH_CLOUD_URL:'http://127.0.0.1:'+cloud.address().port,UPDATE_MANIFEST_URL:'http://127.0.0.1:'+cloud.address().port};
  const start=(extra={})=>spawn(process.execPath,['src/server.js'],{cwd:dir,env:{...env,...extra},windowsHide:true,stdio:['ignore','pipe','pipe']});
  let child=start(),logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);let exited=once(child,'exit');
  const base='http://127.0.0.1:'+port;
  async function health(pending){for(let i=0;i<120;i++){assert.equal(child.exitCode,null,logs);try{const r=await(await fetch(base+'/api/health',{signal:AbortSignal.timeout(500)})).json();if(r.updatePending===pending)return r;}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('Readiness timed out: '+logs);}
  try{
    assert.equal((await health(true)).updateToken,token);
    for(const route of ['/api/sessions/start','/api/bar/orders','/api/license/request-activation'])
      assert.equal((await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,503);
    assert.equal((await fetch(base+'/api/license/status')).status,503);assert.equal(cloudCalls,0);
    const waitingClient=new WebSocket(base.replace('http:','ws:')+'/ws');
    assert.equal((await once(waitingClient,'close'))[0],1013,'Clients must retry their handshake after update approval');
    const duplicate=start({PORT:'0'});let duplicateErrors='';duplicate.stderr.on('data',d=>duplicateErrors+=d);duplicate.stdout.resume();
    assert.equal((await once(duplicate,'exit'))[0],1);assert.match(duplicateErrors,/SERVER_ALREADY_RUNNING/);
    fs.writeFileSync(path.join(transaction,'approved.json'),JSON.stringify({token:'wrong'}));
    await new Promise(r=>setTimeout(r,350));assert.equal((await health(true)).updatePending,true);
    fs.writeFileSync(path.join(transaction,'approved.json'),JSON.stringify({token}));
    await health(false);assert.equal((await fetch(base+'/api/license/status')).status,200);
    child.kill();await exited;
    child=start({SOFTECH_UPDATE_TOKEN:''});child.stdout.resume();child.stderr.on('data',d=>logs+=d);exited=once(child,'exit');
    await health(false); // A forced exit must not leave a permanent ownership lock.
  }finally{
    if(child.exitCode===null)child.kill();await exited;
    cloud.closeAllConnections();await new Promise(r=>cloud.close(r));
  }
  const check=new DatabaseSync(file,{readOnly:true});try{assert.equal(check.prepare('SELECT amount FROM saved_balance').get().amount,5320);}finally{check.close();}
});
