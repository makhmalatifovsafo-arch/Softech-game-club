import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildServerAnalytics } from '../NetCafeServer/src/services/analyticsService.js';
import { initializeTransferHistory, recordSessionTransfer } from '../NetCafeServer/src/services/sessionTransferHistory.js';

// Local dates keep the club's reporting day identical on Windows CI and in Tashkent.
const moment = (hour, minute=0, day=16) => new Date(2026,10,day,hour,minute);
const iso = (...args) => moment(...args).toISOString();
function fixture(t) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`
    CREATE TABLE computers(id TEXT PRIMARY KEY,club_id INTEGER,pc_number INTEGER,name TEXT,zone TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,club_id INTEGER,computer_id TEXT,customer_name TEXT,started_at TEXT,ends_at TEXT,status TEXT,notes TEXT,prepaid_rate_plan TEXT);
    CREATE TABLE transactions(id TEXT PRIMARY KEY,club_id INTEGER,session_id TEXT,amount REAL,payment_type TEXT,payment_method TEXT,transaction_type TEXT,notes TEXT,created_at TEXT);
    CREATE TABLE client_transactions(id INTEGER PRIMARY KEY,club_id INTEGER,user_id INTEGER,session_id TEXT,amount REAL,type TEXT,payment_method TEXT,category TEXT,created_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);
    CREATE TABLE bar_orders(id INTEGER PRIMARY KEY,club_id INTEGER,order_number TEXT,computer_id INTEGER,session_id TEXT,user_id INTEGER,total_amount REAL,payment_status TEXT,payment_method TEXT,approval_status TEXT,created_at TEXT,paid_at TEXT);
    CREATE TABLE bar_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,bar_item_id INTEGER,item_name TEXT,quantity INTEGER,unit_price REAL,total_price REAL);
    CREATE TABLE bar_items(id INTEGER PRIMARY KEY,category TEXT);
    CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,club_id INTEGER,action_type TEXT,details TEXT);
    INSERT INTO computers VALUES('a',7,1,'PC-1','STANDARD'),('b',7,2,'PC-2','VIP'),('c',7,3,'PC-3','STANDARD'),('other',8,1,'Other club','VIP');
    INSERT INTO users VALUES(1,'member');
  `);
  initializeTransferHistory(db);
  let sequence=0;
  function session(id='s', {pc='b',start=iso(9),end=iso(10),notes='hours | TRANSFER: PC-1->PC-2',club=7,plan=null}={}) {
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run(id,club,pc,'Guest',start,end,'COMPLETED',notes,plan);
    return db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
  }
  function move(id,from,to,at,amount) {
    const pc=db.prepare('SELECT * FROM computers WHERE id=?');
    recordSessionTransfer(db,{session:db.prepare('SELECT * FROM sessions WHERE id=?').get(id),from:pc.get(from),to:pc.get(to),now:at.getTime(),gameAmount:amount});
  }
  function payment(id,amount,{method='CASH',at=iso(9),club=7,bar=false}={}) {
    if(method==='BALANCE') db.prepare('INSERT INTO client_transactions VALUES(?,?,1,?,?,?,\'BALANCE\',\'GAME\',?)')
      .run(++sequence,club,id,Math.abs(amount),amount<0?'REFUND':'SESSION_DEDUCT',at);
    else db.prepare('INSERT INTO transactions VALUES(?,?,?,?,?,?,?,?,?)').run('tx'+(++sequence),club,id,amount,method,method,
      bar?'BAR_SALE':amount<0?'REFUND':'PREPAID',bar?'BAR_SALE:1':'',at);
  }
  const report=(days=1,now=moment(12),clubId=7)=>buildServerAnalytics(db,{clubId,days,now});
  const pc=(result,id)=>result.computerStats.find(row=>row.id===id);
  return {db,session,move,payment,report,pc};
}

