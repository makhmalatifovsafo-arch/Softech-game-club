-- Independent launcher diagnostics; never modifies clubs.last_heartbeat_at.
BEGIN;
CREATE TABLE IF NOT EXISTS public.club_server_diagnostics (
 club_id bigint PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, observed_at timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.club_server_diagnostics ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.club_server_diagnostics FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.club_server_diagnostics TO service_role;
CREATE OR REPLACE FUNCTION public.softech_server_diagnostic_upsert(p_club_id bigint,p_payload jsonb,p_observed_at timestamptz)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
 INSERT INTO public.club_server_diagnostics(club_id,payload,observed_at,received_at)
 VALUES(p_club_id,p_payload,p_observed_at,now())
 ON CONFLICT(club_id) DO UPDATE SET payload=excluded.payload,observed_at=excluded.observed_at,received_at=excluded.received_at
 WHERE excluded.observed_at>club_server_diagnostics.observed_at;
$$;
REVOKE ALL ON FUNCTION public.softech_server_diagnostic_upsert(bigint,jsonb,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.softech_server_diagnostic_upsert(bigint,jsonb,timestamptz) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
