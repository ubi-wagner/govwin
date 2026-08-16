# Launch Status — all big efforts (as of mig 178)

A faithful, current status of every major launch effort. Legend: **✅ shipped + proven** ·
**🔵 built, intentionally inert** (ships off until a one-op flip / first tenant edit) · **⏳ descoped**.
Backbone this cycle: **`tsc` 0 · `vitest` 1129 pass · migration head 184 · `next build` clean**,
plus the live proofs cited below.

## A. The customer spine (canonical surface)

- **✅ Opportunity-card spine.** Admin approval → `solicitation.push` fans every activated opportunity
  onto the forward-only `opportunity_bridge` → a denormalized `tenant_opportunity_cards` row per tenant,
  auto-ranked by `tenant_spotlight_buckets`/`tenant_bucket_scores`. The legacy Spotlight/Pipeline surface
  is **retired and DROPPED** (mig 125); `/spotlights` + `/pipeline` redirect to `/cards`.
- **✅ Master + mirror OPP lifecycle.** Two releases (Spotlight discovery vs proposal-portal build) over
  the one-way bridge; comp-code purchase (`rfppipelinetest`) → `curation_pending` (72h SLA) → RFP-admin
  release → provisioned build UNLOCKED, compliance matrix + molds instantiated. (docs/MASTER_MIRROR_OPP_DESIGN.md)
- **✅ Cost/budget volume — computed + agency-neutral.** One deterministic burden engine
  (`lib/proposal/cost-model.ts`, parity to the cent with the Python `budget_model.py`) rendered in the
  government FORM the solicitation requires — `burden_waterfall` (DoD SBIR/STTR), `sf424a` (NSF/DOE grants),
  `otf_state_budget` (Ohio TVSF / state). Tenant cell edits drive the roll-up + exports. (docs/COST_VOLUME_FORMS.md)
- **✅ Compliance floor.** `validateCanvasAgainstSpec` — one **calibrated** size ruler (`estimatePageCount`
  delegates to `paginate()`) so the live editor gauge and the export gate can never disagree; enforced at
  the artifact export gate, on section save, and on standalone (non-proposal) documents.
- **✅ Submission readiness** rolls up lock/compliance/pages/required + the computed price/work-split.
- **✅ Package export** — json/docx/pdf/zip, figures as native chart nodes, sections ordered by integer
  `sort_index`. Verified end-to-end (Playwright + live Python workflow engine).

## B. Authoring & the AI workforce

- **✅ Proposal Studio** — the full-draft engine broken into **3 gated loops** (Draft → Refine →
  Compliance); each lands in review, then a UI gate to comment+regenerate or approve→next, or run all 3
  auto via the doorbell. Advisory — never advances a lock/submit. (docs/PROPOSAL_STUDIO_DESIGN.md)
- **✅ Proposal Draft Manager program** (P1–P4, +8 archetypes) — `proposal_manager` planner +
  `OnFullDraftRequested{ModeA/B/C}` (HITL / restyle / full-auto), `cost_estimator` woken on the
  deterministic burden engine, the adversarial `AdvisoryOverlay` gate. Admin-drivable from the **doorbell**.
- **✅ Agent workforce — 36 archetypes, all auto-registered.** Live in flows today: `section_drafter`,
  `compliance_reviewer` (inline), `color_team_reviewer`, `librarian`, `scoring_strategist`,
  `opportunity_analyst`, `research_scout`, `opportunity_scout`, and the admin-plane `rfp_ingest_manager`.
  **AGENTS-LIVE (proven live this cycle):** `opportunity_scout` woken dark→live (intake → AI triage
  prioritization + ToDo), `research_scout` mapped as an AI_INVOKE step in `OnProposalCreated`,
  `market_analyst` overlay pre-augment fixed to anchor on a real section. Investigation also confirmed the
  "dormant" list was largely stale — `onboarding_agent`, `outcome_analyst`, the ingest cohort, `pp_matcher`,
  `cost_estimator` already have live producers. Agent invariants (non-negotiable): tenant-bound ·
  advisory→guardrail→land-or-review · injection-fenced · runaway-bounded · never dead-ends a workflow.
  (docs/AGENT_WORKFORCE.md)
