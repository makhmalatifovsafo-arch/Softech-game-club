import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync,mkdirSync,mkdtempSync } from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
test('72h offline lease, restart, persistent ban and signed recovery',async()=>{
  mkdirSync('.test-output',{recursive:true});
  const dir=mkdtempSync(path.resolve('.test-output/offline-'));
  cpSync('NetCafeServer/src',path.join(dir,'src'),{recursive:true});
  const {LicenseManager:L}=await import(pathToFileURL(path.join(dir,'src/services/licenseManager.js')));
  const {HwidService}=await import(pathToFileURL(path.join(dir,'src/services/hwidService.js')));
  HwidService.getHardwareFingerprint=()=> 'TEST-OFFLINE-HWID';
  const realNow=Date.now, origin=realNow();
  let now=origin;
  Date.now=()=>now;
  const signed=()=>{
    const payload={clubId:1,clubName:'Offline test',status:'ACTIVE',hardwareFingerprint:'TEST-OFFLINE-HWID',
      verifiedAt:new Date(now).toISOString(),expiresAt:new Date(origin+90*86400000).toISOString()};
    return {payload,signature:crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex')};
  };
  try {
    L.saveSignedLicense(signed());
    assert.equal(L.isOperational(),true);
    now=origin+72*3600000;
    assert.equal(L.loadAndVerifyLocalLicense(),true,'Exact 72h boundary remains valid');
    now++;
    assert.equal(L.loadAndVerifyLocalLicense(),false,'Restart after 72h cannot renew offline grace');
    assert.equal(L.lockReason,'OFFLINE_LEASE_EXPIRED');
    L.saveSignedLicense(signed());
    assert.equal(L.isOperational(),true);
    L.enforceLockdown('REMOTE_BLOCKED','Test ban');
    assert.equal(L.loadAndVerifyLocalLicense(),false);
    assert.equal(L.lockReason,'REMOTE_BLOCKED');
    L.saveSignedLicense(signed());
    assert.equal(L.isOperational(),true,'Fresh signed cloud approval restores access');
    now-=600001;
    assert.equal(L.loadAndVerifyLocalLicense(),false,'Restart cannot erase clock rollback evidence');
  } finally {Date.now=realNow;}
});
