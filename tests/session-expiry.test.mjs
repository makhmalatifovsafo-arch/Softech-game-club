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
    import {calculateFromDurationHours,calculateIntervalPrice,calculateTimeFromAmount,getActiveRateForMoment,resolveZoneIdForComputer} from './src/services/pricingEngine.js';
    import {SessionScheduler} from './src/services/sessionScheduler.js';
    import {ClientManager} from './src/services/clientManager.js';
    import {BarLedgerService} from './src/services/barLedgerService.js';
    import {ProtocolDispatcher} from './src/handlers/protocolDispatcher.js';
    import {startMemberSession} from './src/services/memberBilling.js';
    import {clientSessionState,postpaidGameBill} from './src/services/clientSessionState.js';
    import {hashPassword} from './src/auth.js';
    try { ${body} } finally {db.close();}`);
  const result=spawnSync(process.execPath,['case.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test'},windowsHide:true,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
}
test('uncovered time rejects quotes instead of falling back to packages or another hourly rate',()=>run(`
  db.exec("DELETE FROM tariff_schedules; INSERT INTO zones(id,club_id,name) VALUES(90,1,'Test room')");
  const add=db.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,price_per_hour,type,start_time,end_time) VALUES(?,1,90,?,?,?,?,?)");
  add.run('a-night','Night package',0,'NIGHT','17:00','10:00');
  add.run('b-day','Day',7000,'HOURLY','10:00','17:00');
  for(const time of ['10:00','15:00']){
    const result=calculateFromDurationHours(new Date('2026-11-12T'+time+':00'),2,false,1,90);
    assert.equal(result.totalAmount,14000,time);assert.equal(result.totalMinutes,120);
  }
  for (const time of ['16:18','16:36','17:30']) assert.throws(()=>calculateFromDurationHours(new Date('2026-11-12T'+time+':00'),2,false,1,90), /tarif belgilanmagan/);
  assert.throws(()=>calculateTimeFromAmount(new Date('2026-11-12T16:36:00'),14000,false,1,90), /17:00.*tarif belgilanmagan/);
  assert.throws(()=>calculateFromDurationHours(new Date('2026-11-12T16:59:30'),1/60,false,1,90), /17:00.*tarif belgilanmagan/);
  assert.equal(calculateIntervalPrice(new Date('2026-11-12T16:59:30'),new Date('2026-11-12T17:00:00'),false,1,90).totalAmount,58);
  assert.equal(calculateTimeFromAmount(new Date('2026-11-12T16:00:00'),7000,false,1,90).totalMinutes,60);
  add.run('c-evening','Evening',10000,'HOURLY','17:00','10:00');
  assert.equal(calculateFromDurationHours(new Date('2026-11-12T16:00:00'),2,false,1,90).totalAmount,17000);
  db.prepare("INSERT INTO tariff_schedules(club_id,name,days_of_week,start_time,end_time,price_per_hour) VALUES(1,'Only day','[1,2,3,4,5,6,7]','10:00','17:00',7000)").run();
  assert.throws(()=>calculateFromDurationHours(new Date('2026-11-12T16:36:00'),2,false,1), /17:00.*tarif belgilanmagan/);
  assert.equal(getActiveRateForMoment(new Date('2026-11-12T17:30:00'),false,1).configured,false);
  assert.throws(()=>calculateFromDurationHours(new Date(),Infinity));
