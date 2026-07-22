# V1 → V2 Lifecycle Architecture — Opportunity-Centric, Card-Carried, One Workflow

**The definitive end-to-end architecture: ingest → curate → spotlight → purchase → strawman →
staged build → lock → download → archive → WIN → V2 contract-management portal.** Every state
transition is a **start→finish event** carrying the **card** as its payload. One generic workflow
template runs as a standalone instance per `opportunity_id`-scoped runtime (each bucket, each
portal). Grounded in the 6-auditor source review (`V1_WORKFLOW_ARCHITECTURE.md`); each step is marked
**[BUILT]**, **[PARTIAL]**, or **[GAP]**.

---

## 0. Core principles (owner-confirmed)

1. **`opportunity_id` is the immutable spine; each bucket/portal is its own standalone runtime.**
   A workflow **instance** = one `(scope, opportunity_id, owner)` runtime: `oppStatus`(global),
   `spotlightStatus`(per tenant-bucket-opp), `projectStatus`(per portal-opp). Each is independent
   but audits back to the one `opportunity_id`.
2. **One generic template, instantiated per runtime.** All three scopes — and every customer
   portal — run the **same** `ProjectCollaboration` template, parameterized per instance. This is
   what lets us **replace human steps with agents over time** without changing the card definition:
   a step's actor can be human OR agent; the step contract (trigger→action→outcome→emit) is fixed.
3. **The card carries state; every transition emits start→finish.** The card is the single payload
   that flows through the whole machine. Every state-machine emission, step function, HITL wait,
   collaborator upload, and review writes a `:start` and `:end` event whose payload is the card delta.
   The card is **layered** (L0 global → L1 bucket → L2 project), forward-carrying, tab-locked on
   advance (prior tabs read-only audit).
4. **Lock-on-portal-create = the audit anchor.** When a portal is created from a bucket card, that
   bucket-opp instance **locks** — it becomes the immutable audit head for that entire proposal.
   Pick another opp from the same bucket → a new portal, same process. Pick a similar opp from
   another bucket → almost always a *multiple-submissions-allowed* effort (good for everyone) — still
   audits back to its origin opp.
5. **Combinatorics are free because everything keys on `opportunity_id`.** A customer may create any
   number of spotlights, pin any subset, and buy any subset into portals; archived opps propagate
   from the global level down to every tenant runtime; status rolls up `GROUP BY opportunity_id`.
6. **V2 = the same machine, project-execution scope.** A WIN rolls the proposal's accumulated data
   (timelines, project plan, SOW, collaborators, artifacts) into a contract-management portal that
   runs the **same** template + card, with the **project-execution** step set replacing the
   proposal-development one.

---

## 1. The universal step contract (every step, every scope)

```
STEP = {
  actor:      human(role) | agent(archetype) | system        # swappable; contract is fixed
  trigger:    EventTrigger (business event) | ScheduleTrigger (date anchor) | task-complete
  action:     ACTION(fn) | AI_INVOKE(archetype) | TODO/HITL(park) | NOTIFY
  inputs:     resolved from card/payload (payload.* dot-paths)        [BUILT: resolve_input]
  hitl_wait:  optional park → task(assignee, due_at, nudge_schedule) → resume on complete/timeout
  outcome:    {success | forced_advance | failed} + result merged into the card
  emits:      <namespace>:<entity.action>:start  →  :end   (payload = card delta)   [BUILT: events]
  card:       updates the L-tab + appends an audit row; locks on gate advance
}
```
Engine support today **[BUILT]**: event-trigger start, payload-parameterized steps + tasks, HITL
park/resume, nudges, deadlines, retry, crash recovery, audit transitions. Missing for the contract
**[GAP]**: `opportunity_id`+`scope` key on `process_instances` (W-A), a generic template (W-B), a
parameter store (W-C), `ScheduleTrigger` (W-L), human task-create (W-K), business-event chaining
(W-D).

---

## 2. End-to-end lifecycle — step by step (trigger → action → outcome → emit → card)

