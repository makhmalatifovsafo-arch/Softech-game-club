import fs from 'node:fs';
import assert from 'node:assert/strict';
import { PGlite } from '../.tools/postgres-test/node_modules/@electric-sql/pglite/dist/index.js';

const migration = fs.readFileSync('migrations/20261110_activation_hwid_unique.sql', 'utf8');
const insert = `INSERT INTO clubs(name,hardware_fingerprint,status)
  VALUES('Requested club',$1,'PENDING')
  ON CONFLICT(hardware_fingerprint) DO NOTHING`;

for (const legacy of ['missing', 'partial', 'nonunique']) {
  const db = await PGlite.create();
  try {
    await db.exec(`CREATE TABLE clubs(id serial PRIMARY KEY, name text,
      hardware_fingerprint text, status text);
      INSERT INTO clubs(name,status) VALUES('Existing unbound club','ACTIVE');`);
    if (legacy === 'partial') await db.exec(`CREATE UNIQUE INDEX idx_clubs_hardware_unique
      ON clubs(hardware_fingerprint) WHERE hardware_fingerprint IS NOT NULL`);
    if (legacy === 'nonunique') await db.exec(`CREATE INDEX idx_clubs_hardware_unique ON clubs(hardware_fingerprint)`);
    await assert.rejects(() => db.query(insert, ['HWID-REQUEST-TEST']), { code: '42P10' });
    await db.exec(migration);
    await db.exec(migration);
    await db.query(insert, ['HWID-REQUEST-TEST']);
    await db.exec(`UPDATE clubs SET status='ACTIVE' WHERE hardware_fingerprint='HWID-REQUEST-TEST'`);
    await db.query(insert, ['HWID-REQUEST-TEST']);
    const { rows } = await db.query('SELECT * FROM clubs ORDER BY id');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].name, 'Existing unbound club');
    assert.equal(rows[1].status, 'ACTIVE', 'Retry must preserve the approved license');
    console.log(`PASS activation migration: ${legacy} index, repeatable migration, safe retry`);
  } finally { await db.close(); }
}

const db = await PGlite.create();
try {
  await db.exec(`CREATE TABLE clubs(hardware_fingerprint text);
    INSERT INTO clubs VALUES('duplicate'),('duplicate')`);
  await assert.rejects(() => db.exec(migration), /Duplicate club HWIDs/);
  await db.exec('ROLLBACK');
  assert.equal((await db.query('SELECT count(*)::int n FROM clubs')).rows[0].n, 2);
  console.log('PASS duplicate HWIDs stop migration without deleting club data');
} finally { await db.close(); }
