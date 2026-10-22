-- PRE-MIGRATION fixture for an isolated, disposable Supabase database only.
-- Run after the existing leads/auth schema and before the workspace migration.
-- Do not run this fixture against production or a database containing this UUID.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = 'f1111111-1111-4111-8111-111111111101'
  ) OR EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f2222222-2222-4222-8222-222222222201'
  ) THEN
    RAISE EXCEPTION 'Preservation fixture UUID collision; reset the disposable database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'f1111111-1111-4111-8111-111111111101', 'authenticated', 'authenticated',
  'migration-preservation@example.invalid', '', now(), '{}', '{}', now(), now()
);

INSERT INTO public.leads (
  id, user_id, name, email, phone, company_name, lead_status, notes, created_at, updated_at
) VALUES (
  'f2222222-2222-4222-8222-222222222201',
  'f1111111-1111-4111-8111-111111111101',
  'Migration preservation fixture',
  'preservation@example.invalid',
  '+380000000000',
  'Fixture company',
  'Contacted',
  'This row must remain byte-for-byte equivalent in its existing fields.',
  '2026-01-02T03:04:05Z',
  '2026-02-03T04:05:06Z'
);

COMMIT;