### STAGE A — Ingest (oppStatus / global) — mostly [BUILT]
| Step | Actor | Trigger (in) | Action | Outcome | Emits (start→end) | Card |
|---|---|---|---|---|---|---|
| A1 Discover | system (ingester) | `ScheduleTrigger` (poll) **[GAP: scheduler is manual]** | `BaseIngester.run()` upsert `opportunities ON CONFLICT(source,source_id)` | new/amended opp | `finder:opportunity.ingested` / `.amended` (single) **[BUILT]** | create L0 card (status `new`) |
| A2 Auto-triage | system | A1 end | `_create_triage_row()` → `curated_solicitations(status='new')` | opp in admin queue | (row only) **[BUILT]** | L0 card enters triage |
| A3 Claim | rfp_admin (HITL) | admin action | `solicitation.release` tool → `claimed→released_for_analysis` + enqueue shred job | claimed | `finder:solicitation.released` **[BUILT]** (internal handoff) | L0 tab: claimed |

### STAGE B — Curate: matrix + volumes + summary (oppStatus / global, HITL) — [BUILT]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| B1 Shred | agent (shredder) | shred job | pull docs → 2 Claude passes → write `solicitation_compliance` (matrix) + `ai_extracted.sections[].summary` | matrix + summary | `finder:rfp.shredding.start→end` **[BUILT]**, platform-cap logged (G1) | L0 card body = summary artifact **[PARTIAL: JSONB, not a canvas card]** |
| B2 Build volumes | rfp_admin (HITL) | curation UI | volume/required-item CRUD + `apply-preset` → `solicitation_volumes`/`volume_required_items` (+ `template_id`, `expert_notes`) | volume hierarchy | `finder:volume.added`, `required_item.added` **[BUILT]**; `template_id`/`expert_notes` **[GAP: no writer — E3c]** |
| B3 Strawman first-article (master) | rfp_admin + agent | curation | author/curate the per-volume base artifacts (Template Studio) | reusable master artifacts | (curation events) **[PARTIAL: Template Studio read path E3a/b built; editor + link GAP]** |
| B4 Approve & PUSH | rfp_admin (HITL) | admin action | `solicitation.push` → `approved→pushed_to_pipeline`, `is_active=true` on topic set | **customer-visible** | **`finder:solicitation.pushed`** = the **L0→L1 BRIDGE** **[BUILT]** | L0 card → `pushed`; retention of all origination docs **[CONFIRMED]** |

### STAGE C — Spotlight fork (spotlightStatus / per tenant-bucket-opp) — [PARTIAL]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| C1 Rank into buckets | system (deterministic) **[CONFIRMED no Claude / no bleed]** | `finder:solicitation.pushed` | `OnSolicitationPushed`→`score_tenants.match_tenants`: read shared opp + `tenant_profiles`, write **tenant-scoped** `tenant_pipeline_items` + `spotlight_bucket_scores`(5 buckets), oppID link-back | per-tenant ranked card | `finder:scoring.completed` **[BUILT]** | **fork L0→L1** (scores; summary **referenced**, not copied **[GAP W-E]**) |
| C2 Re-rank on new bucket/portal | system | portal-create / profile-update | `match_one_tenant()` over all pushed opps | new tenant gets scores | — | **[GAP W-J: only fans out on push]** |
| C3 Review-new-opps | tenant_user (HITL) | C1 end | a `tasks` row "review new opps" (queue) + email = login link | customer reviews | `system:task.created` **[BUILT engine]**; the email **[GAP W-N]** | L1 cards appear in spotlight feed |
| C4 Pin | tenant_user | pin action | `is_pinned=true` on `tenant_pipeline_items` | high-intent signal | `capture:topic.pinned` **[BUILT, but ZERO consumers]** | card pinned |
| C5 Pin→nudge | system | `capture:topic.pinned` | create `close_date`-anchored task (today→close), tenant-scoped | nudged to act | `system:task.nudge` (relative) | **[GAP W-Q + W-L: no consumer, no date anchor]** |

