-- 117_agent_rls_role.sql
--
-- #120 agent security foundation. Two parts, BOTH INERT under today's bypass app role
-- (`rolbypassrls = true`), so admin/frontend cross-tenant paths are unaffected:
--
--   (A) Extend the standard tenant RLS to the remaining agent-touched tables
--       (proposals, proposal_sections, tenant_profiles, atom_tags), mirroring the
--       library_atoms / episodic_memories policy (migs prior + 116). This closes the
--       gap the 116 note called out ("proposals handled separately").
--
--   (B) Create a dedicated NOBYPASSRLS agent role `rfp_agent`. Once the pipeline's AGENT
--       path connects as it (AGENT_DATABASE_URL) and the fabric runs `SET app.tenant_id`
--       per invocation (see pipeline/src/agents/fabric.py), RLS becomes the REAL backstop
--       over the explicit `WHERE tenant_id` — a cross-tenant read/write is denied by the
--       engine, not just by the query. The frontend/app role stays bypass, so its
--       legitimate cross-tenant admin work is unchanged.
--
-- Policy shape matches mig 116 exactly: NULLIF(current_setting('app.tenant_id', true),'')
-- so an UNSET GUC yields NULL → no rows (deny-by-default), never an error.
-- Idempotent (DROP POLICY IF EXISTS + guarded CREATE ROLE).

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) RLS on the remaining agent-touched tenant tables
-- ─────────────────────────────────────────────────────────────────────────────

-- proposals — has tenant_id directly.
ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON proposals;
CREATE POLICY tenant_isolation ON proposals
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

-- tenant_profiles — has tenant_id directly.
ALTER TABLE tenant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_profiles;
CREATE POLICY tenant_isolation ON tenant_profiles
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

-- proposal_sections — keys off proposal_id → gate via the (RLS-protected) parent proposal.
ALTER TABLE proposal_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_sections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON proposal_sections;
CREATE POLICY tenant_isolation ON proposal_sections
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM proposals p
    WHERE p.id = proposal_sections.proposal_id
      AND p.tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM proposals p
    WHERE p.id = proposal_sections.proposal_id
      AND p.tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid));

-- atom_tags — keys off atom_id → gate via the (RLS-protected) parent atom. Defense-in-depth:
-- agents already join through library_atoms with the tenant filter, but this denies any direct
-- atom_tags access under the agent role too.
ALTER TABLE atom_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE atom_tags FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON atom_tags;
CREATE POLICY tenant_isolation ON atom_tags
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM library_atoms a
    WHERE a.id = atom_tags.atom_id
      AND a.tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid))
  WITH CHECK (EXISTS (
    SELECT 1 FROM library_atoms a
    WHERE a.id = atom_tags.atom_id
      AND a.tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid));

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) The NOBYPASSRLS agent role
-- ─────────────────────────────────────────────────────────────────────────────
-- A NOLOGIN group role: ops attaches a LOGIN member (or `ALTER ROLE rfp_agent LOGIN PASSWORD …`)
-- and points AGENT_DATABASE_URL at it. Row access is governed by RLS (NOBYPASSRLS); table grants
-- are read-broad + the narrow direct writes the fabric makes (episodic_memories, agent_task_log,
-- system_events). All business-table LANDING still goes through the audited frontend tool registry
-- (the bypass app role), never this role. No DELETE, no DDL.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rfp_agent') THEN
    CREATE ROLE rfp_agent NOBYPASSRLS NOLOGIN;
  ELSE
    ALTER ROLE rfp_agent NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO rfp_agent;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO rfp_agent;
GRANT INSERT, UPDATE ON episodic_memories, agent_task_log, system_events TO rfp_agent;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rfp_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO rfp_agent;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO rfp_agent;
