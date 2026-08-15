# Tenant Workflow Setup — design (2026-08-15)

The **tenant-side counterpart to the provisioning cockpit**: once the RFP-admin team releases a portal
(`curation_pending → launched`), the buying **tenant_admin** gets a full, low-lift UI to run their build
workflow — set the stage-gate dates, name who owns each interstage ToDo, tune the nudge cadence, and add
employees/collaborators — and **change any of it later** as the proposal evolves. This is the "workflow
setup once the OPP is released" surface.

Grounded in a 5-read scout of the live model (guardrail/stage shape · task/nudge engine · people
management · existing UI · engine↔stage mapping). Every claim below carries a file:line anchor.

---

## 0. The one load-bearing fact (drives the whole design)

**The per-portal build is a phase-machine on the `proposal_portals` ROW — not a `process_instances`
template.** Stages are `guardrail_config.stages[]` JSON, cursored by `proposal_portals.current_stage_index`,
with `tasks` rows hung off each stage (`process_instance_id`/`step_name` left NULL). There is no step DAG,
no parked workflow, no reconciler advancing it. Advancement is an **imperative** `advancePortalStage` call
that passes only when **every open ToDo of the current stage is done** (or a manager force-advances).
Dates never advance a stage — **dates drive nudges (reminders) only.** (`frontend/lib/portal-workflow.ts:132-209`;
docs flag the misreading directly: `docs/AUTOMATION_SPINE_MAP.md:17`, `docs/START_END_FRAMEWORK.md:578-579`
finding D-Engine-5.)

The separate declarative engine (`ProjectCollaboration`, `pipeline/src/workflows/project_collaboration.py`)
models only the **transient single gates** around the lifecycle (the 72h curation gate, the purchase gate) —
one gate per launch, deliberately **not** the multi-stage build (`project_collaboration.py:20-21,56-60`).

**Why this is good news:** the setup UI does not have to fight a workflow engine. It edits JSON on a row and
a handful of task rows. Aligning "100% with workflow" means respecting the phase-machine's contract (below),
not re-plumbing an engine.

---

## 1. What already exists (reuse, do not rebuild)

| Capability | Status | Where |
|---|---|---|
| Add **employee** (tenant_user) | ✅ full UI | `team-invite-form.tsx` → `POST /portal/[slug]/team` → `user_memberships source='home'` (`team/route.ts:95`) |
| Add **collaborator** (partner_user) | ✅ full UI | `team-manager.tsx` → `POST …/proposals/[p]/collaborators` → `proposal_collaborators` + `collaborator_stage_access` (`collaborators/route.ts:171`) |
| **Per-stage** collaborator permission view/comment/edit | ✅ schema; UI writes uniformly | `collaborator_stage_access(collaborator_id, proposal_id, stage, permission)` (`001_baseline.sql:356-366`); enforced in `proposal-access.ts:196-227` |
| Revoke / reactivate people (soft, reversible) | ✅ | `team/[userId]/route.ts`, `collaborators/[id]/route.ts` |
| **Pre-launch** workflow authoring (stages · per-ToDo type/title/**role**/dueDays · managers · nudges) | ✅ one modal | `guardrail-editor.tsx` (`GuardrailEditor`), committed at `?action=accept` |
| Assign a **named person** + **absolute due date** + nudges to a **NEW** ad-hoc task | ✅ | `assign-task-form.tsx` → `createTask` (`tasks/assign/route.ts`) |
| Tenant-**global** per-trigger nudge-days editor | ✅ | `automation-policies-card.tsx:202` |
| Stage execution (advance / force / unlock / gate dots) | ✅ read-only dates | `stage-control.tsx` |
| Task nudges fire (60s sweep, N-days-before-`due_at`, email + in-app, manager escalation on final) | ✅ | `pipeline/.../manager.py::_sweep_task_nudges:1011-1080` |
| Absolute-deadline task precedent | ✅ | `_sweep_date_anchored_tasks` mints a `final_due` task at `opportunities.close_date` w/ `[7,3,1]` (`manager.py:1265-1366`) |

**The dual assignee (`assignee_role` + `assignee_user_id`) and absolute `due_at` already exist on every
`tasks` row** (`db/migrations/053_tasks_ledger.sql:26-27,52-54`). **Per-stage collaborator permission
already exists.** **`guardrail_config` is open JSONB.** So the storage is present for everything the ask
needs.

