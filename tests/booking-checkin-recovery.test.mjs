import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

for(const channel of ['CASH','BALANCE'])for(const phase of ['before','after'])
test(`booking check-in ${channel}: crash ${phase} COMMIT then retry keeps one session and one payment`,async()=>{
  fs.mkdirSync('.test-output',{recursive:true});const root=fs.mkdtempSync(path.resolve('.test-output/booking-checkin-crash-'));
  for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(root,file),{recursive:true});
  const runner=path.join(root,'fixture.mjs'),marker=path.join(root,'checkpoint');
  fs.writeFileSync(runner,`
    import fs from 'node:fs';
    import {db,initDatabase} from './src/db.js';
    import {createFreeReservation} from './src/services/bookingFoundation.js';
    import {prepareCashierSession,startCashierSession} from './src/services/cashierSessionStart.js';
    initDatabase();db.exec('PRAGMA synchronous=FULL');
    let saved;
    if(!fs.existsSync('input.json')){
      const actor={...db.prepare("SELECT * FROM users WHERE role='administrator'").get(),clubId:1,permissions:['session:manage']};
      const member=db.prepare("SELECT id FROM users WHERE role='client'").get();
      db.exec("UPDATE tariffs SET price_per_hour=10000; UPDATE tariff_schedules SET price_per_hour=10000; UPDATE users SET balance=100000; INSERT INTO computers(id,club_id,pc_number,name) VALUES('crash-pc',1,90,'Crash PC')");
      const now=Math.floor(Date.now()/60000)*60000,channel=process.argv[2];
      const b=createFreeReservation(db,actor,{requestId:'checkin-fixture-create',computerId:'crash-pc',customerName:'Fixture',
        startTime:new Date(now-60000).toISOString(),endTime:new Date(now+7200000).toISOString(),
        payment:{kind:channel,amount:3000,...(channel==='BALANCE'?{userId:member.id}:{})}},now-120000).body.booking;
      const input={requestId:'checkin-fixture-start',expectedRevision:b.revision,mode:'hours',durationMinutes:60,paymentType:channel};
      input.quoteRevision=prepareCashierSession(db,actor,input,{bookingId:b.id,now}).quoteRevision;
      saved={actor,input,now,bookingId:b.id,memberId:member.id};fs.writeFileSync('input.json',JSON.stringify(saved));
    }else saved=JSON.parse(fs.readFileSync('input.json','utf8'));
    const phase=process.argv[3],stop=()=>{fs.writeFileSync('checkpoint','ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
    const wrapped={prepare:sql=>db.prepare(sql),exec(sql){if(sql==='COMMIT'&&phase==='before')stop();db.exec(sql);if(sql==='COMMIT'&&phase==='after')stop();}};
    const result=startCashierSession(wrapped,saved.actor,saved.input,{bookingId:saved.bookingId,now:saved.now});
    const replay=startCashierSession(db,saved.actor,saved.input,{bookingId:saved.bookingId,now:saved.now});
    fs.writeFileSync('result.json',JSON.stringify({result,replay}));db.close();
  `);
  const launch=mode=>spawn(process.execPath,[runner,channel,mode],{cwd:root,env:{...process.env,NODE_ENV:'test'},windowsHide:true,stdio:['ignore','ignore','pipe']});
  const child=launch(phase),exited=once(child,'exit');let errors='';child.stderr.on('data',d=>errors+=d);
  try{
    const deadline=Date.now()+20000;
    while(!fs.existsSync(marker)&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
    assert.ok(fs.existsSync(marker),errors||'Commit checkpoint was not reached');
  }finally{if(child.exitCode===null)child.kill();await exited;}
  const saved=JSON.parse(fs.readFileSync(path.join(root,'input.json'),'utf8'));
  if(phase==='before'){
    const check=new DatabaseSync(path.join(root,'netcafe.db'));try{
      assert.equal(check.prepare('SELECT count(*) n FROM sessions').get().n,0);
      assert.equal(check.prepare("SELECT count(*) n FROM booking_funds WHERE kind='APPLY'").get().n,0);
      assert.equal(check.prepare('SELECT balance FROM users WHERE id=?').get(saved.memberId).balance,channel==='BALANCE'?97000:100000);
    }finally{check.close();}
  }
  const retry=launch('retry'),retryExit=once(retry,'exit');errors='';retry.stderr.on('data',d=>errors+=d);
  const timeout=setTimeout(()=>retry.kill(),20000);
  try{assert.equal((await retryExit)[0],0,errors);}finally{clearTimeout(timeout);}
  const {result,replay}=JSON.parse(fs.readFileSync(path.join(root,'result.json'),'utf8'));
  assert.equal(result.replayed,phase==='after');assert.equal(replay.replayed,true);
  assert.equal(result.body.sessionId,replay.body.sessionId);
  const check=new DatabaseSync(path.join(root,'netcafe.db'));try{
    assert.equal(check.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    assert.equal(check.prepare('SELECT count(*) n FROM sessions').get().n,1);
    assert.equal(check.prepare('SELECT count(*) n FROM session_funding_allocations').get().n,1);
    assert.equal(check.prepare("SELECT amount FROM booking_funds WHERE kind='APPLY'").get().amount,3000);
    assert.equal(check.prepare('SELECT balance FROM users WHERE id=?').get(saved.memberId).balance,channel==='BALANCE'?90000:100000);
    const table=channel==='CASH'?'transactions':'client_transactions';
    assert.equal(check.prepare('SELECT sum(abs(amount)) n FROM '+table).get().n,10000);
  }finally{check.close();}
});
