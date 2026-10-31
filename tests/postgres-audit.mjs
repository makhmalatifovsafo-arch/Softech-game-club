import fs from 'node:fs';import assert from 'node:assert/strict';
import {PGlite} from '../.tools/postgres-test/node_modules/@electric-sql/pglite/dist/index.js';
const db=await PGlite.create();
try{
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE PUBLICATION supabase_realtime;');
 await db.exec(fs.readFileSync('supabase_schema.sql','utf8'));
 await db.exec(fs.readFileSync('migrations/20261031_cloud_audit.sql','utf8'));
 await db.exec(fs.readFileSync('migrations/20261031_cloud_audit.sql','utf8'));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM super_admins')).rows[0].n,0,'No default admin/password');
 await db.exec("INSERT INTO clubs(id,name,license_expires_at) VALUES(1,'Test club',now()+interval '10 days');");
 const args=[1,100000,'CASH',1,'test','admin','11111111-1111-4111-8111-111111111111'];
 const sql='SELECT softech_record_subscription_payment($1,$2,$3,$4,$5,$6,$7) AS result';
 await db.exec('SET ROLE service_role');
 const first=(await db.query(sql,args)).rows[0].result;assert.equal(first.success,true);
 const again=(await db.query(sql,args)).rows[0].result;assert.equal(again.paymentId,first.paymentId);assert.equal(again.newExpiryDate,first.newExpiryDate);
 await assert.rejects(()=>db.query(sql,[1,-1,...args.slice(2)]));
 await assert.rejects(()=>db.query(sql,[1,200000,...args.slice(2)]));
 assert.equal((await db.query('SELECT count(*)::int AS n FROM subscription_payments')).rows[0].n,1);
 const prior=(await db.query('SELECT license_expires_at FROM clubs WHERE id=1')).rows[0].license_expires_at;
 await db.exec('RESET ROLE; CREATE FUNCTION reject_payment_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'test insert failure\'; END $$; CREATE TRIGGER test_failure BEFORE INSERT ON subscription_payments FOR EACH ROW EXECUTE FUNCTION reject_payment_test(); SET ROLE service_role;');
 await assert.rejects(()=>db.query(sql,[...args.slice(0,6),'22222222-2222-4222-8222-222222222222']));
 assert.equal(String((await db.query('SELECT license_expires_at FROM clubs WHERE id=1')).rows[0].license_expires_at),String(prior),'Failed payment must not extend license');
 for(const role of ['anon','authenticated']){
  await db.exec('RESET ROLE; SET ROLE '+role);
  await assert.rejects(()=>db.query('SELECT * FROM super_admins'));
  await assert.rejects(()=>db.query("UPDATE clubs SET status='ACTIVE' WHERE id=1"));
  await assert.rejects(()=>db.query(sql,args));
 }
 console.log('PASS PostgreSQL schema, repeatable migration, payment idempotency, rollback and anon/authenticated restrictions');
}finally{await db.close();}
