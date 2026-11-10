-- Persistent mobile reports and staff sessions. Apply in Supabase SQL Editor.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mobile_dashboard_data (
 club_id bigint NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 data_key text NOT NULL, payload jsonb NOT NULL, captured_at timestamptz NOT NULL,
 PRIMARY KEY (club_id, data_key)
);
CREATE TABLE IF NOT EXISTS public.mobile_dashboard_sessions (
 token_hash text PRIMARY KEY, club_id bigint NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('manager','administrator')),
 username text NOT NULL, revision bigint NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.mobile_dashboard_limits (
 bucket text PRIMARY KEY, attempts integer NOT NULL, reset_at timestamptz NOT NULL
);
ALTER TABLE public.mobile_dashboard_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_dashboard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_dashboard_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_dashboard_data,public.mobile_dashboard_sessions,public.mobile_dashboard_limits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mobile_dashboard_data,public.mobile_dashboard_sessions,public.mobile_dashboard_limits TO service_role;
CREATE OR REPLACE FUNCTION public.softech_mobile_snapshot_upsert(p_rows jsonb)
RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public AS $$
 INSERT INTO public.mobile_dashboard_data(club_id,data_key,payload,captured_at)
 SELECT club_id,data_key,payload,captured_at FROM jsonb_to_recordset(p_rows)
 AS r(club_id bigint,data_key text,payload jsonb,captured_at timestamptz)
 ON CONFLICT(club_id,data_key) DO UPDATE SET payload=excluded.payload,captured_at=excluded.captured_at
 WHERE excluded.captured_at >= mobile_dashboard_data.captured_at;
$$;
REVOKE ALL ON FUNCTION public.softech_mobile_snapshot_upsert(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.softech_mobile_snapshot_upsert(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.softech_mobile_login_limit(p_bucket text, p_limit integer)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 IF p_bucket IS NULL OR length(p_bucket)>128 OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid bucket'; END IF;
 DELETE FROM public.mobile_dashboard_limits WHERE reset_at < now();
 INSERT INTO public.mobile_dashboard_limits(bucket,attempts,reset_at) VALUES(p_bucket,1,now()+interval '10 minutes')
 ON CONFLICT(bucket) DO UPDATE SET attempts=mobile_dashboard_limits.attempts+1
 RETURNING attempts INTO n;
 RETURN n<=p_limit;
END $$;
REVOKE ALL ON FUNCTION public.softech_mobile_login_limit(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.softech_mobile_login_limit(text,integer) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
