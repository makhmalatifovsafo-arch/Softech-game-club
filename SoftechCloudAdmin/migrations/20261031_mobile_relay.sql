-- Softech mobile PWA relay. Run after the existing Softech cloud schema.
BEGIN;
CREATE TABLE IF NOT EXISTS public.mobile_agents (
 club_id bigint PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
 public_key jsonb NOT NULL, last_seen timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.mobile_requests (
 id uuid PRIMARY KEY, club_id bigint NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
 receipt_hash text NOT NULL, ip_hash text NOT NULL, request_hash text NOT NULL,
 box jsonb NOT NULL, result jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '30 seconds'
);
CREATE INDEX IF NOT EXISTS mobile_requests_club ON public.mobile_requests(club_id,created_at);
CREATE INDEX IF NOT EXISTS mobile_requests_ip ON public.mobile_requests(ip_hash,created_at);
ALTER TABLE public.mobile_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobile_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mobile_agents,public.mobile_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.mobile_agents,public.mobile_requests TO service_role;
CREATE OR REPLACE FUNCTION public.softech_mobile_enqueue(p_id uuid,p_club_id bigint,p_receipt_hash text,p_ip_hash text,p_request_hash text,p_box jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE old public.mobile_requests%ROWTYPE; count_requests integer;
BEGIN
 IF p_id IS NULL OR p_club_id IS NULL OR p_receipt_hash !~ '^[a-f0-9]{64}$' OR p_ip_hash !~ '^[a-f0-9]{64}$' OR p_request_hash !~ '^[a-f0-9]{64}$' OR p_box IS NULL OR octet_length(p_box::text)>65536 THEN RAISE EXCEPTION 'Invalid request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mobile-ip:'||p_ip_hash,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('mobile-club:'||p_club_id,0));
 DELETE FROM public.mobile_requests WHERE created_at<now()-interval '10 minutes';
 SELECT * INTO old FROM public.mobile_requests WHERE id=p_id;
 IF FOUND THEN
  IF old.club_id<>p_club_id OR old.receipt_hash<>p_receipt_hash OR old.request_hash<>p_request_hash THEN RAISE EXCEPTION 'Request ID conflict'; END IF;
  RETURN jsonb_build_object('success',true,'id',p_id);
 END IF;
 SELECT count(*) INTO count_requests FROM public.mobile_requests WHERE created_at>now()-interval '1 minute' AND (ip_hash=p_ip_hash OR club_id=p_club_id);
 IF count_requests>=120 THEN RAISE EXCEPTION 'Rate limited'; END IF;
 INSERT INTO public.mobile_requests(id,club_id,receipt_hash,ip_hash,request_hash,box) VALUES(p_id,p_club_id,p_receipt_hash,p_ip_hash,p_request_hash,p_box);
 RETURN jsonb_build_object('success',true,'id',p_id);
END $$;
REVOKE ALL ON FUNCTION public.softech_mobile_enqueue(uuid,bigint,text,text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.softech_mobile_enqueue(uuid,bigint,text,text,text,jsonb) TO service_role;
COMMIT;