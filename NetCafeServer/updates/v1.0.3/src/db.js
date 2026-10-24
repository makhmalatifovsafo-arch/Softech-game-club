import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DB_FILE = path.resolve(__dirname, '../netcafe.db');
const SCHEMA_FILE = path.resolve(__dirname, '../schema.sql');

export const db = new DatabaseSync(DB_FILE);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA synchronous = NORMAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

export function initDatabase() {
  migrateSchemaToMultiTenant();

  if (fs.existsSync(SCHEMA_FILE)) {
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf-8');
    db.exec(schemaSql);
    console.log('✅ [Database] SQLite multi-tenant sxemasi tekshirildi va tayyorlandi.');
  }

  seedInitialData();
}

/**
 * Ma'lumotlar bazasini Multi-Tenant arxitekturaga xavfsiz migratsiya qilish
 */
function migrateSchemaToMultiTenant() {
  try {
    db.exec('PRAGMA foreign_keys = OFF;');

    // 1. clubs jadvalini yaratish
    db.exec(`
      CREATE TABLE IF NOT EXISTS clubs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        subscription_tier TEXT DEFAULT 'BASIC' CHECK(subscription_tier IN ('BASIC', 'PRO', 'ENTERPRISE')),
        max_computers INTEGER DEFAULT 10,
        price_per_pc_monthly REAL DEFAULT 40000.0,
        is_active INTEGER DEFAULT 1,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Default Club mavjudligini tekshirish
    const clubCount = db.prepare('SELECT COUNT(*) as count FROM clubs').get();
    if (!clubCount || Number(clubCount.count) === 0) {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30); // 30 kundan keyin

      db.prepare(`
        INSERT INTO clubs (id, name, owner_name, phone, subscription_tier, max_computers, price_per_pc_monthly, is_active, expires_at)
        VALUES (1, 'Demo Game Club', 'Ali Valiyev', '+998901234567', 'PRO', 20, 40000.0, 1, ?)
      `).run(expiresAt.toISOString());
      console.log('🏢 [Database] Boshlang\'ich "Demo Game Club" (id=1, PRO, 20 PC, 30 kun) yaratildi.');
    }

    // 2. users jadvalini migratsiya qilish (superadmin, club_owner, administrator, client)
    const userTableInfo = db.prepare("PRAGMA table_info(users);").all();
    const userCols = userTableInfo.map(c => c.name);
    const hasClubId = userCols.includes('club_id');

    // Agar role cheklovida superadmin / club_owner mavjudligini tekshirish
    const usersSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
    const isNewRoleSupported = usersSqlRow?.sql && usersSqlRow.sql.includes('superadmin') && usersSqlRow.sql.includes('club_owner');

    if (!hasClubId || !isNewRoleSupported) {
      console.log('🔄 [Database] "users" jadvali yangi 3-darajali Multi-Tenant RBAC ga o\'tkazilmoqda...');
      db.exec(`
        CREATE TABLE IF NOT EXISTS users_mt (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          club_id INTEGER,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('superadmin', 'club_owner', 'administrator', 'client')),
          phone_number TEXT,
          balance REAL DEFAULT 0.0,
          permissions TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
        );
      `);

      if (userTableInfo.length > 0) {
        // Eski 'manager' rolini 'club_owner' ga xaritaymiz
        db.exec(`
          INSERT OR IGNORE INTO users_mt (id, club_id, username, password_hash, role, phone_number, balance, permissions, created_at)
          SELECT 
            id,
            COALESCE(club_id, 1),
            username,
            password_hash,
            CASE WHEN role = 'manager' THEN 'club_owner' ELSE role END,
            phone_number,
            COALESCE(balance, 0.0),
            permissions,
            created_at
          FROM users;
        `);
        db.exec('DROP TABLE users;');
      }

      db.exec('ALTER TABLE users_mt RENAME TO users;');
      console.log('✅ [Database] "users" jadvali Multi-Tenant formatiga o\'tkazildi.');
    }

    // 3. Boshqa operatsion jadvallarga club_id ustunini xavfsiz qo'shish
    const tablesToScope = [
      'computers',
      'grid_layout',
      'sessions',
      'transactions',
      'tariffs',
      'orders',
      'bookings',
      'tariff_schedules',
      'client_transactions'
    ];

    for (const tbl of tablesToScope) {
      const info = db.prepare(`PRAGMA table_info(${tbl});`).all();
      if (info && info.length > 0) {
        const cols = info.map(c => c.name);
        if (!cols.includes('club_id')) {
          console.log(`🔄 [Database] "${tbl}" jadvaliga "club_id" ustuni qo'shilmoqda...`);
          db.exec(`ALTER TABLE ${tbl} ADD COLUMN club_id INTEGER NOT NULL DEFAULT 1;`);
        }
      }
    }

    // computers jadvaliga zone va zone_id ustunlarini tekshirish
    const compCols = db.prepare("PRAGMA table_info(computers);").all().map(c => c.name);
    if (!compCols.includes('zone')) {
      try {
        console.log('🔄 [Database] "computers" jadvaliga "zone" ustuni qo\'shilmoqda...');
        db.exec("ALTER TABLE computers ADD COLUMN zone TEXT NOT NULL DEFAULT 'STANDARD';");
      } catch {}
    }
    if (!compCols.includes('zone_id')) {
      try {
        console.log('🔄 [Database] "computers" jadvaliga "zone_id" ustuni qo\'shilmoqda...');
        db.exec("ALTER TABLE computers ADD COLUMN zone_id INTEGER DEFAULT NULL;");
      } catch {}
    }

    // computers jadvalida 'ONLINE' statusi qo'llab-quvvatlanishini kafolatlash
    try {
      const pcSqlRow = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='computers'").get();
      if (pcSqlRow && pcSqlRow.sql && !pcSqlRow.sql.includes("'ONLINE'")) {
        console.log("🔄 [Database] 'computers' jadvaliga 'ONLINE' statusi qo'shilmoqda...");
        db.exec("PRAGMA foreign_keys = OFF;");
        db.exec(`
          CREATE TABLE computers_online_patch (
            id TEXT PRIMARY KEY,
            club_id INTEGER NOT NULL DEFAULT 1,
            zone_id INTEGER DEFAULT NULL,
            pc_number INTEGER NOT NULL,
            name TEXT NOT NULL,
            ip_address TEXT,
            mac_address TEXT,
            status TEXT NOT NULL DEFAULT 'OFFLINE' 
                CHECK(status IN ('OFFLINE', 'AVAILABLE', 'OCCUPIED', 'LOCKED', 'MAINTENANCE', 'ONLINE')),
            current_session_id TEXT,
            last_heartbeat TIMESTAMP,
            agent_version TEXT,
            os_info TEXT,
            zone TEXT NOT NULL DEFAULT 'STANDARD' CHECK(zone IN ('STANDARD', 'VIP', 'PLAYSTATION')),
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
            FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE SET NULL
          );
          INSERT OR IGNORE INTO computers_online_patch SELECT * FROM computers;
          DROP TABLE computers;
          ALTER TABLE computers_online_patch RENAME TO computers;
          PRAGMA foreign_keys = ON;
        `);
        console.log("✅ [Database] 'computers' jadvali yangilandi ('ONLINE' qabul qilinadi).");
      }
    } catch (patchErr) {
      console.warn("[Database] computers patch warning:", patchErr.message);
    }

    // tariffs jadvaliga zone_id, is_vip_postpaid_allowed, start_time, end_time, days_of_week ustunlarini qo'shish
    const tariffCols = db.prepare("PRAGMA table_info(tariffs);").all().map(c => c.name);
    if (!tariffCols.includes('zone_id')) {
      try {
        console.log('🔄 [Database] "tariffs" jadvaliga "zone_id" ustuni qo\'shilmoqda...');
        db.exec("ALTER TABLE tariffs ADD COLUMN zone_id INTEGER DEFAULT NULL;");
      } catch {}
    }
    if (!tariffCols.includes('is_vip_postpaid_allowed')) {
      try {
        console.log('🔄 [Database] "tariffs" jadvaliga "is_vip_postpaid_allowed" ustuni qo\'shilmoqda...');
        db.exec("ALTER TABLE tariffs ADD COLUMN is_vip_postpaid_allowed INTEGER DEFAULT 1;");
      } catch {}
    }
    if (!tariffCols.includes('days_of_week')) {
      try {
        db.exec("ALTER TABLE tariffs ADD COLUMN days_of_week TEXT DEFAULT '[1,2,3,4,5,6,7]';");
      } catch {}
    }
    if (!tariffCols.includes('start_time')) {
      try {
        db.exec("ALTER TABLE tariffs ADD COLUMN start_time TEXT DEFAULT '10:00';");
      } catch {}
    }
    if (!tariffCols.includes('end_time')) {
      try {
        db.exec("ALTER TABLE tariffs ADD COLUMN end_time TEXT DEFAULT '18:00';");
      } catch {}
    }

    // 4. zones jadvalini yaratish (2D Floor Plan zonalar / xonalar)
    db.exec(`
      CREATE TABLE IF NOT EXISTS zones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        zone_type TEXT NOT NULL DEFAULT 'STANDARD' CHECK(zone_type IN ('STANDARD', 'VIP', 'BOOTCAMP_5V5', 'PS5')),
        x INTEGER NOT NULL DEFAULT 40,
        y INTEGER NOT NULL DEFAULT 40,
        width INTEGER NOT NULL DEFAULT 360,
        height INTEGER NOT NULL DEFAULT 240,
        color TEXT DEFAULT '#38bdf8',
        polygon_points TEXT DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    const zoneCols = db.prepare("PRAGMA table_info(zones);").all().map(c => c.name);
    if (!zoneCols.includes('polygon_points')) {
      try {
        db.exec("ALTER TABLE zones ADD COLUMN polygon_points TEXT DEFAULT NULL;");
        console.log('🔄 [Database] "zones" jadvaliga "polygon_points" ustuni qo\'shildi.');
      } catch {}
    }

    // 5. grid_layout jadvaliga x, y, rotation, zone_id ustunlarini tekshirish
    db.exec(`
      CREATE TABLE IF NOT EXISTS grid_layout (
        club_id INTEGER NOT NULL DEFAULT 1,
        computer_id INTEGER NOT NULL,
        grid_x INTEGER DEFAULT 0,
        grid_y INTEGER DEFAULT 0,
        x INTEGER DEFAULT 0,
        y INTEGER DEFAULT 0,
        rotation INTEGER DEFAULT 0,
        zone_id INTEGER DEFAULT NULL,
        is_visible INTEGER DEFAULT 1,
        PRIMARY KEY (club_id, computer_id),
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    const gridLayoutCols = db.prepare("PRAGMA table_info(grid_layout);").all().map(c => c.name);
    if (!gridLayoutCols.includes('x')) {
      try { db.exec("ALTER TABLE grid_layout ADD COLUMN x INTEGER DEFAULT 0;"); } catch {}
    }
    if (!gridLayoutCols.includes('y')) {
      try { db.exec("ALTER TABLE grid_layout ADD COLUMN y INTEGER DEFAULT 0;"); } catch {}
    }
    if (!gridLayoutCols.includes('rotation')) {
      try { db.exec("ALTER TABLE grid_layout ADD COLUMN rotation INTEGER DEFAULT 0;"); } catch {}
    }
    if (!gridLayoutCols.includes('zone_id')) {
      try { db.exec("ALTER TABLE grid_layout ADD COLUMN zone_id INTEGER DEFAULT NULL;"); } catch {}
    }

    // 6. bar_items jadvali
    db.exec(`
      CREATE TABLE IF NOT EXISTS bar_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'DRINKS',
        buy_price REAL DEFAULT 0.0,
        sell_price REAL NOT NULL DEFAULT 0.0,
        stock_quantity INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    // 7. bar_orders jadvali
    db.exec(`
      CREATE TABLE IF NOT EXISTS bar_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1,
        order_number TEXT NOT NULL,
        computer_id INTEGER,
        session_id TEXT,
        user_id INTEGER,
        total_amount REAL NOT NULL DEFAULT 0.0,
        payment_status TEXT NOT NULL DEFAULT 'PAID' CHECK(payment_status IN ('PAID', 'PENDING_AT_CHECKOUT', 'CANCELLED')),
        payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK(payment_method IN ('CASH', 'CARD', 'CLIENT_BALANCE', 'ON_PC_SESSION')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    // 8. bar_order_items jadvali
    db.exec(`
      CREATE TABLE IF NOT EXISTS bar_order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        bar_item_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL DEFAULT 0.0,
        total_price REAL NOT NULL DEFAULT 0.0,
        FOREIGN KEY (order_id) REFERENCES bar_orders(id) ON DELETE CASCADE
      );
    `);

    // 9. bookings jadvali va qo'shimcha ustunlar (customer_name, customer_phone, note, created_by)
    db.exec(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1,
        computer_id INTEGER NOT NULL,
        user_id INTEGER,
        customer_name TEXT,
        customer_phone TEXT,
        start_time DATETIME NOT NULL,
        end_time DATETIME NOT NULL,
        note TEXT,
        status TEXT DEFAULT 'CONFIRMED' CHECK(status IN ('CONFIRMED', 'CANCELLED', 'COMPLETED', 'PENDING')),
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    const bookingCols = db.prepare("PRAGMA table_info(bookings);").all().map(c => c.name);
    if (!bookingCols.includes('customer_name')) {
      try { db.exec("ALTER TABLE bookings ADD COLUMN customer_name TEXT;"); } catch {}
    }
    if (!bookingCols.includes('customer_phone')) {
      try { db.exec("ALTER TABLE bookings ADD COLUMN customer_phone TEXT;"); } catch {}
    }
    if (!bookingCols.includes('note')) {
      try { db.exec("ALTER TABLE bookings ADD COLUMN note TEXT;"); } catch {}
    }
    if (!bookingCols.includes('created_by')) {
      try { db.exec("ALTER TABLE bookings ADD COLUMN created_by TEXT;"); } catch {}
    }

    // 10. shifts jadvali
    db.exec(`
      CREATE TABLE IF NOT EXISTS shifts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1,
        opened_by_user_id INTEGER,
        opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        closed_at DATETIME,
        start_cash REAL DEFAULT 0.0,
        end_cash REAL DEFAULT 0.0,
        system_cash REAL DEFAULT 0.0,
        system_card REAL DEFAULT 0.0,
        is_closed INTEGER DEFAULT 0,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    // 11. audit_logs jadvali (Immutable Append-Only Audit Trail)
    const auditInfo = db.prepare("PRAGMA table_info(audit_logs);").all();
    const auditCols = auditInfo.map(c => c.name);

    if (!auditCols.includes('category') || !auditCols.includes('action_type')) {
      console.log('🔄 [Database] "audit_logs" jadvali o\'zgarmas audit sxemasiga o\'tkazilmoqda...');
      db.exec('DROP TRIGGER IF EXISTS prevent_audit_delete;');
      db.exec('DROP TRIGGER IF EXISTS prevent_audit_update;');

      db.exec(`
        CREATE TABLE IF NOT EXISTS audit_logs_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          club_id INTEGER NOT NULL DEFAULT 1,
          shift_id INTEGER,
          actor_user_id INTEGER,
          actor_username TEXT,
          workstation_id INTEGER,
          workstation_name TEXT,
          category TEXT NOT NULL CHECK(category IN ('SESSION', 'FINANCE', 'BAR', 'SYSTEM', 'SECURITY')),
          action_type TEXT NOT NULL,
          details TEXT NOT NULL,
          created_at DATETIME DEFAULT (datetime('now', 'localtime'))
        );
      `);

      if (auditInfo.length > 0) {
        db.exec(`
          INSERT INTO audit_logs_new (id, club_id, shift_id, actor_user_id, actor_username, workstation_id, workstation_name, category, action_type, details, created_at)
          SELECT 
            id,
            COALESCE(club_id, 1),
            shift_id,
            CAST(json_extract(details, '$.actorId') AS INTEGER),
            COALESCE(json_extract(details, '$.actorUsername'), json_extract(details, '$.adminUsername'), json_extract(details, '$.createdBy'), 'SYSTEM'),
            CAST(COALESCE(json_extract(details, '$.pcNumber'), json_extract(details, '$.computerId')) AS INTEGER),
            COALESCE(
              json_extract(details, '$.pcName'), 
              json_extract(details, '$.computerName'), 
              CASE 
                WHEN json_extract(details, '$.pcNumber') IS NOT NULL THEN 'PC-' || printf('%02d', CAST(json_extract(details, '$.pcNumber') AS INTEGER))
                WHEN json_extract(details, '$.computerId') IS NOT NULL AND json_extract(details, '$.computerId') LIKE 'pc_%' THEN 'PC-' || REPLACE(json_extract(details, '$.computerId'), 'pc_', '')
                ELSE NULL 
              END
            ),
            CASE 
              WHEN event_type IN ('SESSION_START', 'SESSION_STOP', 'SESSION_EXTEND', 'PC_SWAP') THEN 'SESSION'
              WHEN event_type IN ('BAR_SALE', 'BAR_ORDER') THEN 'BAR'
              WHEN event_type IN ('REFUND', 'TOPUP', 'FINANCE') THEN 'FINANCE'
              WHEN event_type IN ('SECURITY', 'SECURITY_ALERT', 'USB_BLOCKED') THEN 'SECURITY'
              ELSE 'SYSTEM'
            END,
            event_type,
            COALESCE(details, '{}'),
            COALESCE(created_at, datetime('now', 'localtime'))
          FROM audit_logs;
        `);
        db.exec('DROP TABLE audit_logs;');
        db.exec('ALTER TABLE audit_logs_new RENAME TO audit_logs;');
      } else {
        db.exec('ALTER TABLE audit_logs_new RENAME TO audit_logs;');
      }
      console.log('✅ [Database] "audit_logs" jadvali o\'zgarmas (Append-Only) formatga keltirildi.');
    }

    // Zero-Deletion Triggers
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS prevent_audit_delete 
      BEFORE DELETE ON audit_logs 
      BEGIN 
        SELECT RAISE(ABORT, 'XAVFSIZLIK QOIDASI: Amallar tarixini o''chirish taqiqlangan!'); 
      END;
    `);

    db.exec(`
      CREATE TRIGGER IF NOT EXISTS prevent_audit_update 
      BEFORE UPDATE ON audit_logs 
      BEGIN 
        SELECT RAISE(ABORT, 'XAVFSIZLIK QOIDASI: Amallar tarixini tahrirlash taqiqlangan!'); 
      END;
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_club_created ON audit_logs(club_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_category ON audit_logs(category);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_workstation ON audit_logs(workstation_id);
    `);

    // 12. club_settings jadvalini yaratish (VIP Postpaid va boshqaruv parametrlari)
    db.exec(`
      CREATE TABLE IF NOT EXISTS club_settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        club_id INTEGER NOT NULL DEFAULT 1 UNIQUE,
        vip_enabled INTEGER NOT NULL DEFAULT 1,
        vip_pricing_mode TEXT NOT NULL DEFAULT 'SCHEDULE' CHECK(vip_pricing_mode IN ('SCHEDULE', 'CUSTOM')),
        vip_custom_price REAL NOT NULL DEFAULT 15000.0,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
      );
    `);

    // Default club_settings (club_id = 1)
    db.exec(`
      INSERT OR IGNORE INTO club_settings (club_id, vip_enabled, vip_pricing_mode, vip_custom_price)
      VALUES (1, 1, 'SCHEDULE', 15000.0);
    `);

    // 13. transactions jadvaliga transaction_type va payment_method ustunlarini qo'shish
    const txCols = db.prepare("PRAGMA table_info(transactions);").all().map(c => c.name);
    if (!txCols.includes('transaction_type')) {
      try {
        db.exec("ALTER TABLE transactions ADD COLUMN transaction_type TEXT DEFAULT 'PREPAID';");
        console.log('🔄 [Database] "transactions" jadvaliga "transaction_type" ustuni qo\'shildi.');
      } catch {}
    }
    if (!txCols.includes('payment_method')) {
      try {
        db.exec("ALTER TABLE transactions ADD COLUMN payment_method TEXT DEFAULT 'CASH';");
        console.log('🔄 [Database] "transactions" jadvaliga "payment_method" ustuni qo\'shildi.');
      } catch {}
    }

    try {
      db.exec(`
        UPDATE transactions 
        SET payment_method = COALESCE(payment_type, 'CASH')
        WHERE payment_method IS NULL OR payment_method = '';
      `);
      db.exec(`
        UPDATE transactions 
        SET transaction_type = CASE 
          WHEN notes LIKE '%POSTPAID%' THEN 'POSTPAID_SETTLEMENT'
          WHEN notes LIKE '%BAR%' THEN 'BAR_SALE'
          WHEN payment_type = 'REFUND' OR notes LIKE '%REFUND%' THEN 'REFUND'
          ELSE 'PREPAID'
        END
        WHERE transaction_type IS NULL OR transaction_type = '';
      `);
    } catch {}

    db.exec('PRAGMA foreign_keys = ON;');
  } catch (err) {
    db.exec('PRAGMA foreign_keys = ON;');
    console.error('⚠️ [Database] Multi-Tenant migratsiyasida xatolik:', err);
  }
}

function seedInitialData() {
  // 1. Super Admin (Platform Owner)
  const superAdmin = db.prepare("SELECT id FROM users WHERE role = 'superadmin' OR username = 'superadmin'").get();
  if (!superAdmin) {
    const superAdminPassHash = hashPassword('SoftechMaster2026');
    db.prepare(`
      INSERT INTO users (club_id, username, password_hash, role, phone_number, balance, permissions)
      VALUES (NULL, 'superadmin', ?, 'superadmin', '+998990000000', 0.0, '["*"]')
    `).run(superAdminPassHash);
    console.log('👑 [Database] Super Admin yaratildi (Login: superadmin, Parol: SoftechMaster2026, club_id: NULL).');
  }

  // 2. Club Owner (Demo Game Club egasi)
  const clubOwner = db.prepare("SELECT id FROM users WHERE username = 'manager'").get();
  if (!clubOwner) {
    const ownerPassHash = hashPassword('Softech006');
    db.prepare(`
      INSERT INTO users (club_id, username, password_hash, role, phone_number, balance, permissions)
      VALUES (1, 'manager', ?, 'club_owner', '+998901234567', 0.0, '["*"]')
    `).run(ownerPassHash);
    console.log('🏛️ [Database] Club Owner yaratildi (Login: manager, Parol: Softech006, role: club_owner, club_id: 1).');
  } else {
    // Agar eski role 'manager' bo'lsa, 'club_owner' ga yangilaymiz
    db.prepare("UPDATE users SET role = 'club_owner' WHERE username = 'manager' AND role = 'manager'").run();
  }

  // 3. Administrator / Kassir
  const adminExists = db.prepare("SELECT id FROM users WHERE username = 'admin1'").get();
  if (!adminExists) {
    const adminPassHash = hashPassword('password123');
    db.prepare(`
      INSERT INTO users (club_id, username, password_hash, role, phone_number, balance, permissions)
      VALUES (1, 'admin1', ?, 'administrator', '+998901234568', 0.0, '["session:manage","message:send","customers:view","bar:manage","sessions:manage","orders:manage"]')
    `).run(adminPassHash);
    console.log('🛡️ [Database] Boshlang\'ich Administrator yaratildi (admin1 / password123, club_id: 1).');
  }

  // 4. Client namunasi
  const clientExists = db.prepare("SELECT id FROM users WHERE username = 'gamer1'").get();
  if (!clientExists) {
    const clientPassHash = hashPassword('gamer123');
    db.prepare(`
      INSERT INTO users (club_id, username, password_hash, role, phone_number, balance, permissions)
      VALUES (1, 'gamer1', ?, 'client', '+998901112233', 50000.0, '["client:play"]')
    `).run(clientPassHash);
    console.log('🎮 [Database] Boshlang\'ich Client yaratildi (gamer1 / gamer123, Balans: 50,000 UZS).');
  }

  // 4. Boshlang'ich tariflar
  const tariffExists = db.prepare('SELECT id FROM tariffs WHERE id = ?').get('trf_standard_1h');
  if (!tariffExists) {
    db.prepare(`
      INSERT INTO tariffs (id, club_id, name, price_per_hour, fixed_duration_minutes, fixed_price, type)
      VALUES (?, 1, ?, ?, ?, ?, ?)
    `).run('trf_standard_1h', 'Standart 1 Soat', 12000, 60, 12000, 'HOURLY');

    console.log('🌱 [Database] Boshlang\'ich Tarif (club_id=1) yuklandi.');
  }

  // 5. Dinamik tarif jadvallari (Tariff Schedules)
  const schedCountRow = db.prepare('SELECT COUNT(*) as count FROM tariff_schedules').get();
  if (!schedCountRow || Number(schedCountRow.count) === 0) {
    db.prepare(`
      INSERT INTO tariff_schedules (club_id, name, days_of_week, start_time, end_time, price_per_hour, is_vip, priority)
      VALUES 
        (1, 'Kunduzgi tarif (Ish kunlari)', '[1,2,3,4,5]', '09:00', '18:00', 8000.0, 0, 1),
        (1, 'Kechki / Tun tarifi (Ish kunlari)', '[1,2,3,4,5]', '18:00', '09:00', 12000.0, 0, 2),
        (1, 'Dam olish kunlari tarifi', '[6,7]', '00:00', '23:59', 15000.0, 0, 3);
    `).run();
    console.log('📅 [Database] Dinamik tarif jadvali qoidalari (club_id=1) kiritildi.');
  }

  // 6. Xarita Zonalarini (Floor Plan Zones) boshlang'ich kiritish - foydalanuvchi 0 dan o'zi yaratishi uchun bo'sh qoldiriladi
  // 7. Boshlang'ich kompyuterlar - foydalanuvchi 0 dan o'zi yaratishi uchun bo'sh qoldiriladi

  // 8. Boshlang'ich Bar tovarlari (Bar Items)
  const barCountRow = db.prepare('SELECT COUNT(*) as count FROM bar_items WHERE club_id = 1').get();
  if (!barCountRow || Number(barCountRow.count) === 0) {
    const insertBar = db.prepare(`
      INSERT INTO bar_items (club_id, name, category, buy_price, sell_price, stock_quantity, is_active)
      VALUES (1, ?, ?, ?, ?, ?, 1)
    `);
    const initialBarProducts = [
      ['Coca-Cola 0.5L', 'DRINKS', 6000, 10000, 48],
      ['Flash Up Energy 0.45L', 'DRINKS', 7000, 12000, 36],
      ['Red Bull 0.25L', 'DRINKS', 18000, 25000, 24],
      ['Monster Energy 0.5L', 'DRINKS', 20000, 28000, 18],
      ['Fanta Orange 0.5L', 'DRINKS', 6000, 10000, 30],
      ['Nestle Suv 0.5L', 'DRINKS', 2000, 4000, 60],
      ['Lay\'s Paprika 70g', 'SNACKS', 8000, 12000, 25],
      ['Lay\'s Green Onion 70g', 'SNACKS', 8000, 12000, 25],
      ['Flint Suxariki 70g', 'SNACKS', 3000, 5000, 40],
      ['Hot-Dog Classic', 'FAST_FOOD', 10000, 16000, 15],
      ['Klab Sendvich Tovuqli', 'FAST_FOOD', 14000, 22000, 12]
    ];
    for (const [name, cat, buy, sell, stock] of initialBarProducts) {
      insertBar.run(name, cat, buy, sell, stock);
    }
    console.log('🛒 [Database] Boshlang\'ich Bar tovarlari (club_id=1) kiritildi.');
  }

  // 9. Boshlang'ich Ochiq Smena (Current Open Shift)
  const openShiftRow = db.prepare('SELECT id FROM shifts WHERE club_id = 1 AND is_closed = 0').get();
  if (!openShiftRow) {
    db.prepare(`
      INSERT INTO shifts (club_id, opened_by_user_id, start_cash, is_closed)
      VALUES (1, 1, 250000.0, 0)
    `).run();
    console.log('⏱️ [Database] Boshlang\'ich ochiq smena (club_id=1, 250,000 UZS kassa) yaratildi.');
  }

  // 10. Kompyuterlarga zone_id biriktirish va Boshlang'ich Xona Tariflari
  try {
    const existingZones = db.prepare('SELECT id FROM zones WHERE club_id = 1').all();
    if (existingZones && existingZones.length > 0) {
      const zoneIds = new Set(existingZones.map(z => z.id));
      const zoneTariffCountRow = db.prepare('SELECT COUNT(*) as count FROM tariffs WHERE zone_id IS NOT NULL').get();
      if (!zoneTariffCountRow || Number(zoneTariffCountRow.count) === 0) {
        const insertZoneTariff = db.prepare(`
          INSERT INTO tariffs (id, club_id, zone_id, name, price_per_hour, start_time, end_time, days_of_week, is_vip_postpaid_allowed, type, is_active)
          VALUES (?, 1, ?, ?, ?, ?, ?, '[1,2,3,4,5,6,7]', ?, 'HOURLY', 1)
        `);

        if (zoneIds.has(1)) {
          insertZoneTariff.run('zt_1_day', 1, 'Kunduzgi (Arena)', 12000, '10:00', '18:00', 1);
          insertZoneTariff.run('zt_1_night', 1, 'Kechki / Tun (Arena)', 16000, '18:00', '10:00', 1);
        }
        if (zoneIds.has(2)) {
          insertZoneTariff.run('zt_2_day', 2, 'Kunduzgi (Asosiy Zal)', 8000, '10:00', '18:00', 1);
          insertZoneTariff.run('zt_2_night', 2, 'Kechki / Tun (Asosiy Zal)', 12000, '18:00', '10:00', 1);
        }
        if (zoneIds.has(3)) {
          insertZoneTariff.run('zt_3_day', 3, 'Kunduzgi (VIP)', 15000, '10:00', '18:00', 1);
          insertZoneTariff.run('zt_3_night', 3, 'Kechki / Tun (VIP)', 22000, '18:00', '10:00', 1);
        }
        if (zoneIds.has(4)) {
          insertZoneTariff.run('zt_4_day', 4, 'Kunduzgi (PS5)', 20000, '10:00', '18:00', 1);
          insertZoneTariff.run('zt_4_night', 4, 'Kechki / Tun (PS5)', 30000, '18:00', '10:00', 1);
        }
      }
    }
  } catch (err) {
    console.warn('Initial PC zone sync notice:', err.message);
  }
}

/**
 * Xona tariflarini olish
 */
export function getZoneTariffs(zoneId, clubId = 1) {
  try {
    return db.prepare(`
      SELECT * FROM tariffs
      WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL) AND is_active = 1
      ORDER BY id ASC
    `).all(zoneId, clubId || 1);
  } catch (err) {
    console.warn('[getZoneTariffs] error:', err.message);
    return [];
  }
}

/**
 * Klub sozlamalarini olish (VIP Postpaid va boshqa parametrlar)
 */
export function getClubSettings(clubId = 1) {
  try {
    const row = db.prepare('SELECT * FROM club_settings WHERE club_id = ?').get(clubId || 1);
    if (row) {
      return {
        id: row.id,
        club_id: row.club_id,
        vip_enabled: Boolean(row.vip_enabled),
        vip_pricing_mode: row.vip_pricing_mode || 'SCHEDULE',
        vip_custom_price: Number(row.vip_custom_price || 15000.0),
        updated_at: row.updated_at
      };
    }
  } catch (err) {
    console.warn('[getClubSettings] Error reading club_settings:', err.message);
  }

  return {
    id: null,
    club_id: clubId || 1,
    vip_enabled: true,
    vip_pricing_mode: 'SCHEDULE',
    vip_custom_price: 15000.0
  };
}

/**
 * Xona/Zonani barcha bog'liqliklar bilan xavfsiz o'chirish (Foreign Key xatolarisiz)
 */
export function deleteZoneSafely(zoneId, clubId = 1) {
  const targetZoneId = parseInt(zoneId, 10);
  if (!targetZoneId) return false;

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Ushbu zonadagi barcha kompyuterlarni zonadan ajratish (zone_id = NULL)
    db.prepare('UPDATE computers SET zone_id = NULL WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL)').run(targetZoneId, clubId);

    // 2. 2D xarita koordinatalaridan (grid_layout) ushbu zonani ajratish
    db.prepare('UPDATE grid_layout SET zone_id = NULL WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL)').run(targetZoneId, clubId);

    // 3. Tarixiy seanslarda ishlatilmagan tariflarni to'liq o'chirish
    db.prepare(`
      DELETE FROM tariffs 
      WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL)
        AND id NOT IN (SELECT DISTINCT tariff_id FROM sessions WHERE tariff_id IS NOT NULL)
    `).run(targetZoneId, clubId);

    // 4. Tarixiy seanslarda ishlatilgan tariflarni zonadan ajratish va arxivlash (Foreign Key va kassa yaxlitligini saqlash)
    db.prepare(`
      UPDATE tariffs 
      SET zone_id = NULL, is_active = 0 
      WHERE zone_id = ? AND (club_id = ? OR club_id IS NULL)
    `).run(targetZoneId, clubId);

    // 5. Zonaning o'zini o'chirish
    db.prepare('DELETE FROM zones WHERE id = ? AND (club_id = ? OR club_id IS NULL)').run(targetZoneId, clubId);

    db.exec('COMMIT;');
    return true;
  } catch (err) {
    try { db.exec('ROLLBACK;'); } catch (_) {}
    throw err;
  }
}



