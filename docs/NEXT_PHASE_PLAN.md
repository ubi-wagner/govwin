# Next-phase plan — for review (2026-08-14)

Written after the prod-readiness cycle (RLS-live doc-truth sweep, env-var reconciliation to real Railway,
build unblock + PDF/Chromium wiring, deploy merged & CI-green ×4). Prod is **live and now deployable**; the
sandbox proves the customer path prod-exact. This doc lays out where we are, the fork ahead, and a
recommended sequence. Effort is rough dev-days (D). Nothing here is executed — it's for your steer.

## Where we are (as of merge cbe62e7)
- **Prod:** govtech-frontend (www.rfppipeline.com) · pipeline · rfp-crm · Postgres (govtech_intel) ·
  cms-postgres · rfp-pipeline-bucket — all Online, CI green ×4.
- **RLS:** live app-side (govtech_app); proven prod-exact in-sandbox (portal 28/28, admin 11/11, DB deny/scope/bypass).
- **Agent workforce:** 36 archetypes, 15 firing live, fabric verified live on head-178.
- **Two Railway adds still on you:** `DATABASE_URL_OWNER` (frontend — else admin cross-tenant reads = 0),
  `ANTHROPIC_API_KEY` (pipeline — else pipeline agents can't call Claude).
- **Verified prod-exact this cycle:** live RLS, admin sqlBypass, PDF export (Chromium fix), agent fabric.

## The fork
We can push in three directions. They're not exclusive; the question is **sequence**.

### A. First-Customer Readiness  ·  POLISH/VERIFY  ·  ~2–3 D  ·  **recommended first**
The product is built; the risk is the gap between "deploys" and "a real paying customer succeeds end-to-end."
- Run **docs/PROD_SMOKE_TEST.md** on live prod after the two Railway adds; fix anything it surfaces.
- **Onboarding runbook** for the first real tenant: comp-code → curation → release → provision → build →
  package → contract, as a repeatable checklist + who-does-what (rfp_admin vs tenant).
- **Observability at go-live:** confirm system_events + audit logs land in prod; a one-screen "is it healthy"
  admin view (agent runs, workflow instances, failed-workflow alerts).
- **Billing reality:** self-serve Stripe is descoped (comp-code stands in). Decide: keep comp-code for the
  first N customers, or wake Stripe checkout (design exists). One decision, small build either way.
- Exit: a customer can be onboarded with a written runbook and nothing blocks them.

### B. Wake the Agent Workforce further  ·  PRODUCE  ·  ~1 D per agent
15 of 36 fire live; the rest are wired but dormant. Each wake = a firing site (producer or AI_INVOKE step) +
guardrail + injection-fence + wiring test + emulator live-drive. **Prereq:** pipeline `ANTHROPIC_API_KEY`.
Highest-value next wakes (my ranking):
1. **`amendment_monitor`** (platform) — fires on `finder:source.change_detected`; flags compliance-affecting
   amendments → feeds the existing amendment detect→fan-out→acknowledge engine. Directly protects live
   proposals from spec drift. Firing site: a producer off the scout's change-detect. ~1 D + test + drive.
2. **Full-draft cohort proven end-to-end** (proposal_manager → formatter → stylist → cost_estimator →
   gate cohort) — drive a Mode C full-draft through the **pipeline worker** on the emulator (not just direct
   invoke) so the flagship "Run full draft" is proven worker-to-review. ~1 D (mostly harness).
3. **`pp_matcher`** (tenant) — surfaces past-performance atoms + teaming gaps on proposal creation. ~1 D.
- Guardrail: never rush a wake — tenant isolation + injection fence are safety-critical (docs/AGENT_WORKFORCE.md).

### C. Feature depth  ·  PRODUCE/PLAN  ·  larger
1. **Whole-proposal submission-readiness** — roll per-section readiness into a whole-proposal verdict
   (all volumes locked, matrix satisfied, page budgets, required forms) with a single "ready to submit"
   gate. Deferred in the Canvas build log; high customer value. ~3–5 D.
2. **Polymorphic artifact key / one-canvas refactor** — unify proposal sections, standalone docs, templates,
   and content under one canvas/versioning model. Deferred; pays down real complexity but is invasive. ~5–8 D.
   Recommend a **design pass first**, not a blind build.
3. **CRM build-out (rfp-crm + cms-postgres)** — the customer-acquisition side (identification → outreach →
   pipeline). Explicitly "later." Needs a design pass (entities, the CRM ↔ main-DB bridge, the console). ~design first.

## Recommended sequence
1. **A — First-Customer Readiness** (after your two Railway adds). Prove the live path for real; write the
   onboarding runbook. This de-risks everything else and is the shortest path to revenue.
2. **B — one agent wake** (`amendment_monitor`) + prove the full-draft cohort worker-to-review. Compounding
   product capability, low risk, each independently shippable.
3. **C1 — whole-proposal submission-readiness** as the first feature-depth investment (highest customer value
   per day). Design-pass **C2/C3** (one-canvas, CRM) before committing build days.

## Open decisions for you
- Billing: comp-code for now, or wake Stripe checkout?
- Agent-side RLS: provision `AGENT_DATABASE_URL` (rfp_agent) now for defense-in-depth, or leave the pipeline
  on the trusted owner connection?
- Doc consolidation: keep three event-contract docs (`.md` / `_V2` / `_V3`) or collapse to one? (Started
  demoting V2 this cycle.)
- Which of A/B/C do you want first — and how aggressive on the agent-wake cadence?

## Deferred/known (tracked, not blocking)
- PROJECT_AUDIT.md is stale (mig 141) but V10 cites it "canonical current-state" — re-run or demote.
- RAILWAY.md is banner'd legacy-scaffold; a full rewrite is worthwhile once the topology settles.
- `drive_*.py` base-URL override is fragile (empty-env defeats `setdefault`) — small harness fix.
