import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {recoverServerConfig} from '../NetCafeServer/src/services/serverConfig.js';
import {writeDurableFile,writeDurableJson} from '../NetCafeServer/src/services/durableJson.js';

function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/storage-resilience-'));
  fs.mkdirSync(path.join(dir,'data'));
  const file=path.join(dir,'config.json');
  const config={clubId:10,cloudUrl:'https://club.example',custom:'preserved'};
  const payload={clubId:10,status:'ACTIVE'};
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex');
  fs.writeFileSync(path.join(dir,'data/softech_license.sig'),JSON.stringify({payload,signature}));
  fs.writeFileSync(file,Buffer.alloc(99));
  fs.writeFileSync(file+'.last-good',JSON.stringify(config));
  return {dir,file,config};
}

test('automatic config recovery preserves evidence and cannot change identity, secrets or persisted bans',()=>{
  const {dir,file,config}=fixture();
  const license=fs.readFileSync(path.join(dir,'data/softech_license.sig'));
  fs.writeFileSync(path.join(dir,'data/license_lock.json'),'existing-ban');
  assert.equal(recoverServerConfig(file),true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),config);
  assert.ok(fs.readdirSync(dir).some(n=>n.includes('.corrupt-')&&fs.readFileSync(path.join(dir,n)).equals(Buffer.alloc(99))));
  assert.deepEqual(fs.readFileSync(path.join(dir,'data/softech_license.sig')),license);
  assert.equal(fs.readFileSync(path.join(dir,'data/license_lock.json'),'utf8'),'existing-ban');
  // A deliberate valid config must not silently revert to the saved backup.
  fs.writeFileSync(file,JSON.stringify({...config,clubId:11}));
  assert.equal(recoverServerConfig(file),false);
  assert.equal(JSON.parse(fs.readFileSync(file)).clubId,11);
  for(const bad of [{...config,clubId:11},{...config,cloudUrl:'bad-url'},{}]){
    fs.writeFileSync(file,Buffer.alloc(99));fs.writeFileSync(file+'.last-good',JSON.stringify(bad));
    assert.throws(()=>recoverServerConfig(file),{code:'INVALID_SERVER_CONFIG'});
    assert.deepEqual(fs.readFileSync(file),Buffer.alloc(99));
  }
  fs.writeFileSync(file+'.last-good',JSON.stringify(config));
  fs.writeFileSync(path.join(dir,'data/softech_license.sig'),'{"payload":{"clubId":10},"signature":"forged"}');
  assert.throws(()=>recoverServerConfig(file),{code:'INVALID_SERVER_CONFIG'});
});

test('failed disk flush never truncates old settings and unchanged JSON does not replace the file',()=>{
  const {file}=fixture();
  writeDurableJson(file,{clubId:10});
  const before=fs.readFileSync(file),original=fs.fsyncSync;
  try{
    fs.fsyncSync=()=>{throw Object.assign(Error('fixture disk full'),{code:'ENOSPC'});};
    writeDurableJson(file,{clubId:10});
    assert.throws(()=>writeDurableFile(file,'new-content'),{code:'ENOSPC'});
    assert.deepEqual(fs.readFileSync(file),before);
    assert.equal(fs.readdirSync(path.dirname(file)).some(n=>n.endsWith('.tmp')),false);
  }finally{fs.fsyncSync=original;}
});

test('disk-full lockdown enforces state and notifies clients without crashing or destroying previous lock',async()=>{
  const {dir}=fixture();
  fs.cpSync('NetCafeServer/src',path.join(dir,'src'),{recursive:true});
  const {LicenseManager:L}=await import(pathToFileURL(path.join(dir,'src/services/licenseManager.js')));
  const file=path.join(dir,'data/license_lock.json');fs.writeFileSync(file,'previous-lock');
  let dropped=0,broadcast=0;
  L.sessionDropper=()=>dropped++;L.clientBroadcaster=()=>broadcast++;
  const original=fs.fsyncSync;
  try{
    fs.fsyncSync=()=>{throw Object.assign(Error('disk full'),{code:'ENOSPC'});};
    assert.doesNotThrow(()=>L.enforceLockdown('REMOTE_BLOCKED','fixture'));
    assert.equal(L.isOperational(),false);assert.equal(dropped,1);assert.equal(broadcast,1);
    assert.equal(fs.readFileSync(file,'utf8'),'previous-lock');
  }finally{fs.fsyncSync=original;}
});
