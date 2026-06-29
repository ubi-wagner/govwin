# V1 — End-to-End Automation & Workflow Engine

*As-built summary, 2026-06-29. The system organized around the **opportunity spine**
(`opp : company : spotlight/portal`), the **RFP Admin** control plane, and the two human
operators it serves — the **company customer** and the **collaborator / mentor / expert**.
Grounded in the shipped code; honest about what is live, what is parked, and what is deferred.*

---

## 0. The one idea: an immutable opportunity spine

Every artifact in the platform hangs off **one immutable key — `opportunity_id`** — as it moves
through four levels. Status lives in each domain; the spine is a **key + a reaction runtime**, not a
state machine.

```
 L0  opportunities            the master opportunity (ingested once)          scope='opp'
  │     │  opportunity_id (immutable spine key)
  ▼     ▼
 L1  tenant_pipeline_items    a customer's SPOTLIGHT/pipeline view of L0      scope='spotlight'
  │                           (per-tenant score, pin, pursue/pass)
  ▼
 L2  proposals                the build WORKSPACE (sections, compliance,       scope='project'
  │                           gates, canvas, team, partners)
  ▼
 V2  contracts                post-award EXECUTION (kickoff + delivery gates)  scope='contract'
```

- **The key:** `process_instances.opportunity_id` + `process_instances.scope`
  (`CHECK scope IN ('opp','spotlight','project','contract')`, migration 088). Every workflow
  instance — at any level — is stamped with the opportunity it serves and the level it runs at.
- **The rollup:** `v_opportunity_rollup` (mig 088, extended for contracts in mig 091) is the
  control-tower read-model — it `LEFT JOIN`s `opportunities ← tenant_pipeline_items ← proposals
  ← contracts` on `opportunity_id`, so one row shows an opportunity's whole life across portals.
  The admin opportunities page surfaces the `contracts` rollup count (V2 arc made visible).
- **Why it matters:** *any* new automation is "revectored" around this spine — you pick a scope,
  stamp the `opportunity_id`, and the same engine + the same rollup absorb it. No parallel
  machinery per feature.

---

## 1. The workflow engine (the reaction runtime)

One engine drives every automation, for all three services (frontend, pipeline, CMS all emit to the
**same `system_events` table**). Components:

### 1.1 The event bus + poll loop
- **`system_events`** is the shared spine bus. Every meaningful act emits an event
  (`namespace:type:phase`). Phases: `single`, or a `start`/`end` pair around a multi-step op.
- **`processor.py` poll loop** (`run_workflow_processor`) reads new events
  (`created_at >= watermark`, dedup set guards the boundary), and for each: (a) triggers any
  workflow whose `EventTrigger.matches()` the event, and (b) resumes any **paused HITL instance**
  whose `wait_for` matches (`match_waiting_instances`).
- **Failed-op gating (live):** a failed operation emits a terminal `end` event with its error in the
  dedicated **`error` JSONB column**. `EventTrigger.matches()` rejects any event with a truthy
  `error` on **both** paths — so a failure never spawns a junk workflow nor resumes a gate that was
  waiting on the *success* of that op. (The poll now SELECTs the `error` column and `emit_end`
  writes it, so this long-intended guard is actually armed — verified live on Postgres.)

### 1.2 Step types (what a workflow can do)
- **ACTION** — a deterministic side effect (write a row, send an email, emit an event).
- **AI_INVOKE** — hand a task to the agent fabric (see §2).
- **TODO** — a **human gate**: park the instance (`status='paused'`) and write a row to the unified
  **`tasks`** ledger (assignee role/user, due date, nudge schedule, typed completer). The human's
  action in the UI completes the task and resumes the instance.
- **HITL_WAIT** — pause until a specific event arrives (`wait_for`), with **entity correlation**
  (`_event_correlates`) so one event only wakes the gate for the *same* proposal/section/user, not
  every gate of that kind across tenants.
- **NOTIFY** — emit/notify (e.g. a completion email).

### 1.3 Park → surface → resume (the HITL spine)
```
workflow hits a TODO/HITL_WAIT
   → process_instances.status = 'paused'   +  tasks row (assignee, due, nudge, params.kind)
   → surfaces in the assignee's TaskQueue (portal dashboard AND admin dashboard)
   → human acts (Approve / Upload / Fill form / force-advance)
   → completeTask  →  forceAdvanceProcess  →  status 'paused' → 'retrying'
   → processor picks it up, merges the human decision into the step result, advances
```
- The **frontend resume path mirrors the pipeline exactly** (`lib/tasks/tasks.ts:completeTask` →
  `lib/process/force-advance.ts`), so there is exactly **one** paused→retrying transition, whether
  the human clicks in the portal, the admin dashboard, or the pipeline auto-resumes on an event.
- **Compare-and-swap safety:** the paused-deadline sweep force-fails only
  `WHERE id=$1 AND status='paused'`, so a human completing a task at the 72h boundary can't be
  clobbered back to `failed`.

