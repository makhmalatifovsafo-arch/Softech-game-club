import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '../.tools/postgres-test/node_modules/@electric-sql/pglite/dist/index.js';
const db=await PGlite.create();
try {
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE clubs(id bigint PRIMARY KEY); INSERT INTO clubs VALUES(1),(2);');
 const sql=fs.readFileSync('migrations/20261110_mobile_dashboard.sql','utf8');await db.exec(sql);await db.exec(sql);
 await db.exec('SET ROLE service_role');
 const put=async(amount,date)=>db.query('SELECT softech_mobile_snapshot_upsert($1::jsonb)',[JSON.stringify([{club_id:1,data_key:'report:2026-11-10',payload:{amount},captured_at:date}])]);
 await put(100,'2026-11-10T12:00:00Z');await put(100,'2026-11-10T12:00:00Z');await put(999,'2026-11-10T11:00:00Z');
 assert.equal((await db.query('SELECT payload FROM mobile_dashboard_data WHERE club_id=1')).rows[0].payload.amount,100);
 assert.equal((await db.query('SELECT * FROM mobile_dashboard_data WHERE club_id=2')).rows.length,0);
 for(let i=0;i<4;i++)assert.equal((await db.query('SELECT softech_mobile_login_limit($1,3) AS allowed',['test'])).rows[0].allowed,i<3);
 await db.exec('RESET ROLE; SET ROLE anon;');
 await assert.rejects(()=>db.query('SELECT * FROM mobile_dashboard_data'),/permission denied/);
 await assert.rejects(()=>put(99,'2026-11-10T15:00:00Z'),/permission denied/);
 await db.exec('RESET ROLE');
 console.log('PASS PostgreSQL mobile dashboard: repeatable migration, RLS, atomic snapshot replacement and persistent login limits');
}finally{await db.close();}
