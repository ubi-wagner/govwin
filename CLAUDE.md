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
Atom retrieval is now **hybrid**: the tag/context selector (`selectForSection`) blends in **semantic
cosine similarity** off a per-atom pgvector index (`atom_embeddings`, mig 171, tenant-scoped + FORCE-RLS)
when a **gated** engine is on — Voyage in prod (`VOYAGE_API_KEY`) or a dependency-free local-hash
embedder (`ATOM_EMBED=local`); **inert by default** → byte-for-byte the pre-vector selector, zero
regression. Isolation proven at rest · RLS · app-layer (docs/SEMANTIC_RETRIEVAL.md; `lib/embeddings.ts`).
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
`opportunity_id`; `tsc` 0 · `vitest` 1943 (1941 pass · 2 env-skipped) · `next build`).

Customers buy a proposal portal with a **comp-code purchase** (`rfppipelinetest` → `proposal_portals`
`curation_pending`, 72h SLA); an RFP admin then **releases** it from the shadow account, provisioning
the build UNLOCKED and instantiating the compliance matrix + molds from the master solicitation. The
purchase's `proposal_setup` ToDo now deep-links to the **provisioning cockpit** (`/admin/provisioning/
[portalId]`, PV-1..6, docs/PROVISIONING_WORKSPACE_DESIGN.md) — the rfp_admin surface that LANDS the 72h
SLA: it shows the buyer + live SLA countdown + the master **build-out readiness bar** (compliance + ≥1
volume + ≥1 required item; mig 182 `curated_solicitations.build_complete`), deep-links to the authoring
workspace, and hosts a two-outcome **Complete & Release** — (1) `completeBuildOut` marks the master built
out + BROADCASTS an `updated` fan-out to EVERY tenant's mirror card (`provisionReady=true`; the shared
master — segregation), then (2) `provisionAndReleasePortal` provisions THIS buyer's private portal, flips
`curation_pending→launched`, and kicks off their workflow (the private portal — continuity). One shared
`provisionAndReleasePortal` helper backs both the cockpit and the tenant-side `?action=release` (no drift);
the provision best-effort tail (review ToDos + reuse suggester) is `runInTenant`-scoped so a cross-tenant
admin caller never trips RLS. On release the buyer gets a **required tenant Workflow Setup** (recommend-but-
require, TW-1..6, docs/TENANT_WORKFLOW_SETUP_DESIGN.md): `provisionAndReleasePortal` marks
`guardrail_config._setup=pending` + raises a required ToDo → the tenant-owned page `/portal/[slug]/portals/
[portalId]` where a tenant_admin/delegated-manager reviews a **history-recommended** plan (their prior
*accepted* USAF-Phase-I/D2P2 pattern; own-history only, copy-inward) and **Accept & Starts** it. It's the
post-launch-editable spine the frozen guardrail model never had — absolute stage-gate dates, a per-stage
**gate closer** (Human | AI-manager), per-ToDo owner (a real person *or* a role) + date + nudge, and one-click
**rebaseline** (shift ±N days / set from the solicitation close) — all riding the open `guardrail_config` JSONB
(**no migration**). Edits re-project onto the live `tasks` rows via `editPortalWorkflow` (matches by title;
resets `nudges_sent` so the pipeline nudge sweep re-fires against the new due), with a per-task
`PATCH …/tasks/[taskId]` for day-to-day reassign/reschedule — so advancement stays task-completion-driven and
the sweeper stays row-driven (aligned 100% with the phase-machine; the AI-manager `auto`-advance is the TW-8
fast-follow). The
OPP lifecycle is a **master + mirror** model with **two releases** (Spotlight discovery vs
proposal-portal build) over the one-way bridge; the only backflow is a ToDo event that routes an admin
into a tenant's RLS shadow account. Canonical design: **docs/MASTER_MIRROR_OPP_DESIGN.md**, and the
as-built start→end spine (bridge · engine · agent-automation, both directions, every message +
trigger-step-trigger chain) in **docs/START_END_FRAMEWORK.md** (migration head now **213** — migs 212/213 the
proposal-spine RLS close, B113; migs 186–188 the
**ingest-provenance** spine — canonical **docs/INGEST_PROVENANCE.md**, and the non-negotiable rule behind it:
*a value the product did not read from the solicitation must never look like one it did*. Ingest Assist now
merges three layers PER FIELD — `pattern_match` (`lib/ingest/pattern-extract.ts`, a deterministic, DB-free,
key-free extractor that lifts only unambiguously-stated rules and CITES each with rule + page + excerpt +
char-offset + which document) → `ai` → `default` — stamping the winner into `solicitation_compliance.field_provenance`
(mig 187; mig 188 documents the full contract) so the UI badges "Read from source" vs a red "Default — unverified".
**Absence is a finding**: a DEFERRAL ("the page limit lives in the Component-specific instructions") CLEARS the
default and renders as "Set elsewhere" with the citation — never a fabricated number. Assist also REFUSES an
unshredded solicitation (409 `SOURCE_TEXT_NOT_READY`; `GET` the same route for readiness — the upload form polls
it instead of racing the async shred), with an explicit `allowDefaultSkeleton` opt-in. Trust order:
hitl > verified > override > pattern_match > ai > default. Mig 186 gave `episodic_memories` PLATFORM scope
(`tenant_id IS NULL`) so curation memory actually persists; migs 183–185 add section-comment anchors + the
per-command RLS backstop closing shared writes on `document_templates` then `tasks`/`process_instances` — mig 180 the bucket-score
integrity floor, mig 181 the **opportunity ranking spine** (designee `can_manage_buckets` · admin
OPP `update_watch` · start-nudge watermark), canonical **docs/RANKING_SPINE.md**; mig 182 the master OPP
`build_complete` flag behind the provisioning cockpit (above): customer-admin/designee bucket
authoring (a **1:n the customer opens EMPTY** — mig 206/#189 removed seeded defaults and made the cap a
plain rfp-admin-settable authoring budget of 25, no longer `seeded + headroom`) → cap → OPP-push rescore + new-bucket reshuffle → one mirror-OPP list re-rankable by any bucket lens →
admin pin-for-updates (holder fan-out, pre-purchase) → notify/nudge (the hot-closing-soon start-nudge) → provision;
mig **179** the **Command Center** watermark (`command_seen_state` — the tenant · admin · partner "new since you
looked" cockpits, docs/COMMAND_CENTER_DESIGN.md); mig **183** span/node-anchored comments — the rebuilt
**section-editing spine** (section-scoped ToDos → editor routing · AI assist from the section bar · AI-manager
auto-advance · partner_user-scoped bell); mig **184** **cross-tenant isolation hardening** — per-command RLS on
the shared `document_templates` catalog, adversarially verified copy-inward (docs/COPY_INWARD_VERIFICATION.md);
migs 163–167 per below;
mig 175 completes the **scout-intake candidate queue**: scout findings — crawler leads + the HITL source-scout's
extracted opportunities — land in one `scout_findings` review→release queue, deterministically classified
**NEW vs UPDATE** (`lib/scout/classify.ts`) and released as a new intake (`stageIntake`) or an update
(`logAmendment` on the matched opp), or dismissed — advisory, injection-fenced, platform-scope, `/admin/scouts`;
docs/SCOUT_INTAKE_QUEUE.md; mig 176 seeds the four **program-primer guide drafts** (BAA · OTA · CSO · Grants/NOFO)
authored canvas-native + queued for admin review via a `content_publish` HITL ToDo — draft-gated, nothing public
until published (docs/CONTENT_QUEUE.md); migs **177–178** add the **template-stable/bridge** spine — admin
master templates fan forward-only onto tenant template cards → instantiate into `library_atoms`, with per-tenant
document/template provenance (`lib/template-bridge.ts`, docs/TEMPLATE_BRIDGE_DESIGN.md); and the **NILOC
gold-example** proposal set (`frontend/scripts/niloc/`, docs/NILOC_GOLD_EXAMPLES.md) exercises every agency
cost-form + volume end-to-end;
the **cost-volume common-form pass** added migs **168–169** (the Ohio TVSF Round-45 OPP card + the final Foundation
3DCP proposal off it, for deployment verification). The cost/budget volume is now COMPUTED + agency-neutral: one
deterministic burden engine (`lib/proposal/cost-model.ts`, a TS port of `pipeline/…/budget_model.py`, parity to the
cent) rendered in the common government FORM the solicitation requires — `burden_waterfall` (DoW/DoD SBIR·STTR),
`sf424a` (NSF/DOE grants), or `otf_state_budget` (Ohio TVSF / state EDA) — via `resolveCostForm`/`buildCostVolume`
(`lib/proposal/cost-forms.ts`); readiness rolls up the computed price + work-split, and one shared numeric-cell parser
(`lib/numeric-cell.ts`) keeps edited cell `value`s in sync so tenant edits drive the roll-up + exports. Canonical:
**docs/COST_VOLUME_FORMS.md**. — the **V1 UI-wiring pass** (145–148)
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
`publish_section_draft`, on release/provision, gated on the pipeline `ANTHROPIC_API_KEY` — in the sandbox the committed emulator stands in for Claude:
`EMULATE=1` points `ANTHROPIC_BASE_URL` at the :8787 test-harness so every AI-gated flow runs end-to-end
with no live key, exactly mirroring the prod wiring, docs/AI_FLOWS_PROOF.md);
`compliance_reviewer` INLINE in `ai/compliance`; `color_team_reviewer` via the advance `agent_task_queue`;
plus the greenfielded `librarian` (onto `library_atoms`, atomize→`agent_task_queue`, injection-fenced) and
`scoring_strategist` (tenant-discretion) producers, and the platform-scope `opportunity_scout` — WOKEN
(AGENTS-LIVE): `lib/intake.stageIntake` now emits `finder:opportunities.detected` (admin intake + #176 scout
releaseAsNew both funnel through it) → `OnOpportunitiesDetected` prioritizes the triage backlog (reads
`scout_findings` + `curated_solicitations`; advisory, injection-fenced, guardrail-gated) → rfp_admin email +
a `triage_new_opportunities` ToDo (docs/AGENT_WORKFORCE.md; `test_opportunity_scout_wiring.py`). The
**Proposal Draft Manager program** (P1–P4) added +8
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
logs) — swept + gap-fixed 2026-08-02 (docs/EVENT_AUDIT_2026-08-14.md; the `package?format=zip` blind spot is closed).
The rest are greenfielded + registry-wired, pending their per-producer wiring (the **global automation-policy layer** #190 — recipients×timing×escalation — is BUILT + complete, docs/AUTOMATION_POLICY_BUILD_LOG.md; it ships inert until a tenant edits a policy). Wiring pattern: realign to the current
spine, then either a **per-tenant producer** (fan-out agents) or a declarative **`AI_INVOKE` `Step`**
(single-entity agents; `TOOL_ACTION_TO_ARCHETYPE` maps them — `validate()` rejects an unmapped `AI_INVOKE`
at boot). **Agent invariants (non-negotiable):** tenant-space agents are **tenant-bound** (tenant_user
authority; tool schemas expose NO `tenant_id`); output is **advisory → guardrail → land-or-review** (never
auto-writes business tables); untrusted tenant content is **injection-fenced**; runtime bounds **runaway**
(round/cost/rate/budget caps) and never **dead-ends** a workflow (safe-skip). RLS is **LIVE (two-layer,
enforced)** — mig 116 forced RLS on `episodic_memories`; mig 136_rls_cutover put the `NOBYPASSRLS` roles
(`govtech_app` app / `rfp_agent` agents), `tenant_isolation` policies, and the per-request `SET app.tenant_id`
context in effect (mig 137 validates the namespace CHECK). The app runs as `govtech_app` and **the sandbox
emulates production exactly (serve as `govtech_app`, RLS on)** — the owner/`sqlBypass` role is only for
bootstrap/migrations + legitimate cross-tenant reads (see docs/RLS_CUTOVER.md). Oversight: `/admin/agents` → Agent Workforce (roster +
per-tenant usage, forward-only bridge). **Workflow visualization + compliance + full-draft landing (2026-08,
merged via PR #205 + deployed):** `/admin/workflows` renders a dependency-free **Workflow Map** — all 29
templates as DAGs, grouped by the two spines + platform — plus **live instance graphs** (per-step status
overlay) and a sortable/filterable/Live monitor (operator guide: docs/WORKFLOW_ADMIN_GUIDE.md;
`app/admin/workflows/workflow-{graph,shapes,map}.tsx`). The **compliance floor** `validateCanvasAgainstSpec`
(`lib/types/canvas-document.ts`) checks font/**pages**/**slides**/**per-section page budgets**/images/header-footer
across ALL canvas types (doc·pdf·ppt·xls) — the size ruler is now **one calibrated engine**: `estimatePageCount`
delegates to `paginate()` (moved into `canvas-document.ts`; `lib/export/paginate.ts` re-exports it) so the live
editor gauge and the export gate can never disagree, and `estimateSlideCount`/`overflowingSlides`/`sectionPageSpan`
extend it to decks + section limits. It is enforced at the artifact export gate (`X-Compliance-Violations` header +
`proposal:artifact.exported {compliant}`) and on section save (`data.complianceWarnings`, non-blocking), AND on
**standalone (non-proposal) documents** — the portal/admin document + library-foundation save/export routes call
`validateStandaloneCanvas` (a self-declared floor read off `doc.canvas`), so a 2-page flier or a 10-slide deck built
outside a proposal is size-checked too. The full-draft cohort's staged output LANDS via a **read-on-review**
route (`POST …/proposals/[p]/land-revisions` + the "Apply AI-proposed revisions" button in
`proposal-ai-actions.tsx`) that writes proposed `ai_revision` `canvas_versions` the builder reviews + restores
— the workflow engine's invariants FORBID a pipeline consumer of agent output, so the landing is frontend +
human-triggered (docs/FULL_DRAFT_LANDING_DESIGN.md).
`opportunity_id` keys the spine (mig 088). **The workflow engine the agents plug into — the declarative
trigger+step templates, the start→end event gate, and the two stateless reconcilers — is mapped in
`docs/AUTOMATION_SPINE_MAP.md`**; docs/AGENT_FABRIC_DESIGN.md + docs/V1_REFACTOR_DESIGN.md have the
orchestration pattern.

## Services
1. **Frontend** (Next.js 15): Portal UI + API routes + **all front-facing content** → `frontend/`.
   Front-facing content is **frontend-owned in the main DB**: the unified versioned `content_pages`
   store (canonical; legacy `cms_content` is a read-fallback during transition) drives both the
   **documents** (`blog_post`/`resource`/`guide`/`testimonial`/`team_member`) and the **dynamic pages**
   (the page-block editor, `content_type='page'`) at `/admin/site` — draft→publish→archive
   (`lib/content-admin.ts`), read via `lib/cms.ts`. Content is now authored **canvas-native** (the
   proposal Canvas): the CanvasDocument is the source of truth in `metadata.canvas`; the server
   projects the public HTML body from it on save (docs/CONTENT_STUDIO_DESIGN.md).
2. **Pipeline** (Python 3.12): Ingestion, scoring, workers, agents → `pipeline/`
3. **CRM service** (`rfp-crm`, FastAPI, `services/cms/`): deployed on Railway with its **own `cms-postgres`
   DB**, bridged to the main DB via the shared `system_events` table; **email automation** (Gmail send) +
   social are live. Its content/page-block routers are **superseded** for front-facing content (that moved
   to the frontend per §1 — content is frontend-owned in the main DB) — the service's forward scope is
   **CRM** (customer identification / acquisition / management), **still to be built out**.

Frontend + Pipeline share the main PostgreSQL database (`govtech_intel`, Railway service `Postgres`); the
`rfp-crm` CRM service has its own (`cms-postgres`) and bridges via the shared `system_events` table. Object
storage is the S3-compatible **`rfp-pipeline-bucket`** (Cloudflare R2), shared by all three services —
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
- **Before running or reviving a harness script, check docs/SCRIPT_INVENTORY.md** — generated from
  the tree + the live DB (`frontend/scripts/inventory-scripts.mjs`). It says who references each of
  the 271 scripts and whether it still drives identifiers that exist. 37 classify as branch suite, 4 the
  lenses, 2 the cross-checks, 7 the canvas rulers — note the SUITE column counts *scripts*, and
  `run-branch-drives.sh` registers **39 drives**, because two of them are filed elsewhere (RULER,
  and the deck probe under DOCUMENTED); both
  numbers are right and they measure different things. **41 cannot run** (unreferenced + rotted) and
  **16 are documented-but-rotted** — a doc points at them and they will fail confusingly. Nothing is
  marked deprecated there: that is a decision, and the doc collects candidates rather than making it.
- Before writing SQL, verify against **docs/SCHEMA_MAP.md** (generated from the live DB — columns,
  value vocabularies, and which direction of each FK is actually populated). Check your file with
  `node scripts/schema-check.mjs <file>` before running it. CLAUDE_CLIFFNOTES §1 is SUPERSEDED —
  it froze at migration 067 and misled for 135 migrations.
- Escape ILIKE patterns: `input.replace(/[%_\\]/g, '\\$&')`
- **Verification backbone** (every change): `cd frontend && npx tsc --noEmit` (0) → `npx vitest run`
  (1943 total: 1941 pass · 2 env-skipped) → schema via `db/migrations/migrate.mjs` against the sandbox → `npx next build` for risky
  changes → live Playwright drive (`frontend/e2e/*.spec.ts`) → an adversarial multi-agent bug sweep
  (API / React / SQL, findings must be *proven*) for large diffs. See docs/TESTING_STRATEGY.md.
- **A page at REST is not the UI.** `docs/UI_STATES.md` (`drive-ui-states.mjs`,
  `drive-ui-responsive.mjs`) opens every overlay and walks it — open → validation → filled → close —
  intercepts every native `confirm()`/`prompt()` (recording the message, always DISMISSING), catches
  toasts, and captures phone/tablet/desktop including the mobile nav drawer, which the desktop pass
  cannot reach because the hamburger is `lg:hidden`. It also asserts the invariant nav-shell states
  outright: the page body never scrolls sideways. ⚠️ It is **not read-only** — it prints its
  mutation footprint, and the honest way to run it is `pg_dump` before, restore after. Sheets group
  by KIND, not route: twenty validation messages side by side is what makes the odd one visible.
- **The UI has its own two documents, and a route sweep is not a UI sweep.** `docs/UI_CATALOG.md`
  (`node frontend/scripts/catalog-ui.mjs`) counts what a person can DO — 116 routes, 184 components,
  **1,479 event handlers**, 328 fetch sites — with the render graph both ways so an orphan is
  visible. `docs/UI_ATLAS.md` (`capture-ui-atlas.mjs` + `build-ui-contact-sheets.mjs`) PHOTOGRAPHS
  every route as the actor who owns it: 150 shots, 6 lanes, 13 contact sheets, each caption carrying
  the live DOM's button/link/input counts. **Look at the sheets.** A page can answer 200, return a
  textbook `{error,code}` envelope, and carry no text any matcher knows, while being visibly broken —
  that is exactly how `/admin/storage` shipped a red "Failed to list storage objects" banner past
  every lens (B131). Per-route images are gitignored; one command regenerates them.
- **Start from the MANIFEST, not from a walk you invent.** `docs/FRONTEND_INVENTORY.md`
  (regenerate: `node frontend/scripts/inventory-frontend.mjs`) is the full set a sweep has to touch —
  every page, API route, component, lib module and framework surface, with its exports, gates, SQL
  and the harness that reaches it. It exists because each lens enumerated its own scope, so whatever
  belonged to neither walk never appeared in a coverage number: 213 write verbs and 13 GET routes
  were outside every lens while three greens read like a verified API (B125). It parses with the
  TypeScript compiler API and self-tests against hand-verified answers — `--check`.
- **FIVE lenses on a running box** (`frontend/scripts/verify-*.mjs`, each driven as a real signed-in
  actor, each `console`-reporting what it could NOT reach rather than skipping it silently):
  `verify-surfaces` — every `page.tsx` under `app/admin` + `app/portal/[tenantSlug]` RENDERS (a 200
  is not evidence: it reads the rendered text and collects `pageerror`/console throws);
  `verify-api-contract` — every addressable GET honours the SOP envelope (`{data}` / `{error,code}`);
  `verify-db-crud` — writes LAND (create/read/update/soft-delete, cross-tenant refusal, plus the two
  silent-content-loss invariants: `proposal_sections.version` stays ahead of
  `MAX(canvas_versions.version_number)`, and a stale `baseVersion` save is refused 409);
  `verify-ui-vs-db` — the number the page STATES is the number the table HOLDS. The fourth exists
  because the first three were all green while the dashboard told a customer with 8 builds they had
  6 (B80). Its rule: the expectation must be the page's **own query, copied from its source** — a
  predicate you believe is equivalent manufactures confident, wrong findings.
  `verify-write-contract` — the 213 POST/PATCH/PUT/DELETE verbs NO lens walked, because calling
  every write mutates the box being measured. It binds every `[param]` to a fresh UUID owning
  nothing and asserts the one property needing no successful write: **a client error answers 4xx
  with both `error` and `code`, never 500** (a 500 on bad input means validation ran after the DB
  call). ⚠️ It is NOT read-only — several routes take no required input by design — so it prints its
  mutation footprint every run. Sandbox, never production.
- **Two lenses now refuse to report a verdict they cannot earn.** `verify-api-contract` reconciles
  its coverage against the tree (graded + exempt + unbound + no-actor must equal the routes on disk)
  and exits **2 as a HARNESS DEFECT** otherwise; `verify-surfaces` opens each actor lane by driving a
  page that is DEFINITELY broken and requiring its detector to see it, exiting 2 with *"every clean
  below would be unearned"* otherwise. Both guards were added after the thing they guard against had
  already happened (B125, B127).
- **Run all five on BACKWARD review too**, not just on new changes. A retrospective audit is exactly
  where "it's shipped, it's been fine for months" substitutes for evidence — B80 had shipped and
  survived every prior sweep. A surface a lens has no expectation for is **uncovered, not passing**.
- **Four verification rules, each learned by breaking it** (full write-up: docs/TESTING_STRATEGY.md):
  (1) **Red first** — a check that has never failed proves nothing; show it failing on the unfixed
  code, then fix, then show it passing on the same build. (2) **The instrument before the finding** —
  a new harness's first output describes the HARNESS; validate against a known answer before
  reporting (the contract lens's first run reported 38 violations, all phantom, from truncating the
  body before `JSON.parse`). (3) **Copy the predicate from the source**, never re-type one you
  believe equivalent. (4) **Assert the contract the system HAS** — `DELETE` on a bucket is a
  deactivation by design, so asserting "the row is gone" is a harness bug, not a finding.
- **Cross-check when it matters.** The lenses share a stack (Playwright + one postgres.js client
  + assertions written in one sitting), so a green lens shows the lens and the product AGREE — weaker
  than showing the product is right. `scripts/crosscheck-shipped-fixes.sh` (curl + psql, no browser)
  and `scripts/crosscheck-canvas-normalize.mts` (the shipped normalizer over every stored canvas)
  share nothing with them. Not a fifth lens: a cross-check that cannot dissent is decoration.
- **Anything touching layout or export** additionally runs the canvas measurement harnesses, which
  compare the product's own writers against the artifact that comes out (docs/TESTING_STRATEGY.md):
  `verify-ruler-on-proposals` and `verify-ruler-on-stored-artifacts` are the SAFETY GATES — the ruler
  may over-count but must never UNDER-count, because an under-count at the export gate clears a volume
  that is over its agency page limit; `verify-exports-on-stored-artifacts` proves every stored volume
  still downloads in every format; `calibrate-page-ruler` (36), `calibrate-slide-ruler` (7) and
  `sweep-mold-quality` (39 molds) are the regression net. `diagnose-mold-ruler --nodes/--segments/--pages`
  says WHY when one disagrees. Bug log B64–B76 is the record of what they have caught.
- **AN ARTIFACT IS NOT VERIFIED UNTIL AN ENGINE THAT DID NOT WRITE IT HAS OPENED IT** (B121). Every
  harness above measures our writer against our ruler, or Chromium against our HTML — none opened an
  Office file with an Office engine, and that gap hid **decks delivered with table rows and bullets
  missing.** `.docx`/`.pdf` reflow, so a bad height estimate is untidy spacing; **`.pptx` places
  absolutely and PowerPoint CLIPS rather than spilling**, so the same error deletes content silently
  while the bytes stay complete — the row text is all in the slide XML, so the export gate, the
  vocabulary probe and the ruler are all correct and all blind. Run `probe-deck-overlap` (declared vs.
  realised node height, via LibreOffice) after touching `pptx-exporter`, and `render-artifact-pages`
  (`.pdf`/`.pptx`/`.docx`/`.xlsx` → page images) before calling any artifact finished. ⚠️ `soffice` is
  installed here **with no document filters** — it fails on everything including a plain `.txt`; see
  docs/CONTINUATION.md §2 for the one-line install. *Convert a plain text file before concluding
  anything about ours:* that missing control turned a broken tool into a documented claim that our
  `.pptx` was unopenable, and kept B121 invisible.
- **A 200 IS NOT EVIDENCE THAT A PAGE RENDERED** (bug log B78 · B79). Next serves a client-side
  error boundary and a failed hydration with **status 200**, and a throw inside a client component
  never reaches the server log — so a harness gating on `resp.status() < 400` is structurally
  incapable of catching either. Two live customer-facing defects sat behind exactly that blind spot
  (a stored partial canvas white-screened the proposal workspace; a `Date.now()` read during render
  failed hydration on `/admin/events`). `frontend/scripts/verify-surfaces.mjs` drives **every**
  `page.tsx` under `app/admin` and `app/portal/[tenantSlug]` as the right actor and fails on a
  rendered error surface OR a client throw — routes enumerated from the tree, and any route it
  cannot address is REPORTED, never silently skipped. Run it after a UI change or a deploy;
  `scripts/capture-guides.mjs` applies the same gate to the surfaces the two front-door guides
  document.
  ⚠️ **Serving the built app: `next start` is BROKEN here** (`output:'standalone'`) — run
  `node .next/standalone/server.js` after staging `.next/static`+`public`; auth flows must hit
  `localhost:3000` not `127.0.0.1`. Full sandbox/PDF-tooling recipes: **docs/CONTINUATION.md §2**.

## SOP: Data Layer (postgres.js + constraints) — bug classes, see CLIFFNOTES §4b
- **camelCase results (`postgres.toCamel`) — the #1 runtime-crash class:** `lib/db.ts` applies
  `transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }` to BOTH `sql` and
  `sqlBypass`, so EVERY row comes back **camelCased** — `created_at`→`createdAt`,
  `word_count`→`wordCount`, an `AS tag_count` alias→`tagCount`. **Read camelCase in JS**
  (`r.createdAt`); a snake_case access silently yields `undefined`. The SQL text itself still uses
  snake_case column names. ⚠️ **The `sql<typeof rows>` trap:** a manual row-type assertion whose
  fields are declared snake_case COMPILES (tsc trusts the assertion) yet every read is `undefined`
  at runtime — this shipped **twice this session** (`atoms/review` → `new Date(undefined).toISOString()`
  → "Invalid time value" 500; `proposals/[p]/document` → `r.volume_name` undefined → every section's
  volume grouping silently dropped from the assembled doc). Declare the `sql<typeof rows>` field names
  **camelCase**, matching the runtime, and read them camelCase.
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
- **RLS is LIVE (two-layer, enforced) — not "inert until a future flip".** The app connects as the
  `NOBYPASSRLS` `govtech_app` role and RLS scopes every request via the per-request `SET app.tenant_id`
  context (mig 136_rls_cutover: 19 force-RLS tables + 35 policies at that cutover — since extended by migs 171 (`atom_embeddings`) · 173 (amendment/notification) · 184 (per-command `document_templates`); the `govtech_app`/`rfp_agent` roles;
  mig 137 validates the namespace CHECK). **The sandbox EMULATES PRODUCTION EXACTLY — serve as
  `govtech_app` with RLS on.** The owner/`sqlBypass` connection is only for bootstrap/migrations and
  the few legitimate cross-tenant reads (admin/CMS on RLS-forced tables, e.g. the agent-workforce
  rollup, `matched_opportunities`, rfp-curation Customer Interest — these MUST use `sqlBypass`).
  Full posture: **docs/SECURITY_AND_SAFETY.md**; mechanics in docs/RLS_CUTOVER.md.
- **PLATFORM SCOPE = `tenant_id IS NULL`, never a stand-in tenant.** Memory/state follows the same
  DESCENT rule as authority: an rfp_admin has no ambient cross-tenant reach, so work done in TENANT
  space is that tenant's, and work done in PLATFORM space (curation, triage — the `tenantScoped:false`
  tools acting on MASTER records before any tenant mirror exists) is owned by NO tenant. `tasks`,
  `process_instances` and `episodic_memories` (mig 186) all model it as NULL. Such a row is
  **un-writable** through the context-aware `sql` under `govtech_app` — the UPDATE/DELETE policies are
  tenant-EQUALITY and NULL never equals anything, so writing one needs an explicit `sqlBypass`/
  `enterBypass` admin path. It is **NOT invisible**: `tenant_isolation_select` carries an explicit
  `OR (tenant_id IS NULL)` arm, so a platform row is READABLE from any tenant context (verified —
  a tenant context counts all 35 platform `tasks`). What keeps it off a tenant's screen is the
  APP-layer predicate, not RLS: `listOpenTasksForActor` scopes non-admins to
  `assignee_role IN ('tenant_admin','tenant_user','partner_user') AND tenant_id = $1`. Treat that belt
  as load-bearing — a new platform-row reader that omits it leaks, and RLS will not catch it
  (docs/BUG_LOG_2026-08-19.md B55). Do NOT file platform rows under the house
  `rfp-pipeline` tenant: that works, but hands the whole platform history to anyone holding that
  tenant's context. (The house tenant IS correct for copy-forward CONTENT — the system_starter
  library, mig 152 — which is a source shelf tenants copy from, not platform state.)

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

**Canvas — single source of truth is `docs/CANVAS_ARCHITECTURE.md`.** All canvas architecture is
consolidated there: the model + as-built surfaces (one `CanvasDocument`; `canvas.format` forks into
`CanvasRenderer`/`SlideEditor`/`SheetEditor`; PDF is an export target, not a type), the signed-off
**one-canvas / three-surfaces / one-interaction-layer** direction (doc·pdf fluid · ppt discrete
section-per-slide · xls grid+chart+ribbon — all sharing togglable dotted `OverlayLayer` +
`ActOnSelection` verbs + `AssistPanel`), a realigned gap register, the phased path, and a **map of every
other `docs/CANVAS_*.md`** (historical analysis · data-model reference · superseded design · build log).
The 2026-08 Common-Canvas build is recorded in **`docs/CANVAS_BUILD_LOG.md`**. Shipped: the **trust
hub** — a writable section restore path (`…/sections/[s]/versions` POST, CAS-safe, mig 163
`content_source`), local-draft **autosave**/recover + Ctrl-S, and one-click **Accept AI drafts**
(`accept-ai-revisions`) that lands the staged full-draft workforce onto the page; a **non-destructive
409** (explicit-overwrite confirm, no more silent last-write-wins); real **Accept/Revert** node
buttons; **self-serve reuse** (seed-job routes opened to tenant_admin + `verifyTenantAccess`) and
**verbatim reuse** of an uploaded past proposal (`reuse-past`); **images survive export** (S3 keys
inlined to data: URIs across docx/pptx/xlsx/pdf); **notification routing** (self-excluded + "for you");
and **Studio publish-to-library** (PATCH `publish` flips `is_system=true`, no orphans). Deferred (scoped
in the build log): the polymorphic artifact key / one-canvas refactor, whole-proposal
submission-readiness, the shared *atom* library, and the rest of the admin enable plane.
