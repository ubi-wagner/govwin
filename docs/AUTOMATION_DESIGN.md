# Design — Automation: Namespaces → Events → Rules → Workflows → Agents → ToDos (end to end)

**Status:** design of record for the automation layer. Describes the **intended architecture** and
grounds every mechanism in the **as-built** code (`file:line`). Legend: **WIRED** (producer and
consumer both exist and run) · **PARTIAL** (runs, but via a side path, not the designed loop) ·
**⚠ DORMANT/FUTURE** (built but no producer, or not built). Companion to
`docs/MASTER_MIRROR_OPP_DESIGN.md` (the OPP→purchase→proposal spine this automation reacts to).

Verified against branch `claude/nice-hamilton-kBqtD` (migrations 001→108).

---

## 0. The one sentence

Everything reactive in the platform hangs off **one substrate — the `system_events` table; the shared
Postgres *is* the bus** (no broker). **Three runtimes** consume it: the **pipeline worker** (workflows
+ agents + the nudge sweep), the **CMS listener** (email/notify rules), and the **frontend**, which
only *emits* events and *reads* tasks — it runs no automation loop. Automation is whatever those
consumers do in response.

```
                          ┌───────────────────────────────────────────────┐
   emit (never throws)    │             system_events  (THE BUS)           │   append-only fact log
   frontend/lib/events.ts │  namespace · type · phase · payload · error …  │   (mig 007)
   pipeline/src/events.py │           shared Postgres, no broker           │
                          └───────────────┬───────────────┬───────────────┘
             poll ≤10s (created_at ≥ hw)  │               │  poll ≤10s (created_at ≥ cursor)
             namespace != 'system'        ▼               ▼  skip phase=start / error rows
                  ┌──────────────────────────────┐  ┌──────────────────────────────┐
                  │  PIPELINE worker              │  │  CMS event_listener           │
                  │  processor.run_workflow_...   │  │  _poll_loop → automation_rules│
                  │  → WorkflowManager (mig 043)  │  │  → send_email/notify/create_  │
                  │  → AgentFabric (10 archetypes)│  │     todo/publish… (§3)        │
                  │  → task nudge sweep (60s)     │  └──────────────────────────────┘
                  └──────────────┬───────────────┘
        parks TODO/HITL steps ▼  ▲ completeTask → forceAdvanceProcess (resume)
                  ┌──────────────────────────────┐
                  │  tasks ledger (mig 053)       │  ← the human "workplan": ToDos + nudges
                  │  listOpenAdminTriageTasks     │
                  └──────────────────────────────┘
```

---

## 1. The namespace contract (events)

- **Namespaces (exactly seven):** `finder` (admin), `capture` (customer), `identity` (auth only),
  `proposal` (workspace), `library` (content), `system` (infra), `tool` (invocations). **NEVER**
  `admin`, `cms`, or `spotlight` (enforced by a CHECK, `069_system_events_namespace_check.sql`).
- **Type:** `entity.action_past_tense` (snake_case). **Phase:** `start` | `end` | `single`.
- **Tenant scoping:** admin events `tenant_id = NULL`; portal events `tenant_id =` the tenant UUID.
- **Emit API — best-effort, never throws** (a failed emit must never break the request):
  - Frontend `frontend/lib/events.ts`: `emitEventStart` (`:110`) → `emitEventEnd` (`:149`, links via
    `parent_event_id`, computes `duration_ms`) and `emitEventSingle` (`:220`). jsonb written via
    `sql.json` (`:32`) — never a string scalar (that would break `payload->>` consumers). Actor
    helpers `:75-89`.
  - Pipeline `pipeline/src/events.py`: `emit_event`/`emit_start`/`emit_end` (`:20/:70/:93`); a failure
    populates the dedicated **`error` jsonb column** (`:39`), which is the failed-op gate below.
- **Table** `system_events` (`007`; jsonb hardening in `103`/`104`): `id, namespace, type, phase,
  actor_type/id/email, tenant_id, parent_event_id, payload, error, duration_ms, created_at`.

---

## 2. The bus & dispatch — how an event reaches a consumer

