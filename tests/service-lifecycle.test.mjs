import test from 'node:test';
import assert from 'node:assert/strict';
import {stopService} from '../NetCafeServer/src/services/serviceLifecycle.js';
import fs from 'node:fs';
import path from 'node:path';
import {serviceCockpits} from '../NetCafeServer/src/services/serviceCockpits.js';
const key='fixture-control-secret-32-characters';
const request=(secret=key,address='127.0.0.1')=>({headers:{'x-softech-service-key':secret},socket:{remoteAddress:address}});
const response=()=>({writeHead(code){this.status=code;},end(body){this.body=JSON.parse(body);}});
test('service stop rejects network callers, missing/wrong secrets and concurrent maintenance',async()=>{
  const updater={pendingWrites:0,applying:false,preparing:false,onShutdown(){assert.fail('Unexpected stop');}};
  for(const req of [request('bad'),request(key,'192.168.1.10'),request(undefined)]){
    if(req.headers['x-softech-service-key']===key&&req.socket.remoteAddress==='127.0.0.1')req.headers={};
    const res=response();await stopService(req,res,updater,key);assert.equal(res.status,403);assert.equal(updater.applying,false);
  }
  updater.preparing=true;const res=response();await stopService(request(),res,updater,key);assert.equal(res.status,409);
});
test('service stop drains committed writes and failed draining resumes the existing server',async()=>{
  let shutdown=0;const updater={pendingWrites:1,applying:false,preparing:false,onShutdown(){shutdown++;}};
  let res=response();await stopService(request(),res,updater,key,{timeout:0});assert.equal(res.status,503);assert.equal(updater.applying,false);
  res=response();await stopService(request(),res,updater,key,{sleep:async()=>{assert.equal(updater.applying,true);updater.pendingWrites=0;}});
  assert.equal(res.status,202);await new Promise(r=>setTimeout(r,130));assert.equal(shutdown,1);
});
test('service auto update uses fresh interactive input and treats missing or stale input as unknown',()=>{
  fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/service-input-'));
  fs.mkdirSync(path.join(root,'data'));const file=path.join(root,'data',`cockpit-${process.pid}.json`),at=Date.now();
  assert.deepEqual(serviceCockpits(root,at),[]);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,at,idleSeconds:12}));assert.equal(serviceCockpits(root,at+1000)[0].idleSeconds,12);
  assert.equal(serviceCockpits(root,at+7000)[0].idleSeconds,-1);assert.equal(serviceCockpits(root,at-1)[0].idleSeconds,-1);
  fs.writeFileSync(file,JSON.stringify({pid:process.pid,at,idleSeconds:0}));assert.equal(serviceCockpits(root,at)[0].idleSeconds,0);
  fs.writeFileSync(file,'broken');assert.deepEqual(serviceCockpits(root,at),[]);
});
