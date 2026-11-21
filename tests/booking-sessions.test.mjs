import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('free booking uses shared session pricing, atomic receipts, collision guards and completion history',async()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/booking-sessions-'));
  for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
  process.env.NODE_ENV='test';
  const load=file=>import(pathToFileURL(path.join(dir,'src',file)).href);
  const {db,initDatabase}=await load('db.js'); initDatabase();
  try {
    const {prepareCashierSession,startCashierSession}=await load('services/cashierSessionStart.js');
    const {createFreeReservation,expireFreeReservations}=await load('services/bookingFoundation.js');
    const {startMemberSession,extendPrepaidMember}=await load('services/memberBilling.js');
    const {previewSessionTransfer,transferSession}=await load('services/sessionTransfer.js');
    const actor={...db.prepare("SELECT * FROM users WHERE role='administrator'").get(),clubId:1,permissions:['session:manage']};
    const user=db.prepare("SELECT * FROM users WHERE username='gamer1'").get();
    db.exec('UPDATE tariff_schedules SET price_per_hour=12000; UPDATE tariffs SET price_per_hour=12000; UPDATE users SET balance=1000000');
    const now=Math.floor(Date.now()/60000)*60000,iso=n=>new Date(n).toISOString();
    let seq=100;
    function pc(){const n=++seq,id='booking-pc-'+n;db.prepare("INSERT INTO computers(id,club_id,pc_number,name) VALUES(?,1,?,?)").run(id,n,id);return id;}
    function reserve(id,start=now-60000,end=now+30*60000){return createFreeReservation(db,actor,{
      requestId:'reserve-'+(++seq),computerId:id,customerName:'Booking test',startTime:iso(start),endTime:iso(end)
    },start-1000).body.booking;}
    function checkin(b,body,clock=now){
      const input={...body,expectedRevision:b.revision,requestId:'checkin-'+(++seq)};
      const plan=prepareCashierSession(db,actor,input,{bookingId:b.id,now:clock});
      input.quoteRevision=plan.quoteRevision;
      return {input,result:startCashierSession(db,actor,input,{bookingId:b.id,now:clock}),plan};
    }
    for(const body of [{mode:'hours',durationMinutes:60},{mode:'price',amount:18000},{},
      {mode:'postpaid'},{mode:'client',durationMinutes:30,customerId:user.id}]){
      const id=pc(),b=reserve(id),ordinaryId=pc();
      const normal=prepareCashierSession(db,actor,{...body,computerId:ordinaryId,...(!body.mode?{mode:'endtime',targetEndTime:b.end_time}:{})},{now});
      const before=db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance;
      const {input,result,plan}=checkin(b,body);
      assert.equal(plan.amount,normal.amount);assert.equal(plan.durationMinutes,normal.durationMinutes);
      if(!body.mode)assert.equal(plan.endsAt.toISOString(),b.end_time,'default uses booked end, not a new full booking duration');
      if(body.mode==='hours')assert.ok(plan.endsAt.getTime()>Date.parse(b.end_time),'explicit longer duration permitted');
      const repeated=startCashierSession(db,actor,input,{bookingId:b.id,now:now+1000});
      assert.equal(repeated.replayed,true);assert.equal(repeated.body.sessionId,result.body.sessionId);
      assert.throws(()=>startCashierSession(db,actor,{...input,requestId:'another-'+seq},{bookingId:b.id,now}),{statusCode:409});
      const saved=db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
      assert.equal(saved.status,'ACTIVE');assert.equal(saved.session_id,result.body.sessionId);
      const tx=db.prepare('SELECT sum(amount) amount,count(*) n FROM transactions WHERE session_id=?').get(saved.session_id);
      if(body.mode==='client'){
        assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance,before-plan.amount);
        assert.equal(tx.n,0);
        assert.equal(db.prepare("SELECT count(*) n FROM client_transactions WHERE session_id=? AND type='SESSION_DEDUCT'").get(saved.session_id).n,1);
      }else{assert.equal(tx.n,plan.isPostpaid?0:1);if(!plan.isPostpaid)assert.equal(tx.amount,plan.amount);}
      db.prepare("UPDATE sessions SET status='COMPLETED' WHERE id=?").run(saved.session_id);
      db.prepare("UPDATE sessions SET status='COMPLETED' WHERE id=?").run(saved.session_id);
      assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id).status,'COMPLETED');
      assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action_type='BOOKING_COMPLETED' AND json_extract(details,'$.bookingId')=?").get(b.id).n,1);
      assert.throws(()=>db.prepare('DELETE FROM bookings WHERE id=?').run(b.id));
    }
    const id=pc(),b=reserve(id),next=reserve(id,now+30*60000,now+120*60000);
    for(const body of [{mode:'hours',durationMinutes:60},{mode:'price',amount:18000},{mode:'postpaid'}])
      assert.throws(()=>prepareCashierSession(db,actor,{...body,expectedRevision:b.revision},{bookingId:b.id,now}),{code:'BOOKING_CONFLICT'});
    assert.throws(()=>startCashierSession(db,actor,{computerId:id,mode:'hours',durationMinutes:5},{now}),{code:'BOOKING_CONFLICT'});
    assert.throws(()=>startMemberSession(id,'gamer1','gamer123',5),{code:'BOOKING_CONFLICT'});
    assert.throws(()=>db.prepare('DELETE FROM computers WHERE id=?').run(id),/bron/);
    assert.throws(()=>prepareCashierSession(db,{...actor,clubId:999},{expectedRevision:b.revision},{bookingId:b.id,now}),{statusCode:404});
    assert.throws(()=>prepareCashierSession(db,{...actor,role:'client'},{expectedRevision:b.revision},{bookingId:b.id,now}),{statusCode:403});
    assert.throws(()=>prepareCashierSession(db,actor,{expectedRevision:b.revision,customerId:999999},{bookingId:b.id,now}),{statusCode:400});
    assert.equal(prepareCashierSession(db,actor,{expectedRevision:b.revision,mode:'ENDTIME'},{bookingId:b.id,now}).endsAt.toISOString(),b.end_time);
    const preview=prepareCashierSession(db,actor,{expectedRevision:b.revision},{bookingId:b.id,now});
    const stale={expectedRevision:b.revision,quoteRevision:preview.quoteRevision,requestId:'stale-checkin'};
    db.exec('UPDATE tariff_schedules SET price_per_hour=14000');
    assert.throws(()=>startCashierSession(db,actor,stale,{bookingId:b.id,now}),{code:'QUOTE_CHANGED'});
    assert.equal(db.prepare('SELECT session_id FROM bookings WHERE id=?').get(b.id).session_id,null);
    db.exec('UPDATE tariff_schedules SET price_per_hour=12000');
    db.exec("CREATE TRIGGER fail_checkin BEFORE INSERT ON audit_logs WHEN NEW.action_type='BOOKING_CHECKED_IN' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
    const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance;
    assert.throws(()=>checkin(b,{mode:'client',customerId:user.id,durationMinutes:10}),/audit unavailable/);
    assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance,balance);
    assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE computer_id=?').get(id).n,0);
    db.exec('DROP TRIGGER fail_checkin');
    // A linked booking follows the session lifetime, not the original PC's reservation.
    const {result}=checkin(b,{mode:'hours',durationMinutes:20});
    const target=pc(),options={fromComputerId:id,toComputerId:target,clubId:1,now:now+60000};
    const move=previewSessionTransfer(options);transferSession({...options,quoteRevision:move.quoteRevision});
    assert.equal(db.prepare('SELECT session_id FROM bookings WHERE id=?').get(b.id).session_id,result.body.sessionId);
    assert.doesNotThrow(()=>prepareCashierSession(db,actor,{computerId:id,durationMinutes:5},{now:now+60000}));
    const blockedTarget=pc();reserve(blockedTarget,now,now+60*60000);
    assert.throws(()=>previewSessionTransfer({fromComputerId:target,toComputerId:blockedTarget,clubId:1,now:now+60000}),{code:'BOOKING_CONFLICT'});
    const memberPc=pc(),member=startMemberSession(memberPc,'gamer1','gamer123',10);
    reserve(memberPc,Date.parse(member.endsAt)+60000,Date.parse(member.endsAt)+3600000);
    const beforeExtend=db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance;
    assert.throws(()=>extendPrepaidMember(member.sessionId,20),{code:'BOOKING_CONFLICT'});
    assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance,beforeExtend);
    assert.equal(db.prepare('SELECT ends_at FROM sessions WHERE id=?').get(member.sessionId).ends_at,member.endsAt);
    const late=reserve(pc(),now-20*60000,now+60*60000);
    assert.throws(()=>prepareCashierSession(db,actor,{expectedRevision:late.revision},{bookingId:late.id,now}),{code:'BOOKING_EXPIRED'});
    assert.equal(expireFreeReservations(db,1,now),1);
    assert.equal(expireFreeReservations(db,1,now),0);
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(late.id).status,'NO_SHOW');
  } finally {db.close();}
});
