import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ma'lumotlar bazasi fayli joylashuvi
const DB_DIR = path.resolve(__dirname, '../../data');
const DB_FILE = path.resolve(DB_DIR, 'softech_cloud.db');
const SCHEMA_FILE = path.resolve(__dirname, 'schema.sql');

let dbInstance;
try {
  const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
  if (!isServerless) {
    if (!fs.existsSync(DB_DIR)) {
      fs.mkdirSync(DB_DIR, { recursive: true });
    }
    dbInstance = new DatabaseSync(DB_FILE);
  } else {
    // Vercel serverless /tmp fallback
    const tmpDir = '/tmp';
    const tmpFile = path.resolve(tmpDir, 'softech_cloud.db');
    dbInstance = new DatabaseSync(tmpFile);
  }
} catch (err) {
  try {
    dbInstance = new DatabaseSync(':memory:');
  } catch (err2) {
    // Graceful mock if DatabaseSync is completely unavailable
    dbInstance = {
      prepare: () => ({ get: () => null, all: () => [], run: () => ({ lastInsertRowid: 1, changes: 1 }) }),
      exec: () => {}
    };
  }
}

export const db = dbInstance;

/**
 * Parolni xavfsiz PBKDF2 xesh qilish (Node.js native crypto)
 */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Parol xeshini tekshirish
 */
export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(verifyHash, 'hex'));
}

/**
 * Ma'lumotlar bazasi sxemasini va WAL rejimini initsializatsiya qilish
 */
