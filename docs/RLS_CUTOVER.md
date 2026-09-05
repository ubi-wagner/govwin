# RLS NOBYPASSRLS cutover — the map, the migration, the proof

**Status: DONE (app-side).** Row-Level Security is a real second layer for the application: the frontend's
tenant connection points at the `govtech_app` role (NOBYPASSRLS), so RLS enforces isolation underneath the
app-layer `WHERE tenant_id` predicates (defense-in-depth). This doc is the as-built map + migration + proof.
(The pipeline **agent** role `rfp_agent` is built but still deploy-gated — ops provisions a LOGIN member +
points `AGENT_DATABASE_URL` at it; until then agents run on the caller connection with the app-layer
predicate + fail-closed guard as isolation.)

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

> **Hardening — mig 184 (see docs/COPY_INWARD_VERIFICATION.md).** The mig-136 `FOR ALL` policy shares
> one USING/CHECK across every command, so `OR tenant_id IS NULL` — correct for READ — also let a
> `govtech_app` tenant session UPDATE/DELETE/re-mint the shared `NULL` rows (proven live: a tenant
> could mutate or delete all 9 global `document_templates`). **mig 184** splits `document_templates`
> into per-command policies (SELECT reads own+shared; INSERT/UPDATE/DELETE own-only), closing it while
> preserving read-shared + own-writes. `tasks` + `process_instances` are deferred: they have a
> legitimate `govtech_app` `NULL`-row writer (automation admin-ToDos / workflow reconcilers), so their
> tightening needs a no-context carve-out — tracked, not app-exploitable today.

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

## P4 — the context layer (BUILT + PROVEN — as-built, corrected)

The original plan (set `enterTenant` inside `verifyTenantAccess`, zero per-route edits) **cannot
work**, and the proofing proved it: AsyncLocalStorage context flows parent→child only, and Next
wraps each route handler in its own `run()`, so a context set inside the awaited helper is reverted
when control returns to the route. And the context-aware `sql` Proxy cannot transparently handle
composed `sql\`\`` **fragments** (`filters.push(sql\`…\`)`, `sql\`${a} AND ${b}\``) — it would
eagerly execute the fragment. So the as-built model is per-frame and explicit:

- `lib/tenant-context.ts` — **globalThis-singleton** AsyncLocalStorage. `enterTenant(id)` /
  `enterBypass()` / `runInTenant(id, fn)` / `runInBypass(fn)`.
- `lib/db.ts` — `sql` is a **Proxy** routed by the per-request context: **no context** → exact
  passthrough (rawSql); **tenant context** → each `sql\`\`` runs in a `SET LOCAL app.tenant_id`
  transaction (RLS scopes it under govtech_app); **bypass context** → each `sql\`\`` is routed to
  the owner `sqlBypass` pool (privileged cross-tenant). `verifyTenantAccess` does NOT self-enter
  (that call was dead — child frame). `sqlBypass` is the owner pool.

**The choke point is the ROUTE BODY.** Three patterns:
1. **`enterTenant(tenantId)` in the handler's own frame**, after the access gate — for routes with
   direct `sql\`\`` queries and/or lib-helper calls (helpers inherit the context, parent→child).
   ~49 portal routes.
2. **`withTenant(tenantId, async tx => …)`** (raw `tx`, bypasses the Proxy) — for routes that
   compose `sql\`\`` fragments or use `sql.begin`: proposals list, proposals/create, outcome,
   collaborators; and the lib transactions `advanceProposalStage` + `provisionProposalForPortal`.
3. **`sqlBypass`** for **entity-first authorization gates** that look up a row BY ID to discover its
   owner tenant before any context is pinnable (like auth reading `users` by email):
   `resolveVaultAccess`. A local `guard()` that reads forced tables self-enters before its own reads
   (`lock` route, mirrors verifyProposalAccess).

**Admin routes** (cross-tenant, gated to master_admin/rfp_admin): import `{ sqlBypass as sql }` so
their own direct/fragment/begin queries hit the owner pool, plus `enterBypass()` after the admin
gate when they call an RLS'd-table helper. **Pipeline** keeps its own owner `DATABASE_URL`.

## P5 — PROVEN in sandbox (app connected as `govtech_app`, NOBYPASSRLS)
- `scripts/drive-rls-context.mts` **6/6** — no-ctx → DENY-ALL, correct tenant → sees own,
  other/forged-by-id cross-tenant → 0 (RLS backstop), **bypass ctx → owner pool**, direct owner → all.
- `scripts/drive-rls-portal.mjs` **38/38** — every data-bearing portal route returns its tenant's
  data (was 11 DENY-ALL 404s pre-fix); admin-only route 403s, retired route 410s. Surfaced + fixed a
  pre-existing prod bug (supporting-docs queried the dropped `library_unit_id` column → 500).
- `scripts/drive-rls-admin.mjs` — admin routes return **cross-tenant** data via `sqlBypass`
  (the tenants list sees ≥2 tenants; a DENY-ALL would see 0/1).
