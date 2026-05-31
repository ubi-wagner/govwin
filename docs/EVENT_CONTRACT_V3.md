# EVENT_CONTRACT_V3.md — Forward Design: Closed-Loop Events, Jobs & Process Templates

**Date:** 2026-05-31
**Status:** Forward design (target architecture). Supersedes the *design* sections of
EVENT_CONTRACT.md. Does **not** supersede EVENT_CONTRACT_V2.md — that remains the
authoritative **as-built catalog** of every event currently emitted. V3 describes where
we are taking the system; V2 describes what is wired today. Read V2 for "what fires now,"
read V3 for "how we compose it going forward."

**Companion docs:** CLAUDE.md (binding standards), CLAUDE_CLIFFNOTES.md §3 (event namespace
rules), ARCHITECTURE_V6.md §4 (event-driven architecture), EVENT_CONTRACT_V2.md (as-built
event catalog).

---

## 0. Why this document exists

The platform has accumulated **three overlapping automation mechanisms**:

1. The **process engine** in `pipeline/src/workflows/` (7 definitions, `process_instances`
   ledger) — defined, not yet wired to the main loop.
2. **`automation_rules`** matched by the CMS `event_listener` — wired, single-hop
   `event → action`.
3. **`pipeline_jobs`** consumed by the dispatcher (LISTEN/NOTIFY) — wired, queue-based.

They all react to the same `system_events` bus but use different vocabulary, different
state models, and different reliability guarantees. This document unifies them onto **one
substrate** with **one vocabulary**, so that:

- Discrete actions become **rock-solid, independently testable Jobs**.
- Jobs are **composed by reference** into **Process Templates** (e.g. "Proposal Build").
- The connective tissue is **events, not function calls** — every Job posts its outcome
  to the event journal; the next Job is triggered by that posting. This keeps the system
  **open-ended**: a future template, automation rule, or agent can subscribe to any
  posted outcome without the emitting Job knowing who is downstream.

**Founding principle:** *reliability lives in the Job; the template is just deterministic
wiring.* A Job earns its place in a template by passing its golden tests in isolation.
Once trusted, every template that cites it inherits that trust.

---

## 1. Vocabulary (canonical)

The word "workflow" is **retired** as a design term. The replacement set matches the
table names already shipped (`process_instances`, `process_instance_transitions`) and the
BPMN/Camunda convention.

| Term | Definition | Industry equivalent | Code today |
|------|-----------|---------------------|------------|
| **Job** | One discrete, independently testable action: an API call, an agent tool-use, a HITL button-push, a NOTIFY, a pure data transform. Has a typed input, typed output, an idempotency key, and posts its own start/end events. | Temporal *Activity*, Airflow *Task*, Dagster *Op*, Step Functions *Task* | `Step` (`base.py`), `workflows/actions/*.py`, tool-registry tools |
| **Process Template** | A declarative composition that **cites Jobs by reference** and binds them with ordering, gates, and event triggers. Contains **no business logic** — only wiring. | BPMN *Process Definition*, Temporal *Workflow*, Airflow *DAG* | `Workflow` subclass (`base.py`) |
| **Process Instance** | One running execution of a Process Template, with durable state (current step, results, status, deadline). | BPMN *Process Instance*, Temporal *Workflow Execution* | `process_instances` row |
| **Binding kind** | *How* a Job is invoked from within a template (action / api_call / ai_invoke / hitl_wait / notify / condition). Not a different thing — a Job, plus its invocation strategy. | Operator type / State type | `StepType` enum (`base.py`) |

> **Migration note.** Existing class names (`Workflow`, `OnRfpUploaded`, the `workflows/`
> package) are **not** renamed in this document. Renaming load-bearing code is a separate,
> opt-in task (see §11). In prose and new code comments, use **Process Template** and
> **Job**. When referring to the existing Python base class specifically, `Workflow` is
> still its class name.

---

## 2. The three-layer ledger (forward-posting model)

The mental model is **double-entry accounting**. A Job never calls the next Job; it
**posts** an outcome to an append-only journal, and the processor reads the journal
*forward* to drive the next step.

