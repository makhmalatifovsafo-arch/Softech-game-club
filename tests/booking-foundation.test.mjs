import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Worker } from 'node:worker_threads';
import { initializeBookings } from '../NetCafeServer/src/services/bookingSchema.js';
import { initializeMoneyOperations } from '../NetCafeServer/src/services/moneyOperations.js';
import { assertBookingAvailability, bookingInterval } from '../NetCafeServer/src/services/bookingAvailability.js';
import { createFreeReservation, cancelFreeReservation, readBookingSettings, saveBookingSettings, expireFreeReservations } from '../NetCafeServer/src/services/bookingFoundation.js';
import { updateBookingStatus } from '../NetCafeServer/src/services/bookingService.js';

const schema = fs.readFileSync('NetCafeServer/schema.sql','utf8');
const now = Date.parse('2030-01-01T10:00:00+05:00');
const actor = { id: 7, username: 'Test cashier', clubId: 1, role: 'administrator', permissions: ['session:manage'] };
const input = (overrides={}) => ({requestId:'booking-test-0001',computerId:'pc-a',customerName:'TEST',
  startTime:'2030-01-01T18:00:00+05:00',endTime:'2030-01-01T20:00:00+05:00',...overrides});
function fixture(t,{legacy=false,file=':memory:'}={}) {
  const db = new DatabaseSync(file); t.after(()=>db.close());
  db.exec(schema);
  db.exec(`INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Test','Test','0','2099-01-01'),(2,'Other','Test','0','2099-01-01');
    INSERT INTO computers(id,club_id,pc_number,name) VALUES('pc-a',1,1,'PC-01'),('pc-b',1,2,'PC-02'),('other-a',2,1,'PC-01');
    INSERT INTO tariffs(id,club_id,name,price_per_hour) VALUES('test-rate',1,'Test',7000);`);
  if (legacy) db.exec(`DROP TABLE bookings;
    CREATE TABLE bookings(id INTEGER PRIMARY KEY AUTOINCREMENT,club_id INTEGER NOT NULL DEFAULT 1,
      computer_id INTEGER NOT NULL,user_id INTEGER,customer_name TEXT,customer_phone TEXT,start_time DATETIME NOT NULL,
      end_time DATETIME NOT NULL,note TEXT,status TEXT DEFAULT 'CONFIRMED' CHECK(status IN ('PENDING','CONFIRMED','CANCELLED','COMPLETED')),
      created_by TEXT,created_at DATETIME DEFAULT CURRENT_TIMESTAMP,extra_legacy TEXT,FOREIGN KEY(club_id) REFERENCES clubs(id));`);
  initializeMoneyOperations(db);
  return db;
}
function migrate(db) {db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');try{initializeBookings(db);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}finally{db.exec('PRAGMA foreign_keys=ON');}}
function legacyBooking(db,id,pc=1,club=1,start='2030-01-01T18:00:00+05:00',end='2030-01-01T20:00:00+05:00') {
  db.prepare("INSERT INTO bookings(id,club_id,computer_id,customer_name,start_time,end_time,extra_legacy) VALUES(?,?,?,'Old',?,?,'keep-me')")
    .run(id,club,pc,start,end);
}

test('pausing new bookings preserves receipts, collisions, cancellation, tenant scope and older settings clients',t=>{
  const db=fixture(t);migrate(db);
  const first=createFreeReservation(db,actor,input(),now);
  const settings={requestId:'pause-bookings-01',expectedRevision:0,graceMinutes:10,creationEnabled:false};
  assert.throws(()=>saveBookingSettings(db,{...actor,role:'client'},settings,now),{statusCode:403});
  saveBookingSettings(db,{...actor,permissions:[]},settings,now);
  migrate(db); // An upgrade must not silently re-enable a paused club.
  assert.equal(readBookingSettings(db,actor).creationEnabled,false);
  assert.equal(readBookingSettings(db,{...actor,clubId:2}).creationEnabled,true);
  assert.equal(createFreeReservation(db,actor,input(),now).replayed,true);
  assert.throws(()=>createFreeReservation(db,actor,input({requestId:'blocked-new-01',computerId:'pc-b'}),now),{code:'BOOKING_CREATION_PAUSED'});
  assert.throws(()=>assertBookingAvailability(db,{clubId:1,computerId:'pc-a',start:input().startTime,end:input().endTime}),{statusCode:409});
  saveBookingSettings(db,actor,{requestId:'older-settings-01',expectedRevision:1,graceMinutes:12},now);
  assert.equal(readBookingSettings(db,actor).creationEnabled,false);
  cancelFreeReservation(db,actor,{requestId:'paused-cancel-01',bookingId:first.body.booking.id,expectedRevision:1,reason:'Cancel'},now);
  saveBookingSettings(db,actor,{...settings,requestId:'resume-booking-01',expectedRevision:2,creationEnabled:true},now);
  assert.equal(createFreeReservation(db,actor,input({requestId:'blocked-new-01',computerId:'pc-b'}),now).status,201);
});

test('booking migration preserves real legacy CHECK rows, extra columns, indexes, child references and sequence', t=>{
  const db=fixture(t,{legacy:true});legacyBooking(db,1);legacyBooking(db,99,2);db.exec('DELETE FROM bookings WHERE id=99');
  db.exec(`CREATE INDEX custom_booking_name ON bookings(customer_name);
    CREATE TABLE booking_child(id INTEGER PRIMARY KEY,booking_id INTEGER REFERENCES bookings(id)); INSERT INTO booking_child VALUES(1,1);`);
  migrate(db);migrate(db);
  const row=db.prepare('SELECT * FROM bookings WHERE id=1').get();
  assert.equal(row.extra_legacy,'keep-me');assert.equal(row.computer_ref,'pc-a');assert.equal(row.needs_review,0);
  assert.equal(row.no_show_at,'2030-01-01T13:10:00.000Z');
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='custom_booking_name'").get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('SELECT booking_id FROM booking_child').get().booking_id,1);
  const result=createFreeReservation(db,actor,input({computerId:'pc-b'}),now);assert.ok(result.body.booking.id>99);
  // The schema supports lifecycle states; the public legacy route cannot forge them.
  db.exec("UPDATE bookings SET status='ACTIVE' WHERE id=1");
  assert.throws(()=>updateBookingStatus(db,1,1,'ACTIVE'),{statusCode:409});
  assert.throws(()=>db.exec("UPDATE bookings SET status='INVENTED' WHERE id=1"),/CHECK/);
});

test('migration marks ambiguous, missing and invalid legacy reservations without changing original data',t=>{
  const db=fixture(t,{legacy:true});
  // Simulate a historic installation before PC-number uniqueness was enforced.
  db.exec("DROP INDEX idx_computers_club_pc_number; INSERT INTO computers(id,club_id,pc_number,name) VALUES('duplicate',1,1,'duplicate')");
  legacyBooking(db,1);legacyBooking(db,2,0);legacyBooking(db,3,2,1,'invalid','invalid');legacyBooking(db,4,1,2);
  migrate(db);
  const rows=db.prepare('SELECT * FROM bookings ORDER BY id').all();
  assert.equal(rows[0].computer_ref,null);assert.equal(rows[0].review_reason,'PC_REFERENCE');
  assert.equal(rows[1].computer_id,0);assert.equal(rows[1].needs_review,1);
  assert.equal(rows[2].start_time,'invalid');assert.equal(rows[2].review_reason,'TIME_INTERVAL');
  assert.equal(rows[3].computer_ref,'other-a');assert.equal(rows[3].needs_review,0);
});

test('failed migration rolls back original table and rows rather than discarding bad history',t=>{
  const db=fixture(t,{legacy:true});legacyBooking(db,1);
  db.exec("PRAGMA ignore_check_constraints=ON; UPDATE bookings SET status='UNKNOWN'; PRAGMA ignore_check_constraints=OFF");
  assert.throws(()=>migrate(db),/CHECK/);
  assert.equal(db.prepare('SELECT status,extra_legacy FROM bookings').get().status,'UNKNOWN');
  assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='bookings_upgrade'").get().n,0);
  assert.ok(!db.prepare('PRAGMA table_info(bookings)').all().some(c=>c.name==='computer_ref'));
});

test('free creation, cancellation, persistent receipts and audit are atomic and do not touch money or sessions',t=>{
  const db=fixture(t);migrate(db);
  const first=createFreeReservation(db,actor,input(),now);
  assert.equal(first.status,201);assert.equal(first.body.booking.status,'CONFIRMED');
  assert.equal(createFreeReservation(db,actor,input(),now+86400000).replayed,true);
  assert.throws(()=>createFreeReservation(db,actor,input({customerName:'Changed'}),now),{statusCode:409});
  for(const table of ['sessions','transactions','client_transactions'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM audit_logs').get().n,1);
  const cancel={requestId:'cancel-test-0001',bookingId:first.body.booking.id,expectedRevision:1,reason:'Mijoz bekor qildi'};
  assert.throws(()=>cancelFreeReservation(db,{...actor,clubId:2},cancel,now),{statusCode:404});
  assert.equal(cancelFreeReservation(db,actor,cancel,now).body.booking.status,'CANCELLED');
  assert.equal(cancelFreeReservation(db,actor,cancel,now).replayed,true);
  assert.equal(db.prepare('SELECT count(*) n FROM audit_logs').get().n,2);
  assert.throws(()=>db.exec('DELETE FROM bookings'),/taqiqlangan/);
  assert.throws(()=>db.exec('DELETE FROM audit_logs'),/taqiqlangan/);
  assert.throws(()=>updateBookingStatus(db,1,first.body.booking.id,'CONFIRMED'),{statusCode:409});
});

test('audit write failure rolls back reservation and receipt together',t=>{
  const db=fixture(t);migrate(db);
  db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'disk test'); END");
  assert.throws(()=>createFreeReservation(db,actor,input(),now),/disk test/);
  assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM money_operation_receipts').get().n,0);
});

test('overlaps, adjacency, midnight and live VIP conflicts use one authoritative availability check',t=>{
  const db=fixture(t);migrate(db);createFreeReservation(db,actor,input(),now);
  assert.throws(()=>createFreeReservation(db,actor,input({requestId:'overlap-test-01',startTime:'2030-01-01T19:59:00+05:00'}),now),{code:'BOOKING_CONFLICT'});
  createFreeReservation(db,actor,input({requestId:'adjacent-test-01',startTime:'2030-01-01T20:00:00+05:00',endTime:'2030-01-02T01:00:00+05:00'}),now);
  assert.throws(()=>assertBookingAvailability(db,{clubId:1,computerId:'pc-a',start:'2030-01-01T10:00:00+05:00',end:'2030-01-01T11:00:00+05:00',openEnded:true}),{code:'BOOKING_CONFLICT'});
  db.exec("INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,notes) VALUES('vip',1,'pc-b','test-rate','2029-12-01T00:00:00Z','2029-12-02T00:00:00Z','POSTPAID')");
  assert.throws(()=>createFreeReservation(db,actor,input({requestId:'vip-conflict-01',computerId:'pc-b'}),now),{code:'SESSION_CONFLICT'});
  assert.throws(()=>bookingInterval('2030-01-01 18:00','2030-01-01 19:00'));
  assert.throws(()=>bookingInterval('2030-02-30T18:00:00+05:00','2030-03-03T19:00:00+05:00'));
  assert.throws(()=>createFreeReservation(db,actor,input({requestId:'wrong-club-01',computerId:'other-a'}),now),{statusCode:404});
});

test('cashier and manager may change only booking grace; revisions and permission checks are enforced',t=>{
  const db=fixture(t);migrate(db);
  const cashier={...actor,permissions:[]};
  assert.deepEqual(readBookingSettings(db,cashier),{graceMinutes:10,revision:0,creationEnabled:true});
  const data={requestId:'settings-test-01',expectedRevision:0,graceMinutes:15};
  assert.equal(saveBookingSettings(db,cashier,data,now).body.settings.graceMinutes,15);
  assert.equal(saveBookingSettings(db,cashier,data,now).replayed,true);
  assert.throws(()=>saveBookingSettings(db,actor,{...data,requestId:'settings-test-02'},now),{code:'REVISION_CONFLICT'});
  assert.throws(()=>saveBookingSettings(db,actor,{...data,requestId:'settings-test-03',graceMinutes:181},now),{statusCode:400});
  assert.throws(()=>createFreeReservation(db,cashier,input(),now),{statusCode:403});
  assert.throws(()=>saveBookingSettings(db,{...actor,role:'client'},data,now),{statusCode:403});
  const booking=createFreeReservation(db,actor,input(),now).body.booking;
  saveBookingSettings(db,{...actor,role:'club_owner'},{requestId:'settings-test-04',expectedRevision:1,graceMinutes:30},now);
  assert.equal(db.prepare('SELECT grace_minutes FROM bookings WHERE id=?').get(booking.id).grace_minutes,15);
});

test('no-show is bounded, persistent, once-only; linked sessions survive and cash refunds stay pending',t=>{
  const db=fixture(t);migrate(db);
  const a=createFreeReservation(db,actor,input(),now).body.booking;
  createFreeReservation(db,actor,input({requestId:'paid-booking-01',computerId:'pc-b',payment:{kind:'CASH',amount:3000}}),now);
  db.exec("INSERT INTO computers(id,club_id,pc_number,name) VALUES('pc-c',1,3,'PC-03')");
  const linked=createFreeReservation(db,actor,input({requestId:'linked-booking-01',computerId:'pc-c'}),now).body.booking;
  db.prepare("UPDATE bookings SET session_id='existing-session' WHERE id=?").run(linked.id);
  assert.equal(expireFreeReservations(db,1,Date.parse(a.no_show_at)-1),0);
  assert.equal(expireFreeReservations(db,1,Date.parse(a.no_show_at)),2);
  assert.equal(expireFreeReservations(db,1,Date.parse(a.no_show_at)),0);
  assert.equal(db.prepare("SELECT status FROM bookings WHERE computer_ref='pc-b'").get().status,'NO_SHOW');
  assert.equal(db.prepare("SELECT count(*) n FROM booking_funds WHERE kind='REFUND'").get().n,0);
  assert.equal(db.prepare('SELECT status FROM bookings WHERE id=?').get(linked.id).status,'CONFIRMED');
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action_type='BOOKING_NO_SHOW'").get().n,2);
});

test('two connections preserve receipts and reject a second reservation of the same slot',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'softech-booking-'));
  const file=path.join(dir,'test.db');
  const db=fixture(t,{file});migrate(db);db.exec('PRAGMA journal_mode=WAL');
  const second=new DatabaseSync(file);t.after(()=>second.close());
  createFreeReservation(db,actor,input(),now);
  assert.equal(createFreeReservation(second,actor,input(),now).replayed,true);
  assert.throws(()=>createFreeReservation(second,actor,input({requestId:'second-cashier-01'}),now),{code:'BOOKING_CONFLICT'});
  t.after(()=>{
    for(const fileName of ['test.db','test.db-wal','test.db-shm'])fs.rmSync(path.join(dir,fileName),{force:true});
    fs.rmdirSync(dir);
  });
});

