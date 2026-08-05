# V1-Ready Report — hardening pass (2026-08-04)

**Branch:** `claude/nice-hamilton-kBqtD` · **State:** migrations **148** · **tsc 0** · **vitest 855** ·
**next build ✓** · live server drive PASS.

This closes the directive **"L5 → polish → hunt bugs → kill them → test → polish → update all docs and
manuals"** on top of the completed V1 UI-wiring + universal-archive program. Every subagent finding was
verified against code before any fix landed.

---

## 1. Bug hunt → kill (commit `0e4a6fb`) — 12 proven fixes

Three adversarial agents (API / React / data-layer) swept the V1 + archive diff; each finding was
reproduced against the code before fixing.

| # | Area | Defect → fix |
|---|------|--------------|
| A | amendments | `confirmAmendment` returned 200 on a no-op → now returns `{confirmed}`; route **409s** when not confirmed |
| G | amendments | fan-out flagged **archived** proposals → `WHERE pr.stage <> 'archived'` |
| B | archive | portal archive/restore cascade was too broad → scoped to **build** `process_instances` (never a co-active `spotlight`/`contract` run on the same opportunity) |
| D | archive | outcome-route OCC archive skipped the workflow cascade → added the same scoped cascade in-tx |
| C | archive | tenant restore un-archived workflows under a still-archived portal → gated on `proposals.stage='archived'` NOT EXISTS |
| E | archive | tenant archive wasn't compare-and-swap → existence + state check (**404** unknown / **409** no-op) |
| F | events | `finder:tenant.*` carried a top-level `tenantId` → dropped (finder = admin ⇒ null; identity in payload) |
| R1 | React | archived **Export** was a GET `<a href>` → 405 → now **POSTs** + object-URL download |
| R2 | React | amendment banner swallowed acknowledge errors → surfaces an error line; 409 treated as already-acked |
| R3 | React | curation amendments panel had no `catch` → network errors surfaced |
| R4 | React | canvas Review composer ignored `capabilities.canComment` → threaded it (read-only actors get no live composer) |
| H | docs | ARCHIVABLE_CONTRACT tenant/atom cascade text diverged from as-built → reconciled |

## 2. Polish (commit `e8b74bb`) — toast

New dependency-free `frontend/lib/toast.tsx` (module-level pub/sub; `<Toaster/>` mounted once in the root
layout). Every transient `alert()` across **portal / admin / curation** → `toast.success|error|info`.
Principled split kept: native **`confirm()`** stays for destructive blocking gates (a toast can't gate an
action); form-level validation keeps the inline `setMsg`/`setErr` pattern.

## 3. Manuals regenerated (commit `bea5881`)

All three role guides — data-driven `_src/build_*.py` → JSON → **HTML + PDF** — now document every V1
surface (labels verified against the as-built components; text/table/callout only, no broken image refs):

- **Customer-Admin** (15§ / 30 subs · 43pp): Proposal Studio (3-loop), AI Actions / full-draft Modes A/B/C,
  amendments acknowledge, portal archive + Archived list, atom archive, packaging review, outcome→contract,
  mark-all-read.
- **RFP-Admin** (18§ / 21 subs · 46pp): assess-ingest-readiness, amendments log→confirm→fan-out,
  Proposal Auto-Drive doorbell, comped-portal grant, tenant archive = license slumber.
- **Collaborator** (10§ · 9pp): amendment-banner visibility (sees it; only an admin acknowledges).

## 4. Docs synced (commit `32b1c86`)

CLAUDE.md (mig 148 + corrected soft-archive contract + toast convention + vitest 855), ARCHITECTURE_V10 §7
(migs 144–148), CONTINUATION §0 (this cycle), E2E_HITL_RUNBOOK (V1 flows to spot-check), CLIFFNOTES §1c,
ARCHIVABLE_CONTRACT (shipped in `0e4a6fb`).

---

## 5. Final functional pass (live server drive)

Standalone server on :3000 (health 200, db ok; S3 "degraded" is expected — no real R2 in the sandbox).

**Tenant-admin** (`kate.ulepic@foundation3dp.com`) → dashboard → proposals → TVSF workspace:
- **Proposal Studio renders** — 3 gated loops (Draft → Refine → Compliance), Start / Run-all-3, "advisory —
  nothing locks or submits."