No message queue. Both consumers **poll** `system_events` on a time high-water mark.

**Pipeline (workflows)** — `pipeline/src/workflows/processor.py::run_workflow_processor` (`:755`):
- Every ~10s: `SELECT … WHERE created_at >= $hw AND namespace != 'system' ORDER BY created_at LIMIT 100`
  (`:815`). The `namespace != 'system'` guard stops it re-triggering on its own `system:*` output.
- **High-water** is in-memory (`last_processed_at`, seeded at boot to `MAX(created_at) − 5min`, `:807`)
  — **there is no cursor table.** Second dedup: an in-memory `_processed_event_ids` set (`base.py:95`,
  capped 50k).
- **Match:** `get_workflow_for_event` (`base.py:231`) keys the registry by `"{ns}:{type}:{phase}"` and
  runs `EventTrigger.matches` (`base.py:64`) — ns+type+phase equality plus an optional `condition(payload)`
  lambda. **A row with `error` set never matches** (`base.py:68`).

**CMS (rules)** — `services/cms/src/event_listener.py::_poll_loop` (`:71`), independent, every ~10s:
- `_process_new_events` reads `WHERE created_at >= _last_processed_at … LIMIT 50` (`:137`); cursor is
  in-memory (`:23`), cold-start = last 5 min. Skips `phase='start'` and any `error` row; special-cases
  `system:notification.requested` → email; everything else → `automation_rules` (§3).

**Idempotency at scale:** because both high-water marks are in-memory, a consumer restart replays the
last ~5 minutes. That is safe because dedup is layered downstream: `process_instances` UNIQUE (§4),
the pipeline's in-memory id set, and the CMS `automation_log` 5-minute `(trigger_event_id, action_type)`
window (`event_listener.py:427`). **⚠** a durable events cursor is a scale hardening item, not built.

---

## 3. Automation rules — the CMS reactive layer (email / notify / todo)

The lightweight side: single-event → single-action, no multi-step state.

- **Schema** `automation_rules` (`019_automation_and_content.sql:2`): `trigger_namespace, trigger_type,
  action_type, action_config jsonb, is_active`, optional `trigger_phase`. `action_type` CHECK started as
  `send_email | notify_admin | webhook | update_status` (`:9`) and was widened by `028/040/050` to add
  `create_todo, distribute_social, publish_content, unpublish_content, enroll_drip, log_only`. (Legacy
  `trigger_bus/trigger_events` columns were dropped in `068`.) Exec audit = `automation_log` (`:41`).
- **Match** `_rule_matches` (`event_listener.py:196`): schema-adaptive, **phase-aware — fires on the
  terminal phase only, never `start`**. Tenant-preference gate `_automation_pref_allows` (`:282`).
- **Execute** `_execute_rule` → `_do_action` (`:1078`): dispatch by `action_type` — `send_email`
  (`:1126`, template render + recipient resolve + collaborator fan-out), `notify_admin` (`:1232` →
  `ADMIN_NOTIFICATION_EMAIL`), `create_todo` (`:747` → CMS `admin_todos`), etc. Each action emits
  `system:action.{type}` and dedups via the 5-min `automation_log` window.
- **Seeded rules** (idempotent `ON CONFLICT (name)`): identity welcome/reject (`019`); `028` —
  `capture:application.accepted→send_email`, `proposal:proposal.created→send_email`,
  `finder:rfp.uploaded→notify_admin`, `finder:source.change_detected→notify_admin`,
  `proposal:proposal.advanced→send_email`, `capture:topic.pinned→notify_admin`; `040` create_todo rules;
  `050` CMS publish bridge; `078` document-locked / advance-ready collaborator emails;
  **`106` — `capture:purchase.completed → notify_admin`** ("Purchase needs curation", closes the
  silent-purchase gap). **WIRED.**

---

## 4. The workflow engine — the pipeline reactive layer (multi-step + HITL)

The heavy side: durable, multi-step, human-in-the-loop `process_instances`.

