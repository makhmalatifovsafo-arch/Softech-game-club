-- Fix PostgreSQL 42P10 during Telegram activation requests.
-- Run in the affected project's Supabase SQL Editor.
BEGIN;

-- Keep the duplicate check and index creation consistent with concurrent requests.
LOCK TABLE public.clubs IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.clubs
        WHERE hardware_fingerprint IS NOT NULL
        GROUP BY hardware_fingerprint HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate club HWIDs exist. No club was changed. Review duplicate hardware_fingerprint values before retrying this migration.';
    END IF;
END $$;

-- Use a new name: an older index with the original name may be partial or
-- non-unique, and CREATE INDEX IF NOT EXISTS would silently leave it unchanged.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_activation_hwid_unique
    ON public.clubs (hardware_fingerprint);

NOTIFY pgrst, 'reload schema';
COMMIT;
