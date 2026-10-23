-- Lead Foundation account-deletion preservation test.
-- Run only against a disposable local Supabase DB after all migrations.
-- Execute as the local database owner; all fixtures are rolled back.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'f3333333-3333-4333-8333-333333333301',
      'f3333333-3333-4333-8333-333333333302'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f4444444-4444-4444-8444-444444444401'
  ) THEN
    RAISE EXCEPTION 'Lead Foundation fixture UUID collision; reset the disposable database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('f3333333-3333-4333-8333-333333333301', 'authenticated', 'authenticated', 'lead-author@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('f3333333-3333-4333-8333-333333333302', 'authenticated', 'authenticated', 'lead-operator@example.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.leads (
  id, user_id, created_by_user_id, created_via, name, email, phone,
  phone_normalized, lead_status, workspace_id, operator_id, notes
) VALUES (
  'f4444444-4444-4444-8444-444444444401',
  'f3333333-3333-4333-8333-333333333301',
  'f3333333-3333-4333-8333-333333333301',
  'manual',
  'Author deletion preservation fixture',
  NULL,
  '067 123 45 67',
  '+380671234567',
  'Qualified',
  public.main_workspace_id(),
  'f3333333-3333-4333-8333-333333333302',
  'The lead must remain when its author account is deleted.'
);

DO $$
DECLARE
  v_rejected BOOLEAN := FALSE;
BEGIN
  BEGIN
    UPDATE public.leads
    SET user_id = NULL
    WHERE id = 'f4444444-4444-4444-8444-444444444401';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A live lead legacy creator reference was cleared directly';
  END IF;

  v_rejected := FALSE;
  BEGIN
    UPDATE public.leads
    SET created_by_user_id = NULL
    WHERE id = 'f4444444-4444-4444-8444-444444444401';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A live lead author reference was cleared directly';
  END IF;
END;
$$;

DELETE FROM auth.users WHERE id = 'f3333333-3333-4333-8333-333333333301';

DO $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = 'f4444444-4444-4444-8444-444444444401';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deleting an author removed the lead';
  END IF;
  IF v_lead.user_id IS NOT NULL OR v_lead.created_by_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Deleted author references were not safely nulled';
  END IF;
  IF v_lead.email IS NOT NULL
     OR v_lead.phone_normalized IS DISTINCT FROM '+380671234567'
     OR v_lead.lead_status IS DISTINCT FROM 'Qualified'::public.lead_status
     OR v_lead.workspace_id IS DISTINCT FROM public.main_workspace_id()
     OR v_lead.operator_id IS DISTINCT FROM 'f3333333-3333-4333-8333-333333333302'::UUID
     OR v_lead.notes IS DISTINCT FROM 'The lead must remain when its author account is deleted.' THEN
    RAISE EXCEPTION 'Deleting the author changed unrelated lead data or assignment';
  END IF;
END;
$$;

ROLLBACK;
