-- 116_agent_memory_rls.sql
--
-- #117 agent security foundation (§7b). The agent memory table `episodic_memories` had
-- RLS ENABLED but NOT FORCED and no tenant policy — so a non-bypass agent role could read
-- across tenants. Add the standard tenant_isolation policy + FORCE, mirroring library_atoms.
--
-- SAFE TO SHIP NOW: the current pipeline/app role has rolbypassrls=true, so this is INERT
-- until the dedicated NOBYPASSRLS agent role lands (which will also SET app.tenant_id per
-- invocation, at which point RLS becomes the real backstop over the explicit WHERE).
--
-- NOTE (deliberately scoped): `proposals` (rls disabled) is queried by many frontend admin
-- paths; force-RLS there needs a per-query app.tenant_id audit first, so it is handled
-- separately, not here. Idempotent.

ALTER TABLE episodic_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE episodic_memories FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON episodic_memories;
CREATE POLICY tenant_isolation ON episodic_memories
  FOR ALL
  USING (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid)
  WITH CHECK (tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid);