- **✅ Generative flows proven end-to-end with real actors** — CMS content (generate → review → publish →
  live on the public site), proposal (AI-built cohort → real actor → compiled docx/pdf package bytes), and
  marketing documents (mold → real actor → real .docx). (docs/E2E_GENERATIVE_PROOF.md)
- **✅ Full-draft landing** — the cohort's staged output lands via a **read-on-review** route
  (human-triggered "Apply AI-proposed revisions"), since the engine forbids a pipeline consumer of agent output.
- **✅ Semantic retrieval** — hybrid `selectForSection` blends pgvector cosine (`atom_embeddings`, mig 171,
  tenant-scoped + FORCE-RLS) when a gated engine is on; **inert by default** → byte-for-byte the pre-vector
  selector, zero regression. Isolation proven at rest · RLS · app-layer. (docs/SEMANTIC_RETRIEVAL.md)
- **✅ AI flows proven end-to-end (#148).** The entire event-triggered fabric (full-draft Mode C,
  ai-review, Studio ×3, assess-ingest, ai/research) drove through the Python worker → emulated-Claude →
  tenant-scoped memory → land-or-review, with full `system_events` auditability (137 emulator LLM calls,
  80 `agent.invoked`). Prod runs the identical wiring with the live key. (docs/AI_FLOWS_PROOF.md)

## C. Canvas & content

- **✅ Common-Canvas MVP + trust hub** — writable section restore (CAS-safe), autosave/recover + Ctrl-S,
  one-click Accept-AI, non-destructive 409, real Accept/Revert nodes, self-serve + verbatim reuse, images
  survive export (data-URI inlining), notification routing, Studio publish-to-library. (docs/CANVAS_BUILD_LOG.md)
- **✅ Content Studio** — front-facing content authored canvas-native (the CanvasDocument is the source of
  truth in `metadata.canvas`; the server projects the public HTML on save). Unified versioned `content_pages`
  store, draft→publish→archive. (docs/CONTENT_STUDIO_DESIGN.md)
- **✅ Content queue (#168, this cycle)** — the four missing **program-primer guides** (BAA · OTA · CSO ·
  Grants/NOFO) drafted canvas-native + queued for admin review via a `content_publish` HITL ToDo; draft-gated,
  nothing public until published. Durable via mig 176. (docs/CONTENT_QUEUE.md)

## D. Discovery, intake & templates

- **✅ Scout-intake queue (#176, this cycle)** — scout findings (crawler leads + the HITL source-scout's
  extracted opportunities) land in one `scout_findings` review→release queue, deterministically classified
  **NEW vs UPDATE** and released as a new intake (`stageIntake` → RFP curation) or an update (`logAmendment`
  on the matched opp), or dismissed. Advisory, injection-fenced, platform-scope, audited. (docs/SCOUT_INTAKE_QUEUE.md)
- **✅ Amendment fan-out engine** — detect → confirm → fan-out to every built proposal → tenant acknowledges,
  every transition audited; the proactive 6h update-scan feeds it.
- **✅ Templates** — 18 starter molds across DoD/DoW · NSF · DOE + marketing/commercialization/investment,
  auto-resolved per volume at provision with the form-item guard; page furniture + figures on every mold.
  (docs/TEMPLATES_LAUNCH.md)

## E. Operations & admin

- **✅ Workflow visualization** — `/admin/workflows` renders a dependency-free Workflow Map (29 templates as
  DAGs, grouped by the two spines + platform) + live per-instance status graphs + a sortable/filterable/Live
  monitor. (docs/WORKFLOW_ADMIN_GUIDE.md)