export function initDatabase() {
  console.log(`🔌 [Database] Softech Cloud Telemetry DB yuklanmoqda: ${DB_FILE}`);

  // Yuqori yuklamalar uchun SQLite Enterprise Tuning
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);

  // Sxemani bajarish
  if (fs.existsSync(SCHEMA_FILE)) {
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    db.exec(schemaSql);
  }

  // remote_commands jadvali constraint migratsiyasi
  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='remote_commands'").get();
    if (tableSql && tableSql.sql && !tableSql.sql.includes('BROADCAST_ANNOUNCEMENT')) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE remote_commands_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
            command_type TEXT NOT NULL 
                CHECK(command_type IN ('RESET_ADMIN_PASSWORD', 'LOCK_CLUB_LICENSE', 'UNLOCK_CLUB_LICENSE', 'FORCE_UPDATE', 'RESTART_SERVER', 'BROADCAST_ANNOUNCEMENT')),
            payload TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'PENDING' 
                CHECK(status IN ('PENDING', 'EXECUTED', 'FAILED')),
            executed_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        INSERT OR IGNORE INTO remote_commands_v2 SELECT * FROM remote_commands;
        DROP TABLE remote_commands;
        ALTER TABLE remote_commands_v2 RENAME TO remote_commands;
        CREATE INDEX IF NOT EXISTS idx_remote_commands_club_status ON remote_commands(club_id, status);
        PRAGMA foreign_keys = ON;
      `);
      console.log('🔄 [Database] remote_commands jadvali muvaffaqiyatli yangilandi.');
    }
  } catch (err) {
    console.warn('⚠️ [Database] remote_commands migratsiya ogohlantirishi:', err.message);
  }

  // clubs jadvaliga api_secret_token ustuni qo'shish (Heartbeat autentifikatsiyasi uchun)
  try {
    const clubsCols = db.prepare('PRAGMA table_info(clubs)').all().map(c => c.name);
    if (!clubsCols.includes('api_secret_token')) {
      db.exec('ALTER TABLE clubs ADD COLUMN api_secret_token TEXT;');
      console.log('🔑 [Database] clubs jadvaliga api_secret_token ustuni qo\'shildi.');
    }

    // Bo'sh tokenlarni to'ldirish
    const clubsWithoutToken = db.prepare('SELECT id, slug FROM clubs WHERE api_secret_token IS NULL').all();
    for (const c of clubsWithoutToken) {
      const defaultToken = `softech_sec_${c.slug || c.id}_token`;
      db.prepare('UPDATE clubs SET api_secret_token = ? WHERE id = ?').run(defaultToken, c.id);
    }
  } catch (err) {
    console.warn('⚠️ [Database] api_secret_token migratsiya ogohlantirishi:', err.message);
  }

  // clubs jadvaliga Tarif ustunlarini qo'shish (SaaS Billing)
  try {
    const clubsCols = db.prepare('PRAGMA table_info(clubs)').all().map(c => c.name);
    if (!clubsCols.includes('tariff_type')) {
      db.exec(`
        ALTER TABLE clubs ADD COLUMN tariff_type TEXT DEFAULT 'PER_PC';
        ALTER TABLE clubs ADD COLUMN tariff_price_per_pc REAL DEFAULT 20000.0;
        ALTER TABLE clubs ADD COLUMN tariff_fixed_price REAL DEFAULT 500000.0;
      `);
      console.log('💳 [Database] clubs jadvaliga Tarif ustunlari qo\'shildi (PER_PC & FIXED).');
    }

    // subscription_payments jadvalini yaratish
    db.exec(`
      CREATE TABLE IF NOT EXISTS subscription_payments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
          amount REAL NOT NULL,
          payment_method TEXT NOT NULL 
              CHECK(payment_method IN ('CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER')),
          months_added INTEGER NOT NULL DEFAULT 1,
          previous_expiry_date DATETIME NOT NULL,
          new_expiry_date DATETIME NOT NULL,
          notes TEXT,
          recorded_by TEXT DEFAULT 'superadmin',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_subscription_payments_club ON subscription_payments(club_id, created_at);
    `);
  } catch (err) {
    console.warn('⚠️ [Database] Billing migratsiya ogohlantirishi:', err.message);
  }

  // Boshlang'ich Super Admin mavjudligini tekshirish va yaratish
  const adminCount = db.prepare('SELECT COUNT(*) as count FROM super_admins').get();
  if (!adminCount || adminCount.count === 0) {
    const defaultPassword = 'admin';
    const pwdHash = hashPassword(defaultPassword);
    db.prepare(`
      INSERT INTO super_admins (username, password_hash, pin_code, full_name, phone)
      VALUES (?, ?, ?, ?, ?)
    `).run('admin', pwdHash, '7777', 'Bosh Administrator', '+998901234567');

    console.log('👑 [Database] Standart Super Admin yaratildi: login: admin / parol: admin / PIN: 7777');
  }

  // Agar klublar bo'lmasa, dastlabki 3 ta namunaviy klubni kiritish (Monitoring testlari uchun)
  const clubCount = db.prepare('SELECT COUNT(*) as count FROM clubs').get();
  if (!clubCount || clubCount.count === 0) {
    const nextYear = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);

    const insertClub = db.prepare(`
      INSERT INTO clubs (name, slug, owner_name, owner_phone, city, status, license_expires_at, total_workstations, server_lan_ip, server_version, last_heartbeat_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const c1 = insertClub.run('Softech Arena Chilonzor', 'softech-chilonzor', 'Javohir Aliyev', '+998901112233', 'Toshkent', 'ACTIVE', nextYear, 45, '192.168.1.100', '1.0.1', nowIso);
    const c2 = insertClub.run('Softech Cyber Yunusobod', 'softech-yunusobod', 'Bobur Mirzayev', '+998934445566', 'Toshkent', 'ACTIVE', nextYear, 40, '192.168.1.150', '1.0.1', nowIso);
    const c3 = insertClub.run('Softech Samarqand Prime', 'softech-samarqand', 'Sardor Rustamov', '+998977778899', 'Samarqand', 'ACTIVE', nextYear, 30, '192.168.1.200', '1.0.1', nowIso);

    // Namunaviy kunlik statistika
    const insertMetric = db.prepare(`
      INSERT INTO club_metrics (club_id, record_date, total_daily_revenue, total_sessions_count, total_play_hours, bar_revenue, peak_concurrent_pcs)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    insertMetric.run(Number(c1.lastInsertRowid), todayStr, 4850000, 142, 380.5, 950000, 42);
    insertMetric.run(Number(c2.lastInsertRowid), todayStr, 3920000, 115, 310.0, 720000, 38);
    insertMetric.run(Number(c3.lastInsertRowid), todayStr, 2610000, 85, 215.0, 480000, 28);

    console.log('🏢 [Database] Namunaviy 3 ta klub va kunlik metrikalar kiritildi.');
  }

  console.log('✅ [Database] SQLite WAL Rejimi faollashtirildi va jadvallar muvaffaqiyatli tayyorlandi.');
}
