import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('room tariff changes drive real quotes, preserve history, reject conflicts and never revive deleted prices',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/room-tariffs-'));
  fs.cpSync('NetCafeServer/src',path.join(root,'src'),{recursive:true});
  fs.copyFileSync('NetCafeServer/schema.sql',path.join(root,'schema.sql'));
  fs.writeFileSync(path.join(root,'case.mjs'),`
    import assert from 'node:assert/strict';
    import {db,initDatabase} from './src/db.js';
    import {roomTariffState,saveRoomTariffs,validateRoomTariffs} from './src/services/roomTariffs.js';
    import {getActiveRateForMoment,calculateIntervalPrice} from './src/services/pricingEngine.js';
    import {prepaidQuote} from './src/services/prepaidQuote.js';
    import {clubSetupContext} from './src/services/clubSetupContext.js';
    initDatabase();
    try {
      db.exec("DELETE FROM tariff_schedules; INSERT INTO zones(id,club_id,name) VALUES(90,1,'Zal'),(91,1,'VIP');");
      db.exec("INSERT INTO tariff_schedules(club_id,name,start_time,end_time,price_per_hour,days_of_week) VALUES(1,'Old general','00:00','00:00',12000,'[1,2,3,4,5,6,7]');");
      const at=new Date('2026-11-16T12:00:00');
      const rate=(price=7000,start='00:00',end='00:00',days=[1,2,3,4,5,6,7])=>({name:'Room tariff',price_per_hour:price,start_time:start,end_time:end,days_of_week:days,is_vip_postpaid_allowed:false});
      const state=()=>roomTariffState(db,1,90);
      const save=rows=>saveRoomTariffs(db,1,90,{revision:state().revision,tariffs:rows});
      assert.equal(state().inherited,true);
      assert.equal(getActiveRateForMoment(at,false,1,90).pricePerHour,12000,'existing legacy billing is unchanged on upgrade/read');
      const oldRevision=state().revision;
      const saved=save([rate()]);assert.equal(saved.fullCoverage,true);assert.equal(saved.inherited,false);
      assert.equal(getActiveRateForMoment(at,false,1,90).pricePerHour,7000);
      assert.equal(getActiveRateForMoment(at,false,1,91).pricePerHour,12000,'other room untouched');
      for(const input of [{mode:'hours',durationMinutes:60},{mode:'amount',amount:7000},{mode:'endtime',targetEndTime:'13:00'}]){
        const q=prepaidQuote(input,at,1,90);assert.equal(q.totalAmount,7000);assert.equal(q.totalMinutes,60);
      }
      assert.equal(calculateIntervalPrice(at,new Date('2026-11-16T12:30:00'),true,1,90).totalAmount,3500,'VIP bill uses the same room schedule');
      assert.equal(clubSetupContext(db,1).initialDraft.tariffs.find(r=>r.roomId==='room_90').price_per_hour,7000,'wizard reads saved current prices');
      assert.throws(()=>saveRoomTariffs(db,1,90,{revision:oldRevision,tariffs:[rate(9000)]}),{statusCode:409});
      assert.throws(()=>saveRoomTariffs(db,2,90,{revision:saved.revision,tariffs:[]}),{statusCode:404});
      assert.throws(()=>save([{...rate(),id:'foreign-tariff'}]),/tegishli emas/);
      assert.throws(()=>save([rate(),rate(9000,'12:00','14:00')]),/ustma-ust/);
      assert.equal(state().revision,saved.revision,'invalid writes leave all rates unchanged');
      const firstId=saved.tariffs[0].id;
      db.prepare("INSERT INTO computers(id,club_id,pc_number,name,zone_id) VALUES('pc',1,90,'PC-90',90)").run();
      db.prepare("INSERT INTO sessions(id,club_id,computer_id,tariff_id,ends_at,status,paid_amount) VALUES('paid',1,'pc',?,'2099-01-01','ACTIVE',10000)").run(firstId);
      assert.throws(()=>save([rate(9000)]),/faol seans/);
      assert.throws(()=>save([]),/faol seans/);
      assert.equal(db.prepare("SELECT paid_amount FROM sessions WHERE id='paid'").get().paid_amount,10000);
      db.exec("UPDATE sessions SET status='COMPLETED' WHERE id='paid'");
      save([rate(8000)]);
      assert.equal(db.prepare('SELECT price_per_hour,is_active FROM tariffs WHERE id=?').get(firstId).price_per_hour,7000,'history not rewritten');
      assert.equal(db.prepare('SELECT is_active FROM tariffs WHERE id=?').get(firstId).is_active,0);
      const before=state();
      db.exec("CREATE TRIGGER test_fail_rate BEFORE INSERT ON tariffs BEGIN SELECT RAISE(ABORT,'fixture failure'); END");
      assert.throws(()=>save([rate(9000)]),/fixture failure/);assert.deepEqual(state(),before);
      db.exec('DROP TRIGGER test_fail_rate');
      save([rate(7000,'08:00','18:00'),rate(10000,'18:00','08:00')]);
      assert.equal(prepaidQuote({mode:'hours',durationMinutes:120},new Date('2026-11-16T17:00:00'),1,90).totalAmount,17000);
      const remaining=state().tariffs.filter(t=>t.price_per_hour===7000);save(remaining);
      assert.throws(()=>prepaidQuote({mode:'hours',durationMinutes:120},new Date('2026-11-16T17:00:00'),1,90),/tarif belgilanmagan/);
      save([]);assert.equal(state().inherited,false);assert.equal(getActiveRateForMoment(at,false,1,90).configured,false,'last deletion cannot restore hidden 12000');
      assert.throws(()=>prepaidQuote({mode:'hours',durationMinutes:60},at,1,90),/tarif belgilanmagan/);
      save([rate(9000,'22:00','06:00',[7])]);
      assert.equal(getActiveRateForMoment(new Date('2026-11-16T01:00:00'),false,1,90).pricePerHour,9000,'Sunday rule crosses into Monday');
      assert.equal(getActiveRateForMoment(new Date('2026-11-17T01:00:00'),false,1,90).configured,false);
      assert.throws(()=>validateRoomTariffs([rate(7000,'22:00','06:00',[7]),rate(9000,'01:00','02:00',[1])]),/ustma-ust/);
      assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    } finally {db.close();}
  `);
  const run=spawnSync(process.execPath,['case.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test'},encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