---

## 2. The four gaps (what's genuinely missing)

Answering the ask head-on — can a tenant_admin do this *today*?

| Ask | Today | Gap |
|---|---|---|
| **Change stage-gate DATES** | ❌ | Stages have no date field; only relative per-ToDo `dueDays`, pre-launch (`guardrail-editor.tsx:181`). No absolute stage date anywhere. |
| **Change interstage task ASSIGNEE** | ❌ | Assignee is a **role** (Admin/Contributor), set **pre-launch only** (`guardrail-editor.tsx:23,177`). Tasks are **immutable after creation** — no route rewrites `assignee_*` (verified repo-wide). |
| **Change NUDGE dates/cadence** | ⚠️ pre-launch + tenant-global only | A **launched** portal's own nudges are frozen (accept consumes config once; PATCH is status-only, `portals/[portalId]/route.ts:190-209`). |
| **Add employees / collaborators** | ✅ | Exists — but lives in **two scattered places** (tenant team page + per-proposal tab), not one setup surface. |
| Reorder / rename stages | ❌ | Labels static, include/exclude checkbox only (`guardrail-editor.tsx:165-167`). |
| Edit anything **post-launch** | ❌ | `guardrail_config` is written once (CAS to pre-launch states) — **no post-launch edit route exists** (`portal-launch.ts:88,121`; PATCH status-only). |

**Root cause of all four: the config is frozen at launch and the task rows are write-once.** The data can
hold what you want; nothing can *write* it after go-live.

---

## 3. The alignment verdict — "align 100%" + the ONE deliberate workflow change

The phase-machine contract we align to (unchanged):
- **Advancement stays task-completion-driven** (all open stage ToDos done, or manager force). Invariant 1/2.
- **The time-sweeper keeps reading the `tasks` rows** for `due_at`/`nudge_schedule` — we do **not** touch the
  reconciler. Invariant 8.
- **Every transition stays CAS-guarded** and goes through the existing helpers. Invariant 3.
- **`validateGuardrailConfig` re-runs on every edit** (≤3 stages, ≥1 stage, ≤3 nudges, no empty stage). Inv 2/4.

The **single deliberate change to the workflow model**: **`guardrail_config` becomes editable after launch**
(today it is frozen), via a **bounded, validated, CAS-guarded re-projection** that refreshes the current
stage's open task rows. This is the "change the workflow to match" — done in the least-invasive, most-aligned
way possible:

