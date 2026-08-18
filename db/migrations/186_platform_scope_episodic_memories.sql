-- 186_platform_scope_episodic_memories.sql
--
-- PLATFORM-SCOPE MEMORY = NULL tenant_id, mirroring the descent model.
--
-- Why: an rfp_admin has no ambient cross-tenant reach — to touch anything in a tenant's
-- space they DESCEND into that tenant's RLS shadow account, and are then scoped to it.
-- Memory has to obey the same rule: work done in TENANT space is that tenant's memory;
-- work done in PLATFORM space is platform memory, owned by no tenant.
--
-- Curation is platform work by construction. All four writers of curation memory
-- (compliance.save_variable_value, solicitation.approve/dismiss/push) are
-- `tenantScoped: false`, so ctx.tenantId is ALWAYS null and they operate on
-- `curated_solicitations` — the MASTER records, before any tenant mirror exists.
--
-- Before this migration `tenant_id` was `UUID NOT NULL REFERENCES tenants(id)`, so
-- platform scope had nowhere to go. The original code wrote the nil UUID, the FK rejected
-- it every single time, and the best-effort catch in writeCurationMemory swallowed the
-- error — the HITL learning loop (design decision D-Phase1-14) never persisted one row in
-- the product's life. Filing it under the house `rfp-pipeline` tenant instead would make
-- it work, but conflates platform knowledge with ONE tenant's own memory: any agent
-- holding rfp-pipeline context would see the whole curation decision history through the
-- tenant-scoped `memory.search` tool. That is precisely the conflation descent prevents.
--
-- Precedent: `tasks` and `process_instances` already model platform scope exactly this way
-- (053_tasks_ledger.sql: "NULL tenant_id = an admin/system task (rfp_admin queue)").
--
-- ── Isolation consequences (deliberate, and stricter than the tasks precedent) ──
-- The `tenant_isolation` policy is left UNCHANGED: `tenant_id = app.tenant_id`. NULL is
-- never equal to anything, so a NULL-tenant row is invisible to the `govtech_app` role
-- under EVERY tenant context, and un-writable through the context-aware client. Platform
-- memory is therefore reachable only through an explicit `sqlBypass` — i.e. an admin /
-- platform code path — and never from tenant space. We do NOT add the tasks-style
-- `OR (tenant_id IS NULL)` read branch, because that would let any tenant context read
-- platform memory, which is the opposite of the intent here.
--
-- Consumers, unchanged and already correct for this shape:
--   • /api/admin/compliance-suggest — `sqlBypass`, filters by namespace + agent_role, no
--     tenant filter → still finds platform curator memories (the cross-cycle pre-fill).
--   • lib/tools/memory-search.ts (tenantScoped) — `WHERE tenant_id = $tenantId` → NULL
--     never matches, so platform memory is excluded from every tenant's search.
--   • pipeline archetype memory searches — same tenant-equality filter, same exclusion.
--
-- Existing rows are untouched: all 11 carry a real tenant_id and stay tenant-scoped.

-- (the migrate runner wraps each file in its own transaction — no explicit BEGIN/COMMIT,
--  matching every other migration in this tree.)

ALTER TABLE episodic_memories ALTER COLUMN tenant_id DROP NOT NULL;

COMMENT ON COLUMN episodic_memories.tenant_id IS
  'Owning tenant. NULL = PLATFORM scope (admin/curation work done outside any tenant space) — '
  'reachable only via sqlBypass, excluded from every tenant-scoped memory search by the '
  'tenant-equality RLS policy. Mirrors tasks/process_instances. See migration 186.';

-- Partial index so the platform-scope reads (namespace pre-fill) stay cheap as the
-- curation ledger grows, without bloating the tenant-scoped path.
CREATE INDEX IF NOT EXISTS idx_episodic_memories_platform_namespace
  ON episodic_memories (namespace, agent_role, created_at DESC)
  WHERE tenant_id IS NULL;