- **Schema** `process_instances` (`043`): `status ∈ pending|running|paused|completed|failed|cancelled|
  retrying`, `step_results/step_status jsonb`, `deadline`, `retry_count/max_retries`, `source ∈
  (pipeline,cms)`; spine keys `opportunity_id` + `scope ∈ (opp,spotlight,project,contract)` (`088`).
  **Dedup:** partial UNIQUE `(workflow_name, trigger_event_id)` (`:57`), restated in the
  `ON CONFLICT DO NOTHING` of `create_instance` (`manager.py:198`). Audit trail =
  `process_instance_transitions` (`manager._record_transition:1892`).
- **Managed vs fire-and-forget:** `processor.py:786` checks for the `process_instances` table; present
  (prod, mig 043) → `WorkflowManager` with a pool, crash recovery, and HITL. `process_templates`
  (`054`) is the per-workflow on/off switch — `sync_template_catalog` (`manager.py:271`) reflects the
  discovered `.py` workflows into it; inactive templates refuse to instantiate.
- **Registry:** `base.py` `_registry` keyed by `ns:type:phase`; `discover_workflows` (`:272`)
  auto-imports every `workflows.*` module at boot. **Step types** (`base.py:84`): `ACTION, API_CALL,
  AI_INVOKE, HITL_WAIT, NOTIFY, CONDITION, TODO`.

### The 12 registered workflows (all WIRED)

| Workflow | Trigger (`ns:type:phase` + cond) | Steps | 
|---|---|---|
| **OnProposalCreated** (`on_proposal_created.py`) | `proposal:proposal.created:end` · `proposalId` | `draft_sections` ACTION → `draft_v0`; then `notify_admin_review` |
| **ProjectCollaboration** (`project_collaboration.py`) | `proposal:project.collaboration_requested:single` · `proposalId ∨ opportunityId` | `collaborate` **TODO** (parks the gate) → `notify_done` |
| **OnProposalAdvancedToReview** (`on_proposal_advanced.py`) | `proposal:proposal.advanced:end` · `targetStage=review` | AI_INVOKE `check_compliance` (compliance_reviewer) → `notify_reviewers` → `wait_for_review` **TODO** |
| **OnProposalAdvancedToFinal** (`on_proposal_advanced.py`) | `proposal:proposal.advanced:end` · `targetStage=final` | `generate_export_preview` ACTION → `notify_all_collaborators` |
| **OnOpportunitiesDetected** (`on_opportunities_detected.py`) | `finder:opportunities.detected:single` | NOTIFY + **TODO** `triage_new_opportunities` |
| **OnSourceChangeDetected** (`on_source_change_detected.py`) | `finder:source.change_detected:single` | ACTION + NOTIFY + **TODO** `source_review` |
| **OnCmsContentRequested** (`on_cms_content_requested.py`) | `library:content.requested:single` | ACTION + **TODO** `content_publish` + NOTIFY |
| **OnRfpUploaded** (`on_rfp_uploaded.py`) | `finder:rfp.uploaded:end` | NOTIFY |
| **OnSolicitationPushed** (`on_solicitation_pushed.py`) | `finder:solicitation.pushed:single` | NOTIFY |
| **OnProposalSectionEdited** (`on_proposal_section_edited.py`) | `proposal:section.saved:single` | ACTION (diff analyze) |
| **OnProposalOutcomeRecorded** (`on_proposal_outcome_recorded.py`) | `proposal:outcome.recorded:end` | ACTION (outcome attribution / learning) |
| **OnApplicationAccepted** (`on_application_accepted.py`) | `capture:application.accepted:end` | **HITL_WAIT** (`wait_for identity:user.logged_in`) |

### HITL pause / resume — WIRED
- A `TODO` / `HITL_WAIT` step sets `status='paused'`, `deadline = now()+parkMinutes`, records a
  transition, and (TODO) calls `_create_task` (`manager.py:519,539`).
- **Resume by entity correlation:** `match_waiting_instances` (`:1330`) — on the same poll pass, a paused
  instance whose `wait_for` trigger matches the new event *and* whose entity binding correlates flips
  `paused→retrying`; `poll_retrying_instances` (`:1418`) re-drives it. A completed **task** resumes its
  instance via the frontend: `completeTask` → `forceAdvanceProcess`.