test('VIP A -> B -> A attributes different tariffs, exact time and one visit count per PC without changing receipts',t=>{
  const {db,session,move,payment,report,pc}=fixture(t);
  session('s',{pc:'a',end:iso(10,30),notes:'VIP | TRANSFER: PC-1->PC-2 | TRANSFER: PC-2->PC-1'});
  move('s','a','b',moment(9,30),5000);move('s','b','a',moment(10),15000);
  payment('s',20000);payment('s',5000,{bar:true});
  session('foreign',{pc:'other',club:8,notes:''});payment('foreign',90000,{club:8});
  const snapshot=()=>['sessions','transactions','session_transfer_history','computers'].map(table=>db.prepare('SELECT * FROM '+table).all());
  const before=snapshot(), result=report();
  assert.equal(pc(result,'a').totalRevenue,10000);assert.equal(pc(result,'a').totalMinutes,60);
  assert.equal(pc(result,'b').totalRevenue,10000);assert.equal(pc(result,'b').totalMinutes,30);
  assert.equal(pc(result,'a').sessionsCount,1);assert.equal(pc(result,'b').sessionsCount,1);
  assert.equal(result.kpis.todayChecks,1);assert.equal(result.kpis.averageSessionMinutes,90);
  assert.deepEqual(result.revenueSources,{games:20000,bar:5000,topup:0});
  assert.equal(result.dailyRevenue[0].revenue,25000);
  assert.equal(result.unattributed.sessionsCount,0);assert.ok(!pc(result,'other'));
  assert.deepEqual(snapshot(),before,'Reading statistics must not mutate any session, PC, payment or transfer history');
});

for(const mode of ['hours','price','endtime']) for(const method of ['CASH','CARD','BALANCE']) {
  test(`${mode}/${method}: early refund and bar debt preserve 5000 on source and 3333 on destination`,t=>{
    const {session,move,payment,report,pc}=fixture(t);
    session('s',{end:iso(9,40),notes:mode+' | TRANSFER: PC-1->PC-2'});
    move('s','a','b',moment(9,30),5000);
    payment('s',10000,{method});payment('s',-1667,{method,at:iso(9,40)});
    payment('s',5000,{bar:true,at:iso(9,40)});
    const result=report();
    assert.equal(pc(result,'a').totalRevenue,5000);assert.equal(pc(result,'b').totalRevenue,3333);
    assert.equal(pc(result,'a').totalMinutes,30);assert.equal(pc(result,'b').totalMinutes,10);
    assert.equal(result.revenueSources.games,method==='BALANCE'?0:8333,'Stored balance spending is not a second cash receipt');
    assert.equal(result.revenueSources.bar,5000);assert.equal(result.unattributed.sessionsCount,0);
  });
}

test('midnight, later extensions and late settlement keep receipt dates and do not credit the source PC twice',t=>{
  const {session,move,payment,report,pc}=fixture(t);
  session('s',{start:iso(23,0,15),end:iso(1),notes:'hours | TRANSFER: PC-1->PC-2'});
  move('s','a','b',moment(23,30,15),3500);
  payment('s',7000,{at:iso(23,0,15)});payment('s',3500,{at:iso(0,10)});
  const today=report();
  assert.equal(pc(today,'a').totalRevenue,0);assert.equal(pc(today,'a').totalMinutes,0);
  assert.equal(pc(today,'b').totalRevenue,3500);assert.equal(pc(today,'b').totalMinutes,60);
  const both=report(2);
  assert.equal(pc(both,'a').totalRevenue,3500);assert.equal(pc(both,'b').totalRevenue,7000);
  assert.equal(pc(both,'a').totalMinutes,30);assert.equal(pc(both,'b').totalMinutes,90);
  // A receipt recorded after the whole session ended still uses its history.
  payment('s',1000,{at:iso(9,0,17)});
  const later=report(1,moment(12,0,17));
  assert.equal(pc(later,'b').totalRevenue,1000);assert.equal(pc(later,'b').totalMinutes,0);
  assert.equal(pc(later,'a').totalRevenue,0);
});

test('older transfers without reliable history are visible as unattributed instead of assigned to the final PC',t=>{
  const {session,payment,report,pc}=fixture(t);
  session();payment('s',10000);
  const result=report();
  assert.equal(pc(result,'a').totalRevenue,0);assert.equal(pc(result,'b').totalRevenue,0);
  assert.deepEqual(result.unattributed,{totalRevenue:10000,totalHours:1,sessionsCount:1});
  assert.equal(result.revenueSources.games,10000);assert.equal(result.kpis.averageSessionMinutes,60);
});

