# Role Guides — Build Notes (prep for the morning)

Planning artifact for the three indexed, clickable, screenshot-rich help files. Ground truth:
route list captured from `frontend/app/**`, and the capabilities we shipped this session
(see "What changed this session"). Build the guides against the CURRENT system, not the
pre-session manuals.

## The three guides (audiences)
1. **RFP-Admin Operations Guide** — `master_admin` + `rfp_admin`. Extends
   `docs/manuals/ADMIN_OPERATIONS_MANUAL.html` (good TOC, no screenshots yet).
2. **Customer Admin Guide** — `tenant_admin`. Extends `docs/manuals/CUSTOMER_PORTAL_MANUAL.html`.
3. **Collaborator Guide** — `partner_user` / collaborator. **NEW** — no manual exists.

Each guide: setup → execution → interaction → monitoring, every step anchored to a real
route + a captured screenshot, with a per-guide gap map. Indexed TOC + deep links (the
existing HTML manuals already use anchor-linked TOCs — mirror that).

## What changed this session (MUST be reflected in the guides)
- **Workflow catalog + monitor** (`/admin/workflows`): the roster of all workflow templates
  with an activation toggle, plus live instances with a per-step progress bar, transition
  timeline, outcomes, and retry/cancel/advance. This is the admin's "see + control every
  automation" surface — a headline new section for the RFP-Admin guide (Monitoring).
- **Managed-only execution** ("no fire-and-forget"): every workflow runs audited; failures
  continue-on-independent-failure; human gates (HITL/TODO) park and resume. Document what a
  paused/failed instance looks like and how to advance/retry it.
- **Tenant-side, event-driven bucket scoring**: cards are delivered by the bridge, then
  scored on the tenant spine (deterministic now, `scoring_strategist` agent overlay later).
  Customer Admin guide: buckets = the customer's scoring criteria; editing buckets re-ranks.
- **Cross-board observability**: `/admin/automation` (rules + logs), `/admin/agents` (agent
  workforce roster + usage), `/admin/events` (event stream), `/admin/process` (event-based
  monitor). Every operation emits start→end; every agent/automation run is auditable.
- **Opportunity-card spine**: `/cards` is the canonical customer surface (`/spotlights`,
  `/pipeline` redirect to it). Library is `/atoms` (`/library*` redirect to it).

---

## Guide 1 — RFP-Admin Operations

| # | Journey (setup/exec/interact/monitor) | Route(s) | Screenshot |
|---|---|---|---|
| 1 | Login + admin landing (role-aware ToDos) | `/admin` | admin-landing |
| 2 | **Setup:** source monitoring (scouts) | `/admin/sources`, `/admin/sources/[id]`, `/admin/scouts` | admin-sources, admin-scouts |
| 3 | **Exec:** upload an RFP | `/admin/rfp-curation/upload` | admin-rfp-upload |
| 4 | **Exec:** curate (triage → topics → compliance → skeleton) | `/admin/rfp-curation`, `/admin/rfp-curation/[solId]`, `.../topic/[topicId]` | admin-curation, admin-topic |
| 5 | **Exec:** push to Spotlight (fan-out to tenant cards) | `/admin/opportunities`, `/admin/cards` | admin-opportunities |
| 6 | **Exec:** purchases → curation release (72h SLA) | `/admin/purchases`, `/admin/applications` | admin-purchases |
| 7 | **Interact:** templates + molds studio | `/admin/templates`, `/admin/templates/[id]/edit` | admin-templates |
| 8 | **Monitor:** **Workflow catalog + instances** (NEW) | `/admin/workflows` | admin-workflows-catalog, admin-workflows-instance, admin-workflows-timeline |
| 9 | **Monitor:** automation rules + logs | `/admin/automation` | admin-automation |
| 10 | **Monitor:** agent workforce (roster + usage) | `/admin/agents` | admin-agents |
| 11 | **Monitor:** event stream + process monitor | `/admin/events`, `/admin/process` | admin-events |
| 12 | **Monitor:** system state / storage / analytics | `/admin/system-state`, `/admin/analytics`, `/admin/storage` | admin-system-state, admin-analytics |
| 13 | Guardrail defaults (agent safety) | `/admin/guardrail-defaults` | admin-guardrails |
| 14 | Tenants oversight + shadow-descend | `/admin/tenants`, `/admin/tenants/[id]` | admin-tenants |

