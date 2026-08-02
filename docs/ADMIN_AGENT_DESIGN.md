# Admin Agent — `rfp_ingest_manager` (Phase 1)

**Status:** built + tested (2026-08-02). **Scope:** platform / our-org (RFP-admin ops). **No tenant
descent** (that's Phase 2). Advisory only. This is the first *manager*-shaped admin agent — the
platform-scope analog of the tenant-side `proposal_manager` (which plans a full draft): it plans/
coordinates the **RFP ingest pipeline** for the RFP admin.

## Why (the user ask)
"An RFP shadow-admin which knows the system and can **manage the agents at RFP pipeline for ingest of
RFPs**." Phase 1 delivers the ingest-management half at zero blast radius: it never leaves the admin
plane, never touches a tenant, never mutates a business table — it reads the ingest state and tells
the admin *what to run next*.

## What it does
Given a curated solicitation, `rfp_ingest_manager` assesses each **ingest stage** from the data state
and emits ONE advisory **Ingest Readiness Report + coordination plan**:

- **stage** — where the solicitation is: `shredding → extracting → matrixing → skeletoning →
  ready_for_qa → release_ready` (inferred from `has_full_text`, `has_ai_extracted`,
  `compliance_row_count`, `has_outline`, `status`).
- **agent_plan** — which specialist agents to run/re-run next and why, e.g. `ingest_analyst`
  (no `ai_extracted`), `matrix_stager` (no compliance rows), `skeleton_architect` (no outline),
  `curation_qa` (all present, not yet review-requested). This is the "manage the agents" output.
- **blockers / missing / readiness (0–1) / next_actions / summary** — a prioritized go/no-go plan.

It **coordinates but never commands**: the report is advisory input for the admin, who runs the
specialist agents / requests review / pushes. It is deliberately distinct from `curation_qa` (the
final QC gate at `review_requested`) — the manager is the *cross-stage orchestrator* that runs at any
point and recommends the sequence; they compose (the manager often recommends running `curation_qa`).

## Boundary vs. the existing ingest cohort
| Agent | When | Question it answers |
|---|---|---|
| `ingest_analyst` | RFP uploaded | shred → structured curation draft |
| `matrix_stager` | RFP uploaded | curation → compliance-matrix rows |
| `skeleton_architect` | RFP uploaded | matrix → master skeleton |
| `curation_qa` | submitted for review | is this *good enough* to push? |
| **`rfp_ingest_manager`** | **admin asks, any time** | **where is this in the pipeline & which agents run next?** |

## As-built wiring (mirrors `curation_qa` + `OnSolicitationReviewRequested`)
1. **Archetype** — `pipeline/src/agents/archetypes/rfp_ingest_manager.py` (`BaseArchetype`;
   `role_name="rfp_ingest_manager"`, Sonnet, temp 0.2, `human_gate=True`). One tool
   `get_ingest_state` reads master `curated_solicitations` + `solicitation_compliance` +
   `solicitation_outlines` (NO tenant filter), returns a stage snapshot + the untrusted title/text
   **injection-fenced** (`untrusted_content`, treat-as-data guard in `build_messages`).
2. **Registration** — 3 code lists: `fabric.py` import block + `_ARCHETYPE_CLASSES`, and
   `archetypes/__init__.py` `__all__`. (Roster is code, not the vestigial `agent_archetypes` table.)
3. **Action map** — `TOOL_ACTION_TO_ARCHETYPE["tool.ingest.assess"] = "rfp_ingest_manager"`
   (`workflows/processor.py`). An unmapped `AI_INVOKE` action fails `Workflow.validate()` at boot, so
   the mapping is load-bearing.
4. **Producer workflow** — `pipeline/src/workflows/on_ingest_assessment_requested.py`
   (`OnIngestAssessmentRequested`, auto-discovered). Trigger `finder:ingest.assessment_requested:end`.
   Step `ai_ingest_manager` (`AI_INVOKE` → `tool.ingest.assess`) + an **independent** `NOTIFY` step so
   a skipped/failed agent never dead-ends the admin.
5. **Producer route** — `POST /api/admin/rfp-curation/[solId]/assess-ingest` (rfp_admin+), emits the
   trigger event. The admin's "Assess ingest readiness" control.
6. **Oversight** — a `ROSTER` entry in `components/admin/agent-workforce.tsx` (scope `platform`);
   queue/spend stats populate from `agent_task_queue`/`agent_task_log` once it runs.

## Safety contract (every box ticked — §8 of AGENT_WORKFORCE.md)
- **Advisory only** — output lands in the fabric's audit/infra tables (`agent_task_log`,
  `agent_task_results`, `system_events`) and the admin report; it **never** writes a business table
  and **never** advances a state.