test('reliable legacy audit recovers VIP and prepaid prefixes; malformed or absent historical cost stays unassigned',t=>{
  const {db,session,payment,report,pc}=fixture(t);
  const savedPlan=JSON.stringify({version:2,segments:[[moment(9).getTime(),moment(9,30).getTime(),5000]]});
  for(const [id,carried,plan] of [['vip',5000,null],['prepaid',null,savedPlan],['unknown',null,'{"version":2,"segments":{}}']]) {
    session(id,{plan});payment(id,10000);
    db.prepare("INSERT INTO audit_logs(club_id,action_type,details) VALUES(7,'PC_SWAP',?)").run(JSON.stringify({sessionId:id,fromComputerId:'a',toComputerId:'b',fromName:'PC-1',toName:'PC-2',transferredAt:iso(9,30),carriedAmount:carried}));
  }
  db.exec("INSERT INTO audit_logs(club_id,action_type,details) VALUES(7,'PC_SWAP','not JSON')");
  const result=report();
  assert.equal(pc(result,'a').totalRevenue,10000);assert.equal(pc(result,'b').totalRevenue,10000);
  assert.equal(pc(result,'a').totalMinutes,90);assert.equal(pc(result,'b').totalMinutes,90);
  assert.deepEqual(result.unattributed,{totalRevenue:10000,totalHours:0,sessionsCount:1});
});

test('a new transfer after a missing old move preserves only the verified tail and avoids duplicate audit events',t=>{
  const {db,session,move,payment,report,pc}=fixture(t);
  session('s',{pc:'c',notes:'hours | TRANSFER: A->B | TRANSFER: B->C'});
  move('s','b','c',moment(9,45),7500);payment('s',10000);
  db.prepare("INSERT INTO audit_logs(club_id,action_type,details) VALUES(7,'PC_SWAP',?)").run(JSON.stringify({sessionId:'s',fromComputerId:'b',toComputerId:'c',transferredAt:iso(9,45),carriedAmount:7500}));
  const result=report();
  assert.equal(pc(result,'c').totalRevenue,2500);assert.equal(pc(result,'c').totalMinutes,15);
  assert.equal(pc(result,'b').totalRevenue,0);assert.equal(pc(result,'b').totalMinutes,0);
  assert.deepEqual(result.unattributed,{totalRevenue:7500,totalHours:0.75,sessionsCount:1});
});

test('removed source PC retains its historical identity even when its number is reused',t=>{
  const {db,session,move,payment,report,pc}=fixture(t);
  session();move('s','a','b',moment(9,30),5000);payment('s',10000);
  db.exec("DELETE FROM computers WHERE id='a'; INSERT INTO computers VALUES('new-a',7,1,'New PC-1','STANDARD')");
  const result=report();
  assert.equal(pc(result,'a').archived,true);assert.equal(pc(result,'a').totalRevenue,5000);
  assert.equal(pc(result,'new-a').totalRevenue,0);assert.equal(pc(result,'new-a').totalMinutes,0);
  assert.equal(pc(result,'b').totalRevenue,5000);
});

test('archiving the final PC keeps the recorded source and destination instead of losing the whole chain',t=>{
  const {db,session,move,payment,report,pc}=fixture(t);
  session();move('s','a','b',moment(9,30),5000);payment('s',10000);
  db.exec("INSERT INTO computers VALUES('archived_7',7,0,'[Arxiv PC]','STANDARD'); UPDATE sessions SET computer_id='archived_7'; DELETE FROM computers WHERE id='b'");
  const result=report();
  assert.equal(pc(result,'a').totalRevenue,5000);assert.equal(pc(result,'b').totalRevenue,5000);
  assert.equal(pc(result,'b').archived,true);assert.equal(pc(result,'b').totalMinutes,30);
  assert.equal(pc(result,'archived_7'),undefined);assert.equal(result.unattributed.sessionsCount,0);
});

test('immediate moves and fractional boundaries conserve the final rounded bill',t=>{
  const {session,move,payment,report,pc}=fixture(t);
  session('s',{pc:'c',notes:'VIP | TRANSFER: A->B | TRANSFER: B->C'});
  move('s','a','b',moment(9),0);move('s','b','c',moment(9,30),3333.3333333);payment('s',6667);
  const result=report();
  assert.equal(pc(result,'a').totalRevenue,0);assert.equal(pc(result,'a').sessionsCount,0);
  assert.equal(pc(result,'b').totalRevenue,3333);assert.equal(pc(result,'c').totalRevenue,3334);
  assert.equal(result.computerStats.reduce((sum,row)=>sum+row.totalRevenue,0),6667);
  assert.equal(result.unattributed.sessionsCount,0);
});

