-- ============================================================================
-- NetCafe Pro / Softech — SaaS Platform Core Database Schema
-- Dialect: SQLite WAL (node:sqlite)
-- Architecture: Multi-Tenant B2B SaaS with Strict Club-Level Isolation
-- ============================================================================

-- 0. Klublar / B2B Tenantlar (Clubs)
CREATE TABLE IF NOT EXISTS clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                                       -- masalan: "Softech Chilonzor", "CyberArena"
    owner_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    subscription_tier TEXT DEFAULT 'BASIC' CHECK(subscription_tier IN ('BASIC', 'PRO', 'ENTERPRISE')),
    max_computers INTEGER DEFAULT 10,                         -- Ruxsat etilgan PC lar soni
    price_per_pc_monthly REAL DEFAULT 40000.0,                -- Oylik to'lov (UZS)
    is_active INTEGER DEFAULT 1,                              -- To'lov qilinmasa 0 bo'ladi va klub qulflanadi
    expires_at DATETIME NOT NULL,                             -- Obuna tugash sanasi
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 1. Xodimlar va Foydalanuvchilar (RBAC & Mobile Users)
-- club_id NULL bo'lsa platforma Super Admini, aks holda tegishli klubga bog'lanadi
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('superadmin', 'club_owner', 'administrator', 'client')),
    phone_number TEXT,
    balance REAL DEFAULT 0.0,
    permissions TEXT NOT NULL,                                -- JSON string array (e.g. ["*"] or ["sessions:manage", ...])
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- 2. Kompyuterlar Xaritasi Joylashuvi (Grid Layout)
CREATE TABLE IF NOT EXISTS grid_layout (
    club_id INTEGER NOT NULL DEFAULT 1,
    computer_id INTEGER NOT NULL,
    grid_x INTEGER DEFAULT 0,
    grid_y INTEGER DEFAULT 0,
    is_visible INTEGER DEFAULT 1,
    PRIMARY KEY (club_id, computer_id),
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- 3. Tariflar (Tariffs)
CREATE TABLE IF NOT EXISTS tariffs (
    id TEXT PRIMARY KEY,
    club_id INTEGER NOT NULL DEFAULT 1,
    zone_id INTEGER DEFAULT NULL,                             -- NULL bo'lsa umumiy zal tarifi, aks holda xonaga tegishli
    name TEXT NOT NULL,
    price_per_hour REAL DEFAULT 0.0,
    fixed_duration_minutes INTEGER,
    fixed_price REAL,
    type TEXT NOT NULL DEFAULT 'HOURLY' CHECK(type IN ('HOURLY', 'FIXED_PACKAGE', 'NIGHT')),
    start_time TEXT DEFAULT '10:00',
    end_time TEXT DEFAULT '18:00',
    days_of_week TEXT DEFAULT '[1,2,3,4,5,6,7]',
    is_vip_postpaid_allowed INTEGER DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (zone_id) REFERENCES zones(id) ON DELETE CASCADE
);

-- 4. Kompyuterlar (Computers)
CREATE TABLE IF NOT EXISTS computers (
    id TEXT PRIMARY KEY,
    club_id INTEGER NOT NULL DEFAULT 1,
    zone_id INTEGER DEFAULT NULL,                             -- Kompyuter qaysi xonada joylashganligi (Xona ID)
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

-- 5. O'yin Sessiyalari (Sessions)
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    club_id INTEGER NOT NULL DEFAULT 1,
    computer_id TEXT NOT NULL,
    tariff_id TEXT NOT NULL,
    user_id INTEGER,
    customer_name TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ends_at TIMESTAMP NOT NULL,
    total_amount REAL NOT NULL DEFAULT 0.0,
    paid_amount REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'ACTIVE' 
        CHECK(status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
    created_by TEXT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (computer_id) REFERENCES computers(id) ON DELETE RESTRICT,
    FOREIGN KEY (tariff_id) REFERENCES tariffs(id) ON DELETE RESTRICT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 6. Kassa Tranzaksiyalari (Transactions)
CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    club_id INTEGER NOT NULL DEFAULT 1,
    session_id TEXT,
    amount REAL NOT NULL,
    payment_type TEXT NOT NULL 
        CHECK(payment_type IN ('CASH', 'CARD', 'CLICK', 'PAYME', 'REFUND')),
    payment_method TEXT DEFAULT 'CASH'
        CHECK(payment_method IN ('CASH', 'CARD', 'CLICK', 'PAYME', 'REFUND', 'BALANCE')),
    transaction_type TEXT DEFAULT 'PREPAID'
        CHECK(transaction_type IN ('PREPAID', 'POSTPAID_SETTLEMENT', 'REFUND', 'BAR_SALE')),
    created_by TEXT,
    notes TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
);

-- 7. Bar / Bufet Buyurtmalari (Orders / Bar)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    club_id INTEGER NOT NULL DEFAULT 1,
    session_id TEXT NOT NULL,
    item_name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    total_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' 
        CHECK(status IN ('PENDING', 'PREPARING', 'DELIVERED', 'CANCELLED')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 8. Kompyuterlarni Band Qilish (Bookings — Mobile & Web API)
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
    status TEXT DEFAULT 'CONFIRMED' CHECK(status IN ('PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED')),
    created_by TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- 9. Dinamik Tarif Jadvallari (Tariff Schedules — Vaqt va Kun bo'yicha narxlash)
CREATE TABLE IF NOT EXISTS tariff_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL DEFAULT 1,
    name TEXT NOT NULL,                                       -- masalan: "Kunduzgi tarif", "Kechki tarif"
    days_of_week TEXT NOT NULL,                               -- JSON array: "[1,2,3,4,5]" (1=Dushanba, 7=Yakshanba)
    start_time TEXT NOT NULL,                                 -- "10:00"
    end_time TEXT NOT NULL,                                   -- "17:00"
    price_per_hour REAL NOT NULL,                             -- 7000.0 yoki 10000.0
    is_vip INTEGER DEFAULT 0,
    priority INTEGER DEFAULT 1,                               -- Ziddiyat bo'lsa ustuvorlik
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- 10. Mijoz Balansi Tranzaksiyalari (Client Transactions)
CREATE TABLE IF NOT EXISTS client_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL DEFAULT 1,
    user_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('TOPUP', 'SESSION_DEDUCT', 'REFUND')),
    payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'CLICK', 'CARD', 'BALANCE')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 11. Xarita Zonalar va Xonalar (Zones / Rooms — 2D Floor Plan)
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- 12. Kompyuterlar Xaritadagi Joylashuvi (Floor Map Layout Coordinates)
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

-- 13. Bar / Mahsulotlar (Bar Items)
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

-- 14. Bar Buyurtmalari (Bar Orders)
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

-- 15. Bar Buyurtma Tarkibi (Bar Order Items)
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

-- 16. Kassa Smenalari (Shifts)
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

-- 17. O'zgarmas Tizim Audit Voqealari Tarixi (Immutable Append-Only Audit Logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL,
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

-- Zero-Deletion SQL Triggers (Umuman o'chmaslik kafolati)
CREATE TRIGGER IF NOT EXISTS prevent_audit_delete 
BEFORE DELETE ON audit_logs 
BEGIN 
    SELECT RAISE(ABORT, 'XAVFSIZLIK QOIDASI: Amallar tarixini o''chirish taqiqlangan!'); 
END;

CREATE TRIGGER IF NOT EXISTS prevent_audit_update 
BEFORE UPDATE ON audit_logs 
BEGIN 
    SELECT RAISE(ABORT, 'XAVFSIZLIK QOIDASI: Amallar tarixini tahrirlash taqiqlangan!'); 
END;


-- 18. Klub Sozlamalari (Club Settings — VIP Postpaid & Control)
CREATE TABLE IF NOT EXISTS club_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL DEFAULT 1 UNIQUE,
    vip_enabled INTEGER NOT NULL DEFAULT 1,
    vip_pricing_mode TEXT NOT NULL DEFAULT 'SCHEDULE' CHECK(vip_pricing_mode IN ('SCHEDULE', 'CUSTOM')),
    vip_custom_price REAL NOT NULL DEFAULT 15000.0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEKSLAR VA TENANT CHEKLOVLARI
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_computers_club_pc_number ON computers(club_id, pc_number);
CREATE INDEX IF NOT EXISTS idx_computers_club ON computers(club_id);
CREATE INDEX IF NOT EXISTS idx_computers_status ON computers(status);
CREATE INDEX IF NOT EXISTS idx_computers_mac ON computers(mac_address);
CREATE INDEX IF NOT EXISTS idx_sessions_club ON sessions(club_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_ends_at ON sessions(status, ends_at) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_sessions_computer ON sessions(computer_id);
CREATE INDEX IF NOT EXISTS idx_transactions_club ON transactions(club_id);
CREATE INDEX IF NOT EXISTS idx_transactions_session ON transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_orders_club ON orders(club_id);
CREATE INDEX IF NOT EXISTS idx_orders_session ON orders(session_id);
CREATE INDEX IF NOT EXISTS idx_bookings_club ON bookings(club_id);
CREATE INDEX IF NOT EXISTS idx_bookings_computer ON bookings(computer_id);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_time ON bookings(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_tariff_schedules_club ON tariff_schedules(club_id);
CREATE INDEX IF NOT EXISTS idx_tariff_schedules_priority ON tariff_schedules(priority, is_vip);
CREATE INDEX IF NOT EXISTS idx_client_transactions_club ON client_transactions(club_id);
CREATE INDEX IF NOT EXISTS idx_client_transactions_user ON client_transactions(user_id);
