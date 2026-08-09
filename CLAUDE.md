# CLAUDE.md — RFP Pipeline Portal Engineering Standards

## Project Overview
Multi-tenant SaaS platform for government contractors to discover, score, and build
proposals for federal opportunities (SBIR, STTR, BAA, OTA). Product AI (drafting / compliance /
review) is live via the frontend.

The **greenfield opportunity-card spine is now the canonical customer surface** (see
ARCHITECTURE_V10.md — the as-built successor to V9): admin approval → `solicitation.push`
fans EVERY activated opportunity (umbrella + all topics) onto the forward-only
`opportunity_bridge` → a denormalized `tenant_opportunity_cards` row per tenant, ranked by
`tenant_spotlight_buckets`/`tenant_bucket_scores` (auto-scored on arrival), and drafted from
the unified `library_atoms` library (visibility-enforced, taxonomy-tagged, upload→atomize→select).
The legacy Spotlight/Pipeline surface (`tenant_pipeline_items`) is RETIRED and now **DROPPED**
(mig 125, alongside 11 other superseded tables; the `library_units` family went in mig 121) —
`/spotlights` + `/pipeline` redirect to `/cards`, and the last live reads were repointed to
`tenant_opportunity_cards` (including the rebuilt `v_opportunity_rollup` view + the CMS
`matched_opportunities` variable). The compliance matrix (`proposal_compliance_matrix`) populates
at provision and advances on section lock. A locked/submitted proposal downloads as **json/docx/pdf/zip**
(`/proposals/[p]/package?format=…` — docx & the Chromium-rendered pdf share one combined-CanvasDocument
assembly; zip is per-volume-native), with figures as native `chart` nodes and sections ordered by the
integer `sort_index` (mig 143 — never string-sort `section_number`, which scrambles numbering). Verified
end-to-end (Playwright + the live Python workflow engine creating `process_instances` that carry
`opportunity_id`; `tsc` 0 · `vitest` 855 · `next build`).

Customers buy a proposal portal with a **comp-code purchase** (`rfppipelinetest` → `proposal_portals`
`curation_pending`, 72h SLA); an RFP admin then **releases** it from the shadow account, provisioning
the build UNLOCKED and instantiating the compliance matrix + molds from the master solicitation. The
OPP lifecycle is a **master + mirror** model with **two releases** (Spotlight discovery vs
proposal-portal build) over the one-way bridge; the only backflow is a ToDo event that routes an admin
into a tenant's RLS shadow account. Canonical design: **docs/MASTER_MIRROR_OPP_DESIGN.md**, and the
as-built start→end spine (bridge · engine · agent-automation, both directions, every message +
trigger-step-trigger chain) in **docs/START_END_FRAMEWORK.md** (migration head now **162** — the **V1 UI-wiring pass** (145–148)
added: mig 145 `notification_read_state` (per-user read watermark), mig 146 `solicitation_amendments` +
`proposal_amendment_flags` (the amendment detect→confirm→fan-out→acknowledge engine), mig 147
`proposals.archived_at`, and mig 148 `archived_at` on `process_instances`/`tenant_opportunity_cards`/
`library_atoms`/`contracts`. That pass also made the AI-review button real
(`lib/proposal-ai-review.ts` → per-section `color_team_reviewer`, audited `proposal:ai_review.requested`, NOT
`review_requested` which the fabric double-dispatches), added the packaging-review + assess-ingest-readiness
buttons, and confirmed the contract entity + kickoff already fire on `outcome=awarded`). **Archive is soft +
reversible only — NOTHING is hard-deleted** (canonical **docs/ARCHIVABLE_CONTRACT.md**): archive ACTIONS live on
exactly three entities — a **portal** (`proposals`, tenant_admin+ → cascades its BUILD `process_instances`,
scoped off co-active `spotlight`/`contract` runs), a **library atom / foundational doc** (`library_atoms`,
per-item → drops out of the library + draft selection; copied-forward so no cascade), and a **tenant**
(`tenants`, rfp_admin+ → license slumber: the `verifyTenantAccess` gate darkens every surface + a workflow
cascade, no per-proposal write). Workflows archive ONLY via a parent's cascade (no standalone action);
opportunity cards are NOT an archive target; archived rows are the future S3 cold-storage watermark (`lib/proposal-archive.ts`).
A build can also be **RFP-Admin-approved as a free (comped) portal** — that records a $0
`purchases` row (`metadata.grant='admin'`) + emits `capture:purchase.completed`, so a comp audits
exactly as a purchase (the free self-serve bypass is closed). Self-serve Stripe checkout is still
descoped — the comp code stands in.

