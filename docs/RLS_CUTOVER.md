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

## P4 — the transparent context layer (BUILT + PROVEN — the zero-per-route mechanism)

Rather than hand-wrap ~73 call sites, tenant context is set at choke points and read by a
context-aware `sql` client:
- `lib/tenant-context.ts` — a **globalThis-singleton** AsyncLocalStorage (survives module
  duplication / Next dev reload). `enterTenant(id)` / `enterBypass()` / `runInTenant(id, fn)`.
- `lib/db.ts` — `sql` is now a **Proxy** over the raw client: with an active tenant context it
  runs each `sql\`\`` inside a `SET LOCAL app.tenant_id` transaction (RLS scopes it); with no
  context or a bypass context it is an **exact passthrough**. `sqlBypass` is the owner pool for
  cross-tenant reads.

**PROVEN in sandbox** (`scripts/drive-rls-context.mts`, app connected as `govtech_app`): 5/5 —
no-context → DENY-ALL, correct tenant → sees its row, other/forged-by-id cross-tenant → 0 (RLS
backstop), owner bypass → all. And **passthrough is transparent**: with no context wired,
`vitest` 829 + `drive-vault-{collab-surface 5/5, isolation 7/7, leak}` are green (the Proxy is
inert in the hot path). tsc 0.

### Activation (the remaining wiring — a gated step, NOT yet enabled)
1. **Portal (50 routes) — one choke point:** call `enterTenant(tenantId)` right after a
   successful `verifyTenantAccess` (or in the shared portal gate). Every portal `sql` then
   self-scopes; no per-route edits.
2. **Admin (20 routes) — cross-tenant reads:** swap `sql` → `sqlBypass` for reads that aggregate
   across tenants (`/api/admin/agents/workforce` agent_task_queue rollup, etc.). Auth
   (users/user_memberships) already hits RLS-off tables, so no change.
3. **Pipeline** keeps its own owner `DATABASE_URL` (the cross-tenant engine).

Activation flips every portal request onto per-query transactions (results identical under the
owner today; isolation under `govtech_app`), so it must land with the P5 full-app proof, not
before.

## P5 — the pre-flip gate (the mechanism is proven; the app-wide proof remains)
Run the whole Next app connected as `govtech_app` (sandbox) and drive the real routes (Playwright
+ the drive suite) to confirm **nothing DENY-ALLs** — this surfaces any portal route that skips
the `enterTenant` choke point or any admin read that still needs `sqlBypass`. Fix those, re-run
green. **Prod flip is then one op:** point the frontend `DATABASE_URL` at `govtech_app`, set
`DATABASE_URL_OWNER` to the owner string (for `sqlBypass`). No code change at flip time.
