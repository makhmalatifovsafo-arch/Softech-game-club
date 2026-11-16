import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildServerAnalytics } from '../NetCafeServer/src/services/analyticsService.js';

test('server statistics use retained receipts, real durations and occupied minutes without changing billing',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE computers(id INTEGER PRIMARY KEY,club_id INTEGER,pc_number INTEGER,name TEXT,zone TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,club_id INTEGER,computer_id INTEGER,customer_name TEXT,started_at TEXT,ends_at TEXT,status TEXT);
    CREATE TABLE transactions(id TEXT PRIMARY KEY,club_id INTEGER,session_id TEXT,amount REAL,payment_type TEXT,payment_method TEXT,transaction_type TEXT,notes TEXT,created_at TEXT);
    CREATE TABLE client_transactions(id INTEGER PRIMARY KEY,club_id INTEGER,user_id INTEGER,session_id TEXT,amount REAL,type TEXT,payment_method TEXT,category TEXT,created_at TEXT);
    CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT);
    CREATE TABLE bar_orders(id INTEGER PRIMARY KEY,club_id INTEGER,order_number TEXT,computer_id INTEGER,session_id TEXT,user_id INTEGER,total_amount REAL,payment_status TEXT,payment_method TEXT,approval_status TEXT,created_at TEXT,paid_at TEXT);
    CREATE TABLE bar_order_items(id INTEGER PRIMARY KEY,order_id INTEGER,bar_item_id INTEGER,item_name TEXT,quantity INTEGER,unit_price REAL,total_price REAL);
    CREATE TABLE bar_items(id INTEGER PRIMARY KEY,category TEXT);
    INSERT INTO computers VALUES(1,7,1,'PC-1','STANDARD'),(2,7,2,'PC-2','VIP');
    INSERT INTO sessions VALUES('s1',7,1,'Guest','2026-11-16T05:00:00.000Z','2026-11-16T06:00:00.000Z','COMPLETED');
    INSERT INTO transactions VALUES
      ('pay',7,'s1',10000,'CASH','CASH','PREPAID','', '2026-11-16T05:00:00.000Z'),
      ('refund',7,'s1',-5000,'REFUND','CASH','REFUND','REFUND','2026-11-16T06:00:00.000Z'),
      ('bar',7,'s1',3000,'CASH','CASH','BAR_SALE','BAR_SALE:1','2026-11-16T06:00:00.000Z'),
      ('topup',7,NULL,20000,'CASH','CASH','PREPAID','CLIENT_TOPUP:user','2026-11-16T06:00:00.000Z');
    INSERT INTO bar_orders VALUES(1,7,'ORD-1',1,'s1',NULL,3000,'PAID','CASH','CONFIRMED','2026-11-16T05:30:00.000Z','2026-11-16T06:00:00.000Z');
    INSERT INTO bar_order_items VALUES(1,1,1,'Cola',1,3000,3000);
    INSERT INTO bar_items VALUES(1,'DRINKS');
  `);
  try {
    const before=db.prepare('SELECT amount FROM transactions ORDER BY id').all();
    const result=buildServerAnalytics(db,{clubId:7,days:1,now:new Date('2026-11-16T07:00:00.000Z')});
    assert.equal(result.dailyRevenue[0].revenue,28000);
    assert.deepEqual(result.revenueSources,{games:5000,bar:3000,topup:20000});
    assert.equal(result.kpis.todayChecks,1);
    assert.equal(result.kpis.averageSessionMinutes,60);
    assert.equal(result.kpis.peakTime,'10:00–11:00');
    assert.equal(result.peakHours[10],50);
    assert.equal(result.computerStats.find(pc=>pc.id===1).totalRevenue,5000);
    assert.equal(result.computerStats.find(pc=>pc.id===1).totalHours,1);
    assert.deepEqual(db.prepare('SELECT amount FROM transactions ORDER BY id').all(),before,'Statistics must remain read-only');
  } finally { db.close(); }
});