The pipeline agent workforce (`AgentFabric`, **36 archetypes, all auto-registered — dormant ≠ dead**)
is woken into live flows one at a time — **canonical plan + safety contract in `docs/AGENT_WORKFORCE.md`
(read it before touching agents)**. Live today: `section_drafter` (`draft_v0` → `markdown_to_canvas` →
`publish_section_draft`, on release/provision, gated on the pipeline `ANTHROPIC_API_KEY`);
`compliance_reviewer` INLINE in `ai/compliance`; `color_team_reviewer` via the advance `agent_task_queue`;
plus the greenfielded `librarian` (onto `library_atoms`, atomize→`agent_task_queue`, injection-fenced) and
`scoring_strategist` (tenant-discretion) producers. The **Proposal Draft Manager program** (P1–P4) added +8
archetypes (27→35): the G1 integrity cohort (`formatter`/`stylist`/`continuity_manager`), the P1 cohort
(`proposal_manager` planner + `traceability_auditor`/`redaction_guard`/`market_analyst`), and the P1.5
`advisory_manager` — orchestrated by the admin-run `OnFullDraftRequested{ModeA,B,C}` (V0.1 HITL / V0.2
restyle / V0.5 full auto), with `cost_estimator` **woken** (its `compute_budget` tool is backed by the
deterministic `proposal.budget_model` burden-waterfall engine) and the **adversarial gate** = the reusable
`AdvisoryOverlay` applied with `policy=auto` (Mode C's `request_overlay` elevates the review-gate cohort to a
1:n fan-out → `advisory_manager` reconcile → HITL-or-AUTO landing; advisory, never advances a gate). The **admin-agent
program (Phase 1)** then added the 36th — `rfp_ingest_manager` (platform/our-org, the *manager* over the ingest
cohort; the platform analog of `proposal_manager`): admin-invoked (`.../assess-ingest` → `OnIngestAssessmentRequested`
→ `tool.ingest.assess`), it reads a curated solicitation's ingest state, infers the stage deterministically, and
plans which specialist agents to run next — advisory, injection-fenced, **no tenant descent** (docs/ADMIN_AGENT_DESIGN.md).
On the build side, the tenant Proposal Draft Manager (`proposal_manager` + `OnFullDraftRequested{ModeA,B,C}`,
Mode C = full auto) is now also admin-drivable from up top via the **Proposal Auto-Drive "doorbell"**
(`/admin/agents` card → `POST /api/admin/proposals/[p]/full-draft` → the same `proposal:full_draft_requested`
trigger) — portal + doorbell funnel through one `requestFullDraft` helper (`lib/proposal-full-draft.ts`) so
every full draft is one auditable record, `source` distinguishing `portal` vs `admin_doorbell`. The
**Proposal Studio** (docs/PROPOSAL_STUDIO_DESIGN.md) then breaks that engine into **3 gated loops** —
Draft → Refine → Compliance (`OnReviewPhaseRequested{Draft,Refine,Compliance}`, reusing the SAME cohort
`AI_INVOKE` actions, mig 144 `proposals.studio_phase`): each loop lands in review, then a simple UI gate
where the admin **comments + regenerates** (comments threaded as `guidance`) or **approves → next**, or
**runs all 3 automatically** via the doorbell (`advance_studio_phase` ACTION auto-chains). Advisory —
it never advances a stage, locks, or submits. Observability
is enforced end-to-end: every actor/automation/agent/manager action posts to `system_events` (+ domain audit
logs) — swept + gap-fixed 2026-08-02 (docs/EVENT_AUDIT_2026-08-02.md; the `package?format=zip` blind spot is closed).
The rest are greenfielded + registry-wired, pending their per-producer wiring (the **global automation-policy layer** #190 — recipients×timing×escalation — is BUILT + complete, docs/AUTOMATION_POLICY_BUILD_LOG.md; it ships inert until a tenant edits a policy). Wiring pattern: realign to the current
spine, then either a **per-tenant producer** (fan-out agents) or a declarative **`AI_INVOKE` `Step`**
(single-entity agents; `TOOL_ACTION_TO_ARCHETYPE` maps them — `validate()` rejects an unmapped `AI_INVOKE`
at boot). **Agent invariants (non-negotiable):** tenant-space agents are **tenant-bound** (tenant_user
authority; tool schemas expose NO `tenant_id`); output is **advisory → guardrail → land-or-review** (never
auto-writes business tables); untrusted tenant content is **injection-fenced**; runtime bounds **runaway**
(round/cost/rate/budget caps) and never **dead-ends** a workflow (safe-skip). RLS backstop is **built + applied
in schema** — mig 116 forced RLS on `episodic_memories`, and mig 136_rls_cutover added the `NOBYPASSRLS` roles
(`govtech_app` app / `rfp_agent` agents), `tenant_isolation` policies, and the per-request `SET app.tenant_id`
context layer (mig 137 validates the namespace CHECK); it stays **inert until the one-op prod `DATABASE_URL`
flip** off the owner role (see docs/RLS_CUTOVER.md). Oversight: `/admin/agents` → Agent Workforce (roster +
per-tenant usage, forward-only bridge). **Workflow visualization + compliance + full-draft landing (2026-08,
merged via PR #205 + deployed):** `/admin/workflows` renders a dependency-free **Workflow Map** — all 29
templates as DAGs, grouped by the two spines + platform — plus **live instance graphs** (per-step status
overlay) and a sortable/filterable/Live monitor (operator guide: docs/WORKFLOW_ADMIN_GUIDE.md;
`app/admin/workflows/workflow-{graph,shapes,map}.tsx`). The **compliance floor** `validateCanvasAgainstSpec`
(`lib/types/canvas-document.ts` — font/pages/images/header-footer) is enforced at the artifact export gate
(`X-Compliance-Violations` header + `proposal:artifact.exported {compliant}`) and on section save
(`data.complianceWarnings`, non-blocking). The full-draft cohort's staged output LANDS via a **read-on-review**
route (`POST …/proposals/[p]/land-revisions` + the "Apply AI-proposed revisions" button in
`proposal-ai-actions.tsx`) that writes proposed `ai_revision` `canvas_versions` the builder reviews + restores
— the workflow engine's invariants FORBID a pipeline consumer of agent output, so the landing is frontend +
human-triggered (docs/FULL_DRAFT_LANDING_DESIGN.md).
`opportunity_id` keys the spine (mig 088). **The workflow engine the agents plug into — the declarative
trigger+step templates, the start→end event gate, and the two stateless reconcilers — is mapped in
`docs/AUTOMATION_SPINE_MAP.md`**; docs/AGENT_FABRIC_DESIGN.md + docs/V1_REFACTOR_DESIGN.md have the
orchestration pattern.

## Services
1. **Frontend** (Next.js 15): Portal UI + API routes → `frontend/`
2. **Pipeline** (Python 3.12): Ingestion, scoring, workers, agents → `pipeline/`
3. **CMS/CRM** (FastAPI): Live — email automation, content pipeline, social, page-block editor; own `govtech_cms` DB → `services/cms/`

Frontend + Pipeline share one PostgreSQL database (govtech_intel); CMS/CRM has its own (govtech_cms)
and bridges via the shared `system_events` table. Object storage is S3-compatible (Cloudflare R2) —
there is no `/data` business-data volume (the dead pipeline `STORAGE_ROOT=/data` env was removed this
cycle — nothing read it; `CMS_STORAGE_ROOT` is a different, live var for CMS media).

## Roles
- `master_admin`: Full system access, migrations, Railway management
- `rfp_admin`: RFP triage/curation, customer onboarding, customer service
- `partner_admin`: **Partner-manager** (EconDev, e.g. the Entrepreneurs' Center) — runs a stable of
  client companies from the owner-scoped `/partner` console; is itself a higher-order `partner_org`
  tenant. Rank 50 (below rfp_admin — NO `/admin` reach). New companies go through RFP-admin approval;
  existing ones via a manager-request handshake; descends into any owned/managed company as
  tenant_admin (Exit-to-console banner). Canonical: **docs/PARTNER_MANAGER_DESIGN.md**
- `tenant_admin`: Manages their tenant, invites team, purchases proposals
- `tenant_user`: Access per admin grant (all proposals or per-proposal)
- `partner_user`: Stage-scoped access per proposal (view/comment/edit)

## SOP: Error Handling
- Server components: try-catch all DB queries, re-throw NEXT_REDIRECT, log with tagged prefix
- API routes: try-catch returning NextResponse.json with proper status codes, validate inputs first
- Client components: check res.ok, parse JSON safely, set error/loading states
- Database: validate DATABASE_URL at load, .on('error') handlers on pools
- Auth: try-catch around DB queries in authorize(), wrap non-critical updates separately

## SOP: Code Quality
- `npx tsc --noEmit` must pass — zero type errors
- No unhandled promises
- No console.log — use console.error for error logging only
- User feedback: `toast()` (`lib/toast.tsx`) for transient action results (success/error/info) — NOT
  native `alert()`; native `confirm()` stays for destructive blocking gates; inline `setMsg`/`setErr`
  for form-level validation
- Return consistent shapes: `{ data: T }` success, `{ error: string, code: string }` failure
- Auth checks first, then input validation, then business logic
- Always verify tenant access before returning tenant-specific data
- Parameterize all SQL queries (postgres.js tagged templates)
- EVERY error response MUST include both `error` and `code` fields
- EVERY `await sql` call MUST be inside try/catch
- Portal routes MUST verify tenant access — never query by ID alone
- Before writing SQL, verify column names in CLAUDE_CLIFFNOTES.md section 1
- Escape ILIKE patterns: `input.replace(/[%_\\]/g, '\\$&')`
- **Verification backbone** (every change): `cd frontend && npx tsc --noEmit` (0) → `npx vitest run`
  (855 pass) → schema via `db/migrations/migrate.mjs` against the sandbox → `npx next build` for risky
  changes → live Playwright drive (`frontend/e2e/*.spec.ts`) → an adversarial multi-agent bug sweep
  (API / React / SQL, findings must be *proven*) for large diffs. See docs/TESTING_STRATEGY.md.
  ⚠️ **Serving the built app: `next start` is BROKEN here** (`output:'standalone'`) — run
  `node .next/standalone/server.js` after staging `.next/static`+`public`; auth flows must hit
  `localhost:3000` not `127.0.0.1`. Full sandbox/PDF-tooling recipes: **docs/CONTINUATION.md §2**.

## SOP: Data Layer (postgres.js + constraints) — bug classes, see CLIFFNOTES §4b
- **jsonb writes:** write via `${sql.json(x)}`, NOT `${JSON.stringify(x)}::jsonb`, when the column
  is read back as an object/array. The latter reads back as a STRING (silent char-iteration bug).
  On READ, coerce with `coerceJsonb<T>(v, fallback)` (`lib/jsonb.ts`).
- **ON CONFLICT vs a PARTIAL unique index:** restate the index `WHERE` predicate in the ON CONFLICT
  or it throws on every call (`ON CONFLICT (a,b) WHERE b IS NOT NULL DO …`).
- **counts/bigint:** cast `::int` in SQL (or `Number()`); postgres.js returns int8 as a string.
- **CHECK columns:** confirm a literal is in the column's CHECK (`\d table`) before writing it.
- **Workflow status writes:** force-fail a paused instance only with `… WHERE id=$1 AND status='paused'`
  (compare-and-swap) and expire its sibling task; resume HITL only after entity correlation.
- **`next/dynamic({ssr:false})` drops `ref`** (Next 15 sets `ref.current={retry}`, a truthy non-handle):
  pass an imperative handle via a normal prop (`innerRef`), not `ref`. And load browser-only libs
  (react-pdf / pdfjs) via `next/dynamic({ssr:false})` — a static import into a `'use client'` component
  still SSRs and crashes at module-eval time.
- **FK-before-audit ordering:** validate an FK target exists BEFORE a paired non-FK soft-ref write, or a
  bad id orphans the earlier writes and 500s on the FK throw (`purchases.opportunity_id` has a FK;
  `proposal_portals.opportunity_id` does not).
- **Dropping tables:** drop ONLY when superseded-with-a-successor AND zero live code refs. "Empty in the
  sandbox" is NOT a drop signal — most empty tables are live-but-unused.
- **canvas_versions numbering:** `proposal_sections.version` MUST stay `> MAX(canvas_versions.version_number)`
  per section. A new version row numbers at the section's CURRENT `version` and ADVANCES the counter (CAS
  `version = version + 1`), like `lib/proposal/lock-section.ts` / `lib/proposal-advance.ts` / the save route.
  Numbering at `MAX+1` WITHOUT advancing makes the next human-save's archive collide on the slot →
  `ON CONFLICT (section_id, version_number) DO NOTHING` silently drops it → undo/history content-loss. (The
  full-draft read-on-review landing route follows this; found via a live staging scenario, docs/FULL_DRAFT_LANDING_DESIGN.md.)

## SOP: Events
- Namespaces: finder (admin), capture (customer), identity (auth only),
  proposal (workspace), library (content), system (infra), tool (invocations)
- NEVER use: admin, cms, spotlight as namespaces
- Type format: entity.action_past_tense (snake_case)
- Admin events: tenantId = null
- Portal events: tenantId = actual tenant UUID

## Engineering Reference
See CLAUDE_CLIFFNOTES.md for:
- Complete DB schema quick reference (all column names)
- Canonical API route template
- Common mistakes caught in audits (with fixes)
- Event namespace rules
- Architecture quick reference

## SOP: Security
- Never trust client input — validate and sanitize
- Never expose internal error details to client
- Row-Level Security on all tenant-scoped agent memory tables
- Agent tools enforce tenant_id — agents never construct SQL directly
- User content clearly delimited in agent prompts (prompt injection defense)
- No committed production credentials — mig 124 rotated master_admin off the committed seed
  (`temp_password` forces a reset); the `.test` seed accounts are deactivated + hash-invalidated
- RLS is ENABLE/FORCE'd and **single-layer in effect today** (the app still connects as the RLS-bypassing
  owner role). The `NOBYPASSRLS` `govtech_app` cutover is **built + applied in schema** (mig 136_rls_cutover:
  19 force-RLS tables, 35 policies, the `govtech_app`/`rfp_agent` roles + the per-request context layer;
  mig 137 validates the namespace CHECK) — it stays **inert until the one-op prod `DATABASE_URL` flip** to
  `govtech_app`. Cross-tenant admin/CMS reads on RLS-forced tables must run on a BYPASS connection /
  owner-view — RLS-cutover checklist in docs/RLS_CUTOVER.md. Full posture: **docs/SECURITY_AND_SAFETY.md**.

## Project Structure
See ARCHITECTURE_V10.md (the as-built successor to V9) for the full system design and file tree, and
docs/MASTER_MIRROR_OPP_DESIGN.md for the OPP → purchase → curation → proposal (V0→V1) flow. For the
**UI→DB→back request path** — the seven planes (UI · API · domain · data · events · engine · agents) and
the canonical end-to-end traces (section save · discovery fan-out · build→package · agent land-or-review ·
amendment fan-out) with their invariants — see **docs/DATA_FLOW.md** (the *static* cross-section; the *live*
per-instance DAGs are the `/admin/workflows` Workflow Map).

**Continuity:** `docs/CONTINUATION.md` is the durable "start here" memory — current
sprint state, how to spin up the sandbox, verified demo accounts, the live gap list, and
the recurring bug-classes. Read it first when resuming; the identity model is in
docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
