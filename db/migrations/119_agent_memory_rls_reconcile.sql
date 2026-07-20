-- 119_agent_memory_rls_reconcile.sql
--
-- #120 / launch-readiness P1-1. `semantic_memories`, `procedural_memories`, and
-- `agent_task_log` have RLS ENABLED but NO POLICY and NOT FORCED — inconsistent with
-- `episodic_memories` (mig 116, forced + tenant_isolation). RLS-on + no-policy means:
--   • for a NOBYPASSRLS role (the mig-117 `rfp_agent`): DENY-ALL → the agent would read
--     ZERO semantic/procedural memories (silent split-brain), and
--   • for a bypass owner conn: no-op.
-- Add the standard tenant_isolation policy + FORCE so isolation is real once the agent role
-- lands. INERT today under the bypass app role. Idempotent.
--
-- NULLIF(current_setting('app.tenant_id', true),'') → NULL when unset → deny-by-default,
-- matching mig 116 exactly.

-- Memory tables are always tenant-scoped (the fabric only stores memory when tenant_id is
-- set), so the symmetric episodic policy applies verbatim.
ALTER TABLE semantic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE semantic_memories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON semantic_memories;
CREATE POLICY tenant_isolation ON semantic_memories
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

ALTER TABLE procedural_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE procedural_memories FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON procedural_memories;
CREATE POLICY tenant_isolation ON procedural_memories
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);

-- agent_task_log ALSO holds PLATFORM-scope rows (tenant_id IS NULL — logged for platform
-- agents like scout/ingest/ops_digest). Reads stay tenant-isolated (a tenant never sees NULL
-- platform rows; the admin usage rollup reads via the bypass role and sees everything), but
-- the WITH CHECK must permit tenant_id IS NULL so platform-agent logging still writes.
ALTER TABLE agent_task_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_task_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON agent_task_log;
CREATE POLICY tenant_isolation ON agent_task_log
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (
    tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid
    OR tenant_id IS NULL
  );
