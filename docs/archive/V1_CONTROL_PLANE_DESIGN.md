# V1 Admin Control Plane — Design & Gap Analysis

**E2E Priority #2.** Global + tenant settings / accounts / workflow templates / AI limits, an
RFP-expert-admin **control tower** (automation steps, agents + outcomes, event stream, service/DB
status, audit/archive), and **cross-portal project-status rollups** — with **RFP admin seeing all
tenants and holding all tenant-admin permissions**.

> 🟢 built & verified · 🟡 partial · 🔴 missing. Verified against source 2026-06-27.

---

## 0. Verdict

**~65% built. The settings + RBAC foundation is solid; the gaps are aggregation, observability,
and lifecycle-archive — mostly read-only views + two background jobs, not schema redesign.**
The earlier sweep badly under-counted this surface (it wrongly reported the team page, audit_log
table, master-switch UI, tenant detail route, and `agent_task_queue` as missing/dead — all
verified present/live).

---

## 1. Current State (verified)

### Settings & AI limits 🟢
- **Global:** `platform_agent_config` (mig 072) + `admin/agents/platform-config` route
  (master_admin) + `PlatformAiConfigCard` UI **including the `ai_enabled` master switch** (verified
  in `components/admin/platform-ai-config-card.tsx`). Fields: default budget / rate / per-call
  ceiling / platform monthly cap / AI on-off.
- **Tenant:** `tenant_agent_config` (budget/rate/ceiling override; NULL=inherit) + `admin/tenants/
  [tenantId]/agent-config` route (rfp_admin+) + `TenantAiConfigCard`. `tenant_profiles`
  (NAICS/keywords/focus). `tenant_automation_preferences` (6 toggles) + tenant-side **Automation
  page** (Increment 1) + portal `automation-preferences` route (tenant_admin+).

