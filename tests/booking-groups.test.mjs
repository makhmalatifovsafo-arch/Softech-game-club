import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('group booking allocation, atomic shared check-in/checkout, VIP deposits and retry receipts',async()=>{
 fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/booking-groups-'));
 for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
 process.env.NODE_ENV='test';const load=f=>import(pathToFileURL(path.join(dir,'src',f)).href);
 const {db,initDatabase}=await load('db.js');initDatabase();const realNow=Date.now;let now=Math.floor(realNow()/60000)*60000;Date.now=()=>now;
 try{
  const {reservationAllocation:allocate,createFreeReservation:create}=await load('services/bookingFoundation.js');
  const {previewGroupStart:quote,startBookingGroup:start,previewGroupCheckout:bill,checkoutBookingGroup:close}=await load('services/bookingGroups.js');
  const {BarLedgerService:ledger}=await load('services/barLedgerService.js');
  const actor={...db.prepare("SELECT * FROM users WHERE role='administrator'").get(),clubId:1,permissions:['session:manage']};
  const member=db.prepare("SELECT * FROM users WHERE username='gamer1'").get();
  db.exec('UPDATE tariff_schedules SET price_per_hour=10000; UPDATE tariffs SET price_per_hour=10000; UPDATE users SET balance=1000000');
  let seq=1000;const key=()=>`group-operation-${++seq}`,iso=n=>new Date(n).toISOString();
  const pc=()=>{const id='group-pc-'+(++seq);db.prepare('INSERT INTO computers(id,club_id,pc_number,name) VALUES(?,1,?,?)').run(id,seq,id);return id;};
  const pcs=Array.from({length:5},pc);
  const allocation=(ids,amount,kind='CASH')=>allocate(db,actor,{computerIds:ids,payment:{kind,amount,userId:member.id}});
  assert.deepEqual(allocation(pcs,20000).allocations.map(p=>p.deposit),[4000,4000,4000,4000,4000]);
  assert.deepEqual(allocation(pcs.slice(0,3).reverse(),20000).allocations.map(p=>p.deposit),[6667,6667,6666]);
  assert.deepEqual(allocation(pcs,2).allocations.map(p=>p.deposit),[1,1,0,0,0]);
  assert.throws(()=>allocation([pcs[0],pcs[0]],100));assert.throws(()=>allocation(['unknown'],100));
  assert.throws(()=>allocate(db,{...actor,permissions:[]},{computerIds:pcs}),{statusCode:403});
  const input=(ids,amount,kind='CASH')=>({requestId:key(),computerIds:ids,customerName:'Group guest',startTime:iso(now-60000),endTime:iso(now+7200000),payment:{kind,amount,userId:member.id}});
  const reserve=(ids,amount,kind)=>{const data=input(ids,amount,kind),r=create(db,actor,data,now-120000);assert.equal(create(db,actor,data,now-120000).replayed,true);return r.body;};
  const group=reserve(pcs,20000);assert.equal(group.bookings.length,5);
  const startInput={requestId:key(),mode:'postpaid',paymentType:'POSTPAID',expectedRevisions:Object.fromEntries(group.bookings.map(b=>[b.id,b.revision]))};
  const preview=quote(db,actor,group.groupId,startInput).body;assert.equal(preview.depositApplied,20000);assert.equal(preview.additionalPayment,0);startInput.quoteRevision=preview.quoteRevision;
  const opened=start(db,actor,group.groupId,startInput);assert.equal(opened.body.items.length,5);assert.equal(start(db,actor,group.groupId,startInput).replayed,true);
  assert.throws(()=>bill(db,{...actor,clubId:2},group.groupId),{statusCode:404});
  now+=3600000;
  const checkout=bill(db,actor,group.groupId);assert.equal(checkout.gameBill,50000);assert.equal(checkout.depositApplied,20000);assert.equal(checkout.amountToCollect,30000);assert.equal(checkout.refundAmount,0);
  assert.deepEqual(checkout.items.map(p=>p.amountToCollect),[6000,6000,6000,6000,6000]);
  const endInput={requestId:key(),sessionIds:checkout.sessionIds,paymentMethod:'CASH'};
  const last=checkout.sessionIds.at(-1);db.exec(`CREATE TRIGGER fail_group_checkout BEFORE UPDATE ON sessions WHEN OLD.id='${last}' AND NEW.status='COMPLETED' BEGIN SELECT RAISE(ABORT,'group rollback test'); END;`);
  assert.throws(()=>close(db,actor,group.groupId,endInput),/group rollback test/);
  assert.equal(db.prepare("SELECT count(*) n FROM sessions WHERE status='ACTIVE'").get().n,5);
  assert.equal(db.prepare('SELECT count(*) n FROM session_funding_settlements').get().n,0);
  db.exec('DROP TRIGGER fail_group_checkout');
  const closed=close(db,actor,group.groupId,endInput);assert.equal(closed.body.amountToCollect,30000);assert.equal(closed.afterCommit.length,5);
  assert.equal(closed.body.paidBefore,20000);assert.equal(closed.body.depositApplied,20000);
  const sessionIds=checkout.sessionIds.map(()=>'?').join(',');
  assert.equal(db.prepare(`SELECT sum(amount) total FROM transactions WHERE session_id IN (${sessionIds})`).get(...checkout.sessionIds).total,50000,'reports retain 50000 once, not deposit plus 50000');
  assert.equal(close(db,actor,group.groupId,endInput).replayed,true);assert.equal(close(db,actor,group.groupId,endInput).afterCommit.length,0);
  assert.equal(db.prepare('SELECT count(*) n FROM session_funding_settlements').get().n,5);
  assert.throws(()=>bill(db,actor,group.groupId),{statusCode:409});
  // Prepaid collects only the remainder now, using each PC's ordinary quote.
  const pre=reserve(Array.from({length:5},pc),20000),body={requestId:key(),mode:'hours',durationMinutes:60,paymentType:'CASH',expectedRevisions:Object.fromEntries(pre.bookings.map(b=>[b.id,b.revision]))};
  const q=quote(db,actor,pre.groupId,body).body;assert.equal(q.price,50000);assert.equal(q.depositApplied,20000);assert.equal(q.additionalPayment,30000);
  body.quoteRevision=q.quoteRevision;const r=start(db,actor,pre.groupId,body);
  now+=1800000;const early=bill(db,actor,pre.groupId);assert.equal(early.gameBill,25000);assert.equal(early.refundAmount,25000);assert.equal(early.paidBefore,50000);
  // One already closed PC is never charged again at group checkout.
  ledger.executeSessionCheckout({target:r.body.items[0].sessionId,clubId:1,cashierUserId:actor.id});assert.equal(bill(db,actor,pre.groupId).count,4);
  // Last PC collision cannot leave earlier bookings/deposits behind.
  const fresh=pc(),before=db.prepare('SELECT count(*) n FROM bookings').get().n;
  assert.throws(()=>create(db,actor,input([fresh,pre.bookings.at(-1).computer_ref],10000),now-120000));
  assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,before);
  // Wallet surplus returns to the wallet, and is not used as a cash bar refund.
  db.prepare('UPDATE users SET balance=50000 WHERE id=?').run(member.id);
  const walletGroup=reserve(Array.from({length:3},pc),9000,'BALANCE'),walletStart={requestId:key(),mode:'postpaid',paymentType:'POSTPAID',expectedRevisions:Object.fromEntries(walletGroup.bookings.map(b=>[b.id,b.revision]))};
  walletStart.quoteRevision=quote(db,actor,walletGroup.groupId,walletStart).body.quoteRevision;
  const walletSessions=start(db,actor,walletGroup.groupId,walletStart);now+=12*60000;
  const first=walletSessions.body.items[0];db.prepare("INSERT INTO bar_orders(club_id,order_number,session_id,computer_id,total_amount,payment_status,approval_status) VALUES(1,?,?,?,5000,'PENDING_AT_CHECKOUT','CONFIRMED')").run(key(),first.sessionId,first.computerId);
  const wb=bill(db,actor,walletGroup.groupId);assert.equal(wb.gameBill,6000);assert.equal(wb.barBill,5000);assert.equal(wb.balanceRefund,3000);assert.equal(wb.amountToCollect,5000);assert.equal(wb.refundAmount,0);
  const wc=close(db,actor,walletGroup.groupId,{requestId:key(),sessionIds:wb.sessionIds,paymentMethod:'CASH'});assert.equal(wc.body.amountToCollect,5000);assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,44000);
  // Aggregate wallet sufficiency is atomic, even though every individual share fits.
  db.prepare('UPDATE users SET balance=7000 WHERE id=?').run(member.id);
  const walletIds=Array.from({length:3},pc);
  assert.throws(()=>create(db,actor,input(walletIds,15000,'BALANCE'),now-120000));
  assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,7000);
  assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,before+3);
  // Never net a cash refund against a card collection on another PC.
  const mixed=reserve(Array.from({length:2},pc),10000),mi={requestId:key(),mode:'postpaid',paymentType:'POSTPAID',expectedRevisions:Object.fromEntries(mixed.bookings.map(b=>[b.id,b.revision]))};
  mi.quoteRevision=quote(db,actor,mixed.groupId,mi).body.quoteRevision;const ms=start(db,actor,mixed.groupId,mi);
  for(const [i,minutes] of [42,18].entries())db.prepare('UPDATE sessions SET started_at=? WHERE id=?').run(iso(now-minutes*60000),ms.body.items[i].sessionId);
  const mb=bill(db,actor,mixed.groupId);assert.equal(mb.amountToCollect,0);assert.equal(mb.refundAmount,0);
  assert.deepEqual(mb.paymentOptions.CARD,{separatePayments:true,amountToCollect:2000,refundAmount:2000});
  const mc=close(db,actor,mixed.groupId,{requestId:key(),sessionIds:mb.sessionIds,paymentMethod:'CARD'});assert.equal(mc.body.separatePayments,true);assert.equal(mc.body.amountToCollect,2000);assert.equal(mc.body.refundAmount,2000);
  assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id IN (?,?) AND payment_type='CARD'").get(...mb.sessionIds).n,2000);
  assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id IN (?,?) AND payment_type='CASH'").get(...mb.sessionIds).n,8000);
 }finally{Date.now=realNow;db.close();}
});
