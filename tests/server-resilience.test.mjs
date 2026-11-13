import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';

for (const encoding of ['utf8','utf16le','damaged','bad-url']) {
test(`local server starts with ${encoding} BOM config, unavailable update storage and damaged mobile identity, preserving existing data`, {timeout:30000}, async()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const fixture=fs.mkdtempSync(path.resolve('.test-output/server-resilience-'));
  for(const name of ['src','public','schema.sql','package.json'])
    fs.cpSync(path.join('NetCafeServer',name),path.join(fixture,name),{recursive:true});
  fs.writeFileSync(path.join(fixture,'updates'),'unavailable staging directory');
  const file=path.join(fixture,'netcafe.db');
  const seed=new DatabaseSync(file);
  seed.exec(`CREATE TABLE mobile_agent_identity(id INTEGER PRIMARY KEY,private_key TEXT NOT NULL);
    INSERT INTO mobile_agent_identity VALUES(1,'damaged-json');
    CREATE TABLE preserved_receipt(amount INTEGER);INSERT INTO preserved_receipt VALUES(5320);`);
  seed.close();
  const probe=net.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const goodConfig=Buffer.from('\ufeff'+JSON.stringify({cloudUrl:`http://127.0.0.1:${port}`,updateIdleSeconds:3600,clubId:73}),encoding==='utf16le'?'utf16le':'utf8');
  let savedConfig=encoding==='damaged'?Buffer.from('{"secret":"do-not-show",'):encoding==='bad-url'?Buffer.from('{"cloudUrl":"not a url"}'):goodConfig;
  fs.writeFileSync(path.join(fixture,'config.json'),savedConfig);
  const child=spawn(process.execPath,['src/server.js'],{cwd:fixture,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,NODE_ENV:'test',PORT:String(port),SOFTECH_CLOUD_URL:'',
      UPDATE_MANIFEST_URL:`http://127.0.0.1:${port}/test-no-update`}});
  let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
  const exited=once(child,'exit');
  try {
    let health;
    for(let i=0;i<150;i++) {
      assert.equal(child.exitCode,null,logs);
      try {health=await (await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(500)})).json();break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(health?.app,'NetCafeServer',logs);assert.equal(health.status,'ok');
    assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status,200);
    assert.match(logs,/Mobile relay.*Initialization failed/);
    // Optional mobile failure must neither bypass licensing nor pretend a write synced.
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/computers`)).status,403);
    if (['damaged','bad-url'].includes(encoding)) {
      const base=`http://127.0.0.1:${port}`;
      const status=await (await fetch(base+'/api/license/status?refresh=1')).json();
      assert.equal(status.state,'CONFIG_ERROR');assert.equal(status.isOperational,false);
      assert.ok(!JSON.stringify(status).includes('do-not-show'));
      const activation=await fetch(base+'/api/license/request-activation',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(activation.status,503);
      assert.deepEqual(fs.readFileSync(path.join(fixture,'config.json')),savedConfig);
      assert.equal(fs.existsSync(path.join(fixture,'data/license_lock.json')),false,'Configuration fault must not permanently ban the club');
      fs.writeFileSync(path.join(fixture,'config.json'),goodConfig);savedConfig=goodConfig;
      const restored=await (await fetch(base+'/api/license/status')).json();
      assert.equal(restored.state,'PENDING_ACTIVATION','Settings should recover without a process restart');
      assert.notEqual(restored.lockReason,'CONFIG_ERROR');
      assert.equal(child.exitCode,null);
    }
  } finally { if(child.exitCode===null)child.kill();await exited; }
  const check=new DatabaseSync(file,{readOnly:true});
  try {
    assert.deepEqual(fs.readFileSync(path.join(fixture,'config.json')),savedConfig);
    assert.equal(check.prepare('SELECT amount FROM preserved_receipt').get().amount,5320);
    assert.equal(check.prepare('SELECT private_key FROM mobile_agent_identity').get().private_key,'damaged-json');
  } finally {check.close();}
});
}
