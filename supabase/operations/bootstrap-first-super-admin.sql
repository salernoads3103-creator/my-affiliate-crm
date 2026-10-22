-- Manual one-time bootstrap for the first Super Admin.
-- This operation is for a trusted database owner in Supabase SQL Editor only.
-- The private function has no EXECUTE grant for PUBLIC, anon, or authenticated.
-- It uses a transaction-scoped advisory lock and rejects a second bootstrap.

-- First, independently confirm the exact existing account and its UUID:
-- SELECT id, email, email_confirmed_at
-- FROM auth.users
-- WHERE lower(email) = lower('YOUR_ACCOUNT_EMAIL');
-- Replace target_user_id and expected_email below with the verified values.

BEGIN;

DO $$
DECLARE
  target_user_id UUID := NULL;
  expected_email TEXT := 'REPLACE_WITH_VERIFIED_ACCOUNT_EMAIL';
BEGIN
  IF target_user_id IS NULL
     OR expected_email = 'REPLACE_WITH_VERIFIED_ACCOUNT_EMAIL' THEN
    RAISE EXCEPTION 'Replace the UUID and email placeholders before running this script';
  END IF;

  PERFORM lumen_private.bootstrap_first_super_admin(target_user_id, expected_email);
END;
$$;

COMMIT;
