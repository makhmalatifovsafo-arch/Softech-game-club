-- Run once in the intended Softech Supabase SQL editor, before deploying this release.
BEGIN;
-- Browser/club anon keys must never read admin hashes or write club/license/payment rows.
DO $$ DECLARE t text; p record; BEGIN
 FOREACH t IN ARRAY ARRAY['super_admins','clubs','club_metrics','club_workstations_cache','remote_commands','subscription_payments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename=t LOOP
   EXECUTE format('DROP POLICY %I ON public.%I',p.policyname,t);
  END LOOP;
  EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER TABLE public.subscription_payments ADD COLUMN IF NOT EXISTS request_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_request_id ON public.subscription_payments(request_id);
CREATE OR REPLACE FUNCTION public.softech_record_subscription_payment(
 p_club_id bigint,p_amount numeric,p_method text,p_months integer,p_notes text,p_recorded_by text,p_request_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public AS $$
DECLARE c public.clubs%ROWTYPE; p public.subscription_payments%ROWTYPE; next_expiry timestamptz;
BEGIN
 IF p_request_id IS NULL OR p_amount IS NULL OR p_amount<=0 OR p_amount>1000000000000 OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_months IS NULL OR p_months NOT BETWEEN 1 AND 36 OR p_method IS NULL OR p_method NOT IN ('CASH','CLICK','PAYME','BANK_TRANSFER') THEN
  RAISE EXCEPTION 'Invalid payment' USING ERRCODE='22023';
 END IF;
 -- Serialize retries for this request and concurrent extensions for this club.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 SELECT * INTO p FROM public.subscription_payments WHERE request_id=p_request_id;
 IF FOUND THEN
  IF p.club_id<>p_club_id OR p.amount<>round(p_amount,2) OR p.months_added<>p_months OR p.payment_method<>p_method THEN RAISE EXCEPTION 'Request ID already used for another payment' USING ERRCODE='22023'; END IF;
  SELECT * INTO c FROM public.clubs WHERE id=p_club_id;
 ELSE
  SELECT * INTO c FROM public.clubs WHERE id=p_club_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Club not found' USING ERRCODE='22023'; END IF;
  next_expiry=greatest(coalesce(c.license_expires_at,now()),now())+make_interval(days=>p_months*30);
  INSERT INTO public.subscription_payments(club_id,amount,payment_method,months_added,previous_expiry_date,new_expiry_date,notes,recorded_by,request_id)
   VALUES(p_club_id,round(p_amount,2),p_method,p_months,coalesce(c.license_expires_at,now()),next_expiry,left(coalesce(p_notes,''),2000),p_recorded_by,p_request_id) RETURNING * INTO p;
  UPDATE public.clubs SET license_expires_at=next_expiry,status='ACTIVE',block_reason=NULL,updated_at=now() WHERE id=p_club_id;
 END IF;
 RETURN jsonb_build_object('success',true,'paymentId',p.id,'clubId',p.club_id,'clubName',c.name,'amount',p.amount,'paymentMethod',p.payment_method,'monthsAdded',p.months_added,'previousExpiryDate',p.previous_expiry_date,'newExpiryDate',p.new_expiry_date,'status','ACTIVE');
END $$;
REVOKE ALL ON FUNCTION public.softech_record_subscription_payment(bigint,numeric,text,integer,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.softech_record_subscription_payment(bigint,numeric,text,integer,text,text,uuid) TO service_role;
COMMIT;
