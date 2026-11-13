import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';

function fixture(){
  fs.mkdirSync('.test-output',{recursive:true});
  const dir=fs.mkdtempSync(path.resolve('.test-output/financial-restart-'));
  for(const name of ['src','schema.sql','package.json'])fs.cpSync(path.join('NetCafeServer',name),path.join(dir,name),{recursive:true});
  return dir;
}
async function crashAfterCommit(dir,body){
  fs.writeFileSync(path.join(dir,'case.mjs'),`
    import assert from 'node:assert/strict';
    import {db,initDatabase} from './src/db.js';initDatabase();
    import {BarLedgerService} from './src/services/barLedgerService.js';
    import {ClientManager} from './src/services/clientManager.js';
    import {transferSession} from './src/services/sessionTransfer.js';
    import {postpaidGameBill} from './src/services/clientSessionState.js';
    import {MobileSnapshotSync} from './src/services/mobileSnapshotSync.js';
    import fs from 'node:fs';
    ClientManager.send=()=>{};ClientManager.broadcast=()=>{};
    ${body}
    console.log('FIXTURE_COMMITTED');setInterval(()=>{},1000);
  `);
  const child=spawn(process.execPath,['case.mjs'],{cwd:dir,env:{...process.env,NODE_ENV:'test'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const exited=once(child,'exit');let output='';
  child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  try{
    const deadline=Date.now()+60000;
    while(!output.includes('FIXTURE_COMMITTED')&&child.exitCode===null&&Date.now()<deadline)await new Promise(r=>setTimeout(r,20));
    assert.ok(output.includes('FIXTURE_COMMITTED'),output);
  }finally{if(child.exitCode===null)child.kill();await exited;}
}

for(const postpaid of [true,false])test(`${postpaid?'VIP':'refunded prepaid'} late bar collection survives forced exits without rebilling game or changing its final amount`,async()=>{
  const dir=fixture(),game=postpaid?5320:4000,paid=postpaid?5320:10000;
  await crashAfterCommit(dir,`
    db.prepare("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('closed-pc',1,'Closed',901,'ONLINE')").run();
    db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES('closed',1,'closed-pc','trf_standard_1h','2026-11-13T10:00:00Z','2026-11-13T11:00:00Z',?,?,'COMPLETED',?)").run(${paid},${game},${JSON.stringify(postpaid?'POSTPAID':'price')});
    db.prepare("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type,notes) VALUES('original',1,'closed',?,'CASH','CASH',?,'original payment')").run(${paid},${JSON.stringify(postpaid?'POSTPAID_SETTLEMENT':'PREPAID')});
    ${postpaid?'':`db.exec("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,notes) VALUES('refund',1,'closed',-6000,'CASH','REFUND (Zdacha)')");`}
    db.exec("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,approval_status) VALUES(1,'LATE',901,'closed',2000,'PENDING_AT_CHECKOUT','CONFIRMED')");
    // Historical checkout must not depend on tariffs that have since been removed.
    db.exec('DELETE FROM tariff_schedules');db.exec('UPDATE tariffs SET price_per_hour=99999');
  `);
  await crashAfterCommit(dir,`
    const before=db.prepare("SELECT * FROM sessions WHERE id='closed'").get();
    const preview=BarLedgerService.getSessionCheckoutPreview('closed',1);
    assert.equal(preview.gameBill,${game});assert.equal(preview.amountToCollect,2000);
    const count=db.prepare('SELECT count(*) n FROM transactions').get().n;
    db.exec("CREATE TRIGGER fail_payment BEFORE UPDATE OF payment_status ON bar_orders BEGIN SELECT RAISE(ABORT,'fixture disk failure'); END");
    assert.throws(()=>BarLedgerService.executeSessionCheckout({target:'closed',clubId:1}),/fixture disk failure/);
    assert.equal(db.prepare('SELECT count(*) n FROM transactions').get().n,count);
    assert.deepEqual(db.prepare("SELECT * FROM sessions WHERE id='closed'").get(),before);
    db.exec('DROP TRIGGER fail_payment');
    const result=BarLedgerService.executeSessionCheckout({target:'closed',clubId:1,broadcastUpdate:()=>{throw Error('fixture disconnected UI');}});
    assert.equal(result.amountCollected,2000);
    assert.deepEqual(db.prepare("SELECT * FROM sessions WHERE id='closed'").get(),before);
  `);
  await crashAfterCommit(dir,`
    for(let i=0;i<100;i++)assert.throws(()=>BarLedgerService.executeSessionCheckout({target:'closed',clubId:1}),/allaqachon yopilgan/);
    assert.equal(db.prepare("SELECT count(*) n FROM transactions WHERE session_id='closed' AND transaction_type='BAR_SALE'").get().n,1);
    assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id='closed'").get().n,${game+2000});
    assert.equal(db.prepare("SELECT total_amount FROM sessions WHERE id='closed'").get().total_amount,${game});
    assert.equal(db.prepare("SELECT paid_amount FROM sessions WHERE id='closed'").get().paid_amount,${paid});
  `);
});

test('historical refund reports retry after failed upload and process death; skipped sync is not success',async()=>{
 const dir=fixture();
 const common=`
   let operational=true,proof={payload:{clubId:10}},failUpload=false;
   const sync=new MobileSnapshotSync({db,getLicense:()=>proof,getCloudUrl:()=>'https://cloud.fixture',isOperational:()=>operational,localPort:1,
    createSession:()=>({token:'fixture'}),destroySession(){},fetcher:async(url,options)=>{
     if(url.startsWith('http://127.0.0.1:'))return new Response('{}');
     const entries=JSON.parse(options.body).entries;
     if(failUpload&&entries.some(e=>e.key.startsWith('report:')))return new Response('{}',{status:503});
     for(const entry of entries)if(entry.key.startsWith('report:'))fs.writeFileSync(entry.key.replace(':','-')+'.json',JSON.stringify(entry));
     return new Response('{}');
    }});
 `;
 await crashAfterCommit(dir,`
   db.exec('CREATE TABLE cloud_manager_state(club_id INTEGER,user_id INTEGER,revision INTEGER);CREATE TABLE cloud_administrator_state(club_id INTEGER,user_id INTEGER,revision INTEGER)');
   db.exec("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('history-pc',1,'History',921,'ONLINE');INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES('historical',1,'history-pc','trf_standard_1h',datetime('now','-2 days'),CURRENT_TIMESTAMP,10000,4000,'COMPLETED','price')");
   db.exec("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,transaction_type,notes,created_at) VALUES('paid',1,'historical',10000,'CASH','PREPAID','original',datetime('now','-2 days')),('back',1,'historical',-6000,'CASH',NULL,'REFUND',CURRENT_TIMESTAMP)");
   ${common}
   operational=false;assert.equal(await sync.flush(),false);
   operational=true;proof=null;assert.equal(await sync.flush(),false);
   proof={payload:{clubId:10}};failUpload=true;assert.equal(await sync.flush(),false);
   assert.ok(db.prepare('SELECT count(*) n FROM mobile_report_refresh').get().n>0);
 `);
 await crashAfterCommit(dir,`
   ${common}
   const day=db.prepare('SELECT day FROM mobile_report_refresh ORDER BY day LIMIT 1').get().day;
   assert.equal(await sync.flush(),true);
   const sent=JSON.parse(fs.readFileSync('report-'+day+'.json'));
   assert.equal(sent.data.breakdown.receipts.GAME.CASH,4000);
   assert.deepEqual(sent.data.breakdown,BarLedgerService.getDailyFinancialReport({clubId:1,fromDate:day,toDate:day}).breakdown);
   assert.equal(db.prepare('SELECT count(*) n FROM mobile_report_refresh').get().n,0);
 `);
});

test('VIP transfer retains 5320 earned before restart and continues at the destination tariff',async()=>{
  const dir=fixture();
  await crashAfterCommit(dir,`
    db.exec("DELETE FROM tariff_schedules;INSERT INTO zones(id,club_id,name) VALUES(91,1,'Old'),(92,1,'New')");
    db.exec("INSERT INTO tariffs(id,club_id,zone_id,name,price_per_hour,type,start_time,end_time,is_vip_postpaid_allowed) VALUES('old',1,91,'Old',7000,'HOURLY','00:00','00:00',1),('new',1,92,'New',14000,'HOURLY','00:00','00:00',1)");
    db.exec("INSERT INTO computers(id,club_id,name,pc_number,zone_id,status,current_session_id) VALUES('a',1,'A',911,91,'OCCUPIED','vip'),('b',1,'B',912,92,'ONLINE',NULL)");
    db.exec("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES('vip',1,'a','old','2026-11-13T11:14:24Z','2026-11-14T12:00:00Z',0,0,'ACTIVE','POSTPAID')");
    const moved=transferSession({fromComputerId:'a',toComputerId:'b',clubId:1,now:Date.parse('2026-11-13T12:00:00Z')});
    assert.equal(moved.carriedAmount,5320);
  `);
  await crashAfterCommit(dir,`
    const row=db.prepare("SELECT * FROM sessions WHERE id='vip'").get();
    assert.equal(row.computer_id,'b');assert.equal(postpaidGameBill(row,Date.parse('2026-11-13T12:30:00Z')),12320);
    assert.throws(()=>transferSession({fromComputerId:'a',toComputerId:'b',clubId:1,now:Date.parse('2026-11-13T12:30:00Z')}));
    assert.ok(Math.abs(db.prepare("SELECT postpaid_carried_amount FROM sessions WHERE id='vip'").get().postpaid_carried_amount-5320)<1e-8);
  `);
});

test('500 bar settlements with 500 retries and five forced restarts retain exact receipts',async()=>{
 const dir=fixture();
 await crashAfterCommit(dir,`
   db.exec("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('load-pc',1,'Load',951,'ONLINE');INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES('load',1,'load-pc','trf_standard_1h',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,5320,5320,'COMPLETED','POSTPAID');INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type) VALUES('load-game',1,'load',5320,'CASH','CASH','POSTPAID_SETTLEMENT')");
 `);
 for(let batch=0;batch<5;batch++)await crashAfterCommit(dir,`
   for(let i=0;i<100;i++){
     db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,approval_status) VALUES(1,?,951,'load',2000,'PENDING_AT_CHECKOUT','CONFIRMED')").run('load-'+${batch}+'-'+i);
     assert.equal(BarLedgerService.executeSessionCheckout({target:'load',clubId:1}).amountCollected,2000);
     assert.throws(()=>BarLedgerService.executeSessionCheckout({target:'load',clubId:1}),/allaqachon yopilgan/);
   }
   assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id='load'").get().n,5320+${(batch+1)*200000});
   assert.equal(db.prepare("SELECT count(*) n FROM transactions WHERE session_id='load' AND transaction_type='POSTPAID_SETTLEMENT'").get().n,1);
 `);
 await crashAfterCommit(dir,`
   assert.equal(db.prepare("SELECT sum(amount) n FROM transactions WHERE session_id='load'").get().n,1005320);
   assert.equal(db.prepare("SELECT count(*) n FROM bar_orders WHERE session_id='load' AND payment_status='PAID'").get().n,500);
 `);
});

test('a recorded unpaid remainder on a completed VIP session is collected once, not forgiven',async()=>{
 const dir=fixture();
 await crashAfterCommit(dir,`
   db.exec("INSERT INTO computers(id,club_id,name,pc_number,status) VALUES('legacy-pc',1,'Legacy',961,'ONLINE');INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES('legacy',1,'legacy-pc','trf_standard_1h',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,3000,5320,'COMPLETED','POSTPAID');INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,approval_status) VALUES(1,'LEGACY',961,'legacy',2000,'PENDING_AT_CHECKOUT','CONFIRMED')");
   const result=BarLedgerService.executeSessionCheckout({target:'legacy',clubId:1});
   assert.equal(result.amountCollected,4320);
   assert.equal(db.prepare("SELECT paid_amount FROM sessions WHERE id='legacy'").get().paid_amount,5320);
   assert.equal(db.prepare("SELECT amount FROM transactions WHERE session_id='legacy' AND transaction_type='POSTPAID_SETTLEMENT'").get().amount,2320);
 `);
 await crashAfterCommit(dir,`assert.throws(()=>BarLedgerService.executeSessionCheckout({target:'legacy',clubId:1}),/allaqachon yopilgan/);`);
});