- **Archive portal** button present; admin-panel tabs (Artifacts / Team / Compliance / AI & Library / Library Seed).
- **Toast renders live** — an intercepted archive 500 (non-mutating) fired the red bottom-right error toast.

**Master-admin** (`eric@rfppipeline.com`) → `/admin/agents`:
- **36-archetype roster** across 4 pods; **Proposal Auto-Drive doorbell** (proposal picker + Mode + Ring);
  **Tool Registry** (compliance / finder / ingest / library / proposal / validation / volume); **Recent Tool
  Invocations** audit table.

**Agent fabric drives tools/workflows** — evidence: tool registry loads at boot (server log), **54 `tool`-
namespace audit events**, populated 7-namespace audit spine (identity 160 · finder 69 · tool 54 · proposal 50
· capture 29 · library · system), agent task queue populated. (`process_instances` is currently 0 — a
transient seed state after prior E2E runs completed; the engine itself is intact per vitest + the L2/L3
cascade that proved `workflowsArchived=1`.)

---

## 6. Launch readiness

**Ready.** Green backbone holds; every V1 surface renders and behaves; the new toast is verified live; the
manuals and engineering docs match the as-built system.

**Standing pre-prod items (unchanged, tracked):**
- RLS cutover stays **inert until the one-op prod `DATABASE_URL` flip** off the owner role (docs/RLS_CUTOVER.md).
- Self-serve Stripe checkout descoped — comp code `rfppipelinetest` + the admin comped-portal grant are the two paths in.
- `scoring_strategist` agent overlay is forthcoming; bucket ranking is deterministic today.

---

## 7. Front-to-back / side-to-side test (2026-08-04)

Full sweep against the live sandbox server. **Zero product bugs found.**

### Side to side — every actor
- **`hitl-role-smoke` 5/5 pass** — master_admin · rfp_admin · tenant_admin · tenant_user · partner_user each
  authenticate and carry the correct session role.
- **Surface reachability: 45 e2e specs pass** — every admin page and every portal page loads at **HTTP 200**
  (`zzscreens.admin`/`zzscreens.tenant` captures), plus smoke, redirects, onboarding, and `reach.admin`.

### Front to back — firing off a portal (the real customer lifecycle)
Drove the exact path a customer runs, as the actual actors, verified in DB + UI:
1. **tenant_admin purchases** a card with comp code `rfppipelinetest` → `200`, portal `curation_pending`, `comp:true`.
2. **rfp_admin releases** (`POST /portals/[id]?action=release`, rfp_admin-gated so a buyer can't self-release past
   the 72h SLA) → `200 released:true` → **provision** creates the proposal + compliance matrix + section, then flips
   the portal **`launched`**.
3. **Customer opens the provisioned, UNLOCKED build** — Studio, compliance-matrix volume, AI Section Drafter, stage
   bar, export-gated-until-lock all render.
- Audit verified: **$0 comp `purchases` row** (`status=completed`, `promo_code=rfppipelinetest`) + **`capture:purchase.completed`** event fired.

### The 13 e2e "failures" — all environmental, none a product bug (each verified against source)
- **`PAYMENT_REQUIRED` (402)** on `matrix`/`lock`/`fullloop`/`atomloop` — those specs use the **deliberately
  paywalled** `/proposals/create` direct-hook (its own code comment: *"the real product flow provisions via portal
  release … never hits this route"*). The 402 is the paywall **working**; the real path (purchase→release) is proven above.
- **`NOT_FOUND` (404)** on `ranking`/`fanout` — the specs reference hardcoded fixture-solicitation UUIDs
  (`c3000000…`, `c4000000…`) that a CI global-setup seeds and a bare sandbox tenant lacks.
- **`FORBIDDEN` (403)** on `collab`/downstream — no proposal/collaborator fixture in the freshly-seeded Lighthouse tenant.
- **`reach.tenant` `-1`** — a flaky client-side `page.goto` timeout under the rapid sweep (server logs are clean; the
  same routes are proven **HTTP 200** by the zzscreens captures; different routes fail each run). Harness artifact.

Sandbox left in its documented state (paywall-enforced server, Foundation/TVSF demo untouched).
