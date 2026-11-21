import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

test('booking deposits use ordinary pricing/checkout: holds, sources, refund confirmation, replay, VIP, bar and reports',async()=>{
  fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/booking-funds-'));
  for(const file of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',file),path.join(dir,file),{recursive:true});
  process.env.NODE_ENV='test';const load=file=>import(pathToFileURL(path.join(dir,'src',file)).href);
  const {db,initDatabase}=await load('db.js');initDatabase();
  const realNow=Date.now;let now=Math.floor(realNow()/60000)*60000;Date.now=()=>now;
  try{
    const {createFreeReservation:create,cancelFreeReservation:cancel,expireFreeReservations:expire,confirmBookingCashRefund:refund,saveBookingSettings}=await load('services/bookingFoundation.js');
    const {bookingFunds,bookingFundsReport,bookingFundingPreview}=await load('services/bookingFunds.js');
    const {prepareCashierSession:quote,startCashierSession:start}=await load('services/cashierSessionStart.js');
    const {BarLedgerService:ledger}=await load('services/barLedgerService.js');
    const {getFinancialBreakdown}=await load('services/financialBreakdown.js');
    const {previewSessionTransfer,transferSession}=await load('services/sessionTransfer.js');
    const actor={...db.prepare("SELECT * FROM users WHERE role='administrator'").get(),clubId:1,permissions:['session:manage']};
    const member=db.prepare("SELECT * FROM users WHERE username='gamer1'").get();
    db.exec('UPDATE tariff_schedules SET price_per_hour=10000; UPDATE tariffs SET price_per_hour=10000; UPDATE users SET balance=1000000');
    const wallet=()=>db.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance;
    const iso=n=>new Date(n).toISOString();let seq=500;
    function pc(){const id='fund-pc-'+(++seq);db.prepare("INSERT INTO computers(id,club_id,pc_number,name) VALUES(?,1,?,?)").run(id,seq,id);return id;}
    function reserve(kind,amount,extra={}){
      const input={requestId:'fund-create-'+(++seq),computerId:pc(),customerName:'Deposit guest',startTime:iso(now-60000),endTime:iso(now+7200000),
        payment:{kind,amount,...(kind==='BALANCE'?{userId:member.id}:{})},...extra};
      const response=create(db,actor,input,now-120000);assert.equal(create(db,actor,input,now-120000).replayed,true);
      return response.body.booking;
    }
    const row=b=>db.prepare('SELECT * FROM bookings WHERE id=?').get(b.id);
    function checkin(b,data={}){
      const body={expectedRevision:b.revision,requestId:'fund-start-'+(++seq),mode:'hours',durationMinutes:60,...data};
      const q=quote(db,actor,body,{bookingId:b.id,now});body.quoteRevision=q.quoteRevision;
      const result=start(db,actor,body,{bookingId:b.id,now});assert.equal(start(db,actor,body,{bookingId:b.id,now}).replayed,true);
      return {id:result.body.sessionId,q,result};
    }
    // Holds do not become GAME revenue or a second TOPUP.
    const before=wallet(),held=reserve('BALANCE',3000);
    assert.equal(wallet(),before-3000);
    assert.equal(db.prepare('SELECT count(*) n FROM client_transactions').get().n,0);
    const cancelInput={requestId:'fund-cancel-wallet',bookingId:held.id,expectedRevision:held.revision,reason:'Cannot attend'};
    cancel(db,actor,cancelInput,now);cancel(db,actor,cancelInput,now);assert.equal(wallet(),before);
    const cash=reserve('CASH',3000);
    const cancelled=cancel(db,actor,{...cancelInput,requestId:'fund-cancel-cash',bookingId:cash.id,expectedRevision:cash.revision},now);
    assert.equal(cancelled.body.funds.cashRefundPending,3000);
    assert.throws(()=>db.prepare('DELETE FROM computers WHERE id=?').run(cash.computer_ref),/depozit/);
    const confirmation={requestId:'fund-refund-cash',bookingId:cash.id,expectedRevision:cancelled.body.booking.revision,amount:3000,confirmed:true};
    assert.throws(()=>refund(db,actor,{...confirmation,amount:2999},now),{statusCode:409});
    refund(db,actor,confirmation,now);assert.equal(refund(db,actor,confirmation,now).replayed,true);
    assert.throws(()=>refund(db,actor,{...confirmation,requestId:'fund-refund-again'},now),{statusCode:409});
    assert.equal(bookingFunds(db,row(cash)).held,0);
    const expiredWallet=reserve('BALANCE',2000),expiredCash=reserve('CASH',2500),beforeExpiry=wallet();
    expire(db,1,now+15*60000);assert.equal(wallet(),beforeExpiry+2000);
    assert.equal(bookingFunds(db,row(expiredCash)).cashRefundPending,2500);
    assert.equal(row(expiredWallet).status,'NO_SHOW');
    // Overpayment returns to the original source; cash remains pending until confirmed.
    const excess=reserve('BALANCE',18000),balanceBefore=wallet();
    saveBookingSettings(db,actor,{requestId:'fund-pause-bookings',expectedRevision:0,graceMinutes:10,creationEnabled:false},now);
    const delayedInput={mode:'hours',durationMinutes:60,paymentType:'BALANCE',expectedRevision:excess.revision};
    const firstQuote=quote(db,actor,delayedInput,{bookingId:excess.id,now:now+123});
    const delayedQuote=quote(db,actor,delayedInput,{bookingId:excess.id,now:now+1987});
    assert.equal(delayedQuote.quoteRevision,firstQuote.quoteRevision,'same price a few seconds later must not reject check-in');
    const over=checkin(excess,{durationMinutes:60,paymentType:'BALANCE'});
    saveBookingSettings(db,actor,{requestId:'fund-resume-bookings',expectedRevision:1,graceMinutes:10,creationEnabled:true},now);
    assert.equal(over.result.body.additionalPayment,0);assert.equal(over.result.body.balanceRelease,8000);
    assert.equal(wallet(),balanceBefore+8000);
    db.prepare("UPDATE sessions SET status='COMPLETED' WHERE id=?").run(over.id);
    const cashExcess=reserve('CASH',18000);const excessStart=checkin(cashExcess);
    assert.equal(bookingFunds(db,row(cashExcess)).cashRefundPending,8000);
    assert.equal(excessStart.result.body.additionalPayment,0);
    db.prepare("UPDATE sessions SET status='COMPLETED' WHERE id=?").run(excessStart.id);
    // Same shared engine, different times/amounts and both sources, including mixed funding.
    for(const spec of [
      {kind:'CASH',deposit:3000,payment:'CASH',minutes:30,bar:5000},
      {kind:'CASH',deposit:3000,payment:'CASH',minutes:50,bar:5000},
      {kind:'BALANCE',deposit:3000,payment:'BALANCE',minutes:14,bar:5000,amount:18000},
      {kind:'CASH',deposit:3000,payment:'BALANCE',minutes:30,bar:5000},
      {kind:'BALANCE',deposit:3000,payment:'CASH',minutes:10,bar:5000},
      {kind:'CASH',deposit:12000,payment:'POSTPAID',minutes:30,bar:5000},
      {kind:'BALANCE',deposit:12000,payment:'POSTPAID',minutes:50,bar:5000}
    ]){
      const b=reserve(spec.kind,spec.deposit),baseline=wallet();
      const data={mode:spec.payment==='POSTPAID'?'postpaid':spec.amount?'price':'hours',amount:spec.amount,
        durationMinutes:60,paymentType:spec.payment,...(spec.payment==='BALANCE'?{customerId:member.id}:{})};
      const s=checkin(b,data);
      assert.equal(s.result.body.additionalPayment,spec.payment==='POSTPAID'?0:Math.max(0,(spec.amount||10000)-spec.deposit));
      const normal=start(db,actor,{...data,computerId:pc(),...(spec.payment==='BALANCE'?{customerId:member.id}:{})},{now});
      for(const id of [s.id,normal.body.sessionId])db.prepare(`INSERT INTO bar_orders(club_id,order_number,session_id,computer_id,total_amount,payment_status,approval_status)
        VALUES(1,?,?,?,?,'PENDING_AT_CHECKOUT','CONFIRMED')`).run('fund-bar-'+(++seq),id,db.prepare('SELECT computer_id FROM sessions WHERE id=?').get(id).computer_id,spec.bar);
      now+=spec.minutes*60000;
      const preview=ledger.getSessionCheckoutPreview(s.id,1),ordinary=ledger.getSessionCheckoutPreview(normal.body.sessionId,1);
      assert.equal(preview.gameBill,ordinary.gameBill);assert.equal(preview.barBill,ordinary.barBill);
      if(spec.kind==='CASH'&&spec.payment==='CASH'){
        assert.equal(preview.amountToCollect,ordinary.amountToCollect);assert.equal(preview.refundAmount,ordinary.refundAmount);
      }
      if(spec.kind==='BALANCE'&&spec.payment==='BALANCE'){
        assert.equal(preview.amountToCollect,ordinary.amountToCollect);assert.equal(preview.balanceRefund,ordinary.member.refundAmount);
      }
      const walletBefore=wallet();ledger.executeSessionCheckout({target:s.id,clubId:1,cashierUserId:actor.id});
      assert.equal(wallet(),walletBefore+preview.balanceRefund);
      assert.equal(row(b).status,'COMPLETED');
      assert.throws(()=>ledger.executeSessionCheckout({target:s.id,clubId:1,cashierUserId:actor.id}));
      const cashGame=db.prepare("SELECT coalesce(sum(amount),0) n FROM transactions WHERE session_id=? AND transaction_type<>'BAR_SALE'").get(s.id).n;
      const balanceGame=db.prepare("SELECT coalesce(sum(CASE WHEN type='REFUND' THEN -amount ELSE amount END),0) n FROM client_transactions WHERE session_id=? AND category='GAME'").get(s.id).n;
      assert.equal(cashGame+balanceGame,preview.gameBill,'only consumed game value remains');
      assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id=? AND transaction_type='BAR_SALE'").get(s.id).n,spec.bar);
      assert.equal(bookingFunds(db,row(b)).applied,Math.min(spec.deposit,spec.payment==='POSTPAID'?spec.deposit:spec.amount||10000));
      db.prepare("UPDATE sessions SET status='COMPLETED' WHERE id=?").run(normal.body.sessionId);
      assert.ok(wallet()>=0);assert.ok(baseline>=0);
    }
    // Original deposit date remains the receipt date after a transfer.
    const b=reserve('CASH',3000),source=bookingFunds(db,b).source;
    const s=checkin(b),destination=pc(),options={fromComputerId:b.computer_ref,toComputerId:destination,clubId:1,now:now+60000};
    transferSession({...options,quoteRevision:previewSessionTransfer(options).quoteRevision});
    assert.equal(db.prepare('SELECT session_id FROM session_funding_allocations WHERE booking_id=?').get(b.id).session_id,s.id);
    assert.equal(db.prepare('SELECT created_at FROM transactions WHERE session_id=? AND amount=3000').get(s.id).created_at,source.created_at);
    const report=getFinancialBreakdown(db,'2000-01-01','2099-12-31',1);
    assert.ok(report.bookingDeposits.cashHeld>=2500);assert.equal(report.bookingDeposits.cashRefunded,3000);
    assert.equal(bookingFundsReport(db,'2000-01-01','2099-12-31',999).cashCaptured,0);
    // A second connection sees persistent receipts, with no second debit.
    const second=new DatabaseSync(path.join(dir,'netcafe.db'));
    try{assert.equal(second.prepare('SELECT count(*) n FROM booking_funds WHERE booking_id=? AND kind=\'APPLY\'').get(b.id).n,1);}finally{second.close();}
    assert.throws(()=>db.exec('DELETE FROM booking_funds'),/tarix/);
    initDatabase();assert.equal(db.prepare('SELECT count(*) n FROM booking_funds WHERE booking_id=?').get(b.id).n,2);
    // A failed APPLY rolls back fresh money, session, audit and receipt together.
    const failed=reserve('BALANCE',3000),beforeFailed=wallet();
    const attempt={expectedRevision:failed.revision,requestId:'fund-atomic-checkin',mode:'hours',durationMinutes:60,paymentType:'BALANCE'};
    attempt.quoteRevision=quote(db,actor,attempt,{bookingId:failed.id,now}).quoteRevision;
    db.exec("CREATE TRIGGER fail_booking_apply BEFORE INSERT ON booking_funds WHEN NEW.kind='APPLY' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    assert.throws(()=>start(db,actor,attempt,{bookingId:failed.id,now}),/injected failure/);
    assert.equal(wallet(),beforeFailed);assert.equal(row(failed).status,'CONFIRMED');
    assert.equal(db.prepare('SELECT count(*) n FROM sessions WHERE computer_id=?').get(failed.computer_ref).n,0);
    db.exec('DROP TRIGGER fail_booking_apply');
    start(db,actor,attempt,{bookingId:failed.id,now});assert.equal(wallet(),beforeFailed-7000);
    assert.equal(start(db,actor,attempt,{bookingId:failed.id,now}).replayed,true);
    assert.throws(()=>refund(db,{...actor,permissions:[]},confirmation,now),{statusCode:403});
    assert.throws(()=>refund(db,{...actor,clubId:999},confirmation,now),{statusCode:404});

    // A forced stop preserves the calculated bill and never pretends cash was returned.
    db.exec("UPDATE sessions SET status='COMPLETED' WHERE status='ACTIVE'");
    const {SessionScheduler:scheduler}=await load('services/sessionScheduler.js');
    now=Math.floor(realNow()/60000)*60000-30*60000;
    const stopCash=checkin(reserve('CASH',3000));
    const stopWallet=checkin(reserve('BALANCE',3000),{paymentType:'BALANCE'});
    now=realNow();
    const cashBeforeStop=ledger.getSessionCheckoutPreview(stopCash.id,1);
    const walletBeforeStop=wallet();
    scheduler.dropAllActiveSessions('TEST_STOP');
    const cashAfterStop=ledger.getSessionCheckoutPreview(stopCash.id,1);
    assert.ok(Math.abs(cashAfterStop.gameBill-cashBeforeStop.gameBill)<=1);
    assert.ok(cashAfterStop.refundAmount>4800);
    assert.equal(db.prepare("SELECT count(*) n FROM transactions WHERE session_id=? AND transaction_type='REFUND'").get(stopCash.id).n,0);
    assert.ok(wallet()>walletBeforeStop+4800);
    const restoredWallet=wallet();
    ledger.executeSessionCheckout({target:stopCash.id,clubId:1,cashierUserId:actor.id});
    ledger.executeSessionCheckout({target:stopWallet.id,clubId:1,cashierUserId:actor.id});
    assert.equal(wallet(),restoredWallet,'forced-stop wallet refund cannot be paid twice');
    assert.throws(()=>ledger.getSessionCheckoutPreview(stopCash.id,1));

    now=realNow();const expires=checkin(reserve('CASH',3000));
    const expiring=db.prepare('SELECT * FROM sessions WHERE id=?').get(expires.id);
    scheduler.finishSession(expiring,{now:new Date(Date.parse(expiring.ends_at)+1000)});
    const expiredPreview=ledger.getSessionCheckoutPreview(expires.id,1);
    assert.equal(expiredPreview.gameBill,10000);assert.equal(expiredPreview.amountToCollect,0);assert.equal(expiredPreview.refundAmount,0);
    ledger.executeSessionCheckout({target:expires.id,clubId:1,cashierUserId:actor.id});
    // A deposit captured on an earlier day uses the same retained-receipt report.
    now=realNow();const capturedAt=now-2*86400000;
    const historical=create(db,actor,{requestId:'fund-historical',computerId:pc(),customerName:'Earlier deposit',
      startTime:iso(now-60000),endTime:iso(now+7200000),payment:{kind:'CASH',amount:3000}},capturedAt).body.booking;
    const historicalSession=checkin(historical);now+=30*60000;
    ledger.executeSessionCheckout({target:historicalSession.id,clubId:1,cashierUserId:actor.id});
    const localDay=n=>{const d=new Date(n);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
    const day=localDay(capturedAt),today=localDay(realNow());
    const oldReport=getFinancialBreakdown(db,day,day,1),newReport=getFinancialBreakdown(db,today,today,1);
    const sessionTotal=r=>r.rows.filter(x=>x.sessionId===historicalSession.id).reduce((n,x)=>n+x.amount,0);
    assert.equal(sessionTotal(oldReport),3000);assert.equal(sessionTotal(newReport),2000);
    assert.equal(sessionTotal(getFinancialBreakdown(db,day,today,1)),5000);
    now=realNow();const card=checkin(reserve('CASH',3000),{paymentType:'CARD'});
    // Legacy extension writes payment_type while payment_method defaults to CASH.
    db.prepare("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,notes) VALUES('fund-card-extension',1,?,2000,'CARD','SESSION_EXTEND')").run(card.id);
    const sources=bookingFundingPreview(db,db.prepare('SELECT * FROM sessions WHERE id=?').get(card.id),1000,0).cash;
    assert.equal(sources.find(x=>x.channel==='CARD').amount,9000);
    assert.equal(sources.find(x=>x.channel==='CASH').amount,3000);
  }finally{Date.now=realNow;db.close();}
});
