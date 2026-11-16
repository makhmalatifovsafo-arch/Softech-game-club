import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import crypto from 'node:crypto';
import WebSocket from 'ws';
test('live hub authenticates tickets, isolates clubs and routes wake signals without business payloads',async()=>{
 const secret=crypto.randomBytes(32).toString('hex');
 const child=spawn(process.execPath,['scripts/live-hub.mjs'],{env:{...process.env,SOFTECH_LIVE_SECRET:secret,PORT:'0'},stdio:['ignore','pipe','pipe']});
 const clients=[];
 try{
  const [line]=await once(child.stdout,'data');const port=Number(String(line).trim());assert.ok(port);
  async function connect(clubId,role){const ws=new WebSocket(`ws://127.0.0.1:${port}/live`);clients.push(ws);await once(ws,'open');const body=Buffer.from(JSON.stringify({clubId,role,expiresAt:Date.now()+60000})).toString('base64url');const reply=once(ws,'message');ws.send(JSON.stringify({ticket:body+'.'+crypto.createHmac('sha256',secret).update(body).digest('base64url')}));assert.equal(JSON.parse(String((await reply)[0])).event,'connected');return ws;}
  const server=await connect(18,'server'),mobile=await connect(18,'mobile'),other=await connect(19,'server');
  const unexpected=[];other.on('message',v=>unexpected.push(String(v)));mobile.on('message',v=>unexpected.push(String(v)));
  const result=once(server,'message');
  const response=await fetch(`http://127.0.0.1:${port}/notify`,{method:'POST',headers:{Authorization:'Bearer '+secret},body:JSON.stringify({clubId:18,event:'jobs'})});assert.equal(response.status,204);assert.deepEqual(JSON.parse(String((await result)[0])),{event:'jobs'});
  assert.equal((await fetch(`http://127.0.0.1:${port}/notify`,{method:'POST',body:'{}'})).status,403);
  assert.deepEqual(unexpected,[]);
  const bad=new WebSocket(`ws://127.0.0.1:${port}/live`);clients.push(bad);await once(bad,'open');const closed=once(bad,'close');bad.send(JSON.stringify({ticket:'bad.signature'}));assert.equal((await closed)[0],1008);
 }finally{for(const ws of clients)ws.terminate();child.kill();await once(child,'exit');}
});
