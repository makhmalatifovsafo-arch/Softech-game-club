
-- One server per hardware fingerprint; required for activation upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_hardware_unique ON public.clubs(hardware_fingerprint);
