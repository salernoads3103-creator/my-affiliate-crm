-- POST-MIGRATION assertion for the isolated fixture in prepare-lead-preservation.sql.
-- Run after the workspace migration has completed in that disposable database.

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = 'f2222222-2222-4222-8222-222222222201';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The existing lead was deleted during migration';
  END IF;
  IF v_lead.user_id <> 'f1111111-1111-4111-8111-111111111101'
     OR v_lead.name <> 'Migration preservation fixture'
     OR v_lead.email <> 'preservation@example.invalid'
     OR v_lead.phone <> '+380000000000'
     OR v_lead.company_name <> 'Fixture company'
     OR v_lead.lead_status <> 'Contacted'
     OR v_lead.notes <> 'This row must remain byte-for-byte equivalent in its existing fields.'
     OR v_lead.created_at <> '2026-01-02T03:04:05Z'::TIMESTAMPTZ
     OR v_lead.updated_at <> '2026-02-03T04:05:06Z'::TIMESTAMPTZ THEN
    RAISE EXCEPTION 'An existing lead field changed during migration';
  END IF;
  IF v_lead.workspace_id IS DISTINCT FROM v_main_workspace
     OR v_lead.operator_id IS DISTINCT FROM v_lead.user_id
     OR v_lead.team_id IS NOT NULL
     OR v_lead.offer_id IS NOT NULL THEN
    RAISE EXCEPTION 'Existing lead workspace/operator backfill is incorrect';
  END IF;
END;
$$;

SELECT 'lead-preservation assertions passed' AS result;
