import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MobileAgent} from '../NetCafeServer/src/services/mobileAgent.js';
import {makeRequest,open} from '../public/mobile/crypto.js';

test('mobile receipt survives database reopen: lost response and unfinished request never replay money',async()=>{
 fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/mobile-receipt-restart-'));
 const file=path.join(dir,'local.db');let db=new DatabaseSync(file),calls=0;
 db.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;CREATE TABLE sales(amount);');
 const agent=()=>new MobileAgent({db,getLicense:()=>null,getCloudUrl:()=>'',isOperational:()=>true,localPort:5000,
  staffSession:()=>({role:'administrator',clubId:1}),logout(){},fetcher:async()=>{
   calls++;db.exec('BEGIN IMMEDIATE;INSERT INTO sales VALUES(2000);COMMIT;');
   throw Error('Response lost after commit');
  }});
 try{
  let a=agent();const p=await makeRequest(a.publicKey,1,{path:'/api/bar/orders',method:'POST',token:'fixture',body:{}});
  const job={...p.job,expires_at:new Date(Date.now()+60000).toISOString()};
  await a.execute(job,1);assert.equal(calls,1);
  const pending=await makeRequest(a.publicKey,1,{path:'/api/bar/orders',method:'POST',token:'fixture',body:{}});
  db.prepare('INSERT INTO mobile_local_receipts(id,club_id,created_at) VALUES(?,?,?)').run(pending.job.id,1,Date.now());
  db.close();db=new DatabaseSync(file);a=agent();
  for(let i=0;i<100;i++)await a.execute(job,1);
  const saved=JSON.parse(db.prepare('SELECT result FROM mobile_local_receipts WHERE id=?').get(job.id).result);
  assert.equal((await open(p.key,saved,p.aad+':reply')).status,502);
  await a.execute({...pending.job,expires_at:job.expires_at},1);
  const uncertain=JSON.parse(db.prepare('SELECT result FROM mobile_local_receipts WHERE id=?').get(pending.job.id).result);
  assert.equal((await open(pending.key,uncertain,pending.aad+':reply')).status,409);
  assert.equal(calls,1);assert.equal(db.prepare('SELECT sum(amount) total FROM sales').get().total,2000);
 }finally{db.close();}
});
