import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
import {createBooking,updateBookingStatus} from '../NetCafeServer/src/services/bookingService.js';
import {applyCloudCommands,commandResults} from '../NetCafeServer/src/services/cloudCommands.js';
import {deliverCommands} from '../src/services/commandDelivery.js';

test('booking validation, tenant isolation, time zones and reactivation conflicts',()=>{
 const db=new DatabaseSync(':memory:');db.exec("CREATE TABLE computers(id TEXT,club_id INTEGER,pc_number INTEGER,name TEXT);INSERT INTO computers VALUES('pc_1_12',1,12,'PC-12'),('pc_2_12',2,12,'PC-12');CREATE TABLE bookings(id INTEGER PRIMARY KEY,club_id INTEGER,computer_id INTEGER,customer_name TEXT,customer_phone TEXT,start_time TEXT,end_time TEXT,note TEXT,status TEXT,created_by TEXT);");
 const input={computerId:'pc_1_12',customerName:'Customer',startTime:'2026-11-01T10:00:00+05:00',endTime:'2026-11-01T11:00:00+05:00'};
 try{
  for(const change of [{startTime:'invalid'},{endTime:input.startTime},{endTime:'2026-11-01T09:00:00+05:00'},{customerName:''},{computerId:'unknown'},{computerId:'pc_2_12'}])assert.throws(()=>createBooking(db,1,1,{...input,...change}));
  const first=createBooking(db,1,1,input);assert.equal(first.computerId,12);assert.equal(first.startTime,'2026-11-01T05:00:00.000Z');
  assert.throws(()=>createBooking(db,1,1,{...input,startTime:'2026-11-01T05:30:00Z',endTime:'2026-11-01T06:30:00Z'}),/band/);
  const next=createBooking(db,1,1,{...input,startTime:input.endTime,endTime:'2026-11-01T12:00:00+05:00'});assert.ok(next.id);
  assert.throws(()=>updateBookingStatus(db,2,first.id,'CANCELLED'),/topilmadi/);
  updateBookingStatus(db,1,first.id,'CANCELLED');createBooking(db,1,1,input);
  assert.throws(()=>updateBookingStatus(db,1,first.id,'CONFIRMED'),/band/);
 }finally{db.close();}
});

test('signed cloud commands are bound, persistently deduplicated, deferred while busy and acknowledged',async()=>{
 const cloud=new DatabaseSync(':memory:'),local=new DatabaseSync(':memory:');
 cloud.exec("CREATE TABLE remote_commands(id INTEGER PRIMARY KEY,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);");
 const enqueue=(id,action,options)=>cloud.prepare("INSERT INTO remote_commands VALUES(?,7,?,?,'PENDING',NULL)").run(id,action,JSON.stringify(options));
 enqueue(1,'BROADCAST_ANNOUNCEMENT',{message:'Test'});enqueue(2,'RESTART_SERVER',{delaySeconds:1,force:false});
 const club={id:7,hardware_fingerprint:'test-hwid'},license={clubId:7,hardwareFingerprint:'test-hwid'};
 let broadcasts=0,restarts=0,busy=true;
 const effects={broadcast(){broadcasts++;},maintain:async (action,options)=>{assert.equal(action,'RESTART_SERVER');assert.equal(options.delaySeconds,1);restarts++;return {complete:true};},hasActiveSessions:()=>busy};
 try{
  const envelopes=await deliverCommands({db:cloud},club);
  await applyCloudCommands(local,envelopes,{...license,hardwareFingerprint:'other'},effects);assert.equal(broadcasts,0);
  await applyCloudCommands(local,[{...envelopes[0],payload:{...envelopes[0].payload,options:{message:'forged'}}}],license,effects);assert.equal(broadcasts,0);
  await applyCloudCommands(local,envelopes,license,effects);assert.equal(broadcasts,1);assert.equal(restarts,0);
  await applyCloudCommands(local,envelopes,license,effects);assert.equal(broadcasts,1);
  busy=false;await applyCloudCommands(local,envelopes,license,effects);assert.equal(restarts,1);
  await applyCloudCommands(local,envelopes,license,effects);assert.equal(restarts,1);
  assert.equal((await deliverCommands({db:cloud},club,commandResults(local))).length,0);
  enqueue(3,'RESTART_SERVER',{force:true});await applyCloudCommands(local,await deliverCommands({db:cloud},club),license,{...effects,maintain:async()=>{throw Error('simulated failure');}});
  assert.equal(commandResults(local).find(x=>x.id===3).status,'FAILED');
 }finally{cloud.close();local.close();}
});

test('local cloud billing is atomic, idempotent and preserves fixed zero tariffs',async()=>{
 const dir=fs.mkdtempSync(path.resolve('.test-output/billing-audit-'));process.env.SOFTECH_CLOUD_DATA_DIR=dir;process.env.SUPERADMIN_INITIAL_PASSWORD='isolated-audit-password';process.env.SUPERADMIN_INITIAL_PIN='2468';
 const {db,initDatabase}=await import('../src/db/connection.js');initDatabase();const {BillingService}=await import('../src/services/billingService.js');
 try{
  db.prepare("INSERT INTO clubs(name,slug,owner_name,owner_phone,city,total_workstations,license_expires_at) VALUES('Audit','audit','Owner','123','Test',12,?)").run(new Date(Date.now()+86400000).toISOString());
  const club=db.prepare("SELECT * FROM clubs WHERE slug='audit'").get();const input={amount:500000,monthsAdded:1,paymentMethod:'CASH',requestId:crypto.randomUUID()};
  const first=BillingService.recordPayment(club.id,input),again=BillingService.recordPayment(club.id,input);assert.equal(first.paymentId,again.paymentId);assert.equal(first.newExpiryDate,again.newExpiryDate);
  assert.throws(()=>BillingService.recordPayment(club.id,{...input,amount:700000}));
  for(const change of [{amount:-1},{amount:Infinity},{monthsAdded:0},{monthsAdded:1.5}])assert.throws(()=>BillingService.recordPayment(club.id,{...input,...change,requestId:crypto.randomUUID()}));
  const before=db.prepare('SELECT license_expires_at FROM clubs WHERE id=?').get(club.id).license_expires_at;
  db.exec("CREATE TRIGGER reject_payment BEFORE INSERT ON subscription_payments BEGIN SELECT RAISE(ABORT,'test failure');END;");
  assert.throws(()=>BillingService.recordPayment(club.id,{...input,requestId:crypto.randomUUID()}));assert.equal(db.prepare('SELECT license_expires_at FROM clubs WHERE id=?').get(club.id).license_expires_at,before);
  assert.equal(BillingService.calculateMonthlyFee({tariff_type:'FIXED_MONTHLY',tariff_fixed_price:0}).monthlyFee,0);
 }finally{db.close();}
});
