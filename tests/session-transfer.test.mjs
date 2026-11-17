import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('transfer preserves VIP debt, converts prepaid value, follows bar debt and rolls back failed moves',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/transfer-'));
  fs.cpSync('NetCafeServer/src',path.join(root,'src'),{recursive:true});
  fs.copyFileSync('NetCafeServer/schema.sql',path.join(root,'schema.sql'));
  fs.writeFileSync(path.join(root,'case.mjs'),`
    import assert from 'node:assert/strict';
    import {db,initDatabase} from './src/db.js';
    import {transferSession,previewSessionTransfer} from './src/services/sessionTransfer.js';
    import {postpaidGameBill,clientSessionState} from './src/services/clientSessionState.js';
    import {prepaidRefund,extendPrepaidMember,settleMemberUsage} from './src/services/memberBilling.js';
    import {buildServerAnalytics} from './src/services/analyticsService.js';
    import {BarLedgerService} from './src/services/barLedgerService.js';
    import {ClientManager} from './src/services/clientManager.js';
    initDatabase();
    const now=Date.parse('2026-11-13T12:00:00Z');Date.now=()=>now;
    ClientManager.send=()=>{};ClientManager.broadcast=()=>{};
    const row=id=>db.prepare('SELECT * FROM sessions WHERE id=?').get(id);
    const pc=id=>db.prepare('SELECT * FROM computers WHERE id=?').get(id);
    function makePc(id,number,zone){db.prepare("INSERT INTO computers(id,club_id,name,pc_number,zone_id,status) VALUES(?,1,?,?,?,'AVAILABLE')").run(id,id,number,zone);}
    function open(id,computer,notes,paid,start,end,user=null){
      db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,user_id,started_at,ends_at,paid_amount,total_amount,status,notes) VALUES(?,1,?,'trf_standard_1h',?,?,?,?,?,'ACTIVE',?)")
        .run(id,computer,user,new Date(start).toISOString(),new Date(end).toISOString(),paid,paid,notes);
      db.prepare("UPDATE computers SET current_session_id=?,status='OCCUPIED' WHERE id=?").run(id,computer);
    }
    const request=(from,to,time=now)=>({fromComputerId:from,toComputerId:to,clubId:1,now:time});
    const move=(from,to,time=now)=>{const q=previewSessionTransfer(request(from,to,time));return transferSession({...request(from,to,time),quoteRevision:q.quoteRevision});};
    try {
      for (const [minutes,expected] of [[30,0],[50,3333]]) {
        const id='checkout-'+minutes;
        makePc(id,1100+minutes,null);
        open(id,id,'hours',10000,now-minutes*60000,now+(60-minutes)*60000);
        db.prepare("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type) VALUES(?,1,?,10000,'CASH','CASH','PREPAID')").run(id,id);
        db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,session_id,total_amount,payment_status,approval_status) VALUES(1,?,?,?,5000,'PENDING_AT_CHECKOUT','CONFIRMED')").run(id,1100+minutes,id);
        const preview=BarLedgerService.getSessionCheckoutPreview(id,1);
        assert.equal(preview.amountToCollect,expected);
        assert.equal(preview.gameBill,minutes===30?5000:8333);
        const result=BarLedgerService.executeSessionCheckout({target:id,clubId:1});
        assert.equal(result.amountCollected,expected);
        assert.equal(db.prepare('SELECT SUM(amount) AS total FROM transactions WHERE session_id=?').get(id).total,10000+expected);
        assert.throws(()=>BarLedgerService.executeSessionCheckout({target:id,clubId:1}));
      }
      for(const [id,rate] of [[91,10000],[92,20000],[93,7000],[94,14000]]) {
        db.prepare('INSERT INTO zones(id,club_id,name) VALUES(?,1,?)').run(id,'Zone '+rate);
        db.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,type,price_per_hour,start_time,end_time) VALUES(?,1,?,?,'HOURLY',?,'00:00','00:00')").run('transfer-'+id,id,'Rate '+rate,rate);
      }
      makePc('vip-a',981,91);makePc('vip-b',982,92);makePc('trap',983,91);
      open('vip','vip-a','BATCH_VIP',0,now-1915200,now+86400000);
      assert.equal(postpaidGameBill(row('vip'),now),5320);
      const vip=move('vip-a','vip-b');
      const transferRows=()=>db.prepare("SELECT * FROM session_transfer_history WHERE session_id='vip' ORDER BY id").all();
      assert.equal(transferRows().length,1);assert.ok(Math.abs(transferRows()[0].game_amount-5320)<1e-8);
      assert.equal(transferRows()[0].from_id,'vip-a');assert.equal(transferRows()[0].to_id,'vip-b');
      assert.equal(vip.carriedAmount,5320);assert.equal(vip.remainingSeconds,-1);
      assert.equal(postpaidGameBill(row('vip'),now),5320,'Original time must not be repriced at the more expensive PC');
      assert.equal(postpaidGameBill(row('vip'),now+900000),10320,'Next 15 minutes use 20000/h');
      assert.equal(clientSessionState('vip',now).sessionInfo.gameAmount,5320);
      assert.equal(pc('vip-a').status,'LOCKED');assert.equal(pc('vip-a').current_session_id,null);
      initDatabase();assert.equal(postpaidGameBill(row('vip'),now+900000),10320,'Checkpoint survives migrations/restart');
      move('vip-b','vip-a',now+900000);
      assert.equal(transferRows().length,2);assert.ok(Math.abs(transferRows()[1].game_amount-10320)<1e-8);
      assert.equal(postpaidGameBill(row('vip'),now+1260000),11320,'Repeated transfer adds only new time');
      const before=row('vip');
      db.exec("CREATE TRIGGER reject_transfer BEFORE UPDATE OF current_session_id ON computers WHEN NEW.id='trap' BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      assert.throws(()=>move('vip-a','trap',now+1260000),/fixture failure/);
      assert.deepEqual(row('vip'),before);assert.equal(pc('vip-a').current_session_id,'vip');assert.equal(pc('trap').current_session_id,null);
      assert.equal(transferRows().length,2,'Failed moves must not leave statistics history');
      db.exec('DROP TRIGGER reject_transfer');
      db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON session_transfer_history BEGIN SELECT RAISE(ABORT,'history failure'); END");
      assert.throws(()=>move('vip-a','trap',now+1260000),/history failure/);
      assert.deepEqual(row('vip'),before);assert.equal(pc('vip-a').current_session_id,'vip');assert.equal(pc('trap').current_session_id,null);
      db.exec('DROP TRIGGER reject_history');
      assert.throws(()=>transferSession({...request('vip-a','trap'),clubId:99}),/boshqa klub/);
      Date.now=()=>now+1260000;
      const receipt=BarLedgerService.executeSessionCheckout({target:'vip',clubId:1});assert.equal(receipt.gameBill,11320);
      assert.equal(db.prepare("SELECT amount FROM transactions WHERE session_id='vip' AND transaction_type='POSTPAID_SETTLEMENT'").get().amount,11320);
      // SQLite CURRENT_TIMESTAMP is not controlled by Date.now in this fixture.
      const checkoutAt=new Date(now+1260000).toISOString();
      db.prepare("UPDATE sessions SET ends_at=? WHERE id='vip'").run(checkoutAt);
      db.prepare("UPDATE transactions SET created_at=? WHERE session_id='vip'").run(checkoutAt);
      const vipStats=buildServerAnalytics(db,{clubId:1,days:1,now:new Date(now+3600000)});
      assert.equal(vipStats.computerStats.find(p=>p.id==='vip-a').totalRevenue,6320);
      assert.equal(vipStats.computerStats.find(p=>p.id==='vip-b').totalRevenue,5000);
      assert.equal(vipStats.computerStats.find(p=>p.id==='vip-a').totalMinutes,37.92);
      assert.equal(vipStats.computerStats.find(p=>p.id==='vip-b').totalMinutes,15);
      Date.now=()=>now;
      for (const [index,mode,paid,duration] of [[0,'hours',7000,3600000],[1,'price',10000,5142857],[2,'endtime',7000,3600000]]) {
        const a='paid-a'+index,b='paid-b'+index,id='paid'+index;
        makePc(a,990+index*2,93);makePc(b,991+index*2,94);
        open(id,a,mode,paid,now-1800000,now-1800000+duration);
        const original=row(id),q=previewSessionTransfer(request(a,b));
        assert.equal(q.remainingAmount,paid-3500);assert.equal(q.usedAmount,3500);
        if(mode!=='price'){assert.equal(q.oldRemainingSeconds,1800);assert.equal(q.newRemainingSeconds,900);}
        assert.throws(()=>transferSession(request(a,b)),e=>e.status===409,'Changed prepaid time requires a reviewed quote');
        db.prepare("INSERT INTO bar_orders(club_id,order_number,computer_id,total_amount,payment_status,approval_status) VALUES(1,?,?,2000,'PENDING_AT_CHECKOUT','CONFIRMED')").run('debt-'+index,990+index*2);
        move(a,b);
        const history=db.prepare('SELECT game_amount FROM session_transfer_history WHERE session_id=? ORDER BY id').all(id);
        assert.equal(history.length,1);assert.equal(history[0].game_amount,3500);
        assert.equal(row(id).started_at,original.started_at);assert.equal(row(id).paid_amount,paid);
        assert.equal(prepaidRefund(row(id),new Date(now)).usedAmount,3500,'Consumed value is preserved');
        assert.equal(prepaidRefund(row(id),new Date(row(id).ends_at)).amount,0);
        assert.equal(db.prepare('SELECT session_id FROM bar_orders WHERE order_number=?').get('debt-'+index).session_id,id);
        assert.equal(BarLedgerService.getSessionCheckoutPreview(id,1).barBill,2000);
        move(b,a);assert.ok(Math.abs(Date.parse(row(id).ends_at)-Date.parse(original.ends_at))<=1,'Returning immediately restores the original purchased time');
      }
      makePc('balance-a',1001,93);makePc('balance-b',1002,94);
      const member=db.prepare("SELECT * FROM users WHERE username='gamer1'").get();
      open('balance','balance-a','CLIENT_BALANCE_PREPAID:'+member.id,10000,now-1800000,now+3342857,member.id);
      move('balance-a','balance-b');
      assert.equal(db.prepare('SELECT balance FROM users WHERE id=?').get(member.id).balance,member.balance,'Transfer does not debit a second payment');
      const extended=extendPrepaidMember('balance',15);assert.equal(extended.amount,3500);
      assert.equal(prepaidRefund(row('balance'),new Date(now)).usedAmount,3500,'Extension retains consumed amount');
      assert.equal(prepaidRefund(row('balance'),new Date(row('balance').ends_at)).amount,0);
      makePc('refund-a',1011,93);makePc('refund-b',1012,94);
      open('refund','refund-a','hours',7000,now-1800000,now+1800000);
      db.prepare("INSERT INTO transactions(id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_at) VALUES('refund-pay',1,'refund',7000,'CASH','CASH','PREPAID',?)").run(new Date(now-1800000).toISOString());
      move('refund-a','refund-b');Date.now=()=>now+600000;
      const refund=BarLedgerService.executeSessionCheckout({target:'refund',clubId:1});
      assert.equal(refund.gameBill,5833);
      db.prepare("UPDATE sessions SET ends_at=? WHERE id='refund'").run(new Date(now+600000).toISOString());
      db.prepare("UPDATE transactions SET created_at=? WHERE session_id='refund'").run(new Date(now+600000).toISOString());
      const prepaidStats=buildServerAnalytics(db,{clubId:1,days:1,now:new Date(now+3600000)});
      assert.equal(prepaidStats.computerStats.find(p=>p.id==='refund-a').totalRevenue,3500);
      assert.equal(prepaidStats.computerStats.find(p=>p.id==='refund-b').totalRevenue,2333);
      Date.now=()=>now;
      makePc('live-a',1013,93);makePc('live-b',1014,94);
      open('live','live-a','CLIENT_BALANCE_LIVE:'+member.id,0,now-1800000,now+3600000,member.id);
      move('live-a','live-b');
      assert.equal(db.prepare("SELECT game_amount FROM session_transfer_history WHERE session_id='live'").get().game_amount,3500);
      assert.equal(settleMemberUsage('live',new Date(now+600000)).totalAmount,5833);
      db.prepare("UPDATE client_transactions SET created_at=? WHERE session_id='live'").run(new Date(now).toISOString());
      const liveStats=buildServerAnalytics(db,{clubId:1,days:1,now:new Date(now+600000)});
      assert.equal(liveStats.computerStats.find(p=>p.id==='live-a').totalRevenue,3500);
      assert.equal(liveStats.computerStats.find(p=>p.id==='live-b').totalRevenue,2333);
      makePc('stale-a',1003,93);makePc('stale-b',1004,94);
      open('stale','stale-a','hours',7000,now-1800000,now+1800000);
      const quote=previewSessionTransfer(request('stale-a','stale-b'));
      db.prepare("UPDATE tariffs SET price_per_hour=21000 WHERE id='transfer-94'").run();
      assert.throws(()=>transferSession({...request('stale-a','stale-b'),quoteRevision:quote.quoteRevision}),e=>e.status===409);
      assert.equal(pc('stale-a').current_session_id,'stale');assert.equal(pc('stale-b').current_session_id,null);
      open('hidden-occupied','stale-b','hours',7000,now,now+3600000);
      db.prepare("UPDATE computers SET status='AVAILABLE',current_session_id=NULL WHERE id='stale-b'").run();
      assert.throws(()=>move('stale-a','stale-b'),/faol seans/,'Even inconsistent occupancy must reject overwrite');
    } finally {db.close();}
  `);
  const result=spawnSync(process.execPath,['case.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test'},encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
});