### STAGE D — Purchase → portal fork + strawman + 72h review (projectStatus) — [PARTIAL]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| D1 Purchase | tenant_admin | buy / admin-create | `proposals/create` txn: create `proposals`(locked) + `proposal_artifacts`(frozen specs) + `proposal_sections` + `supporting_docs` + S3 copy (compliance/volumes/rfp/topic) | **portal built**, unique copy set | **`proposal.v0_provisioned`** (copy event) **[BUILT]**; `purchase.completed` emitted w/ oppID but **no consumer [GAP W-D]** | **fork L1→L2**; copy card in **[GAP W-E]** |
| D2 Lock opp-for-bucket | system | D1 | lock the bucket-opp instance = the **audit anchor** for this proposal; spotlight card → locked | immutable origin | (lock event) **[GAP: spotlight lock-state W-G/W-H block]** | L1 tab locks (read-only audit) |
| D3 Strawman (Phase 0 / V0) | agent (ProposalArchitect) | `proposal.v0_requested` | draft each section from **3 sources** (L1 bucket atoms + `tenant_profiles` + RFP/library) → write `proposal_sections.content` | meat-on-bones draft | `v0_requested`→architect fan-out | **[GAP W-R = E5: unwired; needs `publish_section_draft`]** |
| D4 72h admin/manager review | rfp_admin OR tenant manager (HITL) | D1 + deadline | a real HITL/TODO gate: park `projectStatus` at "review strawman," `due_at = +72h`, nudge/escalate; admin edits + accepts | release-ready | NOTIFY + `task` (the gate) | **[GAP W-S: today email-only; the deadline instance was a phantom (removed)]** |
| D5 Release (Phase 0→Phase I) | rfp_admin (HITL) | D4 complete | unlock for customer; advance gate Phase 0→I; emit ready | customer build begins | `proposal.advanced`(BUILT) + `proposal.ready_for_customer` | L2 tab: `draft`/Phase I |

### STAGE E — Staged build (projectStatus, customer-parameterized) — [PARTIAL]
The **workflow parameters** are set **at purchase** by the customer admin via the bounded
process-builder **[GAP W-K]**: choose **1–3 gates** + their **dates** (anchored
purchase→RFP→interim→close; +30 archive **[GAP W-I/W-L]**), assign **bound task primitives** to
**employees / collaborators / agents**, set **nudge/timeout**.
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| E1 Assign tasks | admin/employee (or template) | manual any time **except locked sections** | `createTask`(assignee, primitive, due, nudges) | ToDo in queue | `proposal:task.assigned` (start) | **[GAP W-K: human create]** |
| E2a Upload-named-docs | collaborator (upload-only) | task open | fill `proposal_supporting_docs`(named, required) → on upload, **satisfy task** | docs in | `supporting_doc.uploaded` → `completeTask` | **[PARTIAL W-M: upload built, not bound to task]** |
| E2b Review-section | employee/admin | task open | open section → review/modify → **accept+lock** = complete task | section locked | `section.locked`→`artifact.locked` (BUILT) | **[PARTIAL W-M: lock built, not a task]** |
| E2c Answer-question | any | task open | text answer → `result` | answered | `completeTask` | **[GAP W-M: no completer]** |
| E3 Nudge / timeout / retry | system | `due_at` / `nudge_schedule` | nudge (2nd/3rd → **CC manager**); timeout → retry or **forced-advance** | kept moving | `task.nudge` → email+login link | **[GAP W-N/O/P: dead-end signal, no CC, orphan-on-timeout bug]** |
| E4 Gate advance | admin (HITL) | all required sections locked | `advanceProposalStage` (serial, completion-gated) OR **force-advance override** (locks + documents all open sections, audited) | next phase | `proposal.advanced` (BUILT) | L2 tab locks prior stage (click-back audit) |

### STAGE F — Finalize → lock → download — [BUILT]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| F1 Final lock | admin (HITL) | advance to `final` | all artifacts locked → auto-advance `submitted`, freeze snapshots | submission-ready | `proposal.advanced`(→submitted), `artifact.locked` **[BUILT]** | L2 fully locked |
| F2 Package + download | tenant | locked | `package` export (per-artifact specs **[GAP E8.2: collapses to one DOCX]**), `download_count++` | deliverable | `package.export_started` **[BUILT]** | card: downloaded |
| F3 Outcome | tenant_admin | post-submit | record win/loss → `library_atom_outcomes`, attribution | learning + WIN flag | `outcome.recorded` **[BUILT; no notify GAP]** | card: outcome |

### STAGE G — Archive (propagates global→tenant) — [PARTIAL]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| G1 Auto-archive | system | `ScheduleTrigger` close+30 | `lifecycle_status='archived'`, `is_active=false` (global) → propagate to every tenant runtime | hidden from feeds | `finder:opportunity.archived` **[BUILT event; GAP: close+30 not automated W-I/W-L]** | all L-tabs → archived; click → "archived, contact your admin" **[GAP W-G]** |