```
system_events                 = THE JOURNAL
                                Append-only. Every Job posts its start/end (or single)
                                here, stamped with correlationId + processInstanceId.
                                Nothing is ever updated or deleted.

process_instances             = THE LEDGER
                                The running state ("balance") of one Process Instance:
                                current_step, step_results, status, deadline, retries.
                                Updated as the instance advances.

process_instance_transitions  = THE POSTING LOG
                                One row per state change (the audit trail): from_status →
                                to_status, step_name, actor, reason, affected entity +
                                content version before/after.
```

### 2.1 The forward-posting loop

```
   ┌─────────────┐   posts outcome    ┌──────────────────┐
   │   Job A     │ ─────────────────► │  system_events   │  (JOURNAL, append-only)
   └─────────────┘   event:end        │  + correlationId │
                                       │  + procInstanceId│
                                       └────────┬─────────┘
                                                │ processor reads forward
                                                ▼
                                       ┌──────────────────┐
                                       │  match outcome    │
                                       │  to next trigger  │
                                       │  in template      │
                                       └────────┬─────────┘
                          updates ledger        │ resolves inputs from journal
                          + writes posting log   ▼
                                       ┌─────────────┐  posts outcome   ┌────────────┐
                                       │   Job B     │ ───────────────► │ journal …  │
                                       └─────────────┘                  └────────────┘

           trigger → event → Job → outcome event → trigger → event → Job → …
```

**Why "forward posting" matters:** because Job A only posts an event — it does not name
Job B — any number of consumers can bind to that posting:

- the **Process Template** that owns the instance (advances to Job B),
- a standalone **automation rule** (e.g. "also email the admin"),
- a future **agent** subscribing for learning,
- a **new template** added months later.

None of them require changing Job A. That is the entire point of choreography over
orchestration: **the emitter is decoupled from all downstream consumers.**

### 2.2 What is choreography vs. what needs a ledger

Pure event choreography is blind to two things this product genuinely has, so we keep a
**thin saga ledger** (`process_instances`) alongside the bus:

| Need | Why the bare bus can't do it | Ledger answer |
|------|------------------------------|---------------|
| **HITL waits** | "Parked waiting for an admin to approve" is inherently stateful | Instance row in `status='paused'`, resumed when the awaited event posts |
| **Stuck detection / visibility** | "Where is Proposal X, and did step 3 ever fire?" can't be answered from an append-only stream | `current_step`, `deadline`, `last_heartbeat_at` on the instance |
| **Idempotent advance** | The same event may be re-polled | `UNIQUE(workflow_name, trigger_event_id)` + dedup |

So: **choreography on the bus, correlation in the ledger.** Neither alone is sufficient.

---

## 3. The Job Contract

A Job is "rock-solid" when it provably obeys this contract. This is what lets a template
trust it by reference.

```
CONTRACT (every Job MUST):
  1. TYPED INPUT     Accept a single typed input dict. No reading hidden globals,
                     no implicit "current request" state.
  2. TYPED OUTPUT    Return a single typed output dict. Serializable to JSONB
                     (lands in process_instances.step_results).
  3. IDEMPOTENT      Carry an idempotency key (usually the entity id + step name).
                     Re-running with the same key is a no-op or a safe upsert.
                     ── Example today: OnRfpUploaded.shred checks whether ai_extracted
                        already exists for the solicitation and skips re-processing.
  4. POSTS EVENTS    Emit its own start/end (multi-step) or single (atomic) to
                     system_events, stamped with correlationId + processInstanceId.
                     ── Example today: the tool registry auto-emits tool:invoke.start
                        and tool:invoke.end around every invoke().
  5. NO SIDE CHANNEL Communicate results ONLY via return value + posted events.
                     Never reach forward to call the next Job directly.
  6. BOUNDED         Declare a timeout and a retry policy. Fail loud (raise), never
                     silently swallow.
```

### 3.1 A Job satisfying the contract is composable *by definition*

