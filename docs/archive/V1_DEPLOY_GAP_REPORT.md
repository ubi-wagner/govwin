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

---

## J. Task / ToDo layer — deep analysis (2026-06-27, owner-requested)

The proposal-development automation is mostly time/HITL/event-driven over a **User ToDo queue**.
Deep-dived the `tasks` ledger + completion paths against the owner's vision. **Verdict: the
foundation is built; 3 bounded extensions remain — not a substantive rebuild.**

**Built (verified):**
- `tasks` table — **role-queue AND user-queue** (`assignee_role` / `assignee_user_id`), `due_at`,
  `nudge_schedule`/`nudges_sent`, `params` (criteria/input), `result` (output),
  `process_instance_id` linkage, status lifecycle (open/in_progress/completed/cancelled/expired),
  queue indexes (`idx_tasks_role_queue`, `idx_tasks_user_queue`, `idx_tasks_nudge_sweep`).
- `lib/tasks/tasks.ts` — `listOpenTasksForActor` (per-user/role, tenant-scoped, soonest-due) +
  `completeTask` (assignee-gated; merges `result`; **resumes the parked instance** via
  `forceAdvanceProcess`, paused→retrying, which emits). Completing a task IS the HITL emitter that
  advances the proposal phase. ✅
- `TaskQueue` UI (`components/tasks/task-queue.tsx`) mounted on tenant + admin landing pages; 30s
  refresh; overdue/due-soon escalation; complete via POST. ✅
- Routes `portal/[tenantSlug]/tasks` + `admin/tasks` (GET queue + POST complete). ✅
- Workflow-created tasks (`manager._create_task` from TODO/HITL steps) + relative nudge sweep
  (`_sweep_task_nudges`, 1/3/5-day). ✅

**Gaps (each layers onto the existing ledger; engine untouched):**
- **J1 · P1 · No human/manual task creation (delegation).** `tasks.ts` only lists + completes;
  tasks originate ONLY from the workflow engine. No `createTask`, no route, no "assign a job" UI.
  Owner wants admin **and** employees (incl. accepted shadow experts) to assign contributors a job
  with completion criteria + start/end emitters. **Need:** `createTask` core (insert + emit
  `proposal/task.assigned`) + a `portal/.../tasks/assign` POST (tenant_user+, same-tenant assignee) +
  a small assign UI; completion already emits via `completeTask`.
- **J2 · P1 · No time/date/cron-anchored triggers.** `workflows/base.py` has only `EventTrigger`
  (+ `wait_for` HITL); no `ScheduleTrigger`/cron. `due_at` + relative nudges + paused-deadline sweep
  exist, but nothing CREATES tasks/notifications at ABSOLUTE proposal dates. Owner's model: anchors =
  purchase date + (final due date; +30 = hidden past-due anchor); cron from purchase → RFP publish →
  interim dates → closeout (≤3 stages + V0/V0.5 within 72h). **Need:** a daily date-anchored
  generator (sweep) that materializes the stage tasks + `due_at` from the proposal's anchor dates,
  and/or a `schedule`-type trigger.
- **J3 · P2 · Completion is generic, not criteria-typed.** `TaskQueue` always renders Approve/Done ·
  Dismiss (`{approved:bool}`); `params` can hold criteria but the UI doesn't render the CRUD
  completers the owner wants — **upload required docs / fill a form / review a section**. **Need:**
  type `params` (`{kind:'upload'|'form'|'review', spec}`) + render the matching completer (reuse the
  supporting-docs upload, a form, the review-accept), each auto-satisfying on done; the
  email-with-link modality is the same task reached via a tokenized link.

**Owner framing confirmed:** these are small, well-scoped extensions on a solid ledger — not a
workflow rebuild. Recommended order: J1 (delegation) → J2 (date generator) → J3 (typed completers).

---

## K. Findings surfaced during the R-track refactor (2026-06-28)

