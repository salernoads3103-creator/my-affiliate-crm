-- Lead Foundation: preserve existing leads while separating authorship from
-- the legacy user_id field and preparing nullable e-commerce intake data.
-- Apply only after reviewing against a disposable local Supabase database.

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN created_by_user_id UUID,
  ADD COLUMN created_via TEXT,
  ADD COLUMN phone_normalized TEXT,
  ADD COLUMN traffic_source TEXT,
  ADD COLUMN utm_source TEXT,
  ADD COLUMN utm_medium TEXT,
  ADD COLUMN utm_campaign TEXT,
  ADD COLUMN utm_content TEXT,
  ADD COLUMN utm_term TEXT,
  ADD COLUMN utm_id TEXT,
  ADD COLUMN ttclid TEXT,
  ADD COLUMN sub_id TEXT,
  ADD COLUMN delivery_provider TEXT,
  ADD COLUMN delivery_type TEXT,
  ADD COLUMN delivery_city_ref TEXT,
  ADD COLUMN delivery_city_name TEXT,
  ADD COLUMN delivery_warehouse_ref TEXT,
  ADD COLUMN delivery_warehouse_name TEXT;

-- Keep historical business fields and timestamps unchanged while backfilling
-- the new metadata. Historical intake source cannot be inferred reliably, so
-- "manual" is the documented fallback for rows created before source tracking.
ALTER TABLE public.leads DISABLE TRIGGER update_leads_updated_at;

WITH phone_digits AS (
  SELECT id, regexp_replace(phone, '[^0-9]', '', 'g') AS digits
  FROM public.leads
  WHERE phone IS NOT NULL
)
UPDATE public.leads AS lead
SET created_by_user_id = lead.user_id,
    created_via = 'manual',
    phone_normalized = CASE
      WHEN phone_digits.digits ~ '^380[0-9]{9}$' THEN '+' || phone_digits.digits
      WHEN phone_digits.digits ~ '^0[0-9]{9}$' THEN '+38' || phone_digits.digits
      ELSE NULL
    END
FROM phone_digits
WHERE phone_digits.id = lead.id;

UPDATE public.leads
SET created_by_user_id = user_id,
    created_via = 'manual'
WHERE created_by_user_id IS NULL OR created_via IS NULL;

ALTER TABLE public.leads ENABLE TRIGGER update_leads_updated_at;

ALTER TABLE public.leads
  ALTER COLUMN email DROP NOT NULL,
  ALTER COLUMN user_id DROP NOT NULL,
  ALTER COLUMN created_via SET DEFAULT 'manual',
  ALTER COLUMN created_via SET NOT NULL,
  ADD CONSTRAINT leads_created_by_user_id_fkey
    FOREIGN KEY (created_by_user_id) REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_created_via_check
    CHECK (created_via IN ('manual', 'landing', 'api', 'import')),
  ADD CONSTRAINT leads_delivery_type_check
    CHECK (delivery_type IS NULL OR delivery_type IN ('warehouse', 'postomat', 'address'));

-- The legacy column remains available during the API transition, but deleting
-- an auth user can no longer cascade-delete business data.
DO $$
DECLARE
  v_delete_action "char";
BEGIN
  SELECT confdeltype INTO v_delete_action
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.leads'::regclass
    AND conname = 'leads_user_id_fkey'
    AND contype = 'f';

  IF NOT FOUND OR v_delete_action <> 'c' THEN
    RAISE EXCEPTION 'Expected leads_user_id_fkey with ON DELETE CASCADE; review the Lead Foundation migration before applying';
  END IF;
END;
$$;

-- Allow FK-driven nulling on account deletion, while still preventing a
-- creator from being reassigned to another account.
CREATE OR REPLACE FUNCTION public.prevent_lead_creator_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    IF NEW.user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.user_id) THEN
      RAISE EXCEPTION 'Lead creator cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.prevent_lead_author_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id THEN
    IF NEW.created_by_user_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM auth.users WHERE id = OLD.created_by_user_id) THEN
      RAISE EXCEPTION 'Lead author cannot be changed' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_author_immutable
  BEFORE UPDATE OF created_by_user_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.prevent_lead_author_change();

ALTER TABLE public.leads
  DROP CONSTRAINT leads_user_id_fkey,
  ADD CONSTRAINT leads_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX leads_workspace_phone_normalized_idx
  ON public.leads(workspace_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

COMMENT ON COLUMN public.leads.user_id IS
  'Legacy creator compatibility field. Nullable; new writes set it from the authenticated server context. Prefer created_by_user_id for authorship.';
COMMENT ON COLUMN public.leads.created_by_user_id IS
  'Authenticated user who created the lead. Nullable to preserve the lead if that account is deleted.';
COMMENT ON COLUMN public.leads.created_via IS
  'Controlled intake channel: manual, landing, api, or import. Historical rows use manual because their original channel is unknown.';
COMMENT ON COLUMN public.leads.phone_normalized IS
  'Normalized Ukrainian phone in +380XXXXXXXXX form when recognized. Not unique; historical unrecognized values remain NULL.';

COMMIT;
