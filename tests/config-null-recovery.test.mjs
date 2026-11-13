import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {restoreEmptyConfig} from '../scripts/support/Restore-SoftechConfig.mjs';
import {writeDurableJson} from '../NetCafeServer/src/services/durableJson.js';

function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/null-config-'));
  fs.mkdirSync(path.join(dir,'data'));
  const payload={clubId:73,status:'ACTIVE',hardwareFingerprint:'RECOVERY-FIXTURE-HWID',clubName:'Recovery fixture',
    verifiedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  const signed={payload,signature:crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex')};
  fs.writeFileSync(path.join(dir,'data/softech_license.sig'),JSON.stringify(signed));
  fs.writeFileSync(path.join(dir,'config.json'),Buffer.alloc(99));
  return dir;
}

test('confirmed 99 NUL bytes recover from existing signed club identity; license, ban and balances remain unchanged',()=>{
  const dir=fixture();
  fs.writeFileSync(path.join(dir,'data/license_lock.json'),'preserved-ban');
  fs.writeFileSync(path.join(dir,'netcafe.db'),'preserved-balance');
  const before=fs.readFileSync(path.join(dir,'data/softech_license.sig'));
  const result=restoreEmptyConfig(dir);
  assert.equal(result.clubId,73);assert.ok(fs.readFileSync(result.backup).equals(Buffer.alloc(99)));
  const config=JSON.parse(fs.readFileSync(path.join(dir,'config.json')));
  assert.equal(config.clubId,73);assert.equal(config.cloudUrl,(process.env.SOFTECH_CLOUD_URL||'https://softech-game-club.vercel.app').replace(/\/+$/,''));
  assert.ok(fs.readFileSync(path.join(dir,'data/softech_license.sig')).equals(before));
  assert.equal(fs.readFileSync(path.join(dir,'data/license_lock.json'),'utf8'),'preserved-ban');
  assert.equal(fs.readFileSync(path.join(dir,'netcafe.db'),'utf8'),'preserved-balance');
  assert.throws(()=>restoreEmptyConfig(dir),/faqat/,'Valid settings must not be reset by a second click');
});

test('recovery preserves matching saved settings and refuses untrusted identity or unrelated backup',()=>{
  const dir=fixture();
  const config={clubId:73,cloudUrl:'https://private.example',updateIdleSeconds:90,custom:'keep'};
  fs.writeFileSync(path.join(dir,'config.json.last-good'),JSON.stringify(config));
  assert.equal(restoreEmptyConfig(dir).source,'saved-settings');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'config.json'))),config);
  const wrong=fixture();fs.writeFileSync(path.join(wrong,'config.json.last-good'),JSON.stringify({...config,clubId:74}));
  assert.throws(()=>restoreEmptyConfig(wrong),/mos emas/);
  assert.ok(fs.readFileSync(path.join(wrong,'config.json')).equals(Buffer.alloc(99)));
  const bad=fixture();fs.writeFileSync(path.join(bad,'data/softech_license.sig'),'{"payload":{"clubId":999},"signature":"bad"}');
  assert.throws(()=>restoreEmptyConfig(bad),/ishonchli/);
  assert.ok(fs.readFileSync(path.join(bad,'config.json')).equals(Buffer.alloc(99)));
});

test('durable replacement flushes before rename and leaves original intact when rename fails',()=>{
  const dir=fixture(),file=path.join(dir,'settings.json');
  fs.writeFileSync(file,'{"clubId":73}');
  const originalRename=fs.renameSync,originalSync=fs.fsyncSync;
  let flushed=false;
  try {
    fs.fsyncSync=fd=>{originalSync(fd);flushed=true;};
    fs.renameSync=()=>{assert.equal(flushed,true);throw Error('fixture rename denied');};
    assert.throws(()=>writeDurableJson(file,{clubId:74}),/denied/);
    assert.equal(fs.readFileSync(file,'utf8'),'{"clubId":73}');
    assert.equal(fs.readdirSync(dir).filter(n=>n.endsWith('.tmp')).length,0);
  }finally{fs.renameSync=originalRename;fs.fsyncSync=originalSync;}
  writeDurableJson(file,{clubId:73,custom:'preserved'});
  assert.deepEqual(JSON.parse(fs.readFileSync(file)),{clubId:73,custom:'preserved'});
});

test('recovered all-NUL config starts a real licensed server and retains database records', {timeout:30000},async()=>{
  const dir=fixture();
  for(const name of ['src','public','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(dir,name),{recursive:true});
  const dbfile=path.join(dir,'netcafe.db'),db=new DatabaseSync(dbfile);
  db.exec('CREATE TABLE preserved_money(amount INTEGER);INSERT INTO preserved_money VALUES(5320)');db.close();
  restoreEmptyConfig(dir);
  const preload=path.join(dir,'fixture-hwid.mjs');
  fs.writeFileSync(preload,"import {HwidService} from './src/services/hwidService.js';HwidService.getHardwareFingerprint=()=> 'RECOVERY-FIXTURE-HWID';");
  const cloud=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"status":"PENDING"}');});
  cloud.listen(0,'127.0.0.1');await once(cloud,'listening');
  const reserve=http.createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
  const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'src/server.js'],{cwd:dir,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,NODE_ENV:'test',PORT:String(port),SOFTECH_CLOUD_URL:'http://127.0.0.1:'+cloud.address().port,
      UPDATE_MANIFEST_URL:'http://127.0.0.1:'+cloud.address().port,SUPABASE_URL:'',SUPABASE_ANON_KEY:'',CLUB_ID:''}});
  let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);const exit=once(child,'exit');
  try {
    let status;
    for(let i=0;i<150;i++) {
      assert.equal(child.exitCode,null,logs);
      try{status=await(await fetch('http://127.0.0.1:'+port+'/api/license/status',{signal:AbortSignal.timeout(500)})).json();break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(status?.state,'ACTIVE',JSON.stringify(status)+logs);assert.equal(status.clubId,73);
    assert.equal(status.isOperational,true);
  }finally{if(child.exitCode===null)child.kill();await exit;cloud.closeAllConnections();await new Promise(resolve=>cloud.close(resolve));}
  const check=new DatabaseSync(dbfile,{readOnly:true});
  try{assert.equal(check.prepare('SELECT amount FROM preserved_money').get().amount,5320);}finally{check.close();}
});
