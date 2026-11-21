import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {initializeBookings} from '../NetCafeServer/src/services/bookingSchema.js';
import {initializeMoneyOperations} from '../NetCafeServer/src/services/moneyOperations.js';
import {createFreeReservation, cancelFreeReservation, confirmBookingCashRefund} from '../NetCafeServer/src/services/bookingFoundation.js';

const now=Date.parse('2030-01-01T10:00:00Z');
const actor={id:7,clubId:1,username:'Fixture',role:'administrator',permissions:['session:manage']};
const api={create:createFreeReservation,cancel:cancelFreeReservation,refund:confirmBookingCashRefund};
const moduleUrl=pathToFileURL(path.resolve('NetCafeServer/src/services/bookingFoundation.js')).href;
const pause=ms=>new Promise(r=>setTimeout(r,ms));

// Kill a separate process with its SQLite transaction still open, or immediately
// after COMMIT and before the caller can receive a response. No production DB.
for(const channel of ['BALANCE','CASH'])for(const operation of ['create','cancel','refund']){
  if(operation==='refund'&&channel==='BALANCE')continue;
  for(const phase of ['before','after'])test(`booking ${channel} ${operation}: process loss ${phase} commit preserves money and replay`,async()=>{
    fs.mkdirSync('.test-output',{recursive:true});
    const root=fs.mkdtempSync(path.resolve('.test-output/booking-recovery-'));
    const file=path.join(root,'fixture.db'),marker=path.join(root,'checkpoint');
    let db=new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
    db.exec(fs.readFileSync('NetCafeServer/schema.sql','utf8'));
    db.exec(`INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Fixture','Test','0','2099-01-01');
      INSERT INTO users(id,club_id,username,password_hash,role,permissions,balance) VALUES(1,1,'member','unused','client','[]',20000);
      INSERT INTO computers(id,club_id,pc_number,name) VALUES('test-pc',1,1,'PC-01');`);
    initializeMoneyOperations(db);initializeBookings(db);
    const createInput={requestId:'recovery-create-01',computerId:'test-pc',customerName:'Fixture',
      startTime:'2030-01-01T11:00:00Z',endTime:'2030-01-01T12:00:00Z',
      payment:{kind:channel,amount:3000,...(channel==='BALANCE'?{userId:1}:{})}};
    let input=createInput;
    if(operation!=='create'){
      const b=createFreeReservation(db,actor,createInput,now).body.booking;
      input={requestId:'recovery-cancel-01',bookingId:b.id,expectedRevision:b.revision,reason:'Fixture cancellation'};
      if(operation==='refund'){
        const cancelled=cancelFreeReservation(db,actor,input,now).body.booking;
        input={requestId:'recovery-refund-01',bookingId:b.id,expectedRevision:cancelled.revision,amount:3000,confirmed:true};
      }
    }
    const snapshot=()=>JSON.stringify(Object.fromEntries(['users','bookings','booking_funds','money_operation_receipts','audit_logs'].map(t=>[t,db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()])));
    const before=snapshot();db.close();
    const args={file,marker,phase,operation,input,actor,now};
    const script=`import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';
      import {createFreeReservation as create,cancelFreeReservation as cancel,confirmBookingCashRefund as refund} from ${JSON.stringify(moduleUrl)};
      const a=JSON.parse(process.argv[1]),db=new DatabaseSync(a.file);db.exec('PRAGMA synchronous=FULL');
      const stop=()=>{fs.writeFileSync(a.marker,'ready');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);};
      const wrapped={prepare:sql=>db.prepare(sql),exec(sql){if(sql==='COMMIT'&&a.phase==='before')stop();db.exec(sql);if(sql==='COMMIT'&&a.phase==='after')stop();}};
      ({create,cancel,refund})[a.operation](wrapped,a.actor,a.input,a.now);`;
    const child=spawn(process.execPath,['--input-type=module','-e',script,JSON.stringify(args)],{windowsHide:true,stdio:['ignore','ignore','pipe']});
    let errors='';child.stderr.on('data',d=>errors+=d);const exited=once(child,'exit');
    try{
      const deadline=Date.now()+15000;
      while(!fs.existsSync(marker)&&child.exitCode===null&&Date.now()<deadline)await pause(20);
      assert.ok(fs.existsSync(marker),'Child did not reach commit checkpoint: '+errors);
    }finally{if(child.exitCode===null)child.kill();await exited;}
    db=new DatabaseSync(file);
    try{
      assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
      if(phase==='before')assert.equal(snapshot(),before,'Uncommitted money/history survived a crash');
      const first=api[operation](db,actor,input,now);
      assert.equal(first.replayed,phase==='after');
      const saved=snapshot();assert.equal(api[operation](db,actor,input,now).replayed,true);assert.equal(snapshot(),saved);
      const balance=db.prepare('SELECT balance FROM users WHERE id=1').get().balance;
      assert.equal(balance,channel==='BALANCE'&&operation==='create'?17000:20000);
      assert.equal(db.prepare("SELECT count(*) n FROM booking_funds WHERE kind='CAPTURE'").get().n,1);
      const returned=operation==='refund'||(operation==='cancel'&&channel==='BALANCE');
      assert.equal(db.prepare("SELECT count(*) n FROM booking_funds WHERE kind='REFUND'").get().n,returned?1:0);
    }finally{db.close();}
  });
}