If inputs are typed, outputs are serializable, the action is idempotent, and the only
outward communication is the return value + posted events, then **any** template can cite
it in **any** order without surprises. Composability is not an extra feature — it falls
out of the contract.

### 3.2 Golden-test harness (how "rock-solid" becomes mechanical)

"Trusted over iterative testing" must mean *a passing test file*, not a feeling. Every
Job ships a golden test:

```
fixture(input)  ──►  job(input)  ──►  assert output == golden_output
                                 └──►  assert emitted_events == golden_events
```

- Lives under `pipeline/tests/jobs/test_<job>.py`.
- Asserts **both** the returned output **and** the events posted (the journal entries).
- External services (Claude, Gmail, Stripe, SAM.gov) are stubbed with canned responses;
  **internal code is never mocked** (per TESTING_STRATEGY.md).
- **Gate:** a Job may not be cited by a Process Template until its golden test is green
  in CI. This is the concrete bridge between "iterate until trusted" and "safe to compose."

---

## 4. Binding kinds (the existing StepType, reframed)

A Job is invoked from a template through one of six **binding kinds** — these already
exist as `StepType` in `base.py`. They describe *how* the Job runs, not *what* it is.

| Binding kind | Meaning | Actor | Status in `processor.py` |
|--------------|---------|-------|--------------------------|
| `ACTION` | Call a local `module.function` Job | system/pipeline | ✅ executes |
| `API_CALL` | Call a Job over HTTP | system | ✅ executes |
| `AI_INVOKE` | Call Claude via the tool registry | agent | ⚠️ V1: skipped if not locally resolvable |
| `NOTIFY` | Post a `system:notification.requested` event (email/notification Job) | system | ✅ emits event |
| `HITL_WAIT` | Park the instance until a human-driven event posts | user | ⚠️ V1: skipped (see §6) |
| `CONDITION` | Branch on payload data | n/a | ✅ evaluates |

The key reframe: `NOTIFY` and `AI_INVOKE` aren't special — they're Jobs whose binding kind
says "post a notification event" or "invoke through the tool registry." All six ultimately
**post outcomes to the journal**.

---

## 5. Code organization — two axes

These are **different axes**, and naming them separately is what makes reuse work.

### 5.1 Job modules — organized by **domain / capability**

The reusable Job library. All Jobs of one domain live together so they harden together.

```
pipeline/src/jobs/                  (target home; today these live in workflows/actions/)
  shred_jobs.py        # shred, extract_compliance        (← workflows/actions/shred.py)
  scoring_jobs.py      # score_tenants                     (← actions/score_tenants.py)
  scout_jobs.py        # create_drafts_from_scout          (← actions/create_drafts_from_scout.py)
  library_jobs.py      # create_library_defaults           (← actions/create_library_defaults.py)
  export_jobs.py       # generate_preview, docx/pptx/xlsx  (← actions/generate_preview.py)
  cms_jobs.py          # publish_content, revalidate_isr, submit/approve/reject page blocks
  notify_jobs.py       # send_email, notify_admin
  proposal_jobs.py     # provision_sections, draft_section, ai_review, advance_stage
```

Each file is **well-named, well-commented, segmented by domain**, and every Job in it has
a golden test. This is the "all CMS-related jobs in one file" idea: `cms_jobs.py` is the
hardened home of every content-pipeline Job.

### 5.2 Process Templates — organized by **business outcome**

A template composes Jobs **across** domain modules. It reaches into many job modules; it
does not own them.

```
pipeline/src/process_templates/     (target home; today these live in workflows/)
  rfp_intake.py          # cites shred_jobs + notify_jobs
  proposal_build.py      # cites proposal_jobs + scoring_jobs + export_jobs + notify_jobs
  customer_onboarding.py # cites library_jobs + notify_jobs
  content_pipeline.py    # cites cms_jobs + notify_jobs
  source_monitor.py      # cites scout_jobs + notify_jobs
```

