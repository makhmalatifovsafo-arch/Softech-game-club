import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {setTimeout as delay} from 'node:timers/promises';
import {AnalyticsCache} from '../NetCafeServer/src/services/analyticsCache.js';
import {buildServerAnalytics} from '../NetCafeServer/src/services/analyticsService.js';

function fixture(t){
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/analytics-worker-')),databasePath=path.join(root,'test.db');
  const db=new DatabaseSync(databasePath);db.exec('PRAGMA journal_mode=WAL;');
  db.exec(fs.readFileSync('NetCafeServer/schema.sql','utf8'));
  db.exec("INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Fixture','Owner','0','2099-01-01')");
  db.exec("ALTER TABLE client_transactions ADD COLUMN category TEXT; ALTER TABLE client_transactions ADD COLUMN session_id TEXT; ALTER TABLE bar_orders ADD COLUMN approval_status TEXT; ALTER TABLE bar_orders ADD COLUMN paid_at TEXT;");
  t.after(()=>db.close());return {root,databasePath,db};
}
test('real read-only worker returns exact ledger totals, deduplicates requests, separates tenants and refreshes after writes',async t=>{
  const {db,databasePath}=fixture(t);
  db.exec("BEGIN; WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10000) INSERT INTO transactions(id,club_id,amount,payment_type) SELECT 't'||x,1,100,'CASH' FROM n; COMMIT;");
  const cache=new AnalyticsCache(databasePath,{ttlMs:60000});t.after(()=>cache.close());
  let ticks=0;const timer=setInterval(()=>ticks++,5);
  const results=await Promise.all(Array.from({length:10},()=>cache.get({clubId:1,days:1})));
  clearInterval(timer);assert.ok(ticks>0,'The main event loop must run during calculation');
  assert.ok(results.every(r=>r.analytics.generatedAt===results[0].analytics.generatedAt));
  const expected=buildServerAnalytics(db,{clubId:1,days:1,now:new Date(results[0].analytics.generatedAt)});
  const {analytics,...actual}=results[0];assert.deepEqual(actual,expected);
  assert.equal(actual.revenueSources.games,1000000);
  assert.equal((await cache.get({clubId:2,days:1})).revenueSources.games,0);
  db.exec("INSERT INTO transactions(id,club_id,amount,payment_type) VALUES('next',1,7000,'CASH')");cache.invalidate();
  const stale=await cache.get({clubId:1,days:1});assert.equal(stale.revenueSources.games,1000000);assert.equal(stale.analytics.refreshing,true);
  const fresh=await cache.get({clubId:1,days:1,fresh:true});assert.equal(fresh.revenueSources.games,1007000);assert.equal(fresh.analytics.stale,false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM transactions').get().n,10001);
});

test('a stalled report cannot block SQLite business writes; invalidation during computation stays stale',async t=>{
  const {db,root,databasePath}=fixture(t),workerPath=path.join(root,'slow.mjs'),marker=path.join(root,'reading');
  fs.writeFileSync(workerPath,`import {parentPort,workerData} from 'node:worker_threads';import {DatabaseSync} from 'node:sqlite';import fs from 'node:fs';
    const db=new DatabaseSync(workerData.databasePath,{readOnly:true});db.exec('BEGIN');db.prepare('SELECT count(*) FROM transactions').get();
    fs.writeFileSync(${JSON.stringify(marker)},'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,700);
    db.close();parentPort.postMessage({report:{success:true},generatedAt:new Date().toISOString()});`);
  const cache=new AnalyticsCache(databasePath,{workerUrl:pathToFileURL(workerPath)});t.after(()=>cache.close());
  let done=false;const pending=cache.get().then(r=>{done=true;return r;});
  for(let n=0;n<200&&!fs.existsSync(marker);n++)await delay(10);
  assert.ok(fs.existsSync(marker));
  db.exec("INSERT INTO transactions(id,amount,payment_type) VALUES('sale',5000,'CASH')");cache.invalidate();
  assert.equal(done,false,'A sale commits while the reporting connection is busy');
  assert.equal((await pending).analytics.stale,true,'A snapshot started before the sale cannot be labelled current');
});

test('worker failures retain last good data; deadlines and bounded queue release pending requests',async t=>{
  const {root,databasePath}=fixture(t),workerPath=path.join(root,'fault.mjs');
  fs.writeFileSync(workerPath,"import {parentPort} from 'node:worker_threads';parentPort.postMessage({report:{success:true,value:42},generatedAt:new Date().toISOString()});");
  const cache=new AnalyticsCache(databasePath,{workerUrl:pathToFileURL(workerPath),timeoutMs:500,maxEntries:2});t.after(()=>cache.close());
  assert.equal((await cache.get()).value,42);
  fs.writeFileSync(workerPath,"throw Error('fixture failure');");cache.invalidate();
  const stale=await cache.get();assert.equal(stale.value,42);
  await assert.rejects(cache.get({fresh:true}),/fixture failure/);
  const failed=await cache.get();assert.equal(failed.value,42);assert.ok(failed.analytics.error);assert.equal(failed.analytics.stale,true);
  fs.writeFileSync(workerPath,"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000);");
  const a=cache.get({clubId:10}),b=cache.get({clubId:11});
  const checks=Promise.all([assert.rejects(a,/vaqti tugadi/),assert.rejects(b,/vaqti tugadi/)]);
  await assert.rejects(cache.get({clubId:12}),/navbati band/);await checks;
  assert.equal(cache.active,null);assert.equal(cache.queue.length,0);
});
