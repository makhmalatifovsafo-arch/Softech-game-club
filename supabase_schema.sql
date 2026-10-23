-- ==============================================================================
-- SOFTECH GAME CLUB — SUPER ADMIN & CLOUD LICENSING POSTGRESQL SCHEMA
-- Engine: Supabase Free Tier (PostgreSQL 15+ with Realtime Replication)
-- Location: SoftechCloudAdmin/supabase_schema.sql
-- ==============================================================================

-- 1. SUPER ADMINS JADVALI (Mobil PWA & Web Cockpit Kirish Uchun)
CREATE TABLE IF NOT EXISTS public.super_admins (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    pin_code TEXT NOT NULL CHECK(length(pin_code) = 4),
    full_name TEXT DEFAULT 'Softech Super Admin',
    phone TEXT DEFAULT '+998 95 222 06 44',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CLUBS JADVALI (Filiallar, Litsenziyalar va Jonli Telemetriya)
CREATE TABLE IF NOT EXISTS public.clubs (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE,
    owner_name TEXT NOT NULL DEFAULT 'Filial Menejeri',
    owner_phone TEXT NOT NULL DEFAULT '+998 90 123 45 67',
    city TEXT NOT NULL DEFAULT 'Toshkent',
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'BLOCKED', 'SUSPENDED', 'SUSPENDED_PAYMENT', 'TRIAL', 'PENDING', 'OFFLINE')),
    api_secret_token TEXT UNIQUE,
    hardware_fingerprint TEXT,
    license_expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),
    total_workstations INTEGER NOT NULL DEFAULT 16,
    online_pcs INTEGER DEFAULT 0,
    occupied_pcs INTEGER DEFAULT 0,
    today_revenue NUMERIC(15, 2) DEFAULT 0.00,
    server_lan_ip TEXT DEFAULT '192.168.1.100',
    server_version TEXT DEFAULT '1.0.1',
    tariff_type TEXT DEFAULT 'PER_PC' CHECK(tariff_type IN ('PER_PC', 'FIXED_MONTHLY')),
    tariff_price_per_pc NUMERIC(12, 2) DEFAULT 20000.00,
    tariff_fixed_price NUMERIC(12, 2) DEFAULT 500000.00,
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
    block_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CLUB METRICS JADVALI (Kunlik Kassa va O'yin Tarixi)
CREATE TABLE IF NOT EXISTS public.club_metrics (
    id BIGSERIAL PRIMARY KEY,
    club_id BIGINT REFERENCES public.clubs(id) ON DELETE CASCADE,
    record_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_daily_revenue NUMERIC(15, 2) DEFAULT 0.00,
    total_sessions_count INTEGER DEFAULT 0,
    total_play_hours NUMERIC(10, 2) DEFAULT 0.00,
    bar_revenue NUMERIC(15, 2) DEFAULT 0.00,
    peak_concurrent_pcs INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(club_id, record_date)
);

-- 4. CLUB WORKSTATIONS CACHE JADVALI (Jonli Zal Matritsasi)
CREATE TABLE IF NOT EXISTS public.club_workstations_cache (
    id BIGSERIAL PRIMARY KEY,
    club_id BIGINT REFERENCES public.clubs(id) ON DELETE CASCADE,
    pc_number TEXT NOT NULL,
    zone_name TEXT DEFAULT 'STANDARD',
    status TEXT NOT NULL DEFAULT 'OFFLINE' CHECK(status IN ('AVAILABLE', 'OCCUPIED', 'OFFLINE', 'MAINTENANCE')),
    active_gamer_name TEXT,
    minutes_left INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(club_id, pc_number)
);

-- 5. REMOTE COMMANDS JADVALI (Navbatdagi Buyruqlar & Kill-Switch)
CREATE TABLE IF NOT EXISTS public.remote_commands (
    id BIGSERIAL PRIMARY KEY,
    club_id BIGINT REFERENCES public.clubs(id) ON DELETE CASCADE,
    command TEXT NOT NULL, -- 'LOCK_DOWN', 'UNLOCK', 'RESTART_SERVER', 'RESET_PASSWORD', 'BROADCAST_ANNOUNCEMENT'
    command_type TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'EXECUTED', 'FAILED', 'CANCELLED')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    executed_at TIMESTAMPTZ
);

