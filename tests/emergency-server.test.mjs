import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {HwidService} from '../NetCafeServer/src/services/hwidService.js';

const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){const value=await check();if(value)return value;await pause(50);}throw Error('Emergency fixture timeout');}
async function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/emergency-'));
  for(const name of ['src','public','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(root,name),{recursive:true});
  fs.mkdirSync(path.join(root,'data'));const payload={clubId:10,clubName:'Emergency Fixture',hardwareFingerprint:HwidService.getHardwareFingerprint(),status:'ACTIVE',maxPcs:20,verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  const key='SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';fs.writeFileSync(path.join(root,'data','softech_license.sig'),JSON.stringify({payload,signature:crypto.createHmac('sha256',key).update(JSON.stringify(payload)).digest('hex')}));
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  return {root,port,secret:crypto.randomBytes(32).toString('hex')};
}
async function startServer(f){
  let output='';const child=spawn(process.execPath,['src/emergency-server.js'],{cwd:f.root,env:{...process.env,NODE_ENV:'test',PORT:String(f.port),SOFTECH_SERVICE_CONTROL_SECRET:f.secret},windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const exited=once(child,'exit');
  await until(async()=>{if(child.exitCode!==null)throw Error(output);try{return (await fetch(`http://127.0.0.1:${f.port}/api/health`)).ok;}catch{return false;}});
  return {child,exited,output:()=>output};
}
const post=(port,route,body)=>fetch(`http://127.0.0.1:${port}${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-Softech-Emergency':'1'},body:JSON.stringify(body)});
test('database-free emergency sessions reconnect, stay outside finance and keep an authenticated durable journal',async()=>{
  const f=await fixture();let running=await startServer(f),socket;
  try{
    assert.equal(fs.existsSync(path.join(f.root,'netcafe.db')),false);
    socket=new WebSocket(`ws://127.0.0.1:${f.port}/ws`);await once(socket,'open');
    socket.send(JSON.stringify({type:'CLIENT_HELLO',pcNumber:'PC-07',payload:{pcNumber:'PC-07',macAddress:'02:00:00:00:00:07'}}));
    const ack=JSON.parse((await once(socket,'message'))[0]);assert.equal(ack.type,'HANDSHAKE_ACK');assert.equal(ack.emergencyMode,true);
    const state=await until(async()=>{const value=await(await fetch(`http://127.0.0.1:${f.port}/api/emergency/state`)).json();return value.clients.length?value:null;});
    assert.equal((await post(f.port,'/api/emergency/start',{clientKey:state.clients[0].clientKey,minutes:60,operator:'',note:'DB repair'})).status,400);
    const startMessage=once(socket,'message');assert.equal((await post(f.port,'/api/emergency/start',{clientKey:state.clients[0].clientKey,minutes:60,operator:'Admin',note:'DB repair'})).status,201);
    const started=JSON.parse((await startMessage)[0]);assert.equal(started.type,'START_SESSION');assert.equal(started.remainingSeconds,3600);assert.equal(started.tariffName,'Favqulodda vaqtli seans');
    socket.close();await once(socket,'close');running.child.kill();await running.exited;
    running=await startServer(f);socket=new WebSocket(`ws://127.0.0.1:${f.port}/ws`);await once(socket,'open');socket.send(JSON.stringify({type:'CLIENT_HELLO',pcNumber:'PC-07',payload:{pcNumber:'PC-07',macAddress:'02:00:00:00:00:07'}}));
    const resumed=JSON.parse((await once(socket,'message'))[0]);assert.equal(resumed.activeSession.sessionId,started.sessionId);assert.ok(resumed.activeSession.remainingSeconds>3500);
    const live=await(await fetch(`http://127.0.0.1:${f.port}/api/emergency/state`)).json(),stopMessage=once(socket,'message');assert.equal((await post(f.port,'/api/emergency/stop',{sessionId:live.clients[0].activeSession.sessionId})).status,200);
    assert.equal(JSON.parse((await stopMessage)[0]).type,'STOP_SESSION');
    const lines=fs.readFileSync(path.join(f.root,'data','emergency-sessions.ndjson'),'utf8').trim().split(/\r?\n/).map(JSON.parse);assert.deepEqual(lines.map(x=>x.type),['SESSION_STARTED','SESSION_ENDED']);assert.ok(lines.every(x=>x.hash&&x.previousHash));
    assert.equal(fs.existsSync(path.join(f.root,'netcafe.db')),false,'Emergency mode invented a financial database');
    socket.close();await once(socket,'close');running.child.kill();await running.exited;
    fs.appendFileSync(path.join(f.root,'data','emergency-sessions.ndjson'),'{"tampered":true}\n');
    const denied=spawn(process.execPath,['src/emergency-server.js'],{cwd:f.root,env:{...process.env,PORT:String(f.port),SOFTECH_SERVICE_CONTROL_SECRET:f.secret},windowsHide:true,stdio:'ignore'});
    assert.equal((await once(denied,'exit'))[0],79);
  }finally{if(socket?.readyState===WebSocket.OPEN)socket.close();if(running.child.exitCode===null){running.child.kill();await running.exited;}}
});