Redundancy note for the guide (and #143 cleanup): `/admin/process` (event monitor),
`/admin/processes` (active-instance ledger), and `/admin/workflows` (canonical) overlap —
document `/admin/workflows` as the primary; mention the others as legacy views.

## Guide 2 — Customer Admin (tenant_admin)

| # | Journey | Route(s) | Screenshot |
|---|---|---|---|
| 1 | First login + portal landing (ToDos) | `/dashboard` | portal-dashboard |
| 2 | **Setup:** profile + team | `/profile`, `/team` | portal-profile, portal-team |
| 3 | **Setup:** build the content library (upload→atomize) | `/atoms` (+ upload/atomize modals) | portal-atoms, portal-atomize |
| 4 | **Setup:** spotlight **buckets** = scoring criteria (re-ranks on edit) | `/buckets` | portal-buckets |
| 5 | **Exec:** browse opportunity **cards** (ranked, pinnable) | `/cards` | portal-cards, portal-card-detail |
| 6 | **Exec:** purchase a proposal portal (comp code) | `/cards` (purchase modal), `/portals` | portal-purchase |
| 7 | **Exec:** build a proposal (draft-from-atoms) | `/proposals`, `/proposals/[id]` | portal-proposal |
| 8 | **Interact:** canvas editor (draft, lock, atomize) | `/proposals/[id]/sections/[sectionId]` | portal-canvas |
| 9 | **Interact:** documents (standalone canvas docs) | `/documents`, `/documents/new`, `/documents/[id]` | portal-documents |
| 10 | **Exec:** advance stages + review gate (HITL) | `/proposals/[id]/review` | portal-review |
| 11 | **Exec:** export / download (docx/xlsx/pptx) | `/proposals/[id]` (export) | portal-export |
| 12 | **Monitor:** activity timeline + processes | `/activity`, `/processes` | portal-activity |
| 13 | **Monitor:** automation preferences | `/automation` | portal-automation |
| 14 | Billing | `/billing` | portal-billing |

## Guide 3 — Collaborator (NEW)

Scope: `partner_user` invited to a specific proposal, stage-scoped (view/comment/edit).

| # | Journey | Route(s) | Screenshot |
|---|---|---|---|
| 1 | Accept invite (deep-linked email) → login | invite accept flow | collab-accept |
| 2 | Landing: only the proposals I'm invited to | `/dashboard` (collab view) | collab-landing |
| 3 | Open the proposal workspace (scoped) | `/proposals/[id]` | collab-proposal |
| 4 | Contribute in the canvas (per stage-grant: view/comment/edit) | `/proposals/[id]/sections/[sectionId]` | collab-canvas |
| 5 | Comment / suggest | canvas comment UI | collab-comment |
| 6 | See my ToDos / assignments | `/dashboard` ToDos | collab-todos |
| 7 | What I CANNOT see (scope boundaries — library, buckets, billing) | (document the redirects/403s) | — |

Note: collaborator removal revokes the membership (last-collab-at-tenant handling) — document
the lifecycle.

---

## Screenshot capture plan
- Harness: adapt the Playwright e2e specs in `frontend/e2e/*.spec.ts` (they already
  `page.goto()` the key routes with seeded auth). Add `await page.screenshot({ path: ... })`
  per route, output to `docs/manuals/img/<guide>/<name>.png`.
  - Admin journeys: `smoke.admin.spec.ts`, `fanout.admin.spec.ts` cover most admin routes.
  - Tenant journeys: `smoke.tenant.spec.ts`, `ranking.tenant.spec.ts` (buckets/cards),
    `lock.tenant.spec.ts` (canvas/lock), `fullloop.tenant.spec.ts` (end-to-end), `atomloop`
    (library atoms), `matrix.tenant`, `reach.tenant`.
  - Collaborator: `collab.tenant.spec.ts`.
- Seeded demo accounts / sandbox: see `docs/CONTINUATION.md` for demo logins + sandbox spin-up.
- 62 existing screenshots in `docs/user-guides/img/` — reuse where still accurate; recapture
  anything touched this session (cards, buckets, /admin/workflows, automation, agents).

## Gap map (for the guides to flag honestly)
- `/admin/process` vs `/admin/processes` vs `/admin/workflows` naming overlap (canonical =
  workflows). Flag; cleanup tracked in #143.
- Scoring agent overlay (`scoring_strategist`) is deterministic-only today; the guide should
  describe the deterministic behavior and note the agent overlay as forthcoming.
- Self-serve Stripe billing descoped — the comp-code purchase stands in (document the code flow).
- `library_units` legacy fully retired to `library_atoms` (this session) — library docs point
  at `/atoms`.

## Build order for the morning
1. Capture screenshots (harness run, all three roles).
2. RFP-Admin guide (extend ADMIN_OPERATIONS_MANUAL.html + new Monitoring/Workflows section).
3. Customer Admin guide (extend CUSTOMER_PORTAL_MANUAL.html + buckets/scoring + cards spine).
4. Collaborator guide (new, from scratch — smallest).
5. Cross-link the three + a shared index page; embed the gap map.

---

## Screenshot capture — DONE (overnight run), reproducible recipe

Captured **36** authenticated full-page PNGs to `docs/manuals/img/{admin,tenant,collab}/`
(20 admin + 13 tenant + 3 collab), app served on :3000 by the heartbeat. Recipe:

```bash
export DATABASE_URL='postgresql://claude@127.0.0.1:5433/govtech_intel'
export NODE_PATH=/home/user/govwin/frontend/node_modules
# 1. Seed accounts (admin + Lighthouse/Ubihere tenants + backfill 48 cards)
node scripts/seed_dev_accounts.mjs
# 2. Refresh Playwright auth state (personas: admin / lighthouse / collaborator)
cd frontend && npx playwright test --project=setup
# 3. Capture (skip the setup dep once auth is fresh)
npx playwright test e2e/zzscreens.admin.spec.ts  --project=admin  --no-deps
npx playwright test e2e/zzscreens.tenant.spec.ts --project=tenant --no-deps
npx playwright test e2e/zzcollab.tenant.spec.ts  --project=tenant --no-deps
```

### ⚠️ Two seed/onboarding gaps found + fixed in the sandbox (flag for the morning + #143)
1. **`seed_dev_accounts.mjs` creates tenant_admins with `users.tenant_id` (fused, for login)
   but NO `user_memberships` row** — the PORTAL resolves the workspace from
   `user_memberships` (the canonical multi-membership path, #110/#115), so a seeded
   tenant_admin hits **"No workspace assigned"** on every `/portal/*` route. Fixed in-sandbox
   by inserting the membership. The seed script (and possibly the real tenant-admin onboarding
   path) should create the membership alongside the fused columns. **Worth verifying the live
   signup flow doesn't have the same gap.**
2. **Collaborator login needs the fused `users.role` + `users.tenant_id`** set (auth.ts's
   `findUserByEmail` reads them for the JWT) in addition to the membership — a membership
   alone isn't enough to log in.

### Collaborator scope (captured behavior)
A `partner_user` is redirected to `/portal/<slug>/proposals` from `/dashboard` and `/activity`
— i.e. the scope boundary is enforced by redirect. The 3 collab captures document that
scoped landing (Lighthouse has 0 proposals, so it shows the empty assigned-work state — a
fuller walkthrough needs a seeded proposal + an accepted invite).

### Capture spec files (keepers, in frontend/e2e/)
`zzscreens.admin.spec.ts`, `zzscreens.tenant.spec.ts`, `zzcollab.tenant.spec.ts` — re-runnable
to refresh shots after UI changes.
