-- Record every input used to prepare a landing archive.
-- Existing archives intentionally remain NULL until they are prepared again.
BEGIN;

ALTER TABLE public.workspace_landings
  ADD COLUMN adapted_build_fingerprint TEXT,
  ADD CONSTRAINT workspace_landings_adapted_build_fingerprint_check
    CHECK (
      adapted_build_fingerprint IS NULL
      OR adapted_build_fingerprint ~ '^[0-9a-f]{64}$'
    );

CREATE FUNCTION public.prevent_landing_build_fingerprint_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.adapted_build_fingerprint IS DISTINCT FROM OLD.adapted_build_fingerprint
     AND (
       OLD.status <> 'draft'
       OR OLD.deletion_started_at IS NOT NULL
       OR NEW.deletion_started_at IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'Only an editable landing draft can change its build fingerprint'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_landing_build_fingerprint_change()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER prevent_landing_build_fingerprint_change
  BEFORE UPDATE ON public.workspace_landings
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_landing_build_fingerprint_change();

COMMENT ON COLUMN public.workspace_landings.adapted_build_fingerprint IS
  'SHA-256 fingerprint of the source ZIP, offer/form configuration, intake endpoint, tracking profiles, and adapter version used for the private adapted archive.';

COMMIT;
