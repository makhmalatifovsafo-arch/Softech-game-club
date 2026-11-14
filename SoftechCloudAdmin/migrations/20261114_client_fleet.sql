-- Per-workstation client version, update progress and durable installation receipt.
BEGIN;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS client_version text;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_status text NOT NULL DEFAULT 'IDLE';
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_target_version text;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_command_id bigint;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_error text;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_receipt_id text;
ALTER TABLE public.club_workstations_cache ADD COLUMN IF NOT EXISTS update_observed_at timestamptz;
NOTIFY pgrst, 'reload schema';
COMMIT;
