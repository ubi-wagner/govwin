# V1 Deploy-Now Gap Report — 6-factor functionality sweep (2026-06-27)

Six independent read-only auditors swept the full surface (automation wiring · process queue + agent
dispatch · workflow-template completeness · E2E data paths · APIs↔frontend · DB + agent framework).
Findings are deduped + cross-confirmed below. **Caveat:** the live audit DB was a fresh throwaway
(0 rows), so row-count "empties" are discounted — every finding here is **code-level** (writer/reader
existence, name matches, control flow), not behavior-by-emptiness.

Legend: **P0** deploy-blocker · **P1** silent break / important · **P2** functional gap (roadmap) ·
✅FIX = fixing now · 📋ROADMAP = larger build, tracked.

---

## A. Automation namespace mismatches — silent breaks (✅FIX)
Rules fire on a namespace the emitter never uses, so the action never runs. Root cause: seed mig 019
wired rules under `identity`; later migs moved emitters to `capture` and left rules orphaned.
- **A1 · P0** — social distribute: rule `system/content.published` vs emit `library/content.published` → no LinkedIn post ever. *(mig 040; cms_content.py:271)*
- **A2 · P0** — rejection email: rule `identity/application.rejected` vs emit `capture/application.rejected` → rejected applicants get nothing. *(mig 019; reject/route.ts:75)*
- **A3 · P1** — new-app admin alert: rule `identity/application.submitted` vs emit `capture/application.submitted` (todo still fires via a capture rule; the alert email does not). *(mig 019)*
- **A4 · P1** — `identity/tenant.created` rule → event never emitted (501 stub). Acceptance email works via `capture/application.accepted`; this rule is dead.

