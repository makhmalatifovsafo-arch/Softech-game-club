import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('prepaid prices, durations, tariff boundaries, midnight and invalid input',()=>{
  fs.mkdirSync('.test-output',{recursive:true});
  const root=fs.mkdtempSync(path.resolve('.test-output/prepaid-pricing-'));
  fs.cpSync('NetCafeServer/src',path.join(root,'src'),{recursive:true});
  fs.copyFileSync('NetCafeServer/schema.sql',path.join(root,'schema.sql'));
  fs.writeFileSync(path.join(root,'case.mjs'),`
    import assert from 'node:assert/strict';
    import {db,initDatabase} from './src/db.js';
    import {prepaidQuote} from './src/services/prepaidQuote.js';
    import {calculateIntervalPrice,calculateTimeFromAmount} from './src/services/pricingEngine.js';
    import {freezePrepaidRates,prepaidRefund} from './src/services/memberBilling.js';
    initDatabase();
    try {
      db.exec("DELETE FROM tariff_schedules; INSERT INTO zones(id,club_id,name) VALUES(90,1,'Day/night')");
      const add=db.prepare("INSERT INTO tariffs(id,club_id,zone_id,name,type,price_per_hour,start_time,end_time) VALUES(?,1,90,?,'HOURLY',?,?,?)");
      add.run('day','Day',7000,'10:00','17:00');add.run('night','Night',14000,'17:00','10:00');
      const start=new Date('2026-11-13T15:00:00');
      const quote=data=>prepaidQuote(data,start,1,90);
      assert.equal(quote({mode:'hours',durationMinutes:90,amount:1}).totalAmount,10500);
      const money=quote({mode:'price',amount:10000,durationMinutes:0});
      assert.equal(money.totalAmount,10000);
      assert.ok(Math.abs(money.totalSeconds-10000/7000*3600)<0.001);
      assert.equal(calculateIntervalPrice(start,money.endTime,false,1,90).totalAmount,10000);
      const crossing=prepaidQuote({mode:'amount',amount:10000},new Date('2026-11-13T16:30:00'),1,90);
      assert.equal(crossing.totalAmount,10000);assert.equal(crossing.breakdown.length,2);
      assert.ok(Math.abs(crossing.totalSeconds-(1800+6500/14000*3600))<0.001);
      const until=prepaidQuote({mode:'endtime',targetEndTime:'18:00'},new Date('2026-11-13T16:00:00'),1,90);
      assert.equal(until.totalAmount,21000);assert.equal(until.totalMinutes,120);
      const midnight=prepaidQuote({mode:'END_TIME',targetEndTime:'01:00'},new Date('2026-11-13T23:00:00'),1,90);
      assert.equal(midnight.totalAmount,28000);assert.equal(midnight.totalMinutes,120);
      assert.equal(new Date(midnight.endTime).getDate(),14,'Clock-only end belongs to the start date, then rolls to next day');
      assert.equal(calculateIntervalPrice(start,start,false,1,90).totalAmount,0,'Equal explicit instants must never charge 24 hours');
      assert.equal(quote({mode:'endtime',targetEndTime:'2026-11-13T15:00:30'}).totalAmount,58);
      for(const data of [
        {mode:'price',amount:0},{mode:'price',amount:''},{mode:'price',amount:-1},{mode:'price',amount:NaN},
        {mode:'hours',durationMinutes:0},{mode:'hours',durationMinutes:-1},{mode:'hours',durationMinutes:4321},
        {mode:'endtime',targetEndTime:'bad'},{mode:'endtime',targetEndTime:'25:00'},{mode:'endtime',targetEndTime:'10:99'},
        {mode:'endtime',targetEndTime:'2026-11-12T15:00:00'},{mode:'endtime',targetEndTime:start},
        {mode:'unknown'},{mode:'price',amount:1000000000}
      ]) assert.throws(()=>quote(data),undefined,JSON.stringify(data));
      db.prepare("INSERT INTO computers(id,club_id,pc_number,name,zone_id) VALUES('partial-pc',1,970,'Partial',90)").run();
      const partial=quote({mode:'amount',amount:100});
      const plan=freezePrepaidRates('partial-pc',start,partial.endTime);
      const session={started_at:start.toISOString(),ends_at:partial.endTime,paid_amount:100,prepaid_rate_plan:JSON.stringify(plan)};
      assert.equal(prepaidRefund(session,new Date((Date.parse(partial.endTime)+start.getTime())/2)).usedAmount,50);
      assert.equal(prepaidRefund(session,new Date(partial.endTime)).amount,0,'Fractional last minute is fully billed on expiry');
      db.prepare("DELETE FROM tariffs WHERE id='night'").run();
      assert.throws(()=>prepaidQuote({mode:'hours',durationMinutes:120},new Date('2026-11-13T16:30:00'),1,90),/tarif belgilanmagan/);
      assert.throws(()=>prepaidQuote({mode:'amount',amount:10000},new Date('2026-11-13T16:30:00'),1,90),/tarif belgilanmagan/);
      assert.equal(calculateTimeFromAmount(new Date('2026-11-13T16:00:00'),7000,false,1,90,true).totalMinutes,60,'Exact boundary must not request a missing next tariff');
    } finally {db.close();}
  `);
  const run=spawnSync(process.execPath,['case.mjs'],{cwd:root,env:{...process.env,NODE_ENV:'test'},encoding:'utf8',windowsHide:true,timeout:20000});
  assert.equal(run.status,0,run.stdout+'\n'+run.stderr);
});
