import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
export function readClubCatalog(databasePath) {
  const db=new DatabaseSync(databasePath,{readOnly:true});
  try {
    return {
      computers:db.prepare('SELECT id,club_id,pc_number,name,ip_address,mac_address,zone,zone_id FROM computers ORDER BY id').all(),
      ...Object.fromEntries(['bar_items','grid_layout','zones','tariffs','tariff_schedules'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]))
    };
  } finally {db.close();}
}
export async function checkClubOperations({ databasePath, localUrl, cloudUrl, cloudToken, cloudClubId, socket }) {
  async function request(url,method='GET',body,token) {
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000)});
    return {status:r.status,body:await r.json()};
  }
  const login=await request(localUrl+'/api/auth/login','POST',{username:'manager',password:'Softech006'});
  assert.equal(login.status,200,JSON.stringify(login.body));
  const token=login.body.token || login.body.accessToken;
  assert.ok(token);
  const api=(route,method='GET',body)=>request(localUrl+route,method,body,token);
  const announcementIds=[];
  for(const message of ['Softech test <img src=x>\nYangi xabar','Restartdan keyin ham saqlansin']){
    const queued=await request(cloudUrl+'/api/telemetry/commands/'+cloudClubId,'POST',{action:'BROADCAST_ANNOUNCEMENT',payload:{message,requireDismiss:true}},cloudToken);
    assert.equal(queued.status,200,JSON.stringify(queued.body));announcementIds.push(queued.body.commandId);
  }
  const existingShift = await api('/api/shifts/current');
  if (!existingShift.body.shift) assert.equal((await api('/api/shifts/current','POST',{action:'OPEN',startCash:50000})).status,201);
  const computers=await api('/api/computers');
  const list=Array.isArray(computers.body)?computers.body:computers.body.computers;
  assert.ok(list?.length,JSON.stringify(computers.body));
  const pc=list.find(x=>x.name==='PC-01')||list[0];
  assert.equal(pc.isOnline, true, 'Handshaken client must be online');
  assert.ok(pc.lastHeartbeat, 'Handshake must persist connection history');
  assert.equal(pc.macAddress, '02:00:00:00:00:01', 'Client handshake automatically saves MAC');
  const added = await api('/api/admin/computers', 'POST', { name: 'Never connected test', pcNumber: 901 });
  assert.equal(added.status, 201, JSON.stringify(added.body));
  assert.equal(added.body.computer.status, 'OFFLINE');
  assert.equal(added.body.computer.isOnline, false);
  const addedId = added.body.computer.id;
  // Missing tariffs must reject single/batch starts before charging or writing sessions.
  const tomorrowDay = (new Date().getDay() || 7) % 7 + 1;
  const tariffRule = {name:'Coverage fixture',start_time:'00:00',end_time:'00:00',price_per_hour:7000,days_of_week:[tomorrowDay]};
  const noCoverage = await api('/api/zones','POST',{name:'Coverage fixture',tariffs:[tariffRule]});
  assert.equal(noCoverage.status,201,JSON.stringify(noCoverage.body));
  const noCoverageDb = new DatabaseSync(databasePath);
  noCoverageDb.prepare('UPDATE computers SET zone_id=? WHERE id=?').run(noCoverage.body.zone.id,addedId);
  for (const [route,body] of [
    ['/api/sessions/start',{computerId:addedId,mode:'hours',durationMinutes:60}],
    ['/api/sessions/start',{computerId:addedId,mode:'postpaid'}],
    ['/api/sessions/batch-start',{computerIds:[addedId],mode:'hours',durationMinutes:60}]
  ]) {
    const result = await api(route,'POST',body);
    assert.equal(result.status,400,JSON.stringify(result.body));
    assert.match(result.body.error,/tarif belgilanmagan/);
  }
  assert.equal(noCoverageDb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE computer_id=?').get(addedId).n,0);
  noCoverageDb.prepare('UPDATE computers SET zone_id=NULL WHERE id=?').run(addedId);
  noCoverageDb.prepare('DELETE FROM tariffs WHERE zone_id=?').run(noCoverage.body.zone.id);
  noCoverageDb.prepare('DELETE FROM zones WHERE id=?').run(noCoverage.body.zone.id);
  noCoverageDb.close();
  // Create/edit/delete uses the same validated rules as pricing.
  for (const bad of [{price_per_hour:0},{price_per_hour:-1},{start_time:'25:00'},{days_of_week:[]}])
    assert.equal((await api('/api/admin/tariff-schedules','POST',{...tariffRule,...bad})).status,400);
  const rule = await api('/api/admin/tariff-schedules','POST',tariffRule);
  assert.equal(rule.status,201,JSON.stringify(rule.body));
  assert.equal((await api('/api/admin/tariff-schedules/'+rule.body.id,'PUT',{...tariffRule,name:'Edited fixture',price_per_hour:9000})).status,200);
  assert.equal((await api('/api/tariff-schedules')).body.find(row=>row.id===rule.body.id).price_per_hour,9000);
  assert.equal((await api('/api/admin/tariff-schedules/'+rule.body.id,'DELETE')).status,200);
  assert.equal((await api('/api/admin/computers/' + addedId, 'PUT', { macAddress: '00:00:00:00:00:00', zone: 'STANDARD' })).status, 400);
  assert.equal((await api('/api/admin/computers/' + addedId, 'PUT', { macAddress: '02-AB-CD-EF-00-07', zone: 'STANDARD' })).status, 200);
  const fixtureDb = new DatabaseSync(databasePath);
  fixtureDb.exec('PRAGMA busy_timeout=5000');
  try { fixtureDb.prepare("UPDATE computers SET status='LOCKED' WHERE id=?").run(addedId); }
  finally { fixtureDb.close(); }
  const refreshed = await api('/api/computers');
  const newPc = (Array.isArray(refreshed.body) ? refreshed.body : refreshed.body.computers).find(row => row.id === addedId);
  assert.equal(newPc.isOnline, false, 'Legacy LOCKED rows must not imply a live connection');
  assert.equal(newPc.lastHeartbeat, null);
  assert.equal(newPc.macAddress, '02:AB:CD:EF:00:07');
  assert.equal((await api('/api/admin/computers/' + addedId, 'DELETE')).status, 200);
  const started=await api('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60,paymentType:'CASH'});
  assert.equal(started.status,201,JSON.stringify(started.body));
  const sessionId=started.body.sessionId, gameAmount=started.body.amount;
  const duplicate=await api('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60});
  assert.ok(duplicate.status>=400,'Duplicate active session must be rejected');
  const item=await api('/api/bar/items','POST',{name:'Test Cola',buyPrice:3000,sellPrice:5000,stockQuantity:10});
  assert.equal(item.status,201,JSON.stringify(item.body));
  const id=item.body.item.id;
  const sale=await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:2}],paymentMethod:'CASH'});
  assert.equal(sale.status,201,JSON.stringify(sale.body));
  const pending=await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}],paymentMethod:'ON_PC_SESSION',computerId:pc.id,sessionId});
  assert.equal(pending.status,201,JSON.stringify(pending.body));
  const preview = await api('/api/sessions/'+sessionId+'/checkout-preview');
  assert.equal(preview.body.barBill,5000,'Context-menu session order must be included in checkout');
  const orderDb = new DatabaseSync(databasePath);
  try {
    const saved = orderDb.prepare('SELECT computer_id, session_id, payment_status FROM bar_orders WHERE session_id=?').get(sessionId);
    const actualPc = orderDb.prepare('SELECT pc_number FROM computers WHERE id=?').get(pc.id);
    assert.equal(saved.computer_id, actualPc.pc_number,'Reports must store the canonical PC number, not digits extracted from its ID');
    assert.equal(saved.payment_status,'PENDING_AT_CHECKOUT');
  } finally { orderDb.close(); }
  assert.ok((await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}],paymentMethod:'ON_PC_SESSION',computerId:pc.id,sessionId:'stale-session'})).status>=400,'An old dialog must not charge a replacement session');
  let report=await api('/api/reports/financial');
  assert.equal(report.status,200,JSON.stringify(report.body));
  assert.equal(report.body.summary.gameRevenue,gameAmount,'Bar cash must not count as game revenue');
  assert.equal(report.body.summary.barRevenue,10000,'Unpaid bar order is not collected revenue');
  assert.equal(report.body.summary.totalRevenue,gameAmount+10000);
  const checkout=await api('/api/sessions/'+sessionId+'/checkout','POST',{paymentMethod:'CARD'});
  assert.equal(checkout.status,200,JSON.stringify(checkout.body));
  assert.equal(checkout.body.amountCollected,5000);
  const again=await api('/api/sessions/'+sessionId+'/checkout','POST',{paymentMethod:'CARD'});
  assert.ok(again.status>=400,'Checkout must not charge twice');
  report=await api('/api/reports/financial');
  assert.equal(report.body.summary.gameRevenue,gameAmount);
  assert.equal(report.body.summary.barRevenue,15000);
  assert.equal(report.body.summary.barProfit,6000);
  assert.equal(report.body.summary.totalRevenue,gameAmount+15000);
  const shift = await api('/api/shifts/current');
  assert.equal(shift.status,200);
  assert.equal(shift.body.shift.systemCash,gameAmount+10000);
  assert.equal(shift.body.shift.systemCard,5000);
  const analytics = await api('/api/reports/analytics');
  assert.equal(analytics.status,200,JSON.stringify(analytics.body));
  const stock=await api('/api/bar/items');
  const products=Array.isArray(stock.body)?stock.body:stock.body.items;
  const product=products.find(x=>x.id===id);
  assert.equal(product.stockQuantity??product.stock_quantity,7);
  const oversell=await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:4},{barItemId:id,quantity:4}],paymentMethod:'CASH'});
  assert.ok(oversell.status>=400,'Repeated item rows must not oversell stock');
  assert.equal((await api('/api/bar/items/'+id,'PUT',{buyPrice:9000})).status,200);
  assert.equal((await api('/api/reports/financial')).body.summary.barProfit,6000,'Past profit must not change when purchase price changes');
  await api('/api/bar/items/'+id,'PUT',{buyPrice:3000});

  const fixture = new DatabaseSync(databasePath);
  fixture.exec('PRAGMA busy_timeout=5000');
  const member = fixture.prepare("SELECT id,balance FROM users WHERE username='gamer1'").get();
  assert.ok(member);
  assert.equal((await api('/api/clients/topup','POST',{userId:member.id,amount:20000,paymentMethod:'CARD'})).status,200);
  assert.equal((await api('/api/clients/topup','POST',{userId:member.id,amount:10000,paymentMethod:'CASH'})).status,200);
  assert.equal((await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}],paymentMethod:'CLIENT_BALANCE',userId:member.id})).status,201);
  assert.equal((await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}],paymentMethod:'CARD'})).status,201);
  const balanceSession=await api('/api/sessions/start','POST',{computerId:pc.id,customerId:member.id,mode:'hours',durationMinutes:60,paymentType:'BALANCE'});
  assert.equal(balanceSession.status,201,JSON.stringify(balanceSession.body));
  fixture.prepare('UPDATE sessions SET started_at=?,ends_at=? WHERE id=?').run(new Date(Date.now()-3600000).toISOString(),new Date(Date.now()).toISOString(),balanceSession.body.sessionId);
  assert.equal((await api('/api/sessions/'+balanceSession.body.sessionId+'/checkout','POST',{paymentMethod:'CASH'})).status,200);
  report=await api('/api/reports/financial');
  const breakdown=report.body.breakdown;
  assert.equal(breakdown.cash,gameAmount+20000);
  assert.equal(breakdown.card,30000);
  assert.equal(breakdown.gameReceipts,gameAmount);
  assert.equal(breakdown.topupReceipts,30000);
  assert.equal(breakdown.receipts.BAR.CASH,10000);
  assert.equal(breakdown.receipts.BAR.CARD,10000);
  assert.equal(breakdown.gameBalance,balanceSession.body.amount);
  assert.equal(breakdown.barBalance,5000);
  assert.equal(report.body.summary.totalRevenue,breakdown.total,'Cash receipt summaries must reconcile');
  assert.equal(report.body.summary.gameRevenue,gameAmount+balanceSession.body.amount);
  assert.equal(fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,member.balance+30000-5000-balanceSession.body.amount);
  const balanceBefore=fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance;
  const badBalanceSession=await api('/api/sessions/start','POST',{computerId:pc.id,customerId:member.id,mode:'amount',amount:10000000,paymentType:'BALANCE'});
  assert.ok(badBalanceSession.status>=400);
  assert.equal(fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,balanceBefore);

  const memberLogin=await api('/api/clients/login-session','POST',{computerId:pc.id,username:'gamer1',password:'gamer123',durationMinutes:60});
  assert.equal(memberLogin.status,200,JSON.stringify(memberLogin.body));
  const liveId=memberLogin.body.sessionId;
  assert.equal(memberLogin.body.durationMinutes,60);
  assert.equal(fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,balanceBefore-memberLogin.body.amount,'Selected minutes are charged immediately');
  assert.equal(fixture.prepare("SELECT COUNT(*) AS n FROM client_transactions WHERE session_id=? AND type='SESSION_DEDUCT'").get(liveId).n,1);
  const otherPc=list.find(x=>x.id!==pc.id);
  if(otherPc) assert.ok((await api('/api/clients/login-session','POST',{computerId:otherPc.id,username:'gamer1',password:'gamer123',durationMinutes:60})).status>=400,'One member cannot play on two PCs at once');
  const past=new Date(Date.now()-120000).toISOString();
  const agreedRates=JSON.parse(fixture.prepare('SELECT prepaid_rate_plan FROM sessions WHERE id=?').get(liveId).prepaid_rate_plan);
  const expectedTwoMinutes=Math.round(agreedRates[0]+agreedRates[1]);
  fixture.prepare('UPDATE sessions SET started_at=?,billing_last_at=? WHERE id=?').run(past,past,liveId);
  const liveClosed=await api('/api/sessions/stop','POST',{computerId:pc.id,paymentType:'CASH'});
  assert.equal(liveClosed.status,200,JSON.stringify(liveClosed.body));
  const billed=fixture.prepare('SELECT total_amount FROM sessions WHERE id=?').get(liveId).total_amount;
  assert.ok(billed>=expectedTwoMinutes && billed<expectedTwoMinutes+5,'Two minutes at the agreed member tariff, not the whole balance: '+billed);
  const remaining=fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance;
  assert.equal(remaining,balanceBefore-billed);
  assert.equal(liveClosed.body.refundAmount,memberLogin.body.amount-billed);
  assert.equal(fixture.prepare("SELECT COUNT(*) AS n FROM client_transactions WHERE session_id=? AND type='REFUND'").get(liveId).n,1);
  const latest=(await api('/api/reports/financial')).body;
  assert.equal(latest.summary.totalRevenue,breakdown.total,'Prepaid balance game and refund do not change cash in drawer');
  assert.equal(latest.breakdown.gameBalance,breakdown.gameBalance+billed);
  assert.ok((await api('/api/sessions/stop','POST',{computerId:pc.id})).status>=400);
  assert.equal(fixture.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,remaining);

  const kioskLogin=new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Member WS login timed out'));},2500);
    const listener=raw=>{const msg=JSON.parse(raw);if(msg.type==='MEMBER_LOGIN_SUCCESS'){clearTimeout(timer);socket.off('message',listener);resolve(msg.payload);}};
    socket.on('message',listener);
  });
  socket.send(JSON.stringify({type:'CLIENT_MEMBER_LOGIN',payload:{username:'gamer1',password:'gamer123',durationMinutes:60}}));
  const kioskSession={body:await kioskLogin};
  assert.equal(kioskSession.body.durationMinutes,60);
  assert.equal(kioskSession.body.clientBalance,kioskSession.body.balance);
  async function kioskOrder(paymentMethod, requestId) {
    const ack=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Order acknowledgement timed out'));},2500);
      const listener=raw=>{const msg=JSON.parse(raw);if(msg.type==='BAR_ORDER_RECEIVED'){clearTimeout(timer);socket.off('message',listener);resolve(msg.payload);}};
      socket.on('message',listener);
    });
    socket.send(JSON.stringify({type:'CLIENT_BAR_ORDER',payload:{items:[{id,quantity:1}],paymentMethod,requestId}}));
    return ack;
  }
  for(const paymentMethod of ['CASH_TO_ADMIN','FROM_MEMBER_BALANCE']) {
    const requestId='request-'+paymentMethod.replaceAll('_','-');
    const order=await kioskOrder(paymentMethod,requestId);
    const replay=await kioskOrder(paymentMethod,requestId);
    assert.equal(replay.id,order.id,'Retry must return original order, not create another sale');
    assert.equal((await api('/api/bar/orders/confirm','POST',{orderId:order.id})).status,200);
    assert.ok((await api('/api/bar/orders/confirm','POST',{orderId:order.id})).status>=400);
  }
  const kioskReport=(await api('/api/reports/financial')).body;
  assert.equal(kioskReport.breakdown.barBalance,10000);
  assert.equal(kioskReport.breakdown.receipts.BAR.CASH,15000);
  const kioskPreview=await api('/api/sessions/'+kioskSession.body.sessionId+'/checkout-preview');
  assert.equal(kioskPreview.body.barBill,0,'Cash and balance orders already paid must not be collected again');
  assert.equal((await api('/api/sessions/stop','POST',{computerId:pc.id})).status,200);
  assert.ok((await api('/api/sessions/batch-start','POST',{computerIds:[pc.id,pc.id],mode:'HOURS'})).status>=400,'Duplicate PC in batch is rejected atomically');
  const count=fixture.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
  assert.ok((await api('/api/sessions/batch-start','POST',{computerIds:[pc.id,'pc_9999'],mode:'HOURS'})).status>=400);
  assert.equal(fixture.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,count,'Invalid batch must not create partial sessions');
  fixture.close();
  const searched=await api('/api/customers?q=gamer1');
  assert.equal(searched.status,200,JSON.stringify(searched.body));
  assert.equal(searched.body.find(c=>c.id===member.id)?.name,'gamer1','Cashier search must use the same account as kiosk login');
  assert.equal((await api('/api/clients/topup','POST',{userId:member.id,amount:200000,paymentMethod:'CARD'})).status,200);
  for(const batch of [false,true])for(const paymentType of ['CASH','BALANCE']){
    const memberStart=await api(batch?'/api/sessions/batch-start':'/api/sessions/start','POST',{
      ...(batch?{computerIds:[pc.id]}:{computerId:pc.id}),mode:'client',customerId:member.id,durationMinutes:120,amount:1,paymentType});
    assert.equal(memberStart.status,201,JSON.stringify(memberStart.body));
    const auditDb=new DatabaseSync(databasePath,{readOnly:true});
    const row=auditDb.prepare("SELECT * FROM sessions WHERE computer_id=? AND status='ACTIVE'").get(pc.id);auditDb.close();
    const authoritative=(await api('/api/tariffs/calculate','POST',{computerId:pc.id,durationHours:2,startTime:row.started_at})).body.price;
    assert.equal(row.total_amount,authoritative,'Single and batch member starts must ignore stale/browser supplied prices');
    if(paymentType==='BALANCE')assert.equal(JSON.parse(row.prepaid_rate_plan).length,120,'Cashier-opened member session freezes its agreed rates for refunds');
    assert.equal((await api('/api/sessions/stop','POST',{computerId:pc.id})).status,200);
  }
  const second=await api('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60});
  assert.equal(second.status,201,JSON.stringify(second.body));
  const received = new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Client order not received'));},3000);
    const listener=raw=>{const msg=JSON.parse(raw);if(msg.type==='BAR_ORDER_RECEIVED'){clearTimeout(timer);socket.off('message',listener);resolve(msg.payload);}};
    socket.on('message',listener);
  });
  socket.send(JSON.stringify({type:'CLIENT_BAR_ORDER',payload:{items:[{id,quantity:1,price:1}],totalAmount:1,pcNumber:'PC-99'}}));
  const clientOrder=await received;
  assert.equal(clientOrder.totalAmount,5000,'Client cannot choose product price or another PC');
  const beforeConfirm=await api('/api/sessions/'+second.body.sessionId+'/checkout-preview');
  assert.equal(beforeConfirm.body.barBill,0,'Unconfirmed client order must not be charged');
  const confirmed=await api('/api/bar/orders/confirm','POST',{orderId:clientOrder.id});
  assert.equal(confirmed.status,200,JSON.stringify(confirmed.body));
  assert.ok((await api('/api/bar/orders/confirm','POST',{orderId:clientOrder.id})).status>=400,'Repeated confirm must not deduct stock twice');
  assert.ok((await api('/api/bar/orders/reject','POST',{orderId:clientOrder.id})).status>=400,'Confirmed sale cannot disappear through reject');
  const afterConfirm=await api('/api/sessions/'+second.body.sessionId+'/checkout-preview');
  assert.equal(afterConfirm.body.barBill,5000);
  const debtDb=new DatabaseSync(databasePath);
  debtDb.exec('PRAGMA busy_timeout=5000');
  debtDb.prepare("UPDATE sessions SET status='COMPLETED',ends_at=CURRENT_TIMESTAMP WHERE id=?").run(second.body.sessionId);
  debtDb.prepare("UPDATE computers SET status='LOCKED',current_session_id=NULL WHERE id=?").run(pc.id);
  assert.ok((await api('/api/reports/financial')).body.breakdown.rows.some(r=>r.category==='BAR_PENDING' && r.orderId===clientOrder.id));
  assert.equal((await api('/api/bar/orders/'+clientOrder.id+'/pay','POST',{paymentMethod:'CARD'})).status,200);
  assert.ok((await api('/api/bar/orders/'+clientOrder.id+'/pay','POST',{paymentMethod:'CARD'})).status>=400,'Debt payment must not repeat');
  assert.equal(debtDb.prepare('SELECT payment_status FROM bar_orders WHERE id=?').get(clientOrder.id).payment_status,'PAID');
  debtDb.close();
  // Scheduled expiry retains a recoverable, dismissible notice and a collectible bar bill.
  const expiring=await api('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60,paymentType:'CASH'});
  assert.equal(expiring.status,201,JSON.stringify(expiring.body));
  const expiryId=expiring.body.sessionId;
  assert.equal((await api('/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}],paymentMethod:'ON_PC_SESSION',computerId:pc.id,sessionId:expiryId})).status,201);
  const expiryDb=new DatabaseSync(databasePath);expiryDb.exec('PRAGMA busy_timeout=5000');
  expiryDb.prepare('UPDATE sessions SET started_at=?,ends_at=? WHERE id=?').run(new Date(Date.now()-3601000).toISOString(),new Date(Date.now()-1000).toISOString(),expiryId);
  let notices=[];
  for(let i=0;i<90;i++){
    notices=(await api('/api/session-end-notices')).body.notices||[];
    if(notices.some(n=>n.sessionId===expiryId))break;
    await new Promise(r=>setTimeout(r,100));
  }
  const notice=notices.find(n=>n.sessionId===expiryId);assert.ok(notice);assert.equal(notice.barDebt,5000);assert.equal(notice.barSummary,'1 ta Test Cola');
  assert.equal((await api('/api/session-end-notices/'+expiryId+'/dismiss','POST',{})).status,200);
  assert.ok(!(await api('/api/session-end-notices')).body.notices.some(n=>n.sessionId===expiryId));
  assert.equal(expiryDb.prepare('SELECT payment_status FROM bar_orders WHERE session_id=?').get(expiryId).payment_status,'PENDING_AT_CHECKOUT','Dismissing is not payment');
  assert.equal((await api('/api/sessions/'+expiryId+'/checkout','POST',{paymentMethod:'CASH'})).body.amountCollected,5000);
  expiryDb.close();
  // A newly created cashier account must work through the actual kiosk WebSocket.
  const createdMember=await api('/api/admin/users','POST',{username:'fresh-member',password:'fresh-password',role:'client',balance:0});
  assert.equal(createdMember.status,201,JSON.stringify(createdMember.body));
  const memberId=createdMember.body.user.id;
  function kioskMessage(type, action) {
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{socket.off('message',listener);reject(new Error('Missing kiosk '+type));},4000);
      const listener=raw=>{const message=JSON.parse(raw);if(message.type===type){clearTimeout(timer);socket.off('message',listener);resolve(message.payload);}};
      socket.on('message',listener);action();
    });
  }
  const signIn=password=>socket.send(JSON.stringify({type:'CLIENT_MEMBER_LOGIN',payload:{username:'fresh-member',password,durationMinutes:60}}));
  assert.match((await kioskMessage('MEMBER_LOGIN_FAILED',()=>signIn('wrong-password'))).error,/Login/);
  assert.match((await kioskMessage('MEMBER_LOGIN_FAILED',()=>signIn('fresh-password'))).error,/balans/);
  assert.equal((await api('/api/clients/topup','POST',{userId:memberId,amount:50000,paymentMethod:'CASH'})).status,200);
  const freshSession=await kioskMessage('MEMBER_LOGIN_SUCCESS',()=>signIn('fresh-password'));
  const freshPc=(await api('/api/computers')).body.find(p=>p.id===pc.id);
  assert.equal(freshPc.activeSession.isMember,true);assert.equal(freshPc.activeSession.memberId,memberId);
  assert.equal(freshPc.activeSession.customerName,'fresh-member');assert.equal(freshPc.activeSession.memberBalance,freshSession.balance);
  assert.match((await kioskMessage('MEMBER_LOGIN_FAILED',()=>signIn('fresh-password'))).error,/allaqachon/);
  const selfStop=await kioskMessage('STOP_SESSION',()=>socket.send(JSON.stringify({type:'CLIENT_MEMBER_LOGOUT',payload:{sessionId:freshSession.sessionId}})));
  assert.equal(selfStop.memberSummary.username,'fresh-member');assert.equal(selfStop.memberSummary.accountId,memberId);
  assert.ok(selfStop.memberSummary.balance>=freshSession.balance);assert.equal(selfStop.barNotice,null);
  assert.equal((await api('/api/computers')).body.find(p=>p.id===pc.id).activeSession,null);
  const nextSession=await kioskMessage('MEMBER_LOGIN_SUCCESS',()=>signIn('fresh-password'));
  const memberPreview=(await api('/api/sessions/'+nextSession.sessionId+'/checkout-preview')).body;
  assert.equal(memberPreview.isMember,true);assert.equal(memberPreview.amountToCollect,0);assert.ok(memberPreview.member.refundAmount>0);
  let closeResponse;
  const adminStop=await kioskMessage('STOP_SESSION',()=>{closeResponse=api('/api/sessions/stop','POST',{sessionId:nextSession.sessionId});});
  const closedMember=await closeResponse;assert.equal(closedMember.status,200);
  assert.deepEqual(adminStop.memberSummary,closedMember.body.memberSummary);
  assert.equal(closedMember.body.amountCollected,0);assert.equal(adminStop.barNotice,undefined);
  assert.equal((await api('/api/computers')).body.find(p=>p.id===pc.id).activeSession,null);
  assert.ok((await api('/api/sessions/stop','POST',{sessionId:nextSession.sessionId})).status>=400,'Repeated close must not refund twice');
  // Two different rooms must quote and charge their own rates, not a caller-supplied amount.
  const batchDb=new DatabaseSync(databasePath);batchDb.exec('PRAGMA busy_timeout=5000');
  for(const [num,rate] of [[910,7000],[911,10000]]){
    batchDb.prepare('INSERT INTO zones(id,club_id,name) VALUES(?,1,?)').run(num,'Quote '+num);
    batchDb.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,price_per_hour,type,start_time,end_time) VALUES(?,1,?,'Quote',?,'HOURLY','00:00','00:00')").run('quote-'+num,num,rate);
    batchDb.prepare("INSERT INTO computers(id,club_id,pc_number,name,zone_id,status) VALUES(?,1,?,?,?,'ONLINE')").run('quote-pc-'+num,num,'Quote-'+num,num);
  }
  for(const [num,amount] of [[910,14000],[911,20000]])assert.equal((await api('/api/tariffs/calculate','POST',{computerId:'quote-pc-'+num,durationHours:2})).body.price,amount);
  const batch=await api('/api/sessions/batch-start','POST',{computerIds:['quote-pc-910','quote-pc-911'],mode:'hours',durationMinutes:120,amount:4900});
  assert.equal(batch.status,201,JSON.stringify(batch.body));assert.equal(batch.body.totalAmount,34000);
  for(const row of batch.body.results){
    assert.equal(row.durationMinutes,120);
    batchDb.prepare('DELETE FROM transactions WHERE session_id=?').run(row.sessionId);
    batchDb.prepare('DELETE FROM sessions WHERE id=?').run(row.sessionId);
    batchDb.prepare('DELETE FROM computers WHERE id=?').run(row.computerId);
  }
  batchDb.exec("DELETE FROM tariffs WHERE id IN ('quote-910','quote-911'); DELETE FROM zones WHERE id IN (910,911)");batchDb.close();
  assert.equal((await api('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:60})).status,201);
  const proof=JSON.parse(readFileSync(path.join(path.dirname(databasePath),'data/softech_license.sig'),'utf8'));
  const commandIds=[];
  for(const commandType of ['FORCE_UPDATE','RESTART_SERVER']) {
    const route=cloudUrl+'/api/telemetry/commands/'+cloudClubId;
    assert.equal((await request(route,'POST',{commandType})).status,401);
    const queued=await request(route,'POST',{commandType,payload:{force:true}},cloudToken);
    assert.equal(queued.status,200,JSON.stringify(queued.body));assert.ok(queued.body.commandId);commandIds.push(queued.body.commandId);
  }
  const commandDelivery=await request(cloudUrl+'/api/telemetry/heartbeat','POST',{clubId:cloudClubId,signedLicense:proof});
  assert.equal(commandDelivery.status,200);
  for(const id of commandIds)assert.ok(commandDelivery.body.signedCommands.some(c=>c.payload.id===id&&c.signature));
  // Simulate a failed installation acknowledgement; no real PC is restarted by this HTTP test.
  await request(cloudUrl+'/api/telemetry/heartbeat','POST',{clubId:cloudClubId,signedLicense:proof,commandResults:commandIds.map(id=>({id,status:'FAILED',message:'Isolated fixture: install denied'}))});
  const commandHistory=await request(cloudUrl+'/api/telemetry/commands/history/'+cloudClubId,'GET',undefined,cloudToken);
  assert.equal(commandHistory.status,200);
  for(const id of commandIds){const row=commandHistory.body.history.find(r=>r.id===id);assert.equal(row.status,'FAILED');assert.match(row.payload.result.message,/Isolated fixture/);}
  assert.equal((await request(cloudUrl+'/api/telemetry/heartbeat','POST',{clubId:cloudClubId,todayRevenue:999999})).status,401,'Club ID alone is not telemetry authentication');
  const telemetry=await request(cloudUrl+'/api/telemetry/heartbeat','POST',{clubId:cloudClubId,signedLicense:proof,todayRevenue:12345,barRevenue:2345,onlinePcsCount:1,occupiedPcsCount:1});
  assert.equal(telemetry.status,200,JSON.stringify(telemetry.body));
  const messages=[];const listener=raw=>messages.push(JSON.parse(raw));socket.on('message',listener);
  const catalogBeforeBan=readClubCatalog(databasePath);
  assert.ok(catalogBeforeBan.computers.length>0 && catalogBeforeBan.bar_items.length>0);
  const ban=await request(cloudUrl+'/api/telemetry/kill-switch/'+cloudClubId,'POST',{action:'LOCK',reason:'Isolated test ban'},cloudToken);
  assert.equal(ban.status,200,JSON.stringify(ban.body));
  let status;
  for(let i=0;i<90;i++){status=await request(localUrl+'/api/license/status');if(!status.body.isOperational)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(status.body.isOperational,false,'Ban must reach server');
  assert.ok(messages.some(m=>m.type==='EMERGENCY_LOCKDOWN'),'Ban must reach connected client');
  let unread;
  for(let i=0;i<350;i++){unread=await api('/api/cloud-announcements');if(unread.body.notices?.length===2)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(unread.status,200,JSON.stringify(unread.body));assert.deepEqual(unread.body.notices.map(n=>n.id),announcementIds);
  assert.equal(unread.body.notices[0].message,'Softech test <img src=x>\nYangi xabar');
  assert.equal((await request(localUrl+'/api/cloud-announcements')).status,401);
  assert.equal((await request(localUrl+'/api/cloud-announcements/'+announcementIds[0]+'/dismiss','POST')).status,401);
  assert.equal((await api('/api/cloud-announcements/'+announcementIds[0]+'/dismiss','POST')).status,200);
  assert.deepEqual((await api('/api/cloud-announcements')).body.notices.map(n=>n.id),[announcementIds[1]]);
  console.log('PASS selected-club signed announcement delivery and authenticated dismissal, including blocked license');
  for(const [route,method,body] of [['/api/sessions/start','POST',{computerId:pc.id}],['/api/bar/orders','POST',{items:[{barItemId:id,quantity:1}]}],['/api/reports/financial','GET']]){
    assert.equal((await api(route,method,body)).status,403,'Banned API '+route);
  }
  socket.off('message',listener);
  assert.deepEqual(readClubCatalog(databasePath),catalogBeforeBan,'Blocking must preserve PCs, inventory, layouts and tariffs');
  return { token, gameAmount, sessionId:second.body.sessionId, catalogBeforeBan };
}