> **Correction to a natural assumption:** "Proposal Build" does **not** pull from
> `cms_jobs.py`. It cites shred/scoring/draft/export/notify Jobs. `cms_jobs.py` is cited
> by the *content pipeline* template. The whole reason for two axes is that a template
> reaches **across** job modules — that is what keeps Jobs reusable instead of welded to
> one flow.

---

## 6. HITL gates as parked instances

A Human-in-the-Loop gate is just a Job whose binding kind is `HITL_WAIT`: the instance
**parks** (`status='paused'`) and resumes when the awaited event posts to the journal.

```
   Job: advance_to_review  ──posts──►  proposal:proposal.advanced (review)
                                              │
                                              ▼
   HITL_WAIT: await reviewer action     instance → status='paused'
                                        wait_for = EventTrigger(proposal, review.decided, single)
                                              │
                 (admin clicks Approve/Reject in the UI)
                                              ▼
   UI route posts proposal:review.decided  ──►  journal
                                              │ processor matches wait_for
                                              ▼
   instance → status='running', resumes at next Job
```

- The pause is **durable** (survives a pipeline restart — that's why it's in the ledger,
  not in memory).
- A `deadline` on the instance enables timeout → escalation (a Job bound to `on_timeout`).
- **Status today:** `HITL_WAIT` is recognized but **skipped** in `processor.py` (V1). The
  resume machinery (`status='retrying'`/`'paused'` polling) is partially present in
  `run_workflow_processor`. Wiring this is part of the processor work in §10.

---

## 7. Worked example — "Proposal Build" Process Template

This is the canonical composition. It cites Jobs **by reference** across four domain
modules, binds them with events, and parks at HITL gates. Stages follow the canonical
machine `draft → review → final → submitted → archived` (per ARCHITECTURE_V6 §9.1).

```
PROCESS TEMPLATE: proposal_build
TRIGGER: capture:purchase.completed:single   (or proposal:proposal.created:end for bypass)

  ┌────────────────────────────────────────────────────────────────────────┐
  │ Job (module.function)            Binding     Posts outcome event         │
  ├────────────────────────────────────────────────────────────────────────┤
  │ 1 proposal_jobs.provision        ACTION      proposal.created:end        │
  │     (sections from volume_required_items, compliance freeze)             │
  │ 2 proposal_jobs.draft_section    AI_INVOKE    proposal.section.drafted   │  (per section)
  │     (Claude via tool registry; library + RFP + compliance context)       │
  │ 3 notify_jobs.workspace_ready    NOTIFY       notification.requested      │
  │ 4 ── HITL_WAIT: customer edits + advances ──► proposal.advanced(review)   │  ← parks
  │ 5 proposal_jobs.ai_review        AI_INVOKE    proposal.reviewed           │  (pink team)
  │ 6 ── HITL_WAIT: reviewer signs off ──────────► proposal.advanced(final)   │  ← parks
  │ 7 export_jobs.generate_preview   ACTION       proposal.preview_ready      │
  │ 8 notify_jobs.final_ready        NOTIFY       notification.requested      │
  │ 9 ── HITL_WAIT: submit ──────────────────────► proposal.advanced(submitted)│ ← parks
  │10 proposal_jobs.record_outcome   ACTION       outcome.recorded            │  (→ archived)
  └────────────────────────────────────────────────────────────────────────┘
```

Every numbered Job is independently golden-tested in its domain module. The template adds
no logic — only ordering, binding kinds, and the events it waits on. Swapping the scoring
algorithm, the draft prompt, or the export format changes a **Job** (and its golden test),
never this template.

---

## 8. Guardrails (required before any template is trusted in production)