- **Compare-and-swap:** every paused-state transition (deadline reaper, `resume_instance`,
  `cancel_instance`) is guarded `… WHERE id=$1 AND status='paused'` — a human resume in the
  SELECT→UPDATE window makes it a 0-row no-op, so automation never clobbers finished human work.

---

## 5. The agent fabric — the AI execution layer

- `AgentFabric` (`fabric.py:137`) registers **10 archetypes** (`_ARCHETYPE_CLASSES:78`,
  `archetypes/__init__.py`) at pipeline boot. **Two live entry points:** `invoke_agent(...)` (`:261`,
  direct — called by workflow AI_INVOKE steps and `draft_v0`) and `process_task_queue` (`:697`, the
  `agent_task_queue` consumer). **`handle_event` (`:183`) has NO caller** (confirmed repo-wide) — so the
  archetypes' self-declared `handles_event` routing is **inert**, which is *the* reason most archetypes
  are unreachable.

| Archetype | Producer that actually fires it | Status |
|---|---|---|
| **section_drafter** | `draft_v0.py:157` direct-invoke (batch V0) **and** `proposal-draft-section.ts:389` `requestAgentTask` (interactive) → `process_task_queue`; chain `section_drafter → markdown_to_canvas → publish_section_draft` | **WIRED** |
| **compliance_reviewer** | Primary path runs **inline in the frontend** `ai/compliance/route.ts` (Anthropic SDK direct, billed `:510`); the fabric AI_INVOKE `check_compliance` in OnProposalAdvancedToReview is advisory-only | **PARTIAL** |
| **color_team_reviewer** | Only via `proposal-advance.ts:439` `requestAgentTask` (gated by `tenant_automation_preferences.ai_review_on_advance`, default-on) → `process_task_queue` → `_post_section_recommendation`; its `proposal.review_requested` handler is dead (needs `handle_event`) | **PARTIAL** |
| capture_strategist · opportunity_analyst · scoring_strategist · packaging_specialist · librarian · partner_coordinator · proposal_architect | Mapped in `TOOL_ACTION_TO_ARCHETYPE` (`processor.py:219`) but **no workflow emits their AI_INVOKE and nothing enqueues them**; handlers depend on the dead `handle_event` | **⚠ DORMANT (×7)** |

**Net: 1 WIRED, 2 PARTIAL, 7 DORMANT** — only one AI_INVOKE step exists (`check_compliance`) and only
two roles are ever enqueued (`section_drafter`, `color_team_reviewer`).

- **Queue/logs/memory:** `agent_task_queue` (`001:588`) — producer `requestAgentTask`
  (`agent-client.ts:12`), consumer `main.py::run_agent_task_consumer` → `process_task_queue` claims 5
  with `FOR UPDATE SKIP LOCKED`. `agent_task_log` (`001:565`) is per-call billing/audit (budget +
  rate guards `fabric._check_budget:971`/`_check_rate_limit:923`). Memory tables `episodic_/semantic_/
  procedural_memories` are RLS-`FORCE` (`001:885`); `lifecycle_scheduler.py` runs memory
  GC/decay/compaction **only** (not nudges).

---

## 6. The ToDo / nudge workplan — the human-in-the-loop layer

The "workplan" the founding cohort runs against (manual/shadow-assisted today; see §9).

- **Ledger** `tasks` (`053`): `tenant_id (NULL=admin), assignee_role, assignee_user_id, task_type (e.g.
  'proposal_setup'/'proposal_review'/'source_review'/'triage_new_opportunities'), title, entity_type/id,
  process_instance_id, step_name, status ∈ (open|in_progress|completed|cancelled|expired), due_at,
  nudge_schedule jsonb, nudges_sent jsonb`.
- **Writers:** `manager._create_task` (`:828`, on a parked TODO step, resolves every field from the
  instance overlay, emits `system:task.created`) and frontend `createTask` (`tasks.ts:138`, human
  delegation).
