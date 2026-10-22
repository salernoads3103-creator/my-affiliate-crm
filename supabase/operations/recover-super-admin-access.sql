-- Break-glass access recovery for a trusted database owner only.
-- This is not exposed to anon/authenticated and is not an application API.
-- The script adds the verified account; it does not remove other administrators.

-- Independently confirm the exact existing account and its UUID first:
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

  PERFORM lumen_private.restore_super_admin_access(target_user_id, expected_email);
END;
$$;

COMMIT;
