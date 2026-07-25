# RLS NOBYPASSRLS cutover — the map, the migration, the proof

**Goal:** make Row-Level Security a real second layer. Today the frontend connects as the
RLS-**bypassing owner** role, so the tenant-isolation policies are inert — the only live guard
is the hand-written `WHERE tenant_id` predicate (one omitted predicate = cross-tenant leak with
zero backstop). The cutover points the frontend's tenant connection at the existing
`govtech_app` role (NOBYPASSRLS), so RLS enforces isolation underneath the app-layer predicates.

**Model (two connections):**
- **Tenant connection = `govtech_app`** (NOBYPASSRLS, LOGIN). The default. Every request opens a
  `withTenant(tenantId)` tx that `SET LOCAL app.tenant_id`; RLS restricts each isolated table to
  that tenant. `lib/rls.ts` already does this (29 callers).
- **Bypass connection = the owner role** (BYPASSRLS by ownership). Used for (a) auth (users lookup
  before any tenant context), (b) admin cross-tenant reads (aggregate across tenants), and (c) the
  Python pipeline (the cross-tenant engine). RLS is **ENABLE**'d (not FORCE'd) on the new tables, so
  the owner is unrestricted — only `govtech_app` is policed.

Predicate (matches the 17 existing policies from mig 117/134):
`tenant_id = (NULLIF(current_setting('app.tenant_id', true), ''))::uuid`

---

## Classification of the 23 tenant-scoped tables that were unprotected

Signal used: does the table carry `tenant_id IS NULL` rows (admin/global/shared), and is it ever
read **outside** a single-tenant request (auth, admin cross-tenant, pipeline fan-out)?

### ISOLATE — strict (`= app.tenant_id`)  · 13 tables
Clean per-tenant tables, 0 null rows, only read inside a tenant request:
`purchases · proposal_activity_log · tenant_documents · document_cocoons · contracts ·
spotlights · spotlight_bucket_scores · library_seed_jobs · tenant_agent_config ·
tenant_automation_preferences · proposal_supporting_docs · agent_performance · agent_task_queue`

> `agent_task_queue`: the **admin workforce rollup** (`/api/admin/agents/workforce`) reads it
> across ALL tenants → that route must use the **bypass** connection (P4). Tenant/pipeline writes
> are fine (pipeline = owner; tenant portal reads its own).

### ISOLATE — with-shared (`= app.tenant_id OR tenant_id IS NULL`)  · 3 tables
Carry global/shared rows that the app deliberately surfaces to tenants:
- `tasks` — 4/10 null: admin triage ToDos (rfp_admin, tenant_id NULL) AND global `proposal_setup`
  tasks that `listTasks` surfaces to tenants (tasks.ts:117). The `OR NULL` keeps them visible; the
  app-layer WHERE stays the precise filter. Admin's "read all tenants' tasks" still uses bypass.
- `process_instances` — 2/4 null: admin/master workflows visible in the admin console.
- `document_templates` — 3/12 null: the shared template catalog (like `system_starter`) must be
  visible to every tenant; `OR NULL` = own + shared.

### BYPASS — leave RLS off  · 7 tables
Read cross-tenant by design; app-layer already filters portal reads:
- `users` — auth looks up by email **before** any tenant context. Isolating breaks login.
- `user_memberships` — read by `user_id` across tenants (`getActiveMemberships`, dispatcher,
  `verifyTenantAccess`). Isolating breaks identity/routing.
- `invitations` — read by token pre-session.
- `system_events` — 481/787 null: a shared audit/bridge log; admin reads all, emits carry mixed
  tenants. Portal timeline already filters `tenant_id` at the app layer.
- `audit_log` · `tenant_bridge_cursor` (pipeline fan-out) · `tool_invocation_metrics` (12/12 null,
  global) — cross-cutting / global.

(`proposal_sections`, `atom_tags` are already protected via join-predicate policies — no direct
`tenant_id` column, so they're outside the 23.)

---

## P4 — GUC coverage + bypass routing (code)
1. Every `govtech_app` read of an isolated table must run inside `withTenant`. Known bare-`sql`
   reader to wrap: `lib/tools/library-search-atoms.ts` (sweep finding). Sweep remaining readers.
2. Admin cross-tenant reads → a `sqlBypass` (owner) connection: `/api/admin/agents/workforce`
   (agent_task_queue rollup), plus any admin route aggregating purchases/tasks/process_instances
   across tenants. Auth (users) already hits RLS-off tables, so no change needed there.
3. The Python pipeline keeps its own (owner) `DATABASE_URL` — it is the cross-tenant engine.

## P5 — sandbox proof (before any prod flip)
- `ALTER ROLE govtech_app LOGIN PASSWORD '…'` (sandbox only), connect a drive as `govtech_app`
  with `app.tenant_id` set, and assert: (a) a **forged cross-tenant query** with no `WHERE
  tenant_id` returns **only** the current tenant's rows (RLS caught it); (b) the full drive suite
  is green (nothing DENY-ALLs); (c) the owner/bypass connection still reads all tenants.
- **Prod flip = one op:** repoint the frontend `DATABASE_URL` to `govtech_app` (keep an owner
  connection string for the bypass pool). No code change at flip time.