## B. Orphaned stage events — no consumer (✅FIX) — cross-confirmed ×3
- **B1 · P1** — `proposal.v0_provisioned` (create-route, E1) → no rule/workflow/handler.
- **B2 · P1** — `artifact.locked` (lock route, E1) → no consumer (`document.locked` has a rule; `artifact.locked` doesn't).
- **B3 · P2** — `finder/rfp.attached` and `proposal/proposal.stage_advanced` emitted with no consumer; `library/content.requested` workflow trigger never emitted (OnCmsContentRequested can't start); `content_published` notify-template referenced but missing.

## C. Process queue / workflow runtime (✅FIX C1–C3)
- **C1 · P0** — **phantom `AdminProposalSetup`**: create-route inserts a `process_instances` row `status='running'` but **no such Workflow class exists** → the stuck-detection sweep force-fails it ~5 min later; the 72h admin-review SLA never pauses/nudges/escalates. *(cross-confirmed: process-queue + workflow auditors)* *(create/route.ts:660; manager.py:1305)*
- **C2 · P1** — stuck/pending/paused sweeps in `manager.py` lack `AND source = $1` → a pipeline-side manager force-fails CMS-side instances (mechanism behind C1). *(manager.py:1305/1314/1365/1418/1427)*
- **C3 · P1** — no stale-claim recovery: `agent_task_queue` rows stuck in `running` after a worker crash are never re-picked, retried, or alerted. *(fabric.py:697)*
- **C4 · P2** — no retry of failed tasks (no `attempts` column); a transient bounce = permanent fail.

## D. Structured workflow-template overlay — the centerpiece (📋ROADMAP)
The engine is capable (declarative steps, HITL park/resume, nudges, on_timeout) but templates do
**not** declare the owner's facets as data — they're docstring prose + an operational-only catalog.
- **D1** — `Workflow` base exposes only `trigger/steps/description`; `process_templates` stores only name/active/audit (mig 054 by design). No home for rationale / required-input / actors / HITL-pauses / stage-nudge-matrix / end-message.
- **D2** — `OnProposalCreated` docstring contradicts code (claims AI-draft+customer-notify; actually one admin-notify step).
- **D3** — no structured required-input contract (missing fields resolve to `None`).
- **D4** — no stage-transition notification matrix; `outcome.recorded` sends nothing.
- **D5** — the 3 HITL gates the owner named (72h review, V0-lock expert gate, partner approvals) are not modeled as workflow pauses.
- **Target shape** (from the auditor): extend `Workflow` + add a `definition jsonb` to carry
  `rationale · start_trigger · required_input(schema) · steps-with-first-class-actors · hitl_pauses ·
  stage_transition_nudges(matrix) · end(success/failure message+notify)`, plus a `validate()` that
  enforces every referenced notify-template exists and every transition has a consumer.

## E. E1/E2/E3 connective tissue (✅FIX E-a/E-b/E-e · 📋ROADMAP E-c/E-d/E-f)
- **E-a · P1** — `volume_required_items.template_id` + `expert_notes` are **read by create-route but never written** (no editor field/tool) → the E3 DB-template path is dead (always falls back to the in-code registry). ✅FIX
- **E-b · P1** — `expert_notes` also not read downstream (section editor doesn't SELECT `meta`). ✅FIX
- **E-e · P1** — `artifact_id` not in the sections-list payload → workspace UI can't group by document. ✅FIX
- **E-c · P1** — `format_spec`/`compliance_spec` are write-only; `validateCanvasAgainstSpec` doesn't exist (E4). 📋ROADMAP
- **E-d · P1** — package export ignores the artifact container (flattens to one letter DOCX; pptx/xlsx exporters unwired) (E8.2). 📋ROADMAP
- **E-f · P2** — `is_required` has no writer (optional-artifact advance gate is a no-op). 📋ROADMAP

## F. Portal canvas image 404 — deploy-blocker (✅FIX)
- **F1 · P0** — `canvas-renderer.tsx` posts to `/api/portal/[slug]/uploads/image` and gets
  `/api/portal/[slug]/storage`; **neither route exists** in the portal (admin equivalents do). A
  customer adding/viewing an image node in a section 404s on both upload and display.

## G. Missing admin UI surfaces (📋ROADMAP)
- **G1 · P1** — Template Studio editor (the E3b CRUD API has no create/edit UI).
- **G2 · P1** — opportunity-lifecycle controls (the C6 archive/close/reopen route has no button/host page).
- **G3 · P2** — section-standards management UI; per-artifact lock badge; review-rounds UI.

## H. Agent framework (📋ROADMAP — "built but not yet wired", per CLAUDE.md)
- **H1 · P1** — ToolRegistry uses dotted names (`memory.search`) but archetype allowlists use bare
  names (`search_memory`) → all 9 registry tools are dead; archetypes ship their own tools and build
  SQL directly, bypassing the registry's tenant-isolation guard. Decide: rename to dotted, or remove.
- **H2 · P1** — 8 of 10 archetypes unreachable (only `compliance_reviewer` + `color_team_reviewer`
  run); `fabric.handle_event` is never called; `ProposalArchitect` unwired (= E5/E6).
- **H3 · P1** — no `publish_section_draft` write-back tool (autonomous drafting can't persist; the
  human-in-the-loop product draft path is fine) (= E5).

## I. DB hygiene (✅FIX I1 · 📋ROADMAP I2)
- **I1 · P1** — `agent_task_log` missing `(tenant_id, created_at)` + `(created_at)` indexes — the
  rate-limit COUNT + budget/cap SUM run on **every** agent call and currently post-filter `created_at`.
  ✅FIX
- **I2 · P1** — RLS `ENABLE` without any `POLICY` on `agent_task_log` + 3 memory tables = no-op (app
  connects as superuser). Either real RLS + non-owner role (= F8), or drop the misleading ENABLE. 📋ROADMAP
- **I3 · P2** — `system_events_namespace_chk` is `NOT VALID`. **I4** — dead tables
  (`system_health_snapshots`, `invitations`, `solicitation_templates`, `agent_archetypes`,
  `deploy_baseline`; `agent_performance` write-only) + dead columns (`canvas_preset`/`compliance_preset`
  on volume_required_items; several `solicitation_compliance` JSONB cols read-by-pipeline never-written).

---

## Deploy-now fix plan (this exercise)
**Fixing now (bounded, high-value, low-risk):** A1–A4, B1–B2 (mig: namespace corrections + orphaned-
event rules) · C1 (phantom SLA → real HITL workflow) · C2–C3 (sweep source-scope + stale-claim
recovery) · F1 (portal image routes) · E-a/E-b/E-e (template_id/expert_notes writers + surface +
artifact_id in payload) · I1 (indexes).

**Roadmap (larger builds, tracked in V1_TASKING):** D (structured workflow-template overlay) ·
E-c/E-d (E4 validator + E8.2 package-by-artifact) · H (E5/E6 agent wiring + ToolRegistry decision) ·
G (Template Studio + opp-lifecycle UIs) · I2 (real RLS = F8) · I3/I4 (constraint validate + dead-code cleanup).