- **✅ Archivable contract** — soft + reversible only, NOTHING hard-deleted; archive actions on exactly three
  entities (portal / library atom / tenant), workflows cascade-only. (docs/ARCHIVABLE_CONTRACT.md)
- **✅ Partner-manager console** — `/partner` owner-scoped console; each managed company's open ToDos surface
  ("notify up"), descend-to-complete into any owned/managed company as tenant_admin. (docs/PARTNER_MANAGER_DESIGN.md)
- **✅ HITL ToDo framework** — typed completers; **broadcast-to-all vs named-to-user** targeting (mig 174),
  per-user acks, shadow-admin + partner-shadow-admin receipt, and **broadcast → group-chat threads** (typed
  timestamped chain, the substrate for future meeting/PM extensions). partner_user self-surface + a single
  completable admin-triage inbox. Driven as real users, screenshot-backed. (docs/HITL_TODO_GUIDE.md)
- **🔵 Global automation-policy layer (#190)** — recipients × timing × escalation, BUILT + complete; ships
  inert until a tenant edits a policy. (docs/AUTOMATION_POLICY_BUILD_LOG.md)
- **✅ Observability** — every actor/automation/agent/manager action posts to `system_events` (+ domain audit
  logs); swept + gap-fixed, the `package?format=zip` blind spot closed. (docs/EVENT_AUDIT_2026-08-02.md)

## F. Security & data segregation

- **✅ Copy-inward-only sharing (#118)** — every share copies content INTO the recipient's own space; a live
  integrity sweep found **0 cross-tenant references** (atoms/versions/sections). "Guardrails and data
  segregation can never be compromised." (docs/COPY_INWARD_GUARDRAIL.md)
- **✅ RLS live** — mig 136_rls_cutover (19 force-RLS tables, 35 `tenant_isolation` policies, the
  `NOBYPASSRLS` `govtech_app`/`rfp_agent` roles + per-request `SET app.tenant_id` context) is **applied and
  in effect**: the app connects as the `NOBYPASSRLS govtech_app` role with the per-request `SET app.tenant_id`
  context, so RLS is the enforced second layer. (docs/RLS_CUTOVER.md)
- **✅ Credentials** — mig 124 rotated master_admin off the committed seed; `.test` accounts deactivated +
  hash-invalidated.

## G. Verification backbone (this cycle)

`tsc` 0 · `vitest` **1085 pass** · migrations applied through **178** · `next build` clean · **E2E proof
across 3 solicitations** (TVSF · SBIR Phase I · DoD D2P2 STTR — admin author → tenant build → submission-ready
→ package bytes; docs/E2E_LAUNCH_PROOF.md) · **AI fabric proven on the full rig** (worker + emulator) · live
Playwright drives for every surface touched.

## Descoped / deferred (explicit)

- **⏳ Self-serve Stripe checkout** — the comp-code purchase stands in.
- **⏳ Polymorphic artifact key / one-canvas refactor** — scoped in CANVAS_BUILD_LOG, deferred.
- **⏳ Shared *atom* library** — deliberately deferred; each tenant holds its own copies (segregation).
- **⏳ CRM service** — customer identification/acquisition/management is the CMS/CRM forward scope, still to build.
- **⏳ Whole-proposal submission-readiness** beyond the per-section roll-up.

## Bottom line

The greenfield opportunity-card spine is the canonical customer surface; the compliance-authoring core
(admin author → release → provision → Studio draft → readiness → package) is proven end-to-end across three
real solicitations; the AI agent fabric drives every gated flow with land-or-review + full auditability; and
RLS is **live app-side** (the app runs as `govtech_app`); the automation-policy layer is built and inert
until a tenant edits a policy, and the pipeline agent RLS role (`rfp_agent`) is built and deploy-gated on
`AGENT_DATABASE_URL`. Data segregation is intact and proven (0 cross-tenant references). What remains is
deployment-time (the agent `AGENT_DATABASE_URL` provisioning, the live `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`)
and the explicit descopes above.