- **`launchProjectCollaboration`** (`frontend/lib/process/project-collaboration.ts:59`) — the bridge from
  a request into a parked workflow + task: emits `proposal:project.collaboration_requested`, **default
  `nudgeDays=[1,3]`, `dueMinutes=4320` (72h)** (`:111`). **Producers:** the proposals-create route,
  the Stripe webhook, **the comp-code purchase route** (`purchase/route.ts:146` — the 72h
  `proposal_setup` curation gate), the outcome route, and the admin manual launcher.

### Do nudges actually fire? → **YES, WIRED (in-process, no external cron)**
- `manager._sweep_task_nudges` (`manager.py:1000`) runs **every 60s** inside `_stuck_detection_loop`
  (`:1560`), launched at `manager.start()` (`:125`). It scans open/in-progress tasks with a `due_at` and
  a non-empty `nudge_schedule`; for each crossed `days_before` threshold not already in `nudges_sent` it
  emits **`system:task.nudge`** (in-app) + **`system:notification.requested` template `task_nudge`**
  (email push), idempotently marking `nudges_sent`. The email leg fires only for **user-assigned** tasks
  and only when `PORTAL_BASE_URL`/`NEXTAUTH_URL` is set (else in-app only); the final threshold escalates
  a `task_nudge_manager` email to the tenant_admin.
- The same loop runs `_sweep_date_anchored_tasks` (~hourly, generates deadline tasks + expires past-due)
  and the paused-instance deadline reaper (§4).
- **Surfacing:** `listOpenAdminTriageTasks` (`tasks.ts:109`) is the shared admin queue (any `rfp_admin`/
  `master_admin`, plus the tenant-scoped `proposal_setup` exception). The in-app `system:task.nudge`
  event has **no rule consumer** — the customer-visible surface is the `tasks` table (read by `due_at`)
  plus the email push.

---

## 7. End-to-end traces

**(a) A purchase.** `capture:purchase.completed` →
- CMS: the `106` rule → `notify_admin` email ("Purchase needs curation").
- Frontend (in the same purchase tx): `launchProjectCollaboration` → a paused **ProjectCollaboration**
  instance + a `proposal_setup` **task** (assignee `rfp_admin`, 72h, nudgeDays `[1,3]`).
- `listOpenAdminTriageTasks` surfaces it → admin resolves → `completeTask` → `forceAdvanceProcess`
  resumes the instance. If unresolved, the sweep nudges at day 1 and day 3.

**(b) Provision / release → V0.** `proposal:proposal.created:end` → pipeline **OnProposalCreated** →
`draft_v0` (`section_drafter → markdown_to_canvas → publish_section_draft`) fills the empty sections →
`notify_admin_review`. Result: the **V0** strawman, auto-drafted.

**(c) Advance to review.** `proposal:proposal.advanced:end` (`targetStage=review`) →
**OnProposalAdvancedToReview** → AI_INVOKE `check_compliance` (compliance_reviewer, advisory) →
`notify_reviewers` → parks a `wait_for_review` **TODO** until the proposal advances back.

**(d) Advance to final.** same event, `targetStage=final` → **OnProposalAdvancedToFinal** → export
preview + notify all collaborators.

**(e) Edit / lock.** `proposal:section.saved` → **OnProposalSectionEdited** (diff analyze); a section
**lock** advances the compliance matrix toward `satisfied` (frontend lock route).

---

## 8. Event type registry (by namespace — what drives automation)

| Namespace | Types (★ = has an automation consumer today) | Consumer |
|---|---|---|
| `finder` | `opportunities.detected`★, `source.change_detected`★, `rfp.uploaded`★, `solicitation.pushed`★ | workflows + rules |
| `capture` | `application.submitted`★, `application.accepted`★, `purchase.completed`★, `workspace.released`, `topic.pinned`★, `tenant.cards_backfilled` | rules + workflows |
| `identity` | `user.logged_in`★ | resumes OnApplicationAccepted |
| `proposal` | `proposal.created`★, `proposal.advanced`★, `section.saved`★, `document.locked`★, `outcome.recorded`★, `ready_for_customer`, `review_requested` (no live consumer), `project.collaboration_requested`★, `task.assigned` | workflows + rules |
| `library` | `content.requested`★ | OnCmsContentRequested |
| `system` | `notification.requested`★ (→ email), `task.created`, `task.nudge`, `action.*`, `workflow.wait_timed_out` | CMS email / audit |
| `tool` | `invoke.*` | audit/billing only |
| *(system ns)* | `content.document_archived`, `content.document_restored` (postings retire/restore) | audit + ISR revalidate |

