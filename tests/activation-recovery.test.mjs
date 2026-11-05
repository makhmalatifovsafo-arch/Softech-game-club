import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readCloudResponse} from '../NetCafeServer/src/services/cloudResponse.js';

test('cloud non-JSON errors show HTTP status instead of a JSON parser exception', async () => {
  await assert.rejects(readCloudResponse(new Response('NOT_FOUND', {status:404})), /HTTP 404/);
  await assert.rejects(readCloudResponse(new Response('null')), /HTTP 200/);
  assert.deepEqual(await readCloudResponse(new Response('{"success":true}')), {success:true});
});

test('fresh activation recovers after network failure, throttles retries and respects pending requests and bans', async () => {
  fs.mkdirSync('.test-output', {recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/activation-recovery-'));
  fs.cpSync('NetCafeServer/src',path.join(dir,'src'),{recursive:true});
  fs.copyFileSync('NetCafeServer/package.json',path.join(dir,'package.json'));
  const {LicenseManager:L}=await import(pathToFileURL(path.join(dir,'src/services/licenseManager.js')));
  const {HwidService}=await import(pathToFileURL(path.join(dir,'src/services/hwidService.js')));
  HwidService.getHardwareFingerprint=()=> 'TEST-RECOVERY-HWID';
  L.cloudUrl='http://activation.test';
  const originalFetch=globalThis.fetch,originalNow=Date.now;
  let now=100000,status='NONE',posts=0,online=false,lastBody;
  Date.now=()=>now;
  globalThis.fetch=async (url,options={})=> {
    if(options.method==='POST') {
      posts++; lastBody=JSON.parse(options.body);
      if(!online)throw Error('network unavailable');
      status='PENDING';return new Response('{"success":true,"status":"PENDING"}');
    }
    return new Response(JSON.stringify({status}));
  };
  try {
    assert.equal((await L.requestActivation('Recovery Club')).success,false);
    online=true;
    await L.checkApprovalStatus();assert.equal(posts,1,'No immediate retry loop');
    now+=60000;
    await L.checkApprovalStatus();assert.equal(posts,2);
    assert.equal(lastBody.clubName,'Recovery Club');
    assert.equal(lastBody.serverVersion,JSON.parse(fs.readFileSync('NetCafeServer/package.json')).version);
    now+=60000;await L.checkApprovalStatus();assert.equal(posts,2,'PENDING must not resend Telegram requests');
    status='NONE';L.state='LOCKED_BY_ADMIN';
    await L.checkApprovalStatus();assert.equal(posts,2,'A ban must not become a new activation');
    L.state='ACTIVE';L.licenseData={clubId:1};let reason;
    L.enforceLockdown=value=>{reason=value;};
    await L.checkApprovalStatus();assert.equal(reason,'CLUB_REMOVED');assert.equal(posts,2);
    L.licenseData=null;L.state='PENDING_ACTIVATION';
    let release;globalThis.fetch=()=>new Promise(resolve=>{release=resolve;});
    const first=L.requestActivation('Recovery Club');
    assert.equal((await L.requestActivation('Duplicate')).success,false);
    release(new Response('{"success":true}'));await first;
    assert.equal(L.activationRequestInFlight,false);
  } finally {
    globalThis.fetch=originalFetch;Date.now=originalNow;
    if(L.approvalPollTimer)clearInterval(L.approvalPollTimer);
  }
});