| Guardrail | Mechanism | Status |
|-----------|-----------|--------|
| **Idempotent advance** | `UNIQUE(workflow_name, trigger_event_id)` on `process_instances`; processor `_track_processed()` dedup | ✅ schema + processor |
| **Action-level dedup** | `automation_log` 5-minute window per `(trigger_event_id, action_type)` | ✅ in CMS listener |
| **Loop / depth protection** | Cap chain depth per `correlationId`; refuse to spawn an instance whose trigger event was itself posted by the same instance | ⚠️ **to add** |
| **Stuck detection** | `deadline` + `last_heartbeat_at` on instance; sweeper marks overdue instances `failed`/`retrying` | ⚠️ partial (columns exist) |
| **Poison-event isolation** | Per-event try/catch; one bad event never blocks the poll cycle | ✅ pattern in CMS listener |
| **Replay safety** | Journal is append-only; ledger advance is idempotent; re-poll is safe | ✅ by design |

**Loop protection is the one genuinely new guardrail** the forward-posting model demands:
because outcomes are triggers, `trigger → event → trigger` could in principle spin. The
rule: an instance may not be triggered by an event it (transitively) posted within the
same `correlationId` chain beyond a configured depth.

---

## 9. Closed-loop event taxonomy

Every Job posting is one of three phases (unchanged from V2 / CLIFFNOTES §3):

- **`start` + `end`** — multi-step Job (enables duration, stuck detection, chaining).
- **`single`** — atomic Job.
- Every payload carries `correlationId`; Process-Instance postings additionally carry
  `processInstanceId` and set `parent_event_id` to chain `end`→`start`.

Namespaces are unchanged and binding: `finder`, `capture`, `identity`, `proposal`,
`library`, `system`, `tool`. **Forbidden:** `admin`, `cms`, `spotlight`, `pipeline`.

The **full as-built catalog of which events exist today** is EVENT_CONTRACT_V2.md §2 — not
duplicated here. V3 governs *how* Jobs post and compose; V2 enumerates *what* is posted.

---

## 10. Implementation status & remaining wiring

| Piece | State | Work |
|-------|-------|------|
| Event journal (`system_events` + pg_notify) | ✅ wired | — |
| Ledger tables (`process_instances`, `_transitions`) | ✅ exist | — |
| Job library (`workflows/actions/*`) | ✅ 5 actions built | Add golden tests; relocate to `jobs/` by domain (§5.1) |
| Process Templates (`workflows/*.py`) | ✅ 7 defined | Relocate to `process_templates/`; no logic changes |
| Processor (`processor.py`) | ⚠️ **not wired to main loop** | **Critical-path gap** (ARCHITECTURE_V6 §10.1, ~2d): consume trigger events, write ledger, resume HITL |
| `AI_INVOKE` binding | ⚠️ V1 skip | Wire to tool registry over HTTP |
| `HITL_WAIT` resume | ⚠️ V1 skip | Park/resume via ledger (§6) |
| Loop/depth guardrail | ❌ not present | Add (§8) |
| Golden-test gate in CI | ❌ not present | Add harness (§3.2) |

**Sequence:** (1) golden-test harness + tests for the 5 existing Jobs → (2) wire processor
to `main.py` as the ledger-keeper → (3) `HITL_WAIT` resume → (4) loop guardrail → (5)
relocate to `jobs/` + `process_templates/` by domain/outcome → (6) author `proposal_build`
template by reference.

---

## 11. Naming migration (optional, separate task)

Prose and new comments adopt **Process Template / Job** immediately. Renaming the existing
Python identifiers (`Workflow` base class, `workflows/` package, `workflow_name` column) is
a **separate opt-in refactor** because those are load-bearing across frontend admin routes
(`/api/admin/workflows/*`), the `process_instances.workflow_name` column, and seeded data.
If/when undertaken:

| Today | Target |
|-------|--------|
| `Workflow` (base class) | `ProcessTemplate` |
| `workflows/` package | `process_templates/` |
| `workflows/actions/` | `jobs/` (by domain) |
| `Step` | `JobBinding` |
| `StepType` | `BindingKind` |
| `workflow_name` (column) | keep (BPMN: process definition name) — or `template_name` |
| `/admin/workflows` (route/page) | keep as user-facing "Processes" label, route unchanged |

Until that refactor lands, **the code keeps its current names; only the conceptual
vocabulary changes.** This doc is the source of truth for the vocabulary.

---

*End of EVENT_CONTRACT_V3.md*