### 1.4 The self-healing sweeps (cron inside the manager)
- **stuck-running** (heartbeat timeout → fail + recover), **pending-TTL** (1h), **paused-deadline**
  (abandon backstop + expire the orphaned sibling task), **task nudges** (in-app urgency +
  login-email → `/go?task=` deep-link, CC the manager), **date-anchored tasks** (J2 — generate a
  `final_due` task off a proposal deadline; expire stale W-P gates).

### 1.5 The generic reaction template + its launchers
- **`ProjectCollaboration`** (pipeline) is the one **generic, overlay-parameterized HITL template**:
  trigger `proposal:project.collaboration_requested:single` → one `collaborate` TODO gate (every
  field — task type, title, assignee, entity — resolved from the launch overlay) → `notify_done`.
  *Any* "a human must review/approve X" reaction reuses it instead of a bespoke workflow.
- **`launchProjectCollaboration`** (frontend) is the **canonical, guarded** way to start one. It
  makes the required overlay fields type-required, validates UUID shape, and stamps the spine keys
  (`opportunityId` + `scope`) — a bridge can *never* launch a corrupt/unassigned gate.
- **Bridges that fire it today:** the proposal-create route (the 72h `admin_review` gate,
  `scope='project'`) and the Stripe purchase webhook (workspace-setup gate, `scope='opp'`).
- **Manual launchers (operator-facing):** `POST /api/admin/workflows` launches *any* active
  single-phase template by overlay (e.g. the CMS content vertical via the "Generate Content" form);
  and **`POST /api/admin/workflows/launch-collaboration`** + the **"Launch Review Gate"** admin form
  let ops start a ProjectCollaboration gate **by hand** through the guarded helper — for one-off
  reviews no automatic bridge covers.

---

## 2. The AI agent workforce (`AgentFabric`) — honest status

`AgentFabric` is instantiated and **threaded into the live loops** (the managed execution path now
carries `fabric` to every `AI_INVOKE` step — a prod drop that previously silenced it is fixed). But
only one archetype runs end-to-end:

| Status | Archetype(s) | Path |
|---|---|---|
| **Live** | `color_team_reviewer` | `proposal-advance.ts` enqueues `review_section` to `agent_task_queue` (when tenant pref `ai_review_on_advance`) → `fabric.process_task_queue` → writes a recommendation to `proposal_comments`. The only complete agent path. |
| **Armed, gated** | `compliance_reviewer` | The one `AI_INVOKE` step; runs once `ANTHROPIC_API_KEY` is set (the fabric-drop fix un-blocked it). |
| **Dormant** | `section_drafter`, `proposal_architect`, `opportunity_analyst`, `scoring_strategist`, `capture_strategist`, `packaging_specialist`, `librarian`, `partner_coordinator` | Defined + registered, **no producer drives them yet**. |

- **The 3-source strawman gap:** `publish_section_draft` (the draft-landing primitive — status-gated,
  snapshots a `canvas_versions` row, emits `proposal:section.drafted`) is **shipped and tested but
  callerless**. To make AI strawman drafting real, three pieces remain: (1) a producer event /
  `agent_task_queue` row with `agent_role='section_drafter'`; (2) an invoke that calls
  `fabric.invoke_agent('section_drafter')` drafting from library atoms + tenant profile +
  RFP/compliance (the `ContextAssembler` already loads all three sources); (3) a write-back branch
  that calls `publish_section_draft`. The spine and the landing zone are in place; the drafting
  call is the open integration.
- **Product AI is live** independently of the workforce: the in-canvas Draft / Compliance / Review
  tools call Claude directly through the unified AI spend guard, with a placeholder fallback when no
  key is set.

---

## 3. RFP Admin — the control plane (`master_admin` / `rfp_admin`)

The admin runs the supply side of the marketplace and oversees the demand side.

- **Scouts (sources / ingest).** Configure sources; ingest solicitations. **Manual RFP upload**
  (`/api/admin/rfp-upload`) stores files to R2, creates the `opportunity` +
  `curated_solicitations` + `solicitation_documents` rows, extracts text, and emits
  `finder:rfp.uploaded` → the `OnRfpUploaded` workflow shreds the doc (crash-recoverable). Content
  is **deduped by hash**, race-safe (concurrent same-file upload → a clean 409, not a 500).
- **RFP Curation (triage → push).** The triage queue (workflow-parked ToDos land here, visible to
  *either* admin role). Per-solicitation: outline, **compliance presets** + apply-preset, topic
  files, and the **push** that makes an opportunity visible to customers. The detection workflow
  parks `rfp_admin` review ToDos that a `master_admin` can also clear.
- **Portal oversight.** Opportunities (with the V2 contracts rollup), proposals, tenants.
- **Applications → provisioning.** Accept an application → **race-safe** tenant + admin-user
  creation in one transaction (unique-slug allocation via `ON CONFLICT` suffix-bump; user upsert via
  `ON CONFLICT (email)`), then the welcome email.
- **Template Studio + compliance presets.** CRUD the `document_templates` (canvas preset + seed
  document) and reusable compliance preset packs — the raw material a customer's proposal is seeded
  from.
