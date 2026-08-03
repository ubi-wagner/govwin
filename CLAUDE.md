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
`opportunity_id`; `tsc` 0 · `vitest` 853 · `next build`).

Customers buy a proposal portal with a **comp-code purchase** (`rfppipelinetest` → `proposal_portals`
`curation_pending`, 72h SLA); an RFP admin then **releases** it from the shadow account, provisioning
the build UNLOCKED and instantiating the compliance matrix + molds from the master solicitation. The
OPP lifecycle is a **master + mirror** model with **two releases** (Spotlight discovery vs
proposal-portal build) over the one-way bridge; the only backflow is a ToDo event that routes an admin
into a tenant's RLS shadow account. Canonical design: **docs/MASTER_MIRROR_OPP_DESIGN.md**, and the
as-built start→end spine (bridge · engine · agent-automation, both directions, every message +
trigger-step-trigger chain) in **docs/START_END_FRAMEWORK.md** (migrations at 147 — the **V1 UI-wiring pass**
added: mig 145 `notification_read_state` (per-user read watermark), mig 146 `solicitation_amendments` +
`proposal_amendment_flags` (the amendment detect→confirm→fan-out→acknowledge engine), mig 147
`proposals.archived_at` (archive retention/purge-eligibility). That pass also made the AI-review button real
(`lib/proposal-ai-review.ts` → per-section `color_team_reviewer`, audited `proposal:ai_review.requested`, NOT
`review_requested` which the fabric double-dispatches), added the packaging-review + assess-ingest-readiness
buttons, the archive restore/FK-safe-delete lifecycle (`lib/proposal-archive.ts` — unlinks NO-ACTION
financial/audit refs, preserves them), and confirmed the contract entity + kickoff already fire on
`outcome=awarded`). A build can also be **RFP-Admin-approved as a free (comped) portal** — that records a $0
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
The rest are greenfielded + registry-wired, pending the **global automation-policy wiring**. Wiring pattern: realign to the current
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
per-tenant usage, forward-only bridge).
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
  (853 pass) → schema via `db/migrations/migrate.mjs` against the sandbox → `npx next build` for risky
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
docs/MASTER_MIRROR_OPP_DESIGN.md for the OPP → purchase → curation → proposal (V0→V1) flow.

**Continuity:** `docs/CONTINUATION.md` is the durable "start here" memory — current
sprint state, how to spin up the sandbox, verified demo accounts, the live gap list, and
the recurring bug-classes. Read it first when resuming; the identity model is in
docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.