---

## 9. Gap register (⚠ future / systemic)

1. **`fabric.handle_event` has no caller → 8/10 archetypes unreachable.** The single biggest automation
   gap: the event-routing design that would let archetypes react to events is inert; 7 archetypes are
   fully dormant and `color_team_reviewer`'s event path is dead (it survives only via the
   advance→queue side path).
2. **No autonomous V0→V0.5→V1 driver.** `advanceProposalStage` (frontend) is the **sole** stage
   authority and is **human-driven**; every workflow *reads, never writes* the stage. Automation reacts
   *around* the build (auto-draft V0, park review ToDos, notify, nudge) but does not *drive* it — the
   full customer-facing workplan automation is future (see `MASTER_MIRROR_OPP_DESIGN.md §6`).
3. **Nudge email requires `PORTAL_BASE_URL`/`NEXTAUTH_URL`;** the in-app `system:task.nudge` has no rule
   consumer (the `tasks` table is the surface). Per-workflow reminder steps (`send_review_reminder`) are
   **not** implemented — escalation relies on the generic `nudge_schedule` sweep.
4. **In-memory event high-water (no cursor table)** → a consumer restart replays ~5 min (safe via dedup,
   but a durable cursor is a scale hardening item).
5. **Intersecting OPP-spine gaps** (from `MASTER_MIRROR_OPP_DESIGN.md §9`): the "proposal-ready" nudge to
   mirror cards, the buyer/outcome ledger, and the EconDev appointed-shadow automation are not built.

---

## 10. As-built reference

| Mechanism | Where | Ref |
|---|---|---|
| Event emit (FE / py) | `lib/events.ts` / `pipeline/src/events.py` | `events.ts:110`, `events.py:20` |
| The bus | `system_events` | mig `007` |
| Pipeline dispatch | `run_workflow_processor` | `processor.py:755` |
| CMS dispatch | `_poll_loop` | `event_listener.py:71` |
| Automation rules | `automation_rules` / `_execute_rule` | mig `019`, `event_listener.py:312` |
| Workflow instances | `process_instances` / `WorkflowManager` | mig `043`, `manager.py` |
| Workflow registry | `discover_workflows` / `_registry` | `base.py:216,272` |
| HITL resume | `match_waiting_instances` | `manager.py:1330` |
| Agent fabric | `AgentFabric` / `invoke_agent` / `process_task_queue` | `fabric.py:137,261,697` |
| Agent queue | `agent_task_queue` / `requestAgentTask` | mig `001:588`, `agent-client.ts:12` |
| Task ledger | `tasks` / `_create_task` / `createTask` | mig `053`, `manager.py:828`, `tasks.ts:138` |
| Launch collab | `launchProjectCollaboration` | `project-collaboration.ts:59` |
| Nudge sweep | `_sweep_task_nudges` (60s in stuck-detection loop) | `manager.py:1000,1560` |
| Admin triage | `listOpenAdminTriageTasks` | `tasks.ts:109` |

---

## 11. Operational note (matters for HITL / testing)

Automation needs its **runtimes up**: the **pipeline worker** (`pipeline/src/main.py` — workflows,
agents, the 60s nudge sweep) and the **CMS listener** (`services/cms/src/event_listener.py` — email/
notify rules, needs the mail creds). The **frontend alone runs no automation** — it only emits events
and reads the `tasks` table. So in a frontend-only stack, events post and ToDos are readable, but
workflows don't instantiate, agents don't draft, and nudges don't fire. This is the same
"boot the pipeline worker + CMS listener" prerequisite the HITL runbooks call out.