- **Workflows / Tasks.** The Workflow Monitor + Process Ledger: every instance, force-advance
  (paused-only, audited), retry, cancel; the admin **TaskQueue** (sees `rfp_admin` *and*
  `master_admin` tasks, incl. the 72h `admin_review` gate); **Generate Content** and the new
  **Launch Review Gate** manual launchers.
- **AI cost governance.** Per-tenant + platform spend caps, usage dashboards, settable budgets.

---

## 4. The company customer (`tenant_admin` / `tenant_user`)

The demand side — a small-business owner building proposals. The end-to-end loop, all on the spine:

```
Profile  →  Spotlight (see pushed opps, per-tenant score)  →  PIN / pursue  [L1 scope='spotlight']
  →  Build a proposal from the opportunity  [creates L2, scope='project']
  →  Workspace: sections on a canvas · AI Draft · edit · Compliance matrix · Accept & Lock · Advance
  →  Team & partners: invite teammates (tenant_user) and external collaborators (partner_user)
  →  Delegate work: "Assign a task" (review / upload / fill-a-form completer) → lands in a queue
  →  Submit  →  Record the WIN  →  seeds a V2 contract  [scope='contract']
```

- **Spotlight → pin** emits the spine event that can nudge the team (W-Q pin→nudge).
- **Stage gates** (`stage-control.tsx`): Advance, all-locked detection + "Force advance anyway",
  Mark Met / Unmark a gate requirement (evidence stored correctly as a jsonb object), Unlock/Re-lock.
  Optional **auto-advance** when every section is locked (tenant opt-in).
- **HITL the customer sees:** their **TaskQueue** on the dashboard (delegated tasks, nudged by the
  sweep, completed with the typed completer); the **72h admin-review gate** is cleared by the admin
  and the customer is notified to proceed.
- **Record the win** (`/outcome` route) writes the outcome and, on a win, **seeds the V2 contract**
  — the same engine continues one scope deeper (kickoff + execution gates).

## 5. The collaborator / mentor / expert (`partner_user`)

An **external university partner** invited to **one** proposal — a guest, **scoped to granted
sections** (view / comment / edit). They never see the rest of the customer's portal.

```
Invite email  →  Accept at /invite/<id> (set a 12-char password)   ← activates access
  →  Land in the proposal workspace, "My Sections" (only granted sections)
  →  EDIT a granted+unlocked+current-stage section (Save → version bumps)
  →  COMMENT on comment-granted sections
  →  VIEW view-only sections; upload to "My Dropbox" (if enabled)
```

- **Onboarding is fixed end-to-end:** a **new** collaborator's email routes to the
  `/invite/<id>` **Accept Invitation** page (records `accepted_at` → access activates; no more 404);
  an **existing** GovWin user is **auto-accepted** at invite time and emailed a direct
  "Open Proposal" link. Acceptance enforces the same 12-char password minimum as the server.
- **Hard boundaries (by design):** AI tools 403 for partners; Save on comment/view sections is
  rejected server-side; no advance/lock, no team management, no export; a non-granted proposal or
  section 404s; nav shows only Proposals (direct URLs bounce). A section completed in a prior stage
  becomes read-only (an edit grant degrades to view on it).

---

## 6. HITL launch readiness

A dedicated sweep traced every human touchpoint from pipeline parking → `tasks` ledger → mounted UI
→ wired API. **Verdict: no hard launch blockers — every HITL task a human must act on has a real,
mounted, wired resolver.** Both the items previously flagged as non-blocking are now closed:

- **Typed completers are exercised (M2).** The delegation form (`AssignTaskForm`) now lets a manager
  choose how a task completes — **Review & approve**, **Upload a file**, or **Fill a form** (with
  named fields) — setting `tasks.params.kind`; the `TaskQueue` already renders the matching
  completer. Review (the default) sends no params and stays a plain approve/dismiss.
- **Manual review-gate launcher (M3).** Ops can start a `ProjectCollaboration` gate by hand from the
  admin **Launch Review Gate** form (through the guarded helper) — no longer code-bridge-only.

---

## 7. Honest gaps / consciously deferred

- **AI strawman drafting** — the landing primitive ships callerless; needs the `section_drafter`
  invoke wired (§2). The dormant archetypes await their producers.
- **`proposals (tenant_id, opportunity_id)` uniqueness** — intentionally **not** a DB constraint
  (mig 092 documents this). A concurrent double-submit can create a duplicate draft; closing the
  race needs a product decision (may a tenant re-pursue the same opportunity after a loss?) plus a
  dedupe pass before adding a unique index. The single-request path returns a clean 409.
- **Social posting** (CMS) is stubbed (OAuth pending); **PDF export** is JSON; manual tenant create
  / waitlist are 501 stubs; Stripe billing is bypassed for the founding cohort. None are HITL or
  spine blockers.

---

*Engine, spine, and both personas are wired end-to-end. The remaining work is **feeding** the
machine (the AI drafting producers), not building more of it.*