test('simultaneous cashiers commit exactly one booking and audit for the same PC interval',{timeout:15000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'softech-booking-race-'));
  const file=path.join(dir,'test.db');const db=fixture(t,{file});migrate(db);db.exec('PRAGMA journal_mode=WAL');
  const code=`const {parentPort,workerData:w}=require('node:worker_threads');
    (async()=>{const {DatabaseSync}=require('node:sqlite');const {createFreeReservation}=await import(w.module);
    const db=new DatabaseSync(w.file);db.exec('PRAGMA busy_timeout=5000');parentPort.postMessage('ready');
    parentPort.once('message',()=>{let result;try{result={status:createFreeReservation(db,w.actor,w.input,w.now).status};}
    catch(e){result={status:e.statusCode,error:e.message};}finally{db.close();}parentPort.postMessage(result);});})();`;
  const jobs=[1,2].map(n=>{
    const worker=new Worker(code,{eval:true,workerData:{file,actor,input:input({requestId:'race-booking-000'+n}),now,
      module:new URL('../NetCafeServer/src/services/bookingFoundation.js',import.meta.url).href}});
    let resolveReady;
    const ready=new Promise(resolve=>{resolveReady=resolve;});
    const result=new Promise((resolve,reject)=>{worker.on('message',m=>m==='ready'?resolveReady():resolve(m));worker.on('error',reject);});
    return {worker,ready,result};
  });
  t.after(async()=>{await Promise.all(jobs.map(j=>j.worker.terminate()));});
  await Promise.all(jobs.map(j=>j.ready));jobs.forEach(j=>j.worker.postMessage('go'));
  const results=await Promise.all(jobs.map(j=>j.result));
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409],JSON.stringify(results));
  assert.equal(db.prepare('SELECT count(*) n FROM bookings').get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM audit_logs WHERE action_type='BOOKING_CREATED'").get().n,1);
  t.after(()=>{for(const fileName of ['test.db','test.db-wal','test.db-shm'])fs.rmSync(path.join(dir,fileName),{force:true});fs.rmdirSync(dir);});
});
