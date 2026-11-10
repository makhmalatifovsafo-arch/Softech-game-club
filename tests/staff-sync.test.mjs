import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { ManagerAccountService } from '../src/services/managerAccountService.js';
import { deliverStaffAccounts } from '../src/services/staffAccountSync.js';

test('administrator sync is independent of telemetry, concurrent logins share delivery, signatures and rotation remain enforced', async () => {
  fs.mkdirSync('.test-output', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.test-output/staff-sync-'));
  for (const entry of ['src', 'schema.sql', 'package.json']) fs.cpSync(path.join('NetCafeServer', entry), path.join(dir, entry), { recursive: true });
  process.env.NODE_ENV = 'test';
  const { db, initDatabase } = await import(pathToFileURL(path.join(dir, 'src/db.js')));
  initDatabase();
  const { createStaffAccountSync } = await import(pathToFileURL(path.join(dir, 'src/services/staffAccountSync.js')));
  const { verifyPassword } = await import(pathToFileURL(path.join(dir, 'src/auth.js')));
  const cloud = new DatabaseSync(':memory:');
  // Deliberately no metrics, workstation cache or command-delivery tables.
  cloud.exec(`CREATE TABLE clubs(id INTEGER PRIMARY KEY,hardware_fingerprint TEXT,status TEXT,license_expires_at TEXT);
    INSERT INTO clubs VALUES(7,'test-hardware','ACTIVE','2099-01-01');
    CREATE TABLE remote_commands(id INTEGER PRIMARY KEY AUTOINCREMENT,club_id INTEGER,command_type TEXT,payload TEXT,status TEXT,executed_at TEXT);`);
  const license = { clubId: 7, hardwareFingerprint: 'test-hardware', status: 'ACTIVE', expiresAt: '2099-01-01' };
  const signedLicense = { payload: license, signature: crypto.createHmac('sha256', process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(license)).digest('hex') };
  let calls = 0;
  const sync = createStaffAccountSync({ db, getLicense: () => license, getSignedLicense: () => signedLicense, getCloudUrl: () => 'http://test.invalid',
    fetcher: async (url, request) => {
      calls++;
      assert.equal(new URL(url).pathname, '/api/telemetry/staff-accounts');
      const body = JSON.parse(request.body);
      assert.equal('password' in body, false);
      return { ok: true, json: () => deliverStaffAccounts({ db: cloud }, body) };
    } });
  try {
    const admin = new ManagerAccountService({ db: cloud, role: 'administrator' });
    await admin.save(7, { username: 'new_cashier', password: 'cashier-private-password' });
    const first = sync(), concurrent = sync();
    assert.equal(first, concurrent);
    assert.equal((await first).success, true);
    assert.equal(calls, 1);
    let user = db.prepare('SELECT * FROM users WHERE username=?').get('new_cashier');
    assert.equal(user.role, 'administrator');
    assert.ok(verifyPassword('cashier-private-password', user.password_hash));
    await sync();
    assert.equal((await admin.summary(7)).applied, true);
    await admin.save(7, { username: 'renamed_cashier', password: 'changed-cashier-password' });
    // A broken manager record must not prevent independent cashier delivery.
    cloud.prepare("INSERT INTO remote_commands(club_id,command_type,payload,status) VALUES(7,'RESET_ADMIN_PASSWORD',?,'PENDING')")
      .run(JSON.stringify({ action: 'PROVISION_MANAGER', username: 'bad_record' }));
    assert.equal((await sync()).success, false);
    user = db.prepare('SELECT * FROM users WHERE username=?').get('renamed_cashier');
    assert.ok(verifyPassword('changed-cashier-password', user.password_hash));
    assert.equal(verifyPassword('cashier-private-password', user.password_hash), false);
    await assert.rejects(() => deliverStaffAccounts({ db: cloud }, { clubId: 8, signedLicense }), error => error.statusCode === 401);
    await assert.rejects(() => deliverStaffAccounts({ db: cloud }, { clubId: 7, signedLicense: { ...signedLicense, signature: '0'.repeat(64) } }), error => error.statusCode === 401);
    cloud.exec("UPDATE clubs SET status='BLOCKED'");
    await assert.rejects(() => deliverStaffAccounts({ db: cloud }, { clubId: 7, signedLicense }), error => error.statusCode === 403);
  } finally { db.close(); cloud.close(); }
});