-- 6. SUBSCRIPTION PAYMENTS JADVALI (SaaS Obuna To'lovlari)
CREATE TABLE IF NOT EXISTS public.subscription_payments (
    id BIGSERIAL PRIMARY KEY,
    club_id BIGINT REFERENCES public.clubs(id) ON DELETE CASCADE,
    amount NUMERIC(15, 2) NOT NULL,
    payment_method TEXT NOT NULL CHECK(payment_method IN ('CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER')),
    months_added INTEGER NOT NULL DEFAULT 1,
    previous_expiry_date TIMESTAMPTZ NOT NULL,
    new_expiry_date TIMESTAMPTZ NOT NULL,
    notes TEXT,
    recorded_by TEXT DEFAULT 'superadmin',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- 7. YUQORI UNUMDORLIK INDEKSLARI
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_clubs_status ON public.clubs(status);
CREATE INDEX IF NOT EXISTS idx_clubs_heartbeat ON public.clubs(last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_clubs_token ON public.clubs(api_secret_token);
CREATE INDEX IF NOT EXISTS idx_remote_commands_club_status ON public.remote_commands(club_id, status);
CREATE INDEX IF NOT EXISTS idx_workstations_club ON public.club_workstations_cache(club_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_club ON public.subscription_payments(club_id, created_at);
CREATE INDEX IF NOT EXISTS idx_metrics_club_date ON public.club_metrics(club_id, record_date);

-- ==============================================================================
-- 8. ROW LEVEL SECURITY (RLS) & SIYOSATLAR
-- ==============================================================================
ALTER TABLE public.super_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clubs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.club_workstations_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remote_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_payments ENABLE ROW LEVEL SECURITY;

-- Anon va Service Role kalitlari uchun ruxsatnomalar
DROP POLICY IF EXISTS "Public access for super_admins" ON public.super_admins;
CREATE POLICY "Public access for super_admins" ON public.super_admins FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for clubs" ON public.clubs;
CREATE POLICY "Public access for clubs" ON public.clubs FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for club_metrics" ON public.club_metrics;
CREATE POLICY "Public access for club_metrics" ON public.club_metrics FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for club_workstations_cache" ON public.club_workstations_cache;
CREATE POLICY "Public access for club_workstations_cache" ON public.club_workstations_cache FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for remote_commands" ON public.remote_commands;
CREATE POLICY "Public access for remote_commands" ON public.remote_commands FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for subscription_payments" ON public.subscription_payments;
CREATE POLICY "Public access for subscription_payments" ON public.subscription_payments FOR ALL USING (true) WITH CHECK (true);

-- ==============================================================================
-- 9. SUPABASE REALTIME REPLIKATSIYASI (KILL-SWITCH & JONLI TELEMETRIYA)
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'clubs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clubs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'remote_commands'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.remote_commands;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'club_workstations_cache'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.club_workstations_cache;
  END IF;
END $$;

-- ==============================================================================
-- 10. BOSHLANG'ICH (SEED) MA'LUMOTLAR
-- ==============================================================================

-- Super Admin foydalanuvchisi (Login: admin | Parol: admin123 | PIN: 7777)
-- Parol xeshi: PBKDF2 sha512 (admin123)
INSERT INTO public.super_admins (
    id, username, password_hash, pin_code, full_name, phone
) VALUES (
    1,
    'admin',
    '336df52b477bcf4d1aa41d639b7bf646:b89115fbc70f93da1fa8bb4356a5e18237279c13eeec58a8a4734ba98ee7327ef8ce6f4435889ff0430db88cf8e67fb1179ceb649dcf4615aa4d7f5518b57b98',
    '7777',
    'Softech Super Admin',
    '+998 95 222 06 44'
) ON CONFLICT (username) DO NOTHING;

-- Serial sanagichni to'g'rilash
SELECT setval('public.super_admins_id_seq', (SELECT COALESCE(MAX(id), 1) FROM public.super_admins));