- **K1 · P2 · postgres.js jsonb text-cast reads back as a STRING.** Verified (3 probes, single
  result-set): a jsonb value written `${JSON.stringify(x)}::jsonb` reads back as a **string**, while
  `${sql.json(x)}` or a DDL `DEFAULT` reads back as a parsed **object** — within the *same* column
  descriptor. The whole codebase writes jsonb via `JSON.stringify(...)::jsonb`. Concretely this means
  a **custom** `gate_config` (written that way in `proposals/create`) reads back as a string in
  `lib/proposal-advance.ts:116` (`(proposal.gateConfig || [...])`), so `gates.indexOf(stage)` /
  `gates[idx+1]` would operate on a string. The **default** gate (`["draft","final"]`, from the column
  DDL default) reads back as an array and works — which is why this is latent (almost all proposals
  use default gates). **R0.3 fix pattern (canonical going forward):** write jsonb via `sql.json()` so
  it round-trips as an object, and have read-models normalize defensively (`coerceOriginCard`).
  **TODO (own task, NOT on the untouched advance path this pass):** audit every `JSON.stringify(...)::jsonb`
  write whose column is later read as an object; either migrate writes to `sql.json()` or normalize on
  read. Highest-priority real consumer: custom `gate_config` in advance.
- **K2 · P3 · No DB uniqueness backs the duplicate-proposal guard.** `proposals` has no
  `UNIQUE(tenant_id, opportunity_id)` (the 001 UNIQUE is on the tenant-scoring table; the opportunity
  index is non-unique). Two concurrent `proposals/create` POSTs can both pass the app-level duplicate
  check (route.ts) and create two proposals — each freezing its own origin card. Pre-existing; does not
  violate single-card immutability. A `UNIQUE` index would need a dedupe pass first (could fail on
  existing dupes). Track with the create-path hardening.

### R3.1 finds (2026-06-28)

- **K3 · P1 · `create_instance` ON CONFLICT could not infer the PARTIAL dedup index — every launch threw.**
  `manager.create_instance` used `ON CONFLICT (workflow_name, trigger_event_id) DO NOTHING`, but the
  dedup index (mig 043 `idx_process_instances_dedup`) is PARTIAL (`WHERE trigger_event_id IS NOT NULL`).
  Postgres cannot infer a partial unique index for ON CONFLICT unless the predicate is restated —
  verified on PG16: the exact statement throws `there is no unique or exclusion constraint matching the
  ON CONFLICT specification` on EVERY launch (a minimal INSERT with no R3 columns reproduced it, so it
  is pre-existing, not introduced by R3). A fresh deploy from these migrations would fail to launch ANY
  workflow instance. ✅FIX (R3.1): added `WHERE trigger_event_id IS NOT NULL` to the ON CONFLICT — which
  also RESTORES the intended per-trigger dedup that was previously dead. Caught by the R-track Factor-2
  live-PG drive of the real manager (the throwaway-DB standard exists for exactly this).
- **K4 · P2 · `_create_task` wrote corrupt rows when a generic overlay omitted a gate field.** `r(x) or x`
  fell back to the LITERAL path string, so a missing `taskType`/`assigneeRole` produced a task typed
  `"payload.taskType"` / assigned to a phantom role `"payload.assigneeRole"` no queue reads. ✅FIX (R3.1):
  `r_or_none` degrades an unresolved `payload.`/`step.` path to None (caller defaults safely); quoted/bare
  literals (every existing bespoke template) are unchanged. (Independent-review P2.)

### R3.3 finds (2026-06-28)

- **K5 · P2 · R0.3 shipped a latent test break (now fixed).** The R0.3 origin-card freeze switched the
  create-route proposals INSERT to `sql.json(originCard)`, but `__tests__/proposals-create.test.ts`
  mocks `@/lib/db` with a bare `sql` (no `.json`) → 4 success-path cases threw `sql.json is not a
  function` → 500. R0.3's commit ran the NEW card test + tsc + a live drive but not this existing
  route test. ✅FIX (R3.3): mock `sql.json` (identity) + mock `@/lib/process/project-collaboration`.
  Lesson: run the full `vitest` suite, not just the new file, before committing a shared-route change.
- **W-D CLOSED · `purchase.completed` orphan.** An opportunity purchase now fires a real transient
  reaction: the Stripe webhook launches `ProjectCollaboration` (scope='opp', an rfp_admin
  proposal_setup gate) right after emitting `capture:purchase.completed` (the event still emits for
  audit). The `AdminProposalSetup` phantom is fully retired (the dead lock-route completer deleted).