### Accounts / RBAC 🟢
- `users` (5 roles), `accounts`/`sessions`/`verification_tokens` (NextAuth), `invitations`.
- 5-tier RBAC (`lib/rbac.ts`), middleware path-gating, `verifyTenantAccess` — **returns true for
  master_admin AND rfp_admin** (`lib/db.ts:52`). So **RFP admin already has all-tenant access**
  including portal API routes (rank 80 ≥ tenant_admin 60 passes page-level checks too). *(Agent D
  wrongly said rfp_admin can't reach the portal; verified it can.)*
- **Tenant team management exists** — `portal/[tenantSlug]/team/page.tsx` + `team/route.ts` (invite
  users, members + collaborators). Admin **tenant detail** page + `admin/tenants/[tenantId]/route.ts`
  exist. *(Agent D wrongly reported these missing.)*
- `audit_log` table **exists** (mig 001). *(Agent D wrongly reported missing.)*

### Workflow / automation 🟢/🟡
- Workflow definitions are **code** (`pipeline/src/workflows/*.py`, `Workflow`/`Step`); `process_
  templates` (mig 054) is an **operational catalog** (active/inactive + audit), `process_instances`
  (mig 043) is runtime state. `WorkflowManager` (`manager.py`) **updates `last_heartbeat_at` and
  detects stale (>5 min) instances** — process liveness works. *(Agent E wrongly said heartbeat is
  never updated.)*
- `automation_rules` (CMS event_listener engine) — **global only, no `tenant_id`**.

### Observability surfaces (scattered) 🟡
- `/admin/automation` (rules + 24h count), `/admin/agents` (tool registry + usage),
  `/admin/process` + `/admin/processes` (workflow instances + force-advance), `/admin/system-state`
  + `/admin/system`, `/admin/events` (event stream w/ filters), `/admin/proposals` (cross-tenant
  flat list), `/admin/dashboard`. Event labels centralized (`lib/event-labels.ts`).
- Opportunity lifecycle (C6) — `admin/opportunities/[oppId]/lifecycle` (close/reopen/archive +
  audit + events).

---

## 2. Confirmed Gaps (verified)

| # | Gap | Evidence | Sev |
|---|-----|----------|-----|
| B1 | **No unified control tower** — observability spread across ~5 pages; no single dashboard; no event→process drill-down | pages | P1 |
| B2 | **Service/DB/worker health not surfaced** — `system_health_snapshots` **never written** (verified 0 inserts); no DB/S3/pipeline/CMS liveness probe (workflow heartbeat is the only live signal) | grep | P1 |
| B3 | **No cross-portal project rollup** — `/admin/proposals` is a flat list; no aggregate "all launched portals by stage incl. abandoned" | page | P1 |
| B4 | **No event/audit archival** — no retention/archival job for `system_events`/`proposal_activity_log`/`automation_log`; the "archive fully-executed projects" target is absent | grep | P1 |
| B5 | **`automation_rules` not tenant-scoped** — no `tenant_id`; rules fire globally; can't isolate per-tenant automation | mig | P1 |
| B6 | **Workflow templates code-only** — no authoring UI; no per-tenant enable/disable of workflows (only global `process_templates.active`) | code | P2 |
| B7 | **No settings-change audit writes** — `audit_log` table exists but settings PATCHes don't write to it (only `updated_by` on a couple tables) | routes | P2 |
| B8 | **RLS enabled, no policies** — agent-memory tables have `ENABLE ROW LEVEL SECURITY` but **zero `CREATE POLICY`** and no `FORCE`; app connects as owner so RLS is a **no-op**; isolation rests entirely on app-level `WHERE tenant_id` (verified solid). Defense-in-depth + claim-vs-reality gap, not an active leak | 4 ENABLE / 0 POLICY | P1 |
| B9 | **No per-proposal automation overrides** — `tenant_automation_preferences` is tenant-wide only | schema | P2 |

---

## 3. Target Model

### 3.1 Control tower (read-mostly aggregation)
- **`/admin/control-tower`** — one dashboard: active workflows by status/health, error rate by
  namespace (24h), event throughput, top tools (p95), automation success/fail, **service health**
  (DB/S3/pipeline/CMS).
- **Process drill-down** `/admin/processes/[instanceId]` — instance + `step_results` + correlated
  `system_events` tree + transitions + retry/force-advance.
- **Health**: a `GET /api/admin/health` live probe (DB `SELECT 1`, S3 HEAD) **plus** a worker
  heartbeat (`worker_heartbeats` table or reuse `system_health_snapshots`) written by the pipeline
  loop + CMS listener every ~60s; surface `last_heartbeat_at` + listener lag.

### 3.2 Cross-portal project rollup
- **`/admin/project-rollup`** — `tenants LEFT JOIN proposals` aggregated by stage (active /
  submitted / archived / abandoned), last-activity; drill to a per-tenant proposals view
  (the per-proposal status page already exists; reuse it). RFP admin sees all (access already
  granted by `verifyTenantAccess`).

### 3.3 Archive / closeout
- **Archival job** (pipeline nightly) — move `system_events`/`*_log` older than N days to S3
  (Parquet) + mark `archived_at`; add archival columns (mig). Optional automation rule
  `opportunity.closed → archive related proposals`.

### 3.4 Tenant-scoped automation + settings audit
- `automation_rules.tenant_id` (nullable; NULL=global) + filter in the listener + admin "scope"
  column. Write `audit_log` on every settings PATCH (platform/tenant config, automation prefs).

### 3.5 RLS decision
- Either add tenant policies + `FORCE ROW LEVEL SECURITY` and run the app as a **non-owner** role,
  or **retire the no-op `ENABLE`** and document app-level scoping as the enforcement (with a test
  that every tenant-scoped query carries `tenant_id`). *(Recommended for V1: document + test; full
  RLS as hardening.)*

---

## 4. What NOT to rebuild (verified present)
Platform + tenant AI config (settable, master switch in UI) · tenant Automation page (Increment 1)
· rfp_admin all-tenant access · admin tenant detail page+route · tenant team page+API · `audit_log`
table · `/admin` automation/agents/process/events/system-state pages · workflow heartbeat + stale
detection · opportunity lifecycle (C6) · event-label/deep-link map.

---

## 5. Open product decisions (for owner)
1. **Health depth** — live probe only, or probe + persisted worker heartbeats + alerting?
   *(Recommended: probe + heartbeat table; alerting later.)*
2. **Archive destination** — S3 Parquet cold storage vs soft-delete-in-place. *(Recommended: mark
   `archived_at` in place for V1; cold-storage export as fast-follow.)*
3. **Per-tenant automation** — is tenant-scoping `automation_rules` needed for V1, or do the 6
   `tenant_automation_preferences` toggles suffice? *(Recommended: toggles for V1; `tenant_id`
   column when a customer needs a custom rule.)*
4. **RLS** — document-and-test (fast) vs full policies + non-owner role (hardening). *(Recommended:
   document+test for alpha; policies for GA.)*

See `docs/V1_LAUNCH_READINESS.md` for the Red→Green ToDo (Track F) implementing this.