> **Chosen model — RE-PROJECTION (not live-read).** The tenant edits `guardrail_config`; on save we
> re-project the changed values onto the **current stage's open `tasks` rows** (`UPDATE … SET due_at,
> assignee_role, assignee_user_id, nudge_schedule, nudges_sent='[]'`). Future stages inherit the new config
> for free — `advancePortalStage` already re-reads `guardrail_config` live and calls `createStageTodos(next)`
> (`portal-workflow.ts:156-159,192`). Completed stages are left untouched.

Why re-projection over changing the reconciler to read config live (the rejected Option B):
- The sweeper's clean design is "live timing = the task row" (`manager.py:1022-1030`). Re-projection keeps that
  true — we just refresh the rows. **Zero reconciler change → aligns 100% with the running engine.**
- Re-projection is one explicit, auditable, idempotent write (reset `nudges_sent` so a rescheduled nudge
  re-fires correctly — the exact watermark the sweep dedups on, `manager.py:1062-1069`).
- The one existing live-read seam — delegated **managers** for the *final* escalation, read from
  `guardrail_config` at nudge-time (`manager.py:1207-1234`) — keeps working unchanged and even improves
  (edits to the manager list take effect on the next nudge with no re-projection).

**Storage impact: effectively none.** Absolute stage dates ride in the open JSONB
(`guardrail_config.stages[].dueDate`); task edits use columns that already exist; per-stage collaborator
permission already exists. The only *optional* migration is a `proposal_portals.workflow_updated_at/_by`
audit stamp (nice-to-have; the audit event covers it otherwise). **No engine change, no reconciler change,
no storage migration required for the core.**

---

## 3½. Per-stage gate closer + required setup acceptance (owner refinements)

### 3½.1 The gate CLOSER is per-stage: HUMAN or AI-MANAGER

Each stage declares **who closes its gate** — the axis is *who confirms the stage is done*, not *whether a
clock fired*:

- **`human` (HITL, default).** The stage advances when its human ToDos are all complete (today's
  `advancePortalStage` predicate, `portal-workflow.ts:167-174`), or a manager force-advances. Dates nudge +
  flag overdue.
- **`agent_manager`.** An **agent manager** orchestrates an automated stage — e.g. a "Color Team / Review"
  stage where the **advisory_manager** (or **color_team_reviewer**) fans out to the existing full-draft cohort
  (**stylist · formatter · continuity_manager · editors/refiners**), waits for all to land, then the
  **adversarial** pass (the reusable `AdvisoryOverlay`, `policy=auto`) reviews every document. When the cohort
  has landed **and** the adversarial gate passes, the stage is **gate-ready**. This is exactly the pattern the
  Proposal Studio already runs (`OnReviewPhaseRequested{Draft,Refine,Compliance}`, the Mode-C doorbell
  "run all automatically", the `AdvisoryOverlay policy=auto`).

Two sub-modes for an `agent_manager` stage, **tenant-chosen per stage**:
- **assisted** — the manager does the work + lands the adversarial verdict; a **human clicks "Advance"**
  (one-click HITL-light: "the AI manager reports ready").
- **auto** — on manager-complete + adversarial-pass, a **guarded automation advances the stage**. The tenant's
  per-stage opt-in *is* the human authorization; the agent never advances itself.

**Invariant safety (non-negotiable).** Even in `auto`, the invariant "agents never auto-write a business table"
holds: the agent manager produces an **advisory verdict** (lands as a review), and a **separate automation** —
not the agent — flips `current_stage_index`, gated on (a) the cohort actually complete, (b) the adversarial
pass, and (c) the tenant's explicit per-stage `auto` opt-in. A stage still can **never be empty** and can
**never advance on a clock alone** (the date only nudges/escalates). So `agent_manager/auto` is the
"advance when done" the owner described — with a real completion gate, not a time trigger, and with a human
having pre-authorized *this* stage. (Reuses the existing agent workforce end-to-end; the only net-new wiring is
the "manager-pass → guarded auto-advance" signal + the per-stage selector. This is the **deepest** phase and
ships last — see §9 TW-7.)

### 3½.2 Required setup acceptance (the tenant-side mirror of the admin cockpit)

Provisioning a new portal now requires the tenant to **complete + accept** the workflow setup once, on the
same dedicated page that later hosts all editing:

- On release (`provisionAndReleasePortal`), the portal is `launched` **but marked `workflow_setup_status =
  'pending'`** (rides in `guardrail_config._setup.status`, or an optional `proposal_portals.workflow_setup_status`
  column — see §4). The tenant admin gets a **required ToDo** "Set up your build workflow" deep-linking to the
  Workflow Setup page (reusing the `taskHref` `case 'portal'` → the *tenant* portal page).
- The page opens **pre-filled with recommended defaults** (`recommendedGuardrails()` — 3 stages, dated off the
  solicitation close, sensible owners/nudges) so the required step is a **review-and-tune**, not a blank form.
  It **validates completeness** (every stage has a closer + a date + ≥1 owner) before enabling the commit.
- The commit is **"Accept & Start"** → writes the tuned `guardrail_config`, flips `workflow_setup_status =
  'accepted'`, (re)instantiates the current stage's ToDos from the accepted config, and clears the required
  ToDo. Emits `capture:workflow.accepted`.
- **Momentum vs. gate (owner sub-decision, recommended resolution):** the proposal is **buildable
  immediately** (sections exist from provision), and the workflow runs on **defaults** until accepted — so the
  customer is never blocked — but a **persistent banner + the required ToDo** enforce the one-time
  completion, and the stage/nudge machinery re-projects to the accepted config on Accept. (The stricter
  alternative — hold stage-0 ToDo creation until Accept — is a one-line switch if you prefer a hard gate.)

Thereafter the **same page** is the ongoing edit surface (§5 PATCH A/B/C); "Accept & Start" becomes "Save".
A required accept is per-**proposal/portal**; a **descended shadow admin** (rfp_admin acting inside the
tenant) may complete + accept on the tenant's behalf (same `canEditWorkflow` gate, admin included).

### 3½.3 History-aware recommendations — "recommend, but require"

The required setup opens **pre-filled with a recommendation learned from the tenant's own prior similar
workflows**, not a static default — so the required step is a fast review-and-accept, and the tenant *owns*
the outcome. `recommendWorkflowConfig(tenantId, opportunityId)`:

- **Match prior accepted portals by similarity** — same **agency + program/phase family** (e.g. "USAF Phase I",
  "Army D2P2", "Ohio TVSF"), read off `opportunities.agency`/`program_type`, most-recent-first, scoped to this
  tenant (with a platform-wide fallback for a tenant's first proposal of a type).
- **Carry forward what they chose last time** — the accepted `guardrail_config` of the best match: the
  **stages** + each stage's **gate closer** (Human vs AI-manager) + **who was assigned to AI vs a human** per
  section/ToDo + the **nudge protocol** + the per-todo dates-as-offsets (re-anchored to this opp's close date).
- **Fallback** — when there's no history, `recommendedGuardrails()` (today's 3-stage default) still fills the
  form. Either way the tenant reviews + **Accepts** (required once); nothing is silently applied.

This is the highest-leverage "low-lift" feature: the platform learns each customer's operating pattern
(who they trust to AI, how they gate a color-team phase, their reminder cadence) and proposes it, so setting
up the 5th USAF Phase I is a glance, not a chore. It reads only *accepted* configs (the tenant's vetted
choices), never live/unaccepted ones. (Built in TW-1 as the recommender + surfaced in TW-6.)

---

## 4. Model deltas (small, additive, all in the open JSONB / existing columns)

Extend the `GuardrailConfig` TS types (`portal-workflow.ts:34-47`) — **no DB migration**:

```ts
interface Stage {
  key: string;
  label?: string;
  todos?: StageTodo[];
  dueDate?: string | null;    // NEW — absolute ISO stage-gate deadline (drives nudges + overdue, NOT advancement)
  defaultAssigneeUserId?: string | null;  // NEW — a new ToDo in this stage inherits this owner
  gateCloser?: 'human' | 'agent_manager';  // NEW — who closes the gate (default 'human')
  agentManagerKey?: string | null;         // NEW — which manager archetype (e.g. 'advisory_manager' | 'color_team_reviewer') when agent_manager
  autoAdvance?: boolean;                    // NEW — agent_manager only: auto (guarded) vs assisted (one-click human confirm). Default false (assisted).
}

