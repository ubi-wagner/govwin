-- 173_rls_close_amendment_notification_gap.sql
-- Close the RLS coverage gap for two tenant-scoped tables added AFTER the mig-136
-- NOBYPASSRLS cutover (docs/RLS_CUTOVER.md), so re-validating the cutover at head 172
-- found them with NO tenant_isolation backstop under `govtech_app`:
--   • notification_read_state (mig 145) — per-user notification read watermark.
--   • proposal_amendment_flags (mig 146) — the amendment fan-out flag per affected proposal.
-- Both carry ONLY tenant-scoped rows (verified: 0 NULL tenant_id), so a missing app-layer
-- `WHERE tenant_id` could leak them cross-tenant with zero backstop once the app connects
-- as the non-owner govtech_app role. Bring them under the same strict tenant_isolation
-- policy as the other ISOLATE tables (predicate identical to mig 094/117/134).
--
-- ENABLE (not FORCE): the owner/bypass pool must stay unrestricted so the admin amendments
-- list route can read proposal_amendment_flags cross-tenant (flagged/acknowledged counts)
-- and confirmAmendment can fan a flag out to every affected tenant — both run on the bypass
-- connection (enterBypass). govtech_app (the tenant connection) is policed regardless.
--
-- Writer wiring lands in the SAME commit (frontend): the notifications portal route gains
-- enterTenant; the admin amendments list + confirm routes gain enterBypass. Inert until the
-- prod DATABASE_URL flip (owner/superuser bypasses RLS today).

ALTER TABLE notification_read_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON notification_read_state;
CREATE POLICY tenant_isolation ON notification_read_state
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE proposal_amendment_flags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON proposal_amendment_flags;
CREATE POLICY tenant_isolation ON proposal_amendment_flags
    USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- Grants (defensive — ALTER DEFAULT PRIVILEGES already covers new tables, but match the
-- cutover's explicit-grant idiom so a from-scratch migrate is self-contained). Guarded so a
-- pre-cutover DB without the role still applies clean.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govtech_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON notification_read_state TO govtech_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON proposal_amendment_flags TO govtech_app;
  END IF;
END $$;