### STAGE H — WIN → V2 contract-management portal — [GAP, net-new, same machine]
| Step | Actor | Trigger | Action | Outcome | Emits | Card |
|---|---|---|---|---|---|---|
| H1 Win → seed contract | system | `outcome.recorded(win)` | fork a **projectExecutionStatus** instance from the proposal: carry forward timelines, project plan, SOW, collaborators, artifacts already accumulated | contract portal seeded | `proposal:contract.seeded` (start→end) | **extend the card → project-execution scope** |
| H2 Staged execution | admin + collaborators + agents | same generic template | same task primitives + gates + nudges, now over **execution milestones** (deliverables, reviews, CDRLs) instead of proposal sections | managed contract | same `:start→:end` emissions | same layered card, execution tabs |

V2 reuses **the entire machine** — engine, generic template, card, task primitives, the bounded
process-builder — only the **step set + artifact types** differ (execution deliverables vs proposal
sections). The proposal build *is* the seed: by lock time the project already holds the plan, SOW,
collaborators, and artifacts H1 carries forward.

---

## 3. The card as the universal carrier
- **Layered + forward-carrying:** L0 (global: ingest, matrix, retained named docs, summary, lifecycle
  dates, global audit) → L1 (bucket: score, rationale, reference materials, pin) → L2 (project:
  copied docs, strawman, gates, tasks, lock state, project audit) → (V2: execution milestones).
  **[GAP W-E: forward-copy not persisted; origin is a live JOIN.]**
- **Tab-lock audit:** advancing a gate locks the prior tab read-only with click-back; the snapshots
  to render it exist (`stage_completion_snapshots`, `proposal_stage_history`, `canvas_versions`).
  **[GAP W-G: the tab UI is net-new; primitives BUILT.]**
- **Every transition = `:start`→`:end` carrying the card delta** — state-machine moves, step
  functions, HITL waits, uploads, reviews. **[BUILT: emit pattern; GAP: not all steps wired.]**
- **Free rollup:** `GROUP BY opportunity_id` over (opp ⋈ bucket ⋈ project ⋈ contract) = the project
  status summary, top to bottom. **[GAP W-A key + W-F view.]**

## 4. Eloquent admin rules setup (workflow parameters at purchase) — [GAP W-K/W-C]
At purchase the customer admin uses a **bounded process-builder** that ships our **well-known bound
primitives** and lets them only: pick **1–3 gates** + anchor each to a date (default: single gate =
the proposal due date; the +30 archive anchor is hidden); pick **assignees** from their user list
(employees, collaborators, accepted shadow experts, or an agent); attach a **bound primitive**
(upload-named-docs / review-section / answer-question) with **nudge + timeout**; choose **trigger =
time OR step-completion**. The result is persisted as the instance's **parameter set** (W-C) and the
generic template runs it. **Tasks can be added here OR manually at any time later — except on
previously-locked sections.**

## 5. What this requires (UI + engine), tied to the W-track
- **Engine:** `opportunity_id`+`scope` on `process_instances` (W-A) · generic `ProjectCollaboration`
  template (W-B) · parameter store (W-C) · business-event bridges incl. `purchase.completed`→project
  (W-D) · `ScheduleTrigger` + date-anchor sweeper (W-L) · human `createTask` + process-builder (W-K)
  · typed completers + HITL-as-upload (W-M) · nudge→login-email + CC-manager (W-N/O) · task
  timeout/retry fix (W-P) · pin→nudge (W-Q) · strawman E5 (W-R) · 72h HITL gate (W-S) ·
  access↔task binding + E13 (W-T).
- **UI:** the layered `opportunity-card` + Tabs primitive + tab-lock (W-G) · the oppID rollup page
  (W-F) · spotlight lock/archived states (W-G) · the bounded process-builder (W-K) · the typed task
  completers (W-M) · the "new tasks since last login" interstitial.
- **Data forks (persist the card):** `proposals.origin_card` + `source_bucket` (W-E) · lift the
  multi-proposal block (W-H) · lifecycle date cols + close+30 (W-I).

## 6. Recommended build order (each additive, zero risk to working subsystems)
**W0 keying first** (`opportunity_id`+`scope` on `process_instances` + the rollup view) → unlocks the
whole spine. Then **W1 engine** (generic template + param store + bridges + ScheduleTrigger) → **W2
local loop** (createTask + typed completers + nudge-email) → **W3 card UI** (layered tab-card +
lock-states). E5 strawman + the 72h HITL gate fold into W1/W2. V2 (Stage H) is a fast-follow once the
generic template + card exist — it is the same machine at execution scope.