- **Injection-fenced** — the raw solicitation `full_text` (the most untrusted input in the system) is
  delimited as `untrusted_content` with a treat-as-data / ignore-embedded-instructions guard.
- **Runaway-bounded** — inherits the fabric caps: `MAX_TOOL_ROUNDS=20`, `PER_CALL_CEILING_USD=$0.50`,
  50 calls/hr, `$50`/mo (platform cap for `tenant_id IS NULL`), 120s/round timeout, 3-strike per-tool
  breaker. One task per assessment; its output event does not re-trigger itself.
- **Guardrail-gated landing** — passes `agents/guardrails.py::enforce_guardrails` (fail-safe to
  `review`; denylist → review). It requests no auto-apply, so it always lands as `review`.
- **Never dead-ends** — the `NOTIFY` step is independent; an unmapped/failed/ unkeyed `AI_INVOKE` is a
  safe-skip (no fabric call, no DB write). Fabric returns an error dict, never raises.
- **No tenant reach** — platform-scope: `tenant_id` is NULL, tool schema exposes no `tenant_id`, the
  fabric keeps it on the caller connection (an empty `app.tenant_id` GUC would deny every row). It can
  only read our master ingest data; it structurally cannot see a tenant. (Descent = Phase 2, under an
  audited `shadow_admin_grant`.)

## Testing (airtight — `pipeline/tests/test_rfp_ingest_manager_wiring.py`)
Mirrors `test_pod4_wiring.py` + a live drive over our own solicitations (LLM mocked per
`test_agents.py`; a real run is deploy-gated on `ANTHROPIC_API_KEY`, like every agent):
registered + action-mapped; tool schema exposes no `tenant_id`; injection fence present; reads master
tables (no tenant filter); the workflow validates + registers with an independent NOTIFY; guardrails
land it as `review`; and an end-to-end run over a real `curated_solicitations` row writes
`agent_task_log`/`agent_task_results` and mutates **no** business table.

## The Proposal Auto-Drive "Doorbell" (admin-plane trigger — built 2026-08-02)

The tenant-side proposal build manager is **already complete** — `proposal_manager` (planner) +
`OnFullDraftRequested{ModeA,B,C}` (Mode C = full auto build), landing drafts in review-staged
`canvas_versions`, never advancing a gate. It's already admin-drivable, but only by hand-descending
into each tenant's portal proposal workspace and clicking "Run full draft." The **doorbell** is the
missing admin-plane trigger: a thin `/admin` control that rings the *existing* engine on a chosen
tenant's proposal — no portal descent, one canonical audit trail.

**Single audit path (the point).** Both the portal control and the doorbell now funnel through ONE
helper — `frontend/lib/proposal-full-draft.ts::requestFullDraft(...)` — which persists the Voice
register, emits `proposal:proposal.full_draft_requested` (start/end, the trigger the workflows
consume), and logs `proposal_activity_log`. The only difference is a **`source`** field carried on
both the event payload and the activity row: `'portal'` vs `'admin_doorbell'`. So every full-draft —
tenant-initiated or admin-initiated — is one auditable, attributable record; nothing diverges.

**As-built:**
- **`POST /api/admin/proposals/[proposalId]/full-draft`** (rfp_admin/master_admin). Resolves the
  proposal's tenant + opportunity via a cross-tenant `sqlBypass` read (admin scope), validates
  mode/voice/adversarial, `enterTenant(tenantId)`, then `requestFullDraft({..., source:'admin_doorbell'})`.
  The emitted event carries the **admin** as actor + the target `tenant_id` → the same workflows fire,
  attributed to the admin.
- **`GET /api/admin/proposals?buildable=1`** (rfp_admin+) — recent proposals across tenants
  (id, title, tenantSlug, stage, isLocked) for the picker.
- **UI** — a "Proposal Auto-Drive (Doorbell)" card on `/admin/agents`: pick a proposal, pick a mode
  (A/B/C), Ring. It's the admin doorbell for the build cohort, beside the workforce roster.
- **Safety** — advisory (drafts land in review, never advance a gate), admin-gated, goes through the
  same shadow-authorized emission the portal uses; no new engine, just an admin doorbell on it.

## Phase 2 (not built here)
Descend into a tenant under an admin-issued, TTL'd, audited `shadow_admin_grant` and run the existing
Mode C full-draft orchestrator **autonomously** (the `rfp_ingest_manager`'s build-side sibling) — the
agent never self-authorizes the tenant binding. The doorbell is the human-driven precursor: same
emission, same audit, admin at the wheel.
