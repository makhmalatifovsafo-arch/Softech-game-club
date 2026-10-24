import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ma'lumotlar bazasi fayli
const DB_FILE = path.resolve(__dirname, '../../netcafe.db');
const SCHEMA_FILE = path.resolve(__dirname, '../../schema.sql');

export const db = new Database(DB_FILE);

// SQLite optimizatsiyalari (Katta Game Clublar uchun tezlikni oshirish)
db.pragma('journal_mode = WAL');         // Write-Ahead Logging — yuqori parallel o'qish/yozish
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

export function initDatabase(): void {
  if (fs.existsSync(SCHEMA_FILE)) {
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
    db.exec(schemaSql);
    console.log('✅ [Database] SQLite sxemasi muvaffaqiyatli tekshirildi/yaratildi.');

    // Boshlang'ich test ma'lumotlar (agar yo'q bo'lsa)
    seedInitialData();
  } else {
    console.warn('⚠️ [Database] schema.sql fayli topilmadi!');
  }
}

function seedInitialData(): void {
  const adminExists = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (!adminExists) {
    db.prepare(`
      INSERT INTO users (id, username, password_hash, role, full_name)
      VALUES (?, ?, ?, ?, ?)
    `).run('usr_admin_default', 'admin', '$2b$10$hashed_password_placeholder', 'ADMIN', 'Bosh Administrator');

    db.prepare(`
      INSERT INTO tariffs (id, name, price_per_hour, fixed_duration_minutes, fixed_price, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('trf_standard_1h', 'Standart 1 Soat', 12000, 60, 12000, 'HOURLY');

    db.prepare(`
      INSERT INTO tariffs (id, name, price_per_hour, fixed_duration_minutes, fixed_price, type)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('trf_package_3h', 'VIP Paket 3 Soat', 10000, 180, 30000, 'FIXED_PACKAGE');

    console.log('🌱 [Database] Boshlang\'ich Admin va Tariflar yuklandi.');
  }
}
