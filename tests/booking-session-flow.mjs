import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

// Runs only against startup.test's copied server and disposable database.
export async function checkBookingSessionFlow({api,databasePath}) {
  const db=new DatabaseSync(databasePath);db.exec('PRAGMA busy_timeout=5000');
  try {
    const room=await api('/api/zones','POST',{name:'Booking regression',tariffs:[{name:'Hourly',price_per_hour:10000,
      start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],is_vip_postpaid_allowed:true}]});
    assert.equal(room.status,201,JSON.stringify(room.body));
    const pcs=[];
    for(const n of [961,962]){
      const added=await api('/api/admin/computers','POST',{name:'Booking-'+n,pcNumber:n});
      assert.equal(added.status,201,JSON.stringify(added.body));pcs.push(added.body.computer.id);
      db.prepare('UPDATE computers SET zone_id=? WHERE id=?').run(room.body.zone.id,pcs.at(-1));
    }
    let seq=0;
    async function create(pc=pcs[0],payment){
      const start=Date.now()+3600000;
      const response=await api('/api/bookings','POST',{requestId:'booking-http-create-'+(++seq),computerId:pc,
        customerName:'Test guest',startTime:new Date(start).toISOString(),endTime:new Date(start+3600000).toISOString(),payment});
      assert.equal(response.status,201,JSON.stringify(response.body));return response.body.booking;
    }
    const b=await create();
    assert.equal((await api('/api/bookings/'+b.id+'/status','PUT',{status:'ACTIVE'})).status,409);
    assert.equal((await api('/api/bookings/'+b.id,'DELETE',{})).status,400,'No untracked destructive delete');
    // Set the copied fixture's reservation to a current interval, without waiting an hour.
    db.prepare('UPDATE bookings SET start_time=?,end_time=?,no_show_at=? WHERE id=?').run(
      new Date(Date.now()-60000).toISOString(),new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+600000).toISOString(),b.id);
    const ordinary={computerId:pcs[0],mode:'hours',durationMinutes:60,paymentType:'CASH'};
    assert.equal((await api('/api/sessions/start','POST',ordinary)).status,409);
    assert.equal((await api('/api/sessions/batch-start','POST',{mode:'hours',durationMinutes:60,computerIds:[pcs[1],pcs[0]]})).status,409);
    assert.equal(db.prepare("SELECT count(*) n FROM sessions WHERE computer_id IN (?,?) AND status='ACTIVE'").get(...pcs).n,0,'failed batch is atomic');
    const input={...ordinary,expectedRevision:b.revision};
    const quote=await api('/api/bookings/'+b.id+'/check-in-preview','POST',input);
    assert.equal(quote.status,200,JSON.stringify(quote.body));assert.equal(quote.body.amount,10000);
    const body={...input,quoteRevision:quote.body.quoteRevision,requestId:'booking-http-checkin'};
    const start=await api('/api/bookings/'+b.id+'/check-in','POST',body);
    assert.equal(start.status,201,JSON.stringify(start.body));
    assert.equal((await api('/api/bookings/'+b.id+'/check-in','POST',body)).body.sessionId,start.body.sessionId);
    assert.equal(db.prepare('SELECT count(*) n FROM transactions WHERE session_id=?').get(start.body.sessionId).n,1);
    // An ordinary extension cannot cross a newly reserved following interval.
    const next=await create(pcs[0]);
    db.prepare('UPDATE bookings SET start_time=?,end_time=?,no_show_at=? WHERE id=?').run(
      new Date(Date.now()+61*60000).toISOString(),new Date(Date.now()+121*60000).toISOString(),new Date(Date.now()+71*60000).toISOString(),next.id);
    const before=db.prepare('SELECT * FROM sessions WHERE id=?').get(start.body.sessionId);
    assert.equal((await api('/api/sessions/'+start.body.sessionId+'/extend','POST',{additionalMinutes:30})).status,409);
    assert.equal(db.prepare('SELECT ends_at FROM sessions WHERE id=?').get(start.body.sessionId).ends_at,before.ends_at);
    // Existing checkout remains the sole billing path: 30 minutes game + 5000 bar = retained 10000.
    const item=await api('/api/bar/items','POST',{name:'Booking drink',category:'DRINKS',buyPrice:2000,sellPrice:5000,stockQuantity:5});
    assert.equal(item.status,201,JSON.stringify(item.body));
    const order=await api('/api/bar/orders','POST',{computerId:pcs[0],sessionId:start.body.sessionId,
      items:[{barItemId:item.body.item?.id||item.body.id,quantity:1}],paymentMethod:'ON_PC_SESSION',paymentStatus:'PENDING_AT_CHECKOUT',requestId:'booking-http-drink'});
    assert.equal(order.status,201,JSON.stringify(order.body));
    const half=Date.now()-1800000;
    db.prepare('UPDATE sessions SET started_at=?,ends_at=? WHERE id=?').run(new Date(half).toISOString(),new Date(half+3600000).toISOString(),start.body.sessionId);
    const checkout=await api('/api/sessions/'+start.body.sessionId+'/checkout-preview');
    assert.equal(checkout.status,200,JSON.stringify(checkout.body));
    const close=await api('/api/sessions/'+start.body.sessionId+'/checkout','POST',{paymentMethod:'CASH'});
    assert.equal(close.status,200,JSON.stringify(close.body));
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(b.id).status,'COMPLETED');
    const retained=db.prepare('SELECT sum(amount) amount FROM transactions WHERE session_id=?').get(start.body.sessionId).amount;
    assert.ok(Math.abs(retained-10000)<=10,'Booking checkout must retain game + bar once: '+retained);
    assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action_type='BOOKING_CHECKED_IN' AND json_extract(details,'$.bookingId')=?").get(b.id).n,1);
    assert.equal((await api('/api/bookings/'+next.id+'/cancel','POST',{expectedRevision:next.revision,requestId:'booking-http-cancel',reason:'Finished test'})).status,200);
    // Paid bookings reach the same session/checkout endpoints and preserve one receipt.
    const paid=await create(pcs[0],{kind:'CASH',amount:3000});
    db.prepare('UPDATE bookings SET start_time=?,end_time=?,no_show_at=? WHERE id=?').run(
      new Date(Date.now()-60000).toISOString(),new Date(Date.now()+3600000).toISOString(),new Date(Date.now()+600000).toISOString(),paid.id);
    const paidInput={...ordinary,expectedRevision:paid.revision,requestId:'booking-http-paid-checkin'};
    const paidQuote=await api('/api/bookings/'+paid.id+'/check-in-preview','POST',paidInput);
    assert.equal(paidQuote.status,200,JSON.stringify(paidQuote.body));
    assert.equal(paidQuote.body.depositApplied,3000);assert.equal(paidQuote.body.additionalPayment,7000);
    paidInput.quoteRevision=paidQuote.body.quoteRevision;
    const paidStart=await api('/api/bookings/'+paid.id+'/check-in','POST',paidInput);
    assert.equal(paidStart.status,201,JSON.stringify(paidStart.body));
    assert.equal((await api('/api/bookings/'+paid.id+'/check-in','POST',paidInput)).body.sessionId,paidStart.body.sessionId);
    assert.equal(db.prepare('SELECT sum(amount) n FROM transactions WHERE session_id=?').get(paidStart.body.sessionId).n,10000);
    assert.equal((await api('/api/sessions/'+paidStart.body.sessionId+'/checkout','POST',{paymentMethod:'CASH'})).status,200);
    const cancelledDeposit=await create(pcs[0],{kind:'CASH',amount:4500});
    const cancelledPaid=await api('/api/bookings/'+cancelledDeposit.id+'/cancel','POST',{
      expectedRevision:cancelledDeposit.revision,requestId:'booking-http-paid-cancel',reason:'Refund test'});
    assert.equal(cancelledPaid.status,200,JSON.stringify(cancelledPaid.body));
    assert.equal(cancelledPaid.body.funds.cashRefundPending,4500);
    const refundBody={expectedRevision:cancelledPaid.body.booking.revision,requestId:'booking-http-paid-refund',amount:4500,confirmed:true};
    const refund=await api('/api/bookings/'+cancelledDeposit.id+'/refund','POST',refundBody);
    assert.equal(refund.status,200,JSON.stringify(refund.body));assert.equal(refund.body.funds.held,0);
    assert.equal((await api('/api/bookings/'+cancelledDeposit.id+'/refund','POST',refundBody)).status,200);
    assert.equal(db.prepare("SELECT count(*) n FROM booking_funds WHERE booking_id=? AND kind='REFUND'").get(cancelledDeposit.id).n,1);
    // Expiry runs on the actual server timer and keeps history, without creating a session.
    const missed=await create(pcs[1]);
    db.prepare('UPDATE bookings SET start_time=?,no_show_at=? WHERE id=?').run(new Date(Date.now()-1200000).toISOString(),new Date(Date.now()-60000).toISOString(),missed.id);
    for(let i=0;i<70&&db.prepare('SELECT status FROM bookings WHERE id=?').get(missed.id).status!=='NO_SHOW';i++)await new Promise(r=>setTimeout(r,100));
    assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(missed.id).status,'NO_SHOW');
    console.log('PASS booking HTTP: collisions, batch rollback, check-in replay, extension guard, bar checkout and no-show history');
  }finally{db.close();}
}
