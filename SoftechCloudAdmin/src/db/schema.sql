-- ============================================================================
-- SOFTECH CLOUD CORE — MULTI-CLUB TELEMETRY & SAAS MANAGEMENT SCHEMA
-- Database Engine: SQLite 3 with Write-Ahead Logging (WAL) Mode
-- ============================================================================

-- 1. SUPER ADMINS (Mobil PWA va Markaziy Cockpit Ma'murlari)
CREATE TABLE IF NOT EXISTS super_admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    pin_code TEXT NOT NULL CHECK(length(pin_code) = 4), -- 4 xonali tezkor mobil biometrik/PIN kod
    full_name TEXT DEFAULT 'Super Ma''mur',
    phone TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. CLUBS (Mijoz Game Club Filiallari va Litsenziyalari)
CREATE TABLE IF NOT EXISTS clubs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
    owner_name TEXT NOT NULL,
    owner_phone TEXT NOT NULL,
    city TEXT NOT NULL, -- Toshkent, Samarqand, Buxoro, Farg'ona, va hk.
    status TEXT NOT NULL DEFAULT 'ACTIVE' 
        CHECK(status IN ('ACTIVE', 'SUSPENDED_PAYMENT', 'TRIAL', 'OFFLINE')),
    license_expires_at DATETIME NOT NULL,
    total_workstations INTEGER NOT NULL DEFAULT 0,
    server_lan_ip TEXT,
    server_version TEXT DEFAULT '1.0.1',
    last_heartbeat_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. CLUB METRICS (Har bir klub bo'yicha kunlik agregat telemetriya va kassa)
CREATE TABLE IF NOT EXISTS club_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    record_date TEXT NOT NULL, -- YYYY-MM-DD
    total_daily_revenue REAL NOT NULL DEFAULT 0.0,
    total_sessions_count INTEGER NOT NULL DEFAULT 0,
    total_play_hours REAL NOT NULL DEFAULT 0.0,
    bar_revenue REAL NOT NULL DEFAULT 0.0,
    peak_concurrent_pcs INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, record_date)
);

-- 4. CLUB WORKSTATIONS CACHE (Jonli zal xaritasi va kompyuterlar holati)
CREATE TABLE IF NOT EXISTS club_workstations_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    pc_number TEXT NOT NULL COLLATE NOCASE,
    zone_name TEXT NOT NULL DEFAULT 'STANDARD',
    status TEXT NOT NULL DEFAULT 'OFFLINE'
        CHECK(status IN ('AVAILABLE', 'OCCUPIED', 'OFFLINE')),
    current_session_started_at DATETIME,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(club_id, pc_number)
);

-- 5. REMOTE COMMANDS (Bulutdan filial serveriga navbatga qo'yilgan boshqaruv buyruqlari)
CREATE TABLE IF NOT EXISTS remote_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    command_type TEXT NOT NULL 
        CHECK(command_type IN ('RESET_ADMIN_PASSWORD', 'LOCK_CLUB_LICENSE', 'UNLOCK_CLUB_LICENSE', 'FORCE_UPDATE', 'RESTART_SERVER', 'BROADCAST_ANNOUNCEMENT')),
    payload TEXT NOT NULL DEFAULT '{}', -- JSON formatdagi buyruq parametrlari
    status TEXT NOT NULL DEFAULT 'PENDING' 
        CHECK(status IN ('PENDING', 'EXECUTED', 'FAILED')),
    executed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 6. SUBSCRIPTION PAYMENTS (SaaS Obuna To'lovlari va Tranzaksiyalari)
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

-- ============================================================================
-- TEZKOR INDEKSLAR (TELEMETRIYA & REAL-TIME SO'ROVLAR UCHUN)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_clubs_status ON clubs(status);
CREATE INDEX IF NOT EXISTS idx_clubs_city ON clubs(city);
CREATE INDEX IF NOT EXISTS idx_clubs_heartbeat ON clubs(last_heartbeat_at);

CREATE INDEX IF NOT EXISTS idx_club_metrics_date ON club_metrics(record_date);
CREATE INDEX IF NOT EXISTS idx_club_metrics_club_date ON club_metrics(club_id, record_date);

CREATE INDEX IF NOT EXISTS idx_workstations_club_status ON club_workstations_cache(club_id, status);
CREATE INDEX IF NOT EXISTS idx_remote_commands_club_status ON remote_commands(club_id, status);
CREATE INDEX IF NOT EXISTS idx_subscription_payments_club ON subscription_payments(club_id, created_at);