`));

test('VIP remains open until cashier checkout and closes without bar-reminder windows',()=>run(`
  db.prepare("INSERT INTO computers(id,club_id,pc_number,name,current_session_id,status) VALUES('vip-pc',1,8,'VIP-8','vip','OCCUPIED')").run();
  db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,status,notes) VALUES('vip',1,'vip-pc','trf_standard_1h',?,?,0,'ACTIVE','POSTPAID')")
    .run(new Date(Date.now()-3600000).toISOString(),new Date(Date.now()-1000).toISOString());
  db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status) VALUES(1,'VIP-COLA',8,'vip',10000,'PENDING_AT_CHECKOUT')").run();
  const sent=[],broadcast=[];ClientManager.send=(pc,type,payload)=>sent.push({pc,type,payload});ClientManager.broadcast=(type,payload)=>broadcast.push({type,payload});
  const socket={};ClientManager.socketToPcId.set(socket,'vip-pc');
  SessionScheduler.checkActiveSessions();SessionScheduler.expireSession({id:'vip'});
  ProtocolDispatcher.handleClientLogout(socket,{});
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='vip'").get().status,'ACTIVE');
  assert.ok(sent.every(m=>['CLIENT_LOGOUT_REJECTED','SESSION_INFO'].includes(m.type)),'VIP must not receive timed expiry or client-logout STOP');
  const preview=BarLedgerService.getSessionCheckoutPreview('vip',1);
  assert.ok(preview.gameBill>0);assert.equal(preview.barBill,10000);
  const receipt=BarLedgerService.executeSessionCheckout({target:'vip',clubId:1,paymentMethod:'CASH'});
  assert.equal(receipt.amountCollected,preview.gameBill+10000);
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='vip'").get().status,'COMPLETED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_end_notices').get().n,0);
  assert.ok(sent.some(m=>m.type==='STOP_SESSION'));assert.ok(sent.some(m=>m.type==='LOCK_SCREEN'));
  assert.ok(sent.every(m=>!m.payload.barNotice));
  assert.ok(broadcast.every(m=>m.type!=='SESSION_EXPIRED_WITH_BAR_DEBT'));