- `tsc` 0 · `vitest` 829 (test `@/lib/db` mocks gained `enterTenant`/`enterBypass` no-ops).
- **Migration integrity (nuke + migrate from scratch):** `ALLOW_SCHEMA_RESET=true migrate.mjs` on an
  empty database applies the WHOLE chain clean — **137 applied, 0 skipped, EXIT 0** (000_drop_all →
  001…136, incl. the RLS cutover). The freshly-migrated DB comes up fully armed: **19 force-RLS
  tables · 35 enabled + 35 `tenant_isolation` policies · 444 `govtech_app` grants · the `govtech_app`
  role** — all migration-defined, no manual schema step at deploy (the only sandbox-only manual bit is
  `ALTER ROLE govtech_app LOGIN PASSWORD …`, which prod sets via env, not schema). And **zero schema
  drift**: the seeded working DB's table set is identical to a from-scratch migrate. So Railway's
  deploy-time `migrate.mjs` produces exactly this RLS-armed schema.

The app connects as `govtech_app` in prod (RLS live app-side): the frontend `DATABASE_URL` points at
`govtech_app` and `DATABASE_URL_OWNER` carries the owner string (for `sqlBypass`). No code change — the
same migration-armed schema serves it; the sandbox emulates this exactly by serving as `govtech_app`.

### Re-proven 2026-08-13 (sandbox, against the current Foundation seed)
The prior P5 drives targeted an `immobileyes` seed no longer present; re-ran the whole proof against the
live `govtech_intel` DB with the app connected as `govtech_app` (`ALTER ROLE govtech_app LOGIN` for the
run, reverted to `NOLOGIN` after). All green:
- **DB layer (raw SQL, `govtech_app`):** no-context → 0 (deny-all); ctx=A → 303; ctx=B → 303; ctx=A +
  explicit `WHERE tenant_id=B` → 0 (RLS overrides the app predicate); cross-tenant `UPDATE` → 0 rows.
  Contrast: the current superuser app role (`govtech`, `rolsuper=t`) sees all 639 atoms with no context.
- **App data layer** — `scripts/drive-rls-context.mts` (real `lib/db` Proxy + `tenant-context`): **6/6**.
- **Portal routes** — `scripts/drive-rls-portal-fnd.mjs` (Foundation tenant_admin, 27 data-bearing routes
  + 1 cross-tenant-atom negative): **28/28** (foreign atom → 404).
- **Server components** — `scripts/drive-rls-pages-fnd.mjs` (forced-data token in rendered HTML): **7/7**.
- **Admin cross-tenant** — `scripts/drive-rls-admin-fnd.mjs` (rfp_admin, `sqlBypass` routes): **11/11**
  (`/api/admin/tenants` sees all 4 tenants). *(The `-fnd` scripts are the current-seed retargets of the
  immobileyes-era originals.)*
- **From-zero reproducibility:** `ALLOW_SCHEMA_RESET=true migrate.mjs` on an empty DB applied the full
  chain **176/176, 0 skipped**, and the fresh DB came up armed: **20 force-RLS tables · 35 policies · head 176**.

Net: the isolation *mechanism* + the *route/page coverage under `govtech_app`* are proven in-sandbox, and
the application runs as `govtech_app` in prod (RLS live app-side). The remaining **agent-side** step is
provisioning `AGENT_DATABASE_URL` for the `rfp_agent` pool + re-running these drives against staging.

### Server components (page.tsx) + non-request entry points — WIRED, one open verification
The API-route wiring doesn't cover code that also runs as govtech_app: Next **server components**
(page.tsx query forced tables during the server render) and non-request routes. These were audited
and wired (commit "close the server-component surface"): ~18 portal pages got `enterTenant`, 27 admin
pages got `sqlBypass`, `/api/invite` + `/api/stripe/webhook` + `listVaultsForCollaborator` got
`sqlBypass`. Audit confirmed NO frontend cron, NO `unstable_after`; analytics tables aren't RLS'd;
other forced writers are request-reached or the Python pipeline (owner).

**VERIFIED (`scripts/drive-rls-pages.mjs` — 9/9, app connected as govtech_app on `next dev`):** the
server-component surface renders correct tenant-scoped forced data. `enterTenant` **does** work inside
a React Server Component render (proposals list, dashboard, proposals/[id] all render the tenant's
proposal), and `sqlBypass` works in admin server components (admin/proposals renders cross-tenant
proposals; admin/tenants/[id] renders the tenant's `PROPOSALS → 1 · LIBRARY ATOMS → 367`); the manage
console renders `6 Buckets · 8 OPPs · 1 Active` and the library browser its facets — all forced-table
reads under govtech_app. **No `withTenant` conversion was needed** — the `enterTenant`/`sqlBypass`
wiring is correct.

(Historical note: an earlier run against a `next start` **standalone** build showed several pages
empty, but that was environment pollution — the *same* API drive returned 38/38 on `next dev` vs
36/38 on that standalone. The reliable `next dev` run (API 38/38 → pages 9/9) is the trustworthy
result. Re-verify with `drive-rls-pages` on a clean `next dev` if ever in doubt.)

### Known deferred (documented, not blocking the flip)
Background/workflow paths that write forced tables in their OWN `sql.begin` outside a request
context are covered where reached from routes (advance/provision → withTenant). Any NEW forced-table
writer added later must pick a pattern: `enterTenant`+simple-sql, `withTenant` for its transaction,
or run under the pipeline owner connection.
