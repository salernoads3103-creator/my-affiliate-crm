-- Remove inherited/default table ACLs from public roles on private lead data.
-- Authenticated access remains governed by its existing grants and RLS policies;
-- service_role keeps its explicit grant from the original leads migration.
BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.leads FROM PUBLIC, anon;

COMMIT;