// Config-level setup-acceptance marker (rides in the open JSONB; no migration needed):
interface GuardrailSetup { status: 'pending' | 'accepted'; acceptedAt?: string; acceptedBy?: string }
// GuardrailConfig gains:  _setup?: GuardrailSetup
interface StageTodo {
  type: string; title?: string;
  assigneeRole?: string | null;
  assigneeUserId?: string | null;   // already present — the person picker writes here
  dueDays?: number | null;          // kept as the relative fallback when a stage has no absolute dueDate
  dueDate?: string | null;          // NEW — per-ToDo absolute override of the stage date
  nudgeDays?: number[];             // NEW (optional) — per-ToDo nudge override; default = portal-wide config.nudgeDays
}
```

Projection rule (in `createStageTodos` + the new re-project path): a task's `due_at` =
`todo.dueDate ?? stage.dueDate ?? (dueDays ? now + dueDays·1d : null)`; its `nudge_schedule` =
`todo.nudgeDays ?? config.nudgeDays`. Everything the sweeper reads still lands on the row — the engine is none
the wiser.

---

## 5. New write paths (routes + lib) — the whole build is 3 endpoints + reuse

**A. `PATCH /api/portal/[tenantSlug]/portals/[portalId]/workflow`** — edit the workflow post-launch.
- Gate `tenant_admin`, `verifyTenantAccess`, `withTenant`.
- CAS: only when `status IN ('launched','executing')` — never `curation_pending`/`guardrails_pending`
  (those are the paid accept/release entry, adversarial-sweep B4) and never `closeout`/`archived`/`abandoned`.
- `validateGuardrailConfig` against `getGuardrailLimits` (re-uses the exact limit path).
- Write `guardrail_config`, then **re-project** the current stage's open tasks. One shared
  `editPortalWorkflow(tenantId, portalId, newConfig)` lib backs this (single source of truth).
- Emits a **bracketed** `capture:workflow.reconfigured` (start→end, `tasksReprojected` count) — it's a process
  touching N tasks, so start/end per the events doctrine.

**B. `PATCH /api/portal/[tenantSlug]/tasks/[taskId]`** — reassign / reschedule / re-nudge ONE live task
(the day-to-day quick action, complementing the config editor).
- Gate: manager/tenant_admin (own-tenant, `withTenant`). Body `{ assigneeUserId?, assigneeRole?, dueAt?, nudgeSchedule? }`.
- Guards: task must be `open`/`in_progress` and belong to this tenant/portal; resets `nudges_sent='[]'` on a
  timing change; re-validates the person is a member of the tenant.
- Emits single facts `capture:task.reassigned` / `task.rescheduled` (atomic edits → single events).

**C. `POST …/portals/[portalId]/workflow?action=rebaseline`** — the killer low-lift action: shift the whole
timeline. Body `{ shiftDays }` or `{ newSubmissionDate }` → recompute every stage `dueDate` (and the
`final_due` anchor) proportionally, then re-project. One click when the solicitation deadline moves.

**Reused as-is:** team invite/revoke (`/team`, `/team/[userId]`), collaborator invite/revoke +
per-stage permission (`…/collaborators`), `assign-task-form` for brand-new ad-hoc tasks, `advancePortalStage`
for advance/force. **`GuardrailEditor` is refactored to run in two modes** — `mode="pre-launch"` (today's accept
flow, unchanged) and `mode="edit"` (calls PATCH A instead of accept) — so setup and ongoing management are the
same component, no drift.

---

## 6. The UI — `/portal/[tenantSlug]/portals/[portalId]` · "Workflow Setup"

A new **per-portal detail page** (none exists today — `/portals` is a list; portals deep-link to the
proposal). It's the tenant mirror of the admin provisioning cockpit, and the natural mount is already framed
by the Manage console drawer "Proposal portals & workflow" (`manage-console.tsx:259`). A "Workflow" entry
joins the portal row actions and the proposal workspace header.

**Layout (one screen, four cards + a low-lift action bar):**

1. **Timeline** (the hero) — a horizontal stage rail: each stage is a card with an inline **date picker**
   (absolute gate date), an editable **label**, drag-to-reorder, include/exclude, an **overdue / due-soon**
   chip driven by `dueDate` vs now, and a **gate-closer** control — **Human** (advance on ToDos done) or
   **AI-manager** (pick the manager + assisted/auto). A "critical path" line ties stage dates to the submission
   deadline. The page opens in **required Accept mode** for a new portal (§3½.2) — "Accept & Start" — then
   becomes the ongoing edit surface ("Save").
2. **Stage detail** (expand a stage) — its ToDos as rows: **type**, **title**, an **assignee picker**
   (a real person from the team **or** a role bucket), a **due** control (inherit stage date · absolute · +N days),
   and a per-ToDo **nudge** chip. Add/remove ToDos. A stage-level **default owner**. Live edits → PATCH A.
   Each live task row also gets a one-click **Reassign / Reschedule** (PATCH B).
3. **People** — embeds the existing team-invite + the collaborator **Access Matrix** (sections × people, E/C/V),
   now with **per-stage** permission editing (schema already supports it; today it writes uniformly). "Assign a
   proposal manager" promotes someone to the default assignee + escalation target in one click.
4. **Notifications & guardrails** — the portal-wide **nudge cadence** (up to 3, days-before-due), the **RFP
   oversight** toggle, and a read-only **escalation floor** ("the tenant admin is always notified on the final
   nudge" — non-removable, `manager.py:1187-1198`). Shows the live limits (≤3 stages · ≤3 nudges).

**Low-lift action bar (the "very impactful, very low-lift" set):**
- **Rebaseline timeline** — shift everything by N days / to a new submission date (action C).
- **Set deadline from the solicitation** — seed the final stage date from `opportunities.close_date`
  (the same anchor `final_due` already uses).
- **Assign a manager** — one pick → default owner + escalation.
- **Bulk-invite team** — paste a list of emails → team members.
- **Apply a saved workflow template** — start from a `guardrail_templates` preset (the picker already exists
  pre-launch; reused in edit mode).
- **Toggle nudges** per stage on/off.

Everything is optimistic-UI with a toast on save; every write is validated + audited server-side.

---

## 7. Invariants honored (the alignment checklist)

1. **No auto-advance / advisory agents** — stage dates drive *nudges + overdue*, never advancement; the human
   ToDo gate stays. (`DATA_FLOW.md:135-138`.)
2. **No empty stage / all-or-nothing gate** — every edit re-runs `validateGuardrailConfig`; ≥1 stage, no
   zero-key stage (the DEFECT#1 bypass guard, `portal-workflow.ts:80-87`).
3. **CAS everywhere** — PATCH A CAS's `status IN (launched,executing)`; advance/force go through
   `advancePortalStage`/`setPortalStatus`; no raw status writes.
4. **Bounded limits** — `getGuardrailLimits` + `validateGuardrailConfig` on every save (fix the stale "10/1"
   docstrings → the live "25/25", `mig 123`).
5. **Escalation floor non-removable** — the UI can add managers / opt out of RFP oversight but can never drop
   the tenant admin from the final notice.
6. **Framework caps win / SLA pins** — editing is post-release, so the 72h curation SLA is already satisfied;
   the tenant can only narrow within limits. Ships **inert** — a tenant who edits nothing gets today's behavior.
7. **RLS / own-tenant** — all writes `withTenant`; pre-launch entry states remain unsettable via PATCH (B4);
   task edits carry the cross-tenant guard.
8. **Stateless, idempotent reconcilers** — we introduce **no** state the sweepers can't re-derive: timing lives
   on the task rows (re-projected), `nudges_sent` reset on reschedule so the dedup stays correct.

---

## 8. Decisions (LOCKED, owner-confirmed 2026-08-15)

1. **Gate closer is per-stage: HUMAN (HITL) or AI-MANAGER — dates are a soft deadline/nudge overlay on
   both, never a blind auto-advance.** A stage declares who closes its gate (see §3½). Advancement is always
   gated on *real completion* (human ToDos done, or the agent cohort landed + the adversarial reviewer passed) —
   never on a clock alone. Dates drive nudges + an overdue flag.
2. **Editors = tenant_admin + delegated managers.** The account admin and any manager they appoint can edit the
   workflow; members receive their assigned ToDos.
3. **The dedicated page is REQUIRED once (complete + accept) per new portal, and is the same surface for all
   later editing** (see §3½ "Required setup acceptance"). Mount: a new `/portals/[portalId]` **Workflow Setup**
   page (mirrors the admin provisioning cockpit; keeps the tab-dense proposal workspace uncluttered).
4. **Editability window** — editable while `launched`/`executing`; **locked** at `closeout`/`archived`.
   **Re-projection scope** — refresh the **current stage's open tasks**; future stages inherit on advance;
   **completed** stages untouched.

---

## 9. Phased build plan (TW-1..8) — each phase green + committed

- **TW-1 · Model + validate + editor gate + recommender.** Extend `GuardrailConfig` types (stage `dueDate`/
  `defaultAssigneeUserId`/`gateCloser`/`agentManagerKey`/`autoAdvance`; per-todo `dueDate`/`nudgeDays`;
  `_setup`); extend `validateGuardrailConfig` (dates well-formed, `gateCloser` ∈ set, completeness check, still
  ≤ limits); the projection helper `projectTodoTiming(stage, todo, config)`; a `canEditWorkflow(role)` gate =
  tenant_admin + delegated managers (+ descended shadow admin); **`recommendWorkflowConfig(tenantId,
  opportunityId)`** — match prior *accepted* portals by agency+program/phase, carry forward stages/gate-closer/
  assignees/nudges re-anchored to this close date, fall back to `recommendedGuardrails()`. Unit tests. **No
  migration** (optional `workflow_setup_status` column deferred; rides in `_setup` first).
- **TW-2 · `editPortalWorkflow` + PATCH A + Accept & Start.** Post-launch config edit + re-projection (CAS
  `status IN (launched,executing)`, validate, refresh current-stage open tasks, reset `nudges_sent`); the
  **Accept & Start** transition (`_setup.status` pending→accepted, (re)instantiate current stage from accepted
  config); bracketed `capture:workflow.reconfigured` + `capture:workflow.accepted`.
- **TW-3 · Required-acceptance wiring.** `provisionAndReleasePortal` marks `_setup.status='pending'` + raises the
  required "Set up your build workflow" ToDo (→ tenant portal page) + the persistent banner. (Momentum: runs on
  defaults until accepted; hard-gate switch documented.)
- **TW-4 · PATCH B (per-task reassign/reschedule/re-nudge)** + single-fact `capture:task.reassigned/rescheduled`;
  own-tenant + open-status guards; member-of-tenant validation on the new assignee.
- **TW-5 · Rebaseline (action C) + set-deadline-from-solicitation** + the timeline recompute + re-project.
- **TW-6 · The Workflow Setup page** — required Accept flow → then the edit surface: **timeline** (dates/rename/
  reorder/overdue), **stage detail** (per-ToDo assignee-person/role + date + nudge; **per-stage gate-closer
  selector** Human | AI-manager), **notifications** (nudges + oversight + read-only escalation floor). Refactor
  `GuardrailEditor` to `mode` (pre-launch | edit); wire PATCH A/B/C + Accept. Gate on `canEditWorkflow`.
- **TW-7 · People panel** — embed team invite + collaborator matrix; add **per-stage** collaborator permission
  editing + "assign a proposal manager" + bulk-invite.
- **TW-8 · Agent-manager gate closer (deepest — ships last).** Wire an `agent_manager` stage end-to-end: the
  manager cohort (advisory_manager / color_team_reviewer + the full-draft cohort) lands → the adversarial
  `AdvisoryOverlay policy=auto` passes → **gate-ready**; **assisted** = a one-click human "Advance", **auto** =
  a *guarded automation* (not the agent) advances on cohort-complete + adversarial-pass + the per-stage opt-in.
  Reuses the Proposal Studio / AdvisoryOverlay machinery; the only net-new is the "manager-pass → guarded
  advance" signal + the selector. Invariant-safe (agent never writes `current_stage_index`).
- **TW-verify** (folded into each phase's close + a final pass) — tsc 0 · vitest · `drive-tenant-workflow-setup.mts`
  (edit dates/assignees/nudges → re-projected, `nudges_sent` reset; reassign a live task; rebaseline; the
  Accept-&-Start flow; an emulated `agent_manager` auto-advance) under forced-RLS `govtech_app` + a Playwright
  browser drive as `kate.ulepic@foundation3dp.com`; docs; commit/push.

Nudge-firing is proven by asserting the re-projected `due_at`/`nudge_schedule`/`nudges_sent` on the task rows
(the exact fields `_sweep_task_nudges` reads) — the technique the provisioning drive used, no live worker
needed. The `agent_manager` auto-advance is proven with the committed emulator standing in for the cohort.

---

## 10. Files to touch (map)
- `frontend/lib/portal-workflow.ts` — types, `validateGuardrailConfig`, `projectTodoTiming`, `editPortalWorkflow`, re-project.
- `frontend/lib/portal-launch.ts` — reuse CAS helpers; add `setWorkflowConfig` (CAS launched/executing) if cleaner than inline.
- `frontend/app/api/portal/[tenantSlug]/portals/[portalId]/workflow/route.ts` — **new** (PATCH A + action=rebaseline).
- `frontend/app/api/portal/[tenantSlug]/tasks/[taskId]/route.ts` — **new** (PATCH B).
- `frontend/app/portal/[tenantSlug]/portals/[portalId]/page.tsx` + client cards — **new** (Workflow Setup).
- `frontend/components/portal/guardrail-editor.tsx` — refactor to `mode` (pre-launch | edit).
- Reuse: `team-invite-form.tsx`, `team-manager.tsx`, `assign-task-form.tsx`, `automation-policies-card.tsx`.
- `frontend/lib/event-labels.ts` — labels for `workflow.reconfigured`, `task.reassigned`, `task.rescheduled`.
- Docstring cleanup: the stale "10 collaborators / 1 manager" comments → the live 25/25 (`portal-workflow.ts:5`, etc.).
- Docs: this file + a line in CLAUDE.md + `START_END_FRAMEWORK.md` (post-launch edit seam).

---

## 11. Net
The workflow model is sound and we align to it 100% by keeping advancement task-driven and the sweeper
row-driven. The only deliberate change — **making the config editable after launch via a bounded
re-projection** — needs **no engine change, no reconciler change, and no storage migration**; the data model
already holds absolute dates (open JSONB), named assignees (`assignee_user_id`), and per-stage permissions.
The build is **3 endpoints + one page + reuse of everything that already manages people** — a genuinely
low-lift surface for a very high-impact setup experience.