test('eight real PCs remain eight in statistics and occupancy when PC-0 and archive placeholders exist',t=>{
  const {db,session,payment,report}=fixture(t);
  for(let number=4;number<=8;number++)db.prepare('INSERT INTO computers VALUES(?,7,?,?,\'STANDARD\')').run('pc-'+number,number,'PC-'+number);
  session('real',{pc:'a',start:iso(0),end:iso(12),notes:''});payment('real',120000);
  const before=report(), allClubsBefore=report(1,moment(12),null);
  assert.equal(before.computerStats.length,8);
  assert.equal(before.kpis.averageOccupancy,13);assert.equal(before.peakHours[9],13);
  db.exec(`INSERT INTO computers VALUES
    ('zero',7,0,'PC-0','STANDARD'),('archived_7',7,0,'[Arxiv PC]','STANDARD'),
    ('negative',7,-1,'Legacy layout','STANDARD'),('unset',7,NULL,'Unnumbered','STANDARD'),
    ('foreign-zero',8,0,'Other PC-0','STANDARD')`);
  const after=report(), allClubsAfter=report(1,moment(12),null);
  assert.deepEqual(after,before,'A placeholder without history must not alter any statistic');
  assert.deepEqual(allClubsAfter,allClubsBefore,'The same rule applies without a tenant filter');
  assert.equal(after.computerStats.length,8);assert.ok(after.computerStats.every(row=>row.pcNumber>0));
});

test('PC-0 historical receipts survive while its sessions cannot inflate occupancy, duration, checks or ranking',t=>{
  const {db,session,payment,report}=fixture(t);
  session('real',{pc:'a',notes:''});payment('real',10000);
  const baseline=report();
  db.exec("INSERT INTO computers VALUES('zero',7,0,'PC-0','STANDARD'),('archived_7',7,0,'[Arxiv PC]','STANDARD')");
  session('placeholder',{pc:'zero',start:iso(0),end:iso(20),notes:''});
  db.exec("UPDATE sessions SET status='ACTIVE' WHERE id='placeholder'");
  payment('placeholder',10000);payment('placeholder',-6000);payment('placeholder',5000,{bar:true});
  session('archive',{pc:'archived_7',notes:''});payment('archive',2000);
  // Old numeric references can survive after the original PC-0 row disappeared.
  session('numeric-zero',{pc:'0',notes:''});payment('numeric-zero',1000);
  const snapshot=()=>['computers','sessions','transactions'].map(table=>db.prepare('SELECT * FROM '+table).all());
  const saved=snapshot(), result=report();
  assert.deepEqual(result.computerStats,baseline.computerStats);
  assert.deepEqual(result.kpis,baseline.kpis);
  assert.deepEqual(result.peakHours,baseline.peakHours);
  assert.deepEqual(result.revenueSources,{games:17000,bar:5000,topup:0});
  assert.equal(result.dailyRevenue[0].revenue,22000,'Do not discard real retained money when hiding PC-0');
  assert.deepEqual(result.unattributed,{totalRevenue:7000,totalHours:14,sessionsCount:3});
  assert.deepEqual(snapshot(),saved,'Statistics cannot delete or rewrite historical data');
});

test('a transfer snapshot cannot recreate PC-0 in the ranking after its original row is removed',t=>{
  const {db,session,move,payment,report,pc}=fixture(t);
  db.exec("INSERT INTO computers VALUES('zero',7,0,'PC-0','STANDARD')");
  session('s',{notes:'hours | TRANSFER: PC-0->PC-2'});
  move('s','zero','b',moment(9,30),5000);payment('s',10000);
  const result=report();
  assert.equal(pc(result,'zero'),undefined);
  assert.equal(pc(result,'b').totalRevenue,5000);assert.equal(pc(result,'b').totalMinutes,30);
  assert.equal(result.kpis.todayChecks,1);assert.equal(result.kpis.averageSessionMinutes,30);
  assert.deepEqual(result.unattributed,{totalRevenue:5000,totalHours:0.5,sessionsCount:1});
  db.exec("DELETE FROM computers WHERE id='zero'");
  assert.deepEqual(report(),result,'A stored zero PC number remains nonphysical even without its catalog row');
});

test('a club containing only PC-0 has no computers, load or session KPIs, but keeps its money',t=>{
  const {db,session,payment,report}=fixture(t);
  db.exec("DELETE FROM computers; INSERT INTO computers VALUES('zero',7,0,'PC-0','STANDARD')");
  session('s',{pc:'zero',notes:''});payment('s',4000);
  const result=report();
  assert.deepEqual(result.computerStats,[]);assert.ok(result.peakHours.every(value=>value===0));
  assert.equal(result.kpis.averageOccupancy,0);assert.equal(result.kpis.averageSessionMinutes,0);
  assert.equal(result.kpis.todayChecks,0);assert.equal(result.kpis.peakTime,'—');
  assert.equal(result.revenueSources.games,4000);assert.equal(result.unattributed.totalRevenue,4000);
});