`));

test('account login then client logout notifies both screens once, refunds game balance and leaves bar debt collectible',()=>run(`
  db.exec("UPDATE tariff_schedules SET price_per_hour=7000,days_of_week='[1,2,3,4,5,6,7]',start_time='00:00',end_time='00:00'");
  db.prepare("INSERT INTO users(club_id,username,password_hash,role,permissions,balance) VALUES(1,'member-notice',?,'client','[]',50000)").run(hashPassword('fixture-password'));
  const uid=db.prepare("SELECT id FROM users WHERE username='member-notice'").get().id;
  db.prepare("INSERT INTO computers(id,club_id,pc_number,name,status) VALUES('member-pc',1,9,'PC-9','ONLINE')").run();
  const opened=startMemberSession('member-pc','member-notice','fixture-password',60);
  const sid=opened.sessionId;
  db.prepare('UPDATE sessions SET started_at=?,ends_at=? WHERE id=?').run(new Date(Date.now()-1800000).toISOString(),new Date(Date.now()+1800000).toISOString(),sid);
  const order=db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status) VALUES(1,'MEMBER-COLA',9,?,10000,'PENDING_AT_CHECKOUT')").run(sid).lastInsertRowid;
  db.prepare("INSERT INTO bar_order_items(order_id,bar_item_id,item_name,quantity,unit_price,total_price) VALUES(?,1,'Cola',1,10000,10000)").run(order);
  const sent=[],broadcast=[];ClientManager.send=(pc,type,payload)=>sent.push({pc,type,payload});ClientManager.broadcast=(type,payload)=>broadcast.push({type,payload});
  const socket={};ClientManager.socketToPcId.set(socket,'member-pc');
  ProtocolDispatcher.handleMessage(socket,JSON.stringify({type:'CLIENT_MEMBER_LOGOUT',payload:{pcNumber:'PC-9'}}));
  const notice=sent.find(m=>m.type==='STOP_SESSION').payload.barNotice;
  assert.equal(notice.reason,'LOGOUT');assert.equal(notice.barDebt,10000);assert.equal(notice.barSummary,'1 ta Cola');
  assert.equal(notice.customerName,'member-notice');assert.equal(notice.durationMinutes,30);
  assert.equal(broadcast.filter(m=>m.type==='SESSION_EXPIRED_WITH_BAR_DEBT').length,1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_end_notices WHERE session_id=?').get(sid).n,1);
  const refund=db.prepare("SELECT SUM(amount) AS amount FROM client_transactions WHERE session_id=? AND type='REFUND'").get(sid).amount;
  assert.ok(refund>3400&&refund<=3500);const balance=db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance;
  const summary=sent.find(m=>m.type==='STOP_SESSION').payload.memberSummary;
  assert.equal(summary.balance,balance);assert.equal(summary.refundAmount,refund);assert.equal(summary.username,'member-notice');assert.equal(summary.barDebt,10000);
  assert.equal(summary.gameAmount,7000-refund);assert.equal(summary.playedMinutes,30);assert.equal(summary.password,undefined);
  ProtocolDispatcher.handleClientLogout(socket,{});
  assert.equal(sent.filter(m=>m.type==='STOP_SESSION').length,1);assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance,balance);
  assert.equal(BarLedgerService.executeSessionCheckout({target:sid,clubId:1}).amountCollected,10000);
  assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(uid).balance,balance,'Cash bar collection must not deduct the member game balance again');
  const second=startMemberSession('member-pc','member-notice','fixture-password',60);
  ProtocolDispatcher.handleClientLogout(socket,{sessionId:sid});
  assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(second.sessionId).status,'ACTIVE','Stale logout must not close the new session');
  db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status) VALUES(1,'ALREADY-PAID',9,?,10000,'PAID')").run(second.sessionId);
  sent.length=0;ProtocolDispatcher.handleClientLogout(socket,{});
  assert.equal(sent.find(m=>m.type==='STOP_SESSION').payload.barNotice,null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_end_notices WHERE session_id=?').get(second.sessionId).n,0);
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

test('empty schedules remain empty after restart; member balances and session records stay untouched',()=>run(`
  db.exec('DELETE FROM tariff_schedules');initDatabase();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tariff_schedules').get().n,0);
  assert.equal(getActiveRateForMoment(new Date()).pricePerHour,null);
  assert.throws(()=>calculateFromDurationHours(new Date(),1), /tarif belgilanmagan/);
  db.prepare("INSERT INTO computers(id,club_id,name,pc_number) VALUES('missing',1,'Missing',99)").run();
  const before=db.prepare("SELECT balance FROM users WHERE username='gamer1'").get().balance;
  assert.throws(()=>startMemberSession('missing','gamer1','gamer123',60), /tarif belgilanmagan/);
  assert.equal(db.prepare("SELECT balance FROM users WHERE username='gamer1'").get().balance,before);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE computer_id='missing'").get().n,0);
`));

test('24-hour rules include 23:59 and overnight rules follow their starting weekday',()=>run(`
  db.exec("DELETE FROM tariff_schedules; INSERT INTO tariff_schedules(club_id,name,days_of_week,start_time,end_time,price_per_hour) VALUES(1,'All day','[1,2,3,4,5,6,7]','00:00','00:00',7000)");
  assert.equal(calculateFromDurationHours(new Date('2026-11-12T23:59:00'),2).totalAmount,14000);
  db.exec("UPDATE tariff_schedules SET days_of_week='[5]',start_time='22:00',end_time='06:00'");
  assert.equal(calculateFromDurationHours(new Date('2026-11-13T23:00:00'),6).totalAmount,42000);
  assert.throws(()=>calculateFromDurationHours(new Date('2026-11-13T05:00:00'),1), /tarif belgilanmagan/);
  assert.throws(()=>calculateFromDurationHours(new Date('2026-11-14T05:00:00'),2), /06:00.*tarif belgilanmagan/);
`));

test('cashier prepaid and cashier account sessions reject client logout, while expiry still closes them',()=>run(`
  const sent=[];ClientManager.send=(pc,type,payload)=>sent.push({pc,type,payload});ClientManager.broadcast=()=>{};
  const user=db.prepare("SELECT id FROM users WHERE username='gamer1'").get();
  for (const [id,notes] of [['cash','hours'],['cash-member','CLIENT_BALANCE_PREPAID:'+user.id]]) {
    db.prepare("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES(?,1,?,?,'OCCUPIED')").run(id,id,id==='cash'?91:92);
    db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,user_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES(?,1,?,'trf_standard_1h',?,?,?,14000,14000,'ACTIVE',?)")
      .run(id,id,user.id,new Date(Date.now()-600000).toISOString(),new Date(Date.now()+600000).toISOString(),notes);
    const socket={};ClientManager.socketToPcId.set(socket,id);
    const state=clientSessionState(id);
    assert.equal(state.canSelfClose,false);assert.equal(state.sessionInfo.gameAmount,14000);
    ProtocolDispatcher.handleClientLogout(socket,{sessionId:id,canSelfClose:true});
    assert.equal(db.prepare('SELECT status FROM sessions WHERE id=?').get(id).status,'ACTIVE');
    assert.ok(sent.some(m=>m.type==='CLIENT_LOGOUT_REJECTED'&&m.pc===id));
    db.prepare('UPDATE sessions SET ends_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),id);
  }
  SessionScheduler.checkActiveSessions();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE status='ACTIVE'").get().n,0);
`));

test('self-service origin survives reconnect and Postpaid widget amount matches cashier schedule/custom bill',()=>run(`
  db.prepare("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('self',1,'Self',91,'ONLINE')").run();
  const opened=startMemberSession('self','gamer1','gamer123',30);
  assert.equal(opened.canSelfClose,true);initDatabase();assert.equal(clientSessionState(opened.sessionId).canSelfClose,true);
  assert.equal(db.prepare('SELECT client_self_service FROM sessions WHERE id=?').get(opened.sessionId).client_self_service,1);
  db.exec("UPDATE tariff_schedules SET start_time='00:00',end_time='00:00',days_of_week='[1,2,3,4,5,6,7]',price_per_hour=7000");
  db.prepare("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('post',1,'Post',92,'OCCUPIED')").run();
  const now=Date.now(),start=new Date(now-7200000).toISOString();
  db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,status,notes) VALUES('post',1,'post','trf_standard_1h',?,?,'ACTIVE','BATCH_VIP')").run(start,new Date(now+86400000).toISOString());
  const state=clientSessionState('post',now);
  assert.equal(state.remainingSeconds,-1);assert.equal(state.canSelfClose,false);
  assert.equal(state.sessionInfo.gameAmount,14000);assert.equal(state.sessionInfo.asOf-state.sessionInfo.startedAt,7200000);
  assert.equal(BarLedgerService.getSessionCheckoutPreview('post',1).gameBill,state.sessionInfo.gameAmount);
  db.prepare("UPDATE club_settings SET vip_pricing_mode='CUSTOM',vip_custom_price=9000 WHERE club_id=1").run();
  assert.equal(clientSessionState('post',now).sessionInfo.gameAmount,18000);
  db.prepare("UPDATE club_settings SET vip_pricing_mode='SCHEDULE' WHERE club_id=1").run();
  db.exec('DELETE FROM tariff_schedules');
  assert.equal(clientSessionState('post',now).sessionInfo.gameAmount,null,'Missing tariffs must never display a made-up zero bill');
  assert.ok(clientSessionState('post',now).sessionInfo.billingError);
  const sent=[];ClientManager.send=(pc,type,payload)=>sent.push({pc,type,payload});ClientManager.broadcast=()=>{};
  SessionScheduler.lastSyncMinute=-1;SessionScheduler.checkActiveSessions();
  assert.ok(sent.some(m=>m.pc==='post'&&m.type==='SESSION_INFO'&&m.payload.isPostpaid));
  assert.equal(db.prepare("SELECT status FROM sessions WHERE id='post'").get().status,'ACTIVE');
`));
