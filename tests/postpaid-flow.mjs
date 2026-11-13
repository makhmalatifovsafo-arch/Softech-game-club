import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

export async function checkPostpaidFlow({localUrl,token,databasePath}) {
  const api=async(route,method='GET',body)=>{
    const response=await fetch(localUrl+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const db=new DatabaseSync(databasePath);db.exec('PRAGMA busy_timeout=5000');
  const previous=(await api('/api/settings')).body.settings;
  try {
    const room=await api('/api/zones','POST',{name:'Postpaid regression room',tariffs:[{name:'Room 10000',price_per_hour:10000,start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],is_vip_postpaid_allowed:true}]});
    assert.equal(room.status,201,JSON.stringify(room.body));
    const expensive=await api('/api/zones','POST',{name:'Postpaid expensive destination',tariffs:[{name:'Room 20000',price_per_hour:20000,start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],is_vip_postpaid_allowed:true}]});
    assert.equal(expensive.status,201);
    const item=await api('/api/bar/items','POST',{name:'VIP billing regression drink',category:'DRINKS',buyPrice:2000,sellPrice:6000,stockQuantity:20});
    assert.equal(item.status,201,JSON.stringify(item.body));
    const barItemId=item.body.item?.id || item.body.id;
    assert.ok(barItemId,JSON.stringify(item.body));
    const pcs=[];
    for (const pcNumber of [971,972]) {
      const added=await api('/api/admin/computers','POST',{name:'Postpaid-'+pcNumber,pcNumber});
      assert.equal(added.status,201,JSON.stringify(added.body));pcs.push(added.body.computer.id);
      db.prepare('UPDATE computers SET zone_id=? WHERE id=?').run(pcs.length===1?room.body.zone.id:expensive.body.zone.id,pcs.at(-1));
    }
    for (const [mode,rate] of [['SCHEDULE',10000],['CUSTOM',9000]]) {
      assert.equal((await api('/api/settings','PUT',{vip_enabled:true,vip_pricing_mode:mode,vip_custom_price:9000})).status,200);
      const start=await api('/api/sessions/start','POST',{computerId:pcs[0],mode:'postpaid',paymentType:'POSTPAID'});
      assert.equal(start.status,201,JSON.stringify(start.body));
      const id=start.body.sessionId;
      const startedAt=Date.now()-30*60000;
      db.prepare('UPDATE sessions SET started_at=? WHERE id=?').run(new Date(startedAt).toISOString(),id);
      const live=(await api('/api/computers')).body.find(p=>p.id===pcs[0]).activeSession;
      assert.equal(live.isPostpaid,true);assert.equal(live.remainingSeconds,-1);assert.equal(live.billingError,null);
      assert.equal(live.totalAmount,Math.round((live.asOf-startedAt)/3600000*rate));
      assert.ok(live.totalAmount>=rate/2 && live.totalAmount<rate/2+20);
      assert.equal(live.totalWithBar,live.totalAmount);
      assert.equal(db.prepare('SELECT total_amount FROM sessions WHERE id=?').get(id).total_amount,0,'Live bill must not mutate payment history');
      const preview=await api('/api/sessions/'+id+'/checkout-preview');assert.equal(preview.status,200,JSON.stringify(preview.body));
      assert.equal(preview.body.pricingMode,mode);
      assert.equal(preview.body.customPrice,mode==='CUSTOM'?9000:null);
      assert.ok(Math.abs(preview.body.gameBill-live.totalAmount)<20,'List and checkout must use the same rate');
      const addBar=async pc=>{
        const sale=await api('/api/bar/orders','POST',{items:[{barItemId,quantity:1}],computerId:pc,sessionId:id,paymentMethod:'ON_PC_SESSION',paymentStatus:'PENDING_AT_CHECKOUT'});
        assert.equal(sale.status,201,JSON.stringify(sale.body));
      };
      await addBar(pcs[0]);
      assert.match(db.prepare('SELECT notes FROM sessions WHERE id=?').get(id).notes,/POSTPAID.*BAR:/);
      const withBar=(await api('/api/computers')).body.find(p=>p.id===pcs[0]).activeSession;
      assert.equal(withBar.isPostpaid,true,'A real bar order must not erase VIP mode');
      assert.ok(withBar.totalAmount>=rate/2 && withBar.totalAmount<rate/2+20);
      assert.equal(withBar.barPendingAmount,6000);assert.equal(withBar.totalWithBar,withBar.totalAmount+6000);
      const barPreview=await api('/api/sessions/'+id+'/checkout-preview');
      assert.equal(barPreview.status,200);assert.equal(barPreview.body.isPostpaid,true);
      assert.equal(barPreview.body.barBill,6000);assert.ok(barPreview.body.gameBill>=rate/2);
      assert.equal(barPreview.body.amountToCollect,barPreview.body.gameBill+6000);
      // A real transfer appends a suffix; generic /stop must still collect a postpaid payment.
      const transfer=await api('/api/sessions/transfer','POST',{fromComputerId:pcs[0],toComputerId:pcs[1]});
      assert.equal(transfer.status,200,JSON.stringify(transfer.body));
      const moved=(await api('/api/computers')).body.find(p=>p.id===pcs[1]).activeSession;
      assert.equal(moved.isPostpaid,true);assert.ok(moved.totalAmount>=rate/2);
      assert.ok(moved.totalAmount<rate/2+20,'Historical debt must not be doubled by the new room rate');
      await addBar(pcs[1]);
      const withSecondBar=(await api('/api/computers')).body.find(p=>p.id===pcs[1]).activeSession;
      assert.equal(withSecondBar.isPostpaid,true);assert.equal(withSecondBar.barPendingAmount,12000);
      assert.ok(withSecondBar.totalAmount>=rate/2);
      const stop=await api('/api/sessions/stop','POST',{sessionId:id,paymentType:'CASH'});
      assert.equal(stop.status,200,JSON.stringify(stop.body));
      assert.equal(stop.body.barBill,12000);assert.equal(stop.body.amountCollected,stop.body.gameBill+12000);
      const receipts=db.prepare("SELECT amount FROM transactions WHERE session_id=? AND transaction_type='POSTPAID_SETTLEMENT'").all(id);
      assert.equal(receipts.length,1,'Transferred VIP must create exactly one game payment');
      assert.equal(receipts[0].amount,stop.body.gameBill);assert.ok(receipts[0].amount>=rate/2 && receipts[0].amount<rate/2+20);
      assert.equal(db.prepare('SELECT total_amount FROM sessions WHERE id=?').get(id).total_amount,receipts[0].amount);
      assert.notEqual((await api('/api/sessions/stop','POST',{sessionId:id})).status,200,'A settled bill must not charge twice');
      assert.equal(db.prepare('SELECT SUM(amount) AS total FROM transactions WHERE session_id=?').get(id).total,stop.body.gameBill+12000,'Game and bar are collected exactly once');
    }
    // Legacy group VIP markers must have the same display and missing-tariff behavior.
    await api('/api/settings','PUT',{vip_pricing_mode:'SCHEDULE'});
    const batch=await api('/api/sessions/batch-start','POST',{computerIds:[pcs[0]],mode:'VIP'});
    assert.equal(batch.status,201,JSON.stringify(batch.body));
    const id=db.prepare('SELECT current_session_id AS id FROM computers WHERE id=?').get(pcs[0]).id;
    db.prepare("UPDATE sessions SET started_at=?,notes='BATCH_VIP' WHERE id=?").run(new Date(Date.now()-1800000).toISOString(),id);
    assert.equal((await api('/api/computers')).body.find(p=>p.id===pcs[0]).activeSession.isPostpaid,true);
    db.prepare("UPDATE tariffs SET days_of_week='[]' WHERE zone_id=?").run(room.body.zone.id);
    const missing=(await api('/api/computers')).body.find(p=>p.id===pcs[0]);
    assert.equal(missing.activeSession.totalAmount,null);assert.equal(missing.totalWithBar,null);assert.ok(missing.activeSession.billingError);
    assert.notEqual((await api('/api/sessions/'+id+'/checkout','POST',{})).status,200,'Missing rates cannot silently settle at zero');
    assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(id).status,'ACTIVE');
    db.prepare("UPDATE tariffs SET days_of_week='[1,2,3,4,5,6,7]' WHERE zone_id=?").run(room.body.zone.id);
    assert.equal((await api('/api/sessions/'+id+'/checkout','POST',{paymentMethod:'CASH'})).status,200);
    for (const price of [0,-1,'invalid']) assert.equal((await api('/api/settings','PUT',{vip_custom_price:price})).status,400);
    console.log('PASS VIP live amount, real bar orders before/after transfer, room/custom rates, exact game/bar settlement, group VIP and duplicate-payment protection');
  } finally {
    db.close();await api('/api/settings','PUT',previous);
  }
}
