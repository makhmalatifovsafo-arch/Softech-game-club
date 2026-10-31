import crypto from 'node:crypto';
import { revokeUserSessions } from '../auth.js';

const accountTypes = {
  manager: { table: 'cloud_manager_state', kind: 'PROVISION_MANAGER', role: 'club_owner', permissions: ['*'] },
  administrator: {
    table: 'cloud_administrator_state', kind: 'PROVISION_ADMINISTRATOR', role: 'administrator',
    permissions: ['session:manage', 'message:send', 'customers:view']
  }
};
export function ensureLocalOwner(db) {
  // Keep the manager table for compatibility with already provisioned installations.
  for (const { table } of Object.values(accountTypes)) {
    db.exec(`CREATE TABLE IF NOT EXISTS ${table} (club_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, user_id INTEGER NOT NULL)`);
  }
}
function revision(db, clubId, type) {
  ensureLocalOwner(db);
  return db.prepare(`SELECT revision FROM ${accountTypes[type].table} WHERE club_id=?`).get(clubId)?.revision || 0;
}
export const getManagerRevision = (db, clubId) => revision(db, clubId, 'manager');
export const getAdministratorRevision = (db, clubId) => revision(db, clubId, 'administrator');
export const applyManagerAccount = (db, envelope, license) => applyAccount(db, envelope, license, 'manager');
export const applyAdministratorAccount = (db, envelope, license) => applyAccount(db, envelope, license, 'administrator');

function applyAccount(db, envelope, license, type) {
  ensureLocalOwner(db);
  const p = envelope?.payload, account = accountTypes[type];
  if (!p || p.kind !== account.kind || Number(p.clubId) !== Number(license?.clubId) || p.hardwareFingerprint !== license?.hardwareFingerprint) {
    throw new Error('Akkaunt sozlamasi boshqa klub, kompyuter yoki xodim turiga tegishli.');
  }
  if (!/^[a-f0-9]{64}$/.test(envelope.signature || '')) throw new Error('Akkaunt imzosi yaroqsiz.');
  const expected = crypto.createHmac('sha256', process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026')
    .update('manager-account:' + JSON.stringify(p)).digest();
  if (!crypto.timingSafeEqual(expected, Buffer.from(envelope.signature, 'hex'))) throw new Error('Akkaunt imzosi yaroqsiz.');
  if (!Number.isSafeInteger(p.revision) || p.revision < 1 || !/^[a-zA-Z0-9_.-]{3,40}$/.test(p.username) || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(p.passwordHash || '')) {
    throw new Error('Akkaunt sozlamasi yaroqsiz.');
  }
  const state = db.prepare(`SELECT * FROM ${account.table} WHERE club_id=?`).get(p.clubId);
  if (state && state.revision >= p.revision) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    let user;
    if (state) {
      user = db.prepare('SELECT id,role FROM users WHERE id=? AND club_id=1').get(state.user_id);
      if (user && user.role !== account.role && !(type === 'manager' && user.role === 'manager')) {
        throw new Error('Akkaunt roli o‘zgargan. Mavjud xodim avtomatik almashtirilmaydi.');
      }
    } else if (type === 'manager') {
      user = db.prepare("SELECT id FROM users WHERE club_id=1 AND role IN ('club_owner','manager') ORDER BY id LIMIT 1").get();
    } else {
      // Reuse only the explicitly named administrator; never overwrite an arbitrary cashier.
      user = db.prepare("SELECT id FROM users WHERE club_id=1 AND role='administrator' AND username=?").get(p.username);
    }
    const collision = db.prepare('SELECT id FROM users WHERE username=?').get(p.username);
    if (collision && collision.id !== user?.id) throw new Error('Bu login boshqa akkauntda ishlatilgan. Super admin boshqa login tanlasin.');
    let userId = user?.id;
    if (user) {
      // A password change keeps the club manager's existing permission choices for a cashier.
      if (type === 'administrator') db.prepare('UPDATE users SET username=?,password_hash=? WHERE id=?').run(p.username, p.passwordHash, userId);
      else db.prepare('UPDATE users SET username=?,password_hash=?,role=?,permissions=? WHERE id=?').run(p.username, p.passwordHash, account.role, JSON.stringify(account.permissions), userId);
    } else {
      userId = Number(db.prepare('INSERT INTO users (club_id,username,password_hash,role,balance,permissions) VALUES (1,?,?,?,0,?)')
        .run(p.username, p.passwordHash, account.role, JSON.stringify(account.permissions)).lastInsertRowid);
    }
    revokeUserSessions(userId);
    db.prepare(`INSERT INTO ${account.table} (club_id,revision,user_id) VALUES (?,?,?) ON CONFLICT(club_id) DO UPDATE SET revision=excluded.revision,user_id=excluded.user_id`).run(p.clubId, p.revision, userId);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
