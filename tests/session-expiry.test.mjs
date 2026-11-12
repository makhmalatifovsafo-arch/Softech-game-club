import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function run(body) {
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/session-expiry-'));
  fs.cpSync('NetCafeServer/src',path.join(root,'src'),{recursive:true});
  fs.copyFileSync('NetCafeServer/schema.sql',path.join(root,'schema.sql'));
  fs.writeFileSync(path.join(root,'case.mjs'),`import assert from 'node:assert/strict';
    import {db,initDatabase} from './src/db.js';initDatabase();
    import {calculateFromDurationHours,resolveZoneIdForComputer} from './src/services/pricingEngine.js';
    import {SessionScheduler} from './src/services/sessionScheduler.js';
    import {ClientManager} from './src/services/clientManager.js';
    import {BarLedgerService} from './src/services/barLedgerService.js';
    try { ${body} } finally {db.close();}`);
  const result=spawnSync(process.execPath,['case.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test'},windowsHide:true,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
}
test('two hours at 7000 remains 14000 across an uncovered 17:00 boundary; package rates are not hourly rates',()=>run(`
  db.exec("DELETE FROM tariff_schedules; INSERT INTO zones(id,club_id,name) VALUES(90,1,'Test room')");
  const add=db.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,price_per_hour,type,start_time,end_time) VALUES(?,1,90,?,?,?,?,?)");
  add.run('a-night','Night package',0,'NIGHT','17:00','10:00');
  add.run('b-day','Day',7000,'HOURLY','10:00','17:00');
  for(const time of ['10:00','16:18','16:36','17:30']){
    const result=calculateFromDurationHours(new Date('2026-11-12T'+time+':00'),2,false,1,90);
    assert.equal(result.totalAmount,14000,time);assert.equal(result.totalMinutes,120);
  }
  add.run('c-evening','Evening',10000,'HOURLY','17:00','10:00');
  assert.equal(calculateFromDurationHours(new Date('2026-11-12T16:00:00'),2,false,1,90).totalAmount,17000);
  db.prepare("INSERT INTO tariff_schedules(club_id,name,days_of_week,start_time,end_time,price_per_hour) VALUES(1,'Only day','[1,2,3,4,5,6,7]','10:00','17:00',7000)").run();
  assert.equal(calculateFromDurationHours(new Date('2026-11-12T16:36:00'),2,false,1).totalAmount,14000);
  assert.throws(()=>calculateFromDurationHours(new Date(),Infinity));
`));
test('expiry persists exact unpaid Cola/Fanta notice; later collection never bills game twice or stops a replacement session',()=>run(`
  const end=new Date(Date.now()-1000).toISOString(),start=new Date(Date.parse(end)-3600000).toISOString();
  db.prepare("INSERT INTO computers(id,club_id,pc_number,name,current_session_id,status) VALUES('pc',1,7,'PC-7','paid','OCCUPIED')").run();
  db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,total_amount,paid_amount,status) VALUES('paid',1,'pc','trf_standard_1h',?,?,7000,7000,'ACTIVE')").run(start,end);
  const order=db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,approval_status) VALUES(1,?,7,?,?,'PENDING_AT_CHECKOUT',?)");
  const cola=order.run('COLA','paid',10000,'CONFIRMED').lastInsertRowid;
  const fanta=order.run('FANTA','paid',12000,'CONFIRMED').lastInsertRowid;
  order.run('OLD','previous-session',90000,'CONFIRMED');order.run('UNCONFIRMED','paid',50000,'PENDING');
  db.prepare("INSERT INTO bar_order_items(order_id,bar_item_id,item_name,quantity,unit_price,total_price) VALUES(?,1,'Cola',1,10000,10000)").run(cola);
  db.prepare("INSERT INTO bar_order_items(order_id,bar_item_id,item_name,quantity,unit_price,total_price) VALUES(?,2,'Fanta',2,6000,12000)").run(fanta);
  const sent=[],broadcast=[];ClientManager.send=(pc,type,payload)=>sent.push({pc,type,payload});ClientManager.broadcast=(type,payload)=>broadcast.push({type,payload});
  SessionScheduler.expireSession({id:'paid'});SessionScheduler.expireSession({id:'paid'});
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='paid'").get().status,'COMPLETED');
  const notice=JSON.parse(db.prepare("SELECT payload_json FROM session_end_notices WHERE session_id='paid'").get().payload_json);
  assert.equal(notice.barDebt,22000);assert.equal(notice.barSummary,'1 ta Cola, 2 ta Fanta');assert.equal(notice.durationMinutes,60);
  assert.equal(sent.filter(s=>s.type==='STOP_SESSION').length,1);
  assert.equal(sent.find(s=>s.type==='STOP_SESSION').payload.barNotice.message,notice.message);
  assert.equal(broadcast.filter(s=>s.type==='SESSION_EXPIRED_WITH_BAR_DEBT').length,1);
  const preview=BarLedgerService.getSessionCheckoutPreview('paid',1);assert.equal(preview.amountToCollect,22000);
  db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,ends_at,paid_amount,status) VALUES('replacement',1,'pc','trf_standard_1h',?,7000,'ACTIVE')").run(new Date(Date.now()+3600000).toISOString());
  db.exec("UPDATE computers SET current_session_id='replacement',status='OCCUPIED' WHERE id='pc'");
  sent.length=0;
  assert.equal(BarLedgerService.executeSessionCheckout({target:'paid',clubId:1,paymentMethod:'CASH'}).amountCollected,22000);
  assert.equal(db.prepare("SELECT current_session_id FROM computers WHERE id='pc'").get().current_session_id,'replacement');
  assert.equal(sent.length,0);
  assert.equal(db.prepare("SELECT SUM(amount) AS total FROM transactions WHERE transaction_type='BAR_SALE'").get().total,22000);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE transaction_type='POSTPAID_SETTLEMENT'").get().n,0);
  assert.equal(db.prepare("SELECT ends_at FROM sessions WHERE id='paid'").get().ends_at,end);
  assert.throws(()=>BarLedgerService.executeSessionCheckout({target:'paid',clubId:1}));
  assert.equal(db.prepare("SELECT payment_status FROM bar_orders WHERE order_number='OLD'").get().payment_status,'PENDING_AT_CHECKOUT');
  assert.equal(db.prepare("SELECT dismissed_at FROM session_end_notices WHERE session_id='paid'").get().dismissed_at,null);
`));
