-- 136_rls_cutover.sql — make RLS a real second layer (docs/RLS_CUTOVER.md).
--
-- Adds tenant-isolation policies to the 16 tenant-scoped tables that were unprotected, and
-- grants the app role `govtech_app` (created NOLOGIN in mig 094) the privileges it needs.
--
-- IMPORTANT: ENABLE (not FORCE) ROW LEVEL SECURITY. Policies then apply to `govtech_app`
-- (NOBYPASSRLS, the frontend's tenant connection) but NOT the owner role, so the owner/bypass
-- connection (auth, admin cross-tenant reads, the Python pipeline, migrations) is unrestricted.
-- Inert until the frontend DATABASE_URL is repointed at govtech_app — today the app runs as the
-- owner, which bypasses these policies, so behavior is unchanged. Idempotent / re-runnable.
--
-- Predicate matches the 17 existing policies (mig 117/134):
--   tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid

-- ── grants: govtech_app can touch what the app touches; RLS provides the isolation ──
GRANT USAGE ON SCHEMA public TO govtech_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO govtech_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO govtech_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO govtech_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO govtech_app;

-- ── ISOLATE (strict): clean per-tenant tables, only read inside a tenant request ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'purchases','proposal_activity_log','tenant_documents','document_cocoons','contracts',
    'spotlights','spotlight_bucket_scores','library_seed_jobs','tenant_agent_config',
    'tenant_automation_preferences','proposal_supporting_docs','agent_performance','agent_task_queue'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = (NULLIF(current_setting(''app.tenant_id'', true), ''''))::uuid) '
      'WITH CHECK (tenant_id = (NULLIF(current_setting(''app.tenant_id'', true), ''''))::uuid)', t);
  END LOOP;
END $$;

-- ── ISOLATE (with-shared): tables that deliberately surface tenant_id IS NULL global/shared rows
--    to tenant sessions (admin triage/global tasks, admin workflows, the shared template catalog).
--    The app-layer WHERE stays the precise filter; this is the coarse tenant backstop. ──
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tasks','process_instances','document_templates'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL '
      'USING (tenant_id = (NULLIF(current_setting(''app.tenant_id'', true), ''''))::uuid OR tenant_id IS NULL) '
      'WITH CHECK (tenant_id = (NULLIF(current_setting(''app.tenant_id'', true), ''''))::uuid OR tenant_id IS NULL)', t);
  END LOOP;
END $$;

-- BYPASS (left RLS-off, cross-tenant/auth/audit by design — see docs/RLS_CUTOVER.md):
--   users · user_memberships · invitations · system_events · audit_log · tenant_bridge_cursor
--   · tool_invocation_metrics
