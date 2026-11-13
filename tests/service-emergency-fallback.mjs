import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {HwidService} from '../NetCafeServer/src/services/hwidService.js';
const dotnet=process.env.DOTNET_EXE||path.resolve('.tools/dotnet-sdk/dotnet.exe'),host=path.resolve('NetCafeServer/Service/bin/Debug/net8.0-windows/win-x64/SoftechService.dll');
const pause=ms=>new Promise(r=>setTimeout(r,ms));async function until(check,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const v=await check();if(v)return v;await pause(50);}throw Error('Service emergency fallback timeout');}
fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/service-emergency-'));
for(const name of ['src','public','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(root,name),{recursive:true});
const validServer=fs.readFileSync(path.join(root,'src/server.js'));fs.writeFileSync(path.join(root,'src/server.js'),'this is invalid javascript !!!');fs.mkdirSync(path.join(root,'runtime'));fs.copyFileSync(process.execPath,path.join(root,'runtime/node.exe'));fs.writeFileSync(path.join(root,'config.json'),'{}');fs.mkdirSync(path.join(root,'data'));
const payload={clubId:10,clubName:'Fallback Fixture',hardwareFingerprint:HwidService.getHardwareFingerprint(),status:'ACTIVE',maxPcs:10,verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()},master='SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';fs.writeFileSync(path.join(root,'data','softech_license.sig'),JSON.stringify({payload,signature:crypto.createHmac('sha256',master).update(JSON.stringify(payload)).digest('hex')}));
const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));const base=`http://127.0.0.1:${port}`;
let output='';const worker=spawn(dotnet,[host,'--console',root],{env:{...process.env,NODE_ENV:'test',PORT:String(port),SOFTECH_SERVICE_TEST_RETRY_SECONDS:'0',SOFTECH_SERVICE_TEST_STOP_FILE:'fixture-stop',SOFTECH_CLOUD_URL:'http://127.0.0.1:9',UPDATE_MANIFEST_URL:'http://127.0.0.1:9'},windowsHide:true,stdio:['ignore','pipe','pipe']});worker.stdout.on('data',d=>output+=d);worker.stderr.on('data',d=>output+=d);const exit=once(worker,'exit');
try{
  const emergency=await until(async()=>{if(worker.exitCode!==null)throw Error(output);try{return await(await fetch(base+'/api/health')).json();}catch{return null;}});assert.equal(emergency.app,'NetCafeEmergency');
  fs.writeFileSync(path.join(root,'src/server.js'),validServer);
  const retry=await fetch(base+'/api/emergency/retry-main',{method:'POST',headers:{'Content-Type':'application/json','X-Softech-Emergency':'1'},body:'{"operator":"fixture"}'});assert.equal(retry.status,202);
  const normal=await until(async()=>{try{const h=await(await fetch(base+'/api/health')).json();return h.app==='NetCafeServer'?h:null;}catch{return null;}},60000);assert.equal(normal.app,'NetCafeServer');
  console.log('PASS repeated main crashes enter limited emergency mode and manual retry returns to the repaired main server');
}finally{fs.writeFileSync(path.join(root,'fixture-stop'),'stop');if(worker.exitCode===null){await Promise.race([exit,pause(15000)]);if(worker.exitCode===null){worker.kill();await exit;}}}
