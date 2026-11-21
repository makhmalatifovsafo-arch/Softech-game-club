import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

test('cash/card prepaid refunds follow purchased tariff periods, including extensions and fractional minutes',async()=>{
  fs.mkdirSync('.test-output',{recursive:true});const dir=fs.mkdtempSync(path.resolve('.test-output/cashier-refund-'));
  for(const f of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',f),path.join(dir,f),{recursive:true});
  process.env.NODE_ENV='test';const load=f=>import(pathToFileURL(path.join(dir,'src',f)).href);
  const {db,initDatabase}=await load('db.js');initDatabase();
  try{
    const {startCashierSession:start}=await load('services/cashierSessionStart.js');
    const {prepaidRefund}=await load('services/memberBilling.js');
    const {extendFrozenPricePlan}=await load('services/prepaidTransferPlan.js');
    db.exec("DELETE FROM tariff_schedules; INSERT INTO zones(id,club_id,name) VALUES(90,1,'Day/night')");
    const add=db.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,type,price_per_hour,start_time,end_time) VALUES(?,1,90,?,'HOURLY',?,?,?)");
    add.run('day','Day',7000,'10:00','17:00');add.run('night','Night',14000,'17:00','10:00');
    const actor={...db.prepare("SELECT * FROM users WHERE role='administrator'").get(),clubId:1,permissions:['session:manage']};
    let seq=200;const when=new Date(2026,10,21,16).getTime();
    for(const paymentType of ['CASH','CARD'])for(const mode of ['hours','price','endtime']){
      const pc='refund-pc-'+(++seq);
      db.prepare('INSERT INTO computers(id,club_id,pc_number,name,zone_id) VALUES(?,1,?,?,90)').run(pc,seq,pc);
      const opened=start(db,actor,{computerId:pc,paymentType,mode,durationMinutes:120,amount:21000,targetEndTime:'18:00'},{now:when});
      const s=db.prepare('SELECT * FROM sessions WHERE id=?').get(opened.body.sessionId);
      assert.equal(s.paid_amount,21000);
      assert.deepEqual(prepaidRefund(s,new Date(when+3600000)),{usedAmount:7000,amount:14000},paymentType+' '+mode+' must not use an average hourly price');
      db.prepare('UPDATE tariffs SET price_per_hour=90000 WHERE zone_id=90').run();
      assert.equal(prepaidRefund(s,new Date(when+3600000)).usedAmount,7000,'later edits cannot rewrite the purchased interval');
      db.exec("UPDATE tariffs SET price_per_hour=7000 WHERE id='day'; UPDATE tariffs SET price_per_hour=14000 WHERE id='night'");
      const extended={...s,ends_at:new Date(when+3*3600000).toISOString(),paid_amount:35000,
        prepaid_rate_plan:JSON.stringify(extendFrozenPricePlan(s,new Date(when+3*3600000).toISOString()))};
      assert.equal(prepaidRefund(extended,new Date(when+2.5*3600000)).usedAmount,28000);
      assert.equal(prepaidRefund(extended,new Date(when+3*3600000)).amount,0);
      const again=extendFrozenPricePlan(extended,new Date(when+4*3600000).toISOString());
      assert.equal(prepaidRefund({...extended,ends_at:new Date(when+4*3600000).toISOString(),paid_amount:49000,prepaid_rate_plan:JSON.stringify(again)},new Date(when+3.5*3600000)).usedAmount,42000);
    }
    const pc='refund-pc-'+seq,startAt=new Date(when),endAt=new Date(when+90000);
    const partial={computer_id:pc,club_id:1,started_at:startAt.toISOString(),ends_at:endAt.toISOString(),paid_amount:175,prepaid_rate_plan:JSON.stringify([7000/60,7000/60])};
    const plan=extendFrozenPricePlan(partial,new Date(when+150000).toISOString());
    const extended={...partial,ends_at:new Date(when+150000).toISOString(),paid_amount:292,prepaid_rate_plan:JSON.stringify(plan)};
    assert.equal(prepaidRefund(extended,new Date(when+120000)).usedAmount,233);
    assert.equal(prepaidRefund(extended,new Date(when+150000)).amount,0);
  }finally{db.close();}
});
