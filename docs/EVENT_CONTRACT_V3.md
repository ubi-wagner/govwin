# EVENT_CONTRACT_V3.md — Unified Automation Architecture: Jobs, Process Templates & the Event Ledger

> ⚠️ The HITL-resume-broken description below is STALE — resume **is** implemented
> (`WorkflowManager.match_waiting_instances` / `resume_instance`, entity-correlated + compare-and-swap).
> **Canonical end-to-end automation design (as-built): `docs/AUTOMATION_DESIGN.md`** — bus → rules →
> workflows → agents → ToDos, with the wired/partial/dormant map. Read that first; this doc's target
> architecture is now largely realized there.

**Date:** 2026-05-31
**Status:** Authoritative target architecture for automation. Supersedes the *design*
sections of EVENT_CONTRACT.md. Does **not** supersede EVENT_CONTRACT_V2.md — that remains
the authoritative **as-built event catalog** (which events fire, from where). V3 governs
**how work is composed and executed**; V2 enumerates **what is emitted**.
**Verification:** §10 (As-Built Reality) and §11 (Gap Matrix) were verified against a full
five-track codebase audit on 2026-05-31. Every as-built claim carries a `file:line` cite.

**Companion docs:** CLAUDE.md (binding standards), CLAUDE_CLIFFNOTES.md §3/§9 (event +
automation rules), ARCHITECTURE_V9.md §8 (canonical namespace registry; V6 archived at docs/archive/ARCHITECTURE_V6.md — note V6 §4.4/§10.1 are STALE, see §10.0 below),
EVENT_CONTRACT_V2.md (as-built event catalog).

---

## 0. Why this document exists

Automation is currently spread across **four overlapping mechanisms** that all react to the
same `system_events` bus but use different vocabulary, state models, and reliability
guarantees:

| | Mechanism | Executor | State | Status |
|---|-----------|----------|-------|--------|
| **A** | Pipeline processor + `WorkflowManager` | `Step` dispatch by kind | `process_instances`, `_transitions` | **LIVE** (`main.py:87`) |
| **B** | CMS `event_listener` | `automation_rules` → action ladder | `automation_rules`, `automation_log` | **LIVE** (`event_listener.py:50`) |
| **C** | `pipeline_jobs` queue | `dispatcher` by `kind` | `pipeline_jobs` | **LIVE** (`main.py:82`) |
| **D** | `agent_task_queue` dispatcher | (would poll queue) | `agent_task_queue`, `agent_task_results` | **DEAD STUB** (`tools/dispatcher.py:68`) |
| **E** | `AutomationEngine.evaluate()` | — | — | **ORPHAN STUB** (`automation/engine.py:4`) |

This document unifies them onto **one substrate, one vocabulary, one reliability contract**:

- Discrete actions become **rock-solid, independently testable Jobs** with **intrinsic
  timeout + retry**.
- Jobs are **composed by reference** into **Process Templates** (e.g. "Proposal Build").
- The connective tissue is **events, not function calls** — every Job posts its outcome to
  the journal; the next Job is triggered by that posting. A future template, automation
  rule, or agent can subscribe to any posting without the emitter knowing who is downstream.

**Founding principle:** *reliability lives in the Job; the template is just deterministic
wiring.* A Job earns a place in a template by passing its golden tests **and** declaring its
own time/retry bounds.

---

## 1. Vocabulary (canonical)

The word "workflow" is **retired as a design term**. The replacement set matches the shipped
table names (`process_instances`) and the BPMN/Camunda convention.

| Term | Definition | Industry equivalent | Code today |
|------|-----------|---------------------|------------|
| **Job** | One discrete, independently testable action: an API call, an agent tool-use, a HITL decision, a NOTIFY, a pure transform. Typed input → typed output, idempotency key, **own default timeout + retry**, posts its own start/end events. | Temporal *Activity*, Airflow *Task*, Dagster *Op* | `Step` + `workflows/actions/*.py` + tool-registry tools |
| **Process Template** | A declarative composition that **cites Jobs by reference** and binds them with ordering, gates, and event triggers. **No business logic** — only wiring + bounds. | BPMN *Process Definition*, Temporal *Workflow* | `Workflow` subclass (`base.py:109`) |
| **Process Instance** | One durable execution of a template (current step, results, status, deadline). | BPMN *Process Instance* | `process_instances` row |
| **Binding kind** | *How* a Job is invoked from a template (action / api_call / ai_invoke / hitl_wait / notify / condition). Not a separate thing — a Job + its invocation strategy. | Operator / State type | `StepType` enum (`base.py:79`) |
| **Park-and-wait** | Any binding that suspends an instance pending a future event: HITL_WAIT (human), AGENT_WAIT (long agent run), or SCHEDULED_WAIT (timer). All share one monitored-park mechanism (§6). | BPMN intermediate catch event | `HITL_WAIT` (partial, broken — §10) |

> **Migration note.** Existing identifiers (`Workflow`, `workflows/` package, `workflow_name`
> column, `/api/admin/workflows/*`) are **not** renamed in this doc. Prose/comments use
> **Process Template** and **Job**. The opt-in code rename is §13.

---

## 2. The three-layer ledger (forward-posting model)

The mental model is **double-entry accounting**. A Job never calls the next Job; it **posts**
its outcome to an append-only journal, and the processor reads the journal *forward*.

```
system_events                 = THE JOURNAL  (append-only; every Job posts start/end here,
                                stamped with correlationId + processInstanceId)
process_instances             = THE LEDGER   (running state of one instance: current_step,
                                step_results, status, deadline, retries)
process_instance_transitions  = THE POSTING LOG (one row per state change; audit trail)
```

### 2.1 The forward-posting loop

```
   Job A ──posts outcome──► system_events ──processor reads forward──► match to next
                            (+correlationId,   trigger in template ──► Job B ──posts──► …
                             +procInstanceId)

   trigger → event → Job → outcome event → trigger → event → Job → …
```

Because Job A only **posts** (it does not name Job B), any number of consumers can bind to
that posting — the owning template, a standalone automation rule, a future agent, a
template added months later — **without changing Job A**. That decoupling is the entire
point of choreography over hard-wired orchestration.

### 2.2 Choreography on the bus + a thin saga ledger

Pure event choreography is **blind** to two things this product genuinely has, so we keep a
correlation ledger (`process_instances`) alongside the bus:

| Need | Why the bare bus can't do it | Ledger answer |
|------|------------------------------|---------------|
| **Park-and-wait** (HITL/Agent/timer) | "Parked, awaiting X" is stateful | Instance `status='paused'`, resumed when the awaited event posts |
| **Stuck/timeout detection** | "Where is X, and did step 3 fire?" can't be read from an append-only stream | `current_step`, `deadline`, `last_heartbeat_at` |
| **Idempotent advance** | Same event may be re-polled | `UNIQUE(workflow_name, trigger_event_id)` + dedup |

### 2.3 Transport is **polling**, not pg_notify (corrected)

A `pg_notify` trigger is **defined in schema but NOT consumed by any code**. All consumers
**poll**: the processor every 10s (`processor.py:717`), the CMS listener every 10s
(`event_listener.py:108`), the `pipeline_jobs` dispatcher via `LIMIT 1 FOR UPDATE SKIP
LOCKED` (`dispatcher.py:162`). There is **no `add_listener`/`pg_notify` call anywhere in the
codebase.** Any doc claiming "pg_notify wired" (including earlier V3 drafts) is wrong.
Moving to LISTEN/NOTIFY is an optional V2 optimization (§12), not a current capability.

---

## 3. The Job Contract

A Job is "rock-solid" when it provably obeys this contract. This is what lets a template
trust it by reference.

```
CONTRACT (every Job MUST):
  1. TYPED INPUT      Single typed input dict. No hidden globals / implicit request state.
  2. TYPED OUTPUT     Single JSONB-serializable output (lands in step_results).
  3. IDEMPOTENT       Carry an idempotency key (entity id + step name). Re-run = no-op/upsert.
  4. POSTS EVENTS     Emit own start/end (multi-step) or single (atomic) to system_events,
                      stamped correlationId + processInstanceId.
  5. NO SIDE CHANNEL  Communicate ONLY via return value + posted events. Never call the
                      next Job directly.
  6. TIME-BOUNDED     Declare its OWN default_timeout AND default_retry policy (§3.1).
                      Fail loud (raise), never silently swallow.
```

### 3.1 Time-monitoring & resource bounds (MANDATORY — applies to every Job, incl. HITL/Agent/park-waits)

This is a hard requirement, not advisory. **Every Job carries its own bounds; the binding
may tighten or relax them but may never remove them.** Bounds live on the Job so they travel
with it into every template that cites it.

**Job-intrinsic fields (declared on the Job, defaulted, binding-overridable):**

| Field | Meaning | Default rule |
|-------|---------|--------------|
| `default_timeout` | Max wall-clock for one execution | Required; no unbounded Jobs |
| `default_retry_count` | Max automatic retries on transient failure | 0 unless the Job is idempotent-safe |
| `default_retry_backoff` | Backoff between retries | exponential `base × 2^attempt` |
| `max_attempts_budget` | Hard ceiling across retries (cost/loop guard) | derived from above |

**Enforcement points (all must honor the bounds — see §10/§11 for current gaps):**

| Execution path | Timeout mechanism | Retry mechanism |
|----------------|-------------------|-----------------|
| Pipeline ACTION/NOTIFY (template) | `asyncio.wait_for(timeout_minutes×60)` (`manager.py:401`) ✅ | backoff loop (`manager.py:412`) ✅ |
| Frontend `invoke()` (tool/agent) | `AbortController` / `AbortSignal.timeout` ⚠️ **absent today** | retry wrapper ⚠️ **absent today** |
| AI_INVOKE (agent) | per-call wall-clock + round cap + cost ceiling | bounded retries |
| CMS action (`event_listener`) | `asyncio.wait_for` ⚠️ **absent today** | bounded retry ⚠️ **absent (fire-and-forget) today** |

**Park-and-wait monitoring (HITL_WAIT / AGENT_WAIT / SCHEDULED_WAIT):** a parked instance is
*still time-monitored*. It must declare:

| Field | Meaning |
|-------|---------|
| `wait_deadline` | Absolute time the wait expires — **derived from the binding's `timeout_minutes`**, NOT a hardcoded global (this is the source of the live HITL bug, §10/§11) |
| `on_timeout` | The escalation Job to run when `wait_deadline` passes (e.g. reminder, re-notify, auto-cancel) |
| heartbeat exemption | Parked instances are **exempt from the running-heartbeat stuck check** but **subject to the `wait_deadline` sweep** |

A monitor sweep runs on an interval, compares `now()` to each parked instance's
`wait_deadline`, and on expiry routes to `on_timeout` (escalate/reschedule/fail) rather than
silently killing the instance. **Agents are park-and-waits too:** a long agent run parks the
instance with an `AGENT_WAIT` deadline and a `max_cost`/`max_rounds` budget; breaching any
bound routes to `on_timeout`.

### 3.2 Golden-test gate (how "rock-solid" becomes mechanical)

Every Job ships a golden test: `fixture(input) → job(input)` asserting **both** the returned
output **and** the posted events. External services (Claude, Gmail, Stripe, SAM.gov) are
stubbed; internal code is never mocked (per TESTING_STRATEGY.md). **A Job may not be cited by
a Process Template until its golden test is green in CI.** Today only the shredder has
fixtures (`shredder/golden_fixtures/`); §11 tracks the rest.

---

## 4. Binding kinds (the existing `StepType`, reframed + verified)

| Binding kind | Meaning | Verified status (`processor.py`/`manager.py`) |
|--------------|---------|------------------------------------------------|
| `ACTION` | Call a local `module.function` Job | ✅ executes; timeout+retry enforced |
| `NOTIFY` | Post `system:notification.requested` (email/notify Job) | ✅ emits; ignores the action string by design |
| `API_CALL` | Call a Job over HTTP | ⚠️ **stubbed** — logs "not implemented in V1, skipping" (`processor.py:355`) |
| `AI_INVOKE` | Call an agent/Claude via the tool registry | ⚠️ **stubbed** — import fails → skipped "not resolvable locally (V1)" (`processor.py:231`) |
| `HITL_WAIT` | Park until a human event posts | 🔴 **broken** — pauses but cannot resume + dies at +1h (§10) |
| `CONDITION` | Branch on payload | ✅ evaluates; **but no template sets a condition**, so it's a constant pass-through |

---

## 5. Code organization — two axes

### 5.1 Job modules — by **domain / capability** (the reusable library)

```
pipeline/src/jobs/                  (target home; today: workflows/actions/ + scattered)
  shred_jobs.py        # shred, extract_compliance      (← actions/shred.py; canonical core = shredder/runner.py)
  scoring_jobs.py      # match_tenants                   (← actions/score_tenants.py)
  scout_jobs.py        # scout + create_drafts_from_scout(← unify the TS/Py scout duplication, §10)
  library_jobs.py      # create_default_categories
  export_jobs.py       # generate_preview + docx/pptx/xlsx
  cms_jobs.py          # publish_content, unpublish_content, page-block submit/approve/reject/publish
  notify_jobs.py       # send_email, notify_admin
  proposal_jobs.py     # provision_sections, draft_section, ai_review, advance_stage, record_outcome
```

### 5.2 Process Templates — by **business outcome**

```
pipeline/src/process_templates/     (target home; today: workflows/on_*.py)
  rfp_intake.py          # cites shred_jobs + notify_jobs
  proposal_build.py      # cites proposal_jobs + scoring_jobs + export_jobs + notify_jobs
  customer_onboarding.py # cites library_jobs + notify_jobs
  content_pipeline.py    # cites cms_jobs + notify_jobs
  source_monitor.py      # cites scout_jobs + notify_jobs
```

> A template reaches **across** job modules — that is what keeps Jobs reusable. "Proposal
> Build" cites shred/scoring/draft/export/notify Jobs; `cms_jobs.py` is cited by the
> *content pipeline* template, not by Proposal Build.

---

## 6. Park-and-wait states with time monitoring (HITL + Agent + timer)

A park-and-wait suspends the instance pending a future event. The mechanism is shared across
HITL, long agent runs, and scheduled delays.

```
  Job: advance_to_review ──posts──► proposal:proposal.advanced(review)
                                          │
                                          ▼
  HITL_WAIT: await reviewer       instance → status='paused'
    wait_for  = EventTrigger(proposal, review.decided, single)
    wait_deadline = created_at + binding.timeout_minutes   ◄── derived, NOT hardcoded
    on_timeout    = notify_jobs.send_review_reminder
                                          │
            (admin clicks Approve/Reject → UI route posts proposal:review.decided)
                                          ▼
  processor matches wait_for ──► instance → status='running' ──► next Job
                                          │
            (if now() > wait_deadline before the event) ──► run on_timeout Job (escalate)
```

**Required properties (today's reality is in §10):**
- The pause is **durable** (survives restart — it's in the ledger, not memory).
- `wait_deadline` is **derived from the binding's declared timeout** (24h/48h/72h), never a
  global default.
- A monitor sweep compares `now()` vs `wait_deadline`; on expiry it runs `on_timeout`
  (reminder / re-notify / auto-cancel) — it does **not** silently fail the instance.
- A **resume path** must exist: the awaited event, matched against `wait_for`, transitions
  the instance `paused → running` and re-drives from the next step.
- Parked instances are **exempt from the running-heartbeat sweep** but **subject to the
  deadline sweep**.

---

## 7. Worked example — "Proposal Build" Process Template

Cites Jobs **by reference** across four domain modules; stages follow the canonical machine
`draft → review → final → submitted → archived` (ARCHITECTURE_V6 §9.1).

```
PROCESS TEMPLATE: proposal_build
TRIGGER: capture:purchase.completed:single  (or proposal:proposal.created:end for bypass)

  Job (module.function)         Binding     timeout/retry      Posts outcome
  ───────────────────────────────────────────────────────────────────────────────
  1 proposal_jobs.provision     ACTION      5m / r1            proposal.created:end
  2 proposal_jobs.draft_section AI_INVOKE   per-call+budget    proposal.section.drafted  (per section)
  3 notify_jobs.workspace_ready NOTIFY      —                  notification.requested
  4 ── HITL_WAIT customer edits+advance ──► proposal.advanced(review)   wait_deadline, on_timeout=reminder
  5 proposal_jobs.ai_review     AI_INVOKE   per-call+budget    proposal.reviewed
  6 ── HITL_WAIT reviewer signoff ───────► proposal.advanced(final)    wait_deadline, on_timeout=reminder
  7 export_jobs.generate_preview ACTION     15m / r1           proposal.preview_ready
  8 notify_jobs.final_ready      NOTIFY     —                  notification.requested
  9 ── HITL_WAIT submit ─────────────────► proposal.advanced(submitted)
 10 proposal_jobs.record_outcome ACTION     5m / r1            outcome.recorded  (→ archived)
```

Every numbered Job is golden-tested and time-bounded in its domain module. The template adds
no logic — only ordering, binding kinds, bounds, and the events it waits on.

---

## 8. Guardrails (required before any template is trusted in production)

| Guardrail | Mechanism | Status |
|-----------|-----------|--------|
| Idempotent advance | `UNIQUE(workflow_name, trigger_event_id)` + `_track_processed()` | ✅ |
| Action-level dedup | `automation_log` 5-min window per `(trigger_event_id, action_type)` | ✅ (CMS) |
| **Phase-aware matching** | match on `namespace:type:phase` (not namespace+type only) | 🔴 **CMS ignores phase → double-fire (§10)** |
| **Single-owner per trigger** | one mechanism owns each trigger; others observe | 🔴 **A+B both fire on rfp.uploaded / source.change_detected (§10)** |
| Loop / depth protection | cap chain depth per `correlationId`; refuse self-triggered re-spawn | ⚠️ **to add** |
| Deadline-derived park monitoring | `wait_deadline` from binding; `on_timeout` escalation | 🔴 **hardcoded 1h kills HITL (§10)** |
| Stuck detection | `deadline` + `last_heartbeat_at` sweep | ⚠️ partial (kills parked instances) |
| Poison-event isolation | per-event try/catch | ✅ pattern present |

---

## 9. Closed-loop event taxonomy

Phases (unchanged): **`start`+`end`** (multi-step) / **`single`** (atomic). Every payload
carries `correlationId`; instance postings add `processInstanceId` and set `parent_event_id`.

### 9.1 Binding namespace rules (canonical — this IS the contract)

- **Seven allowed namespaces:** `finder, capture, identity, proposal, library, system, tool`.
- **Forbidden as namespaces:** `admin, cms, spotlight` (the CLAUDE.md trio) — **plus** `pipeline`,
  which is an `actor_type`, never a namespace. Admin actions emit under `finder`; CMS under
  `system`; the retired Spotlight surface has no namespace of its own. (Tool-registry names like
  `solicitation`, `volume`, `compliance`, `opportunity`, `memory`, `ingest` are tool names, not
  event namespaces — never emit under them.)
- **Type format:** `entity.action_past_tense` (snake_case) — e.g. `atom.created`,
  `section.atoms_selected`, `purchase.completed`, `tenant.created`.
- **Admin-event `tenantId` is NULL:** an event fired from an admin (finder) surface sets
  `tenant_id = null`; the affected tenant's UUID rides in the payload. Portal (tenant) events
  carry the real tenant UUID. (See `finder:tenant.created` below.)

V3 is canonical for these binding rules + how work is composed; **EVENT_CONTRACT_V2.md §2 remains
the authoritative as-built event catalog** (what fires, from where) and is *not* superseded — the
two are complementary, and V2's own header says so. The full enumerated catalog lives there.

### 9.2 New event types

**2026-07-22 (auditability sweep) — all namespace-valid `entity.action_past_tense`:**
- **`library:atom.created`** (`single`) — now emitted from **three** producers: the direct atom
  create (`portal/[t]/atoms`), the upload→reference path (`portal/[t]/atoms/upload`), and the
  in-canvas harvest (`…/sections/[id]/atomize-node`). Payload carries `atomId` + `grain`/`source`.
  Every path an atom can enter the unified `library_atoms` library now audits (previously only the
  direct create did).
- **`library:section.atoms_selected`** (`single`, `portal/[t]/atoms/select`) — records
  `{ sectionId, recorded }` when a drafter binds library atoms to a section.
- **`finder:tenant.created`** — the admin company-create emit was **fixed to `tenantId: null`**
  (admin-event convention §9.1); the new tenant's UUID rides in the payload
  (`{ tenantId, slug, source:'admin_manual', cardsBackfilled }`).
- **`capture:purchase.completed`** is now **also** emitted for the **RFP-Admin comp free-portal**
  (`POST /portal/[t]/portals`, gated rfp_admin+): a $0 `purchases` row (`metadata.grant='admin'`)
  is written and the event fires with `payload.grant='admin'` + `comp:true`, so an admin-approved
  free portal **audits exactly as a paid purchase** (and drives the same `notify_admin` automation).

**Audit coverage:** every state-changing route emits start/end (or `single`) into `system_events`
— **97/97 on the checked paths** (up from 94/97; the three fixes above closed the gap). Spine
health: all 7 allowed namespaces active, 0 forbidden, every type a valid `entity.action_past_tense`.

**2026-07-15 (catalogued in EVENT_CONTRACT_V2.md §2):**
`capture:purchase.completed` (comp-code purchase — now consumed via mig 106 `notify_admin`),
`capture:workspace.released` (RFP-expert release-from-curation), `capture:tenant.cards_backfilled`
(signup card mirror), `proposal:proposal.ready_for_customer` (proposal handed back for customer
input), `finder:solicitation.pushed` (curation push fan-out), and
`system:content.document_archived` / `system:content.document_restored` (postings retire/restore,
start/end). All obey §9.1.

---

## 10. As-Built Reality (VERIFIED 2026-05-31 — five-track audit)

### 10.0 Stale claims this section corrects
- ARCHITECTURE_V6 §4.4 / §10.1 say the processor is "Defined, not wired" / "not connected to
  main.py" — **FALSE**: `run_workflow_processor` is awaited at `main.py:87`. The real gap is
  HITL, not wiring.
- Any "pg_notify wired" claim — **FALSE** (§2.3).
- Migration count: CLIFFNOTES said 51, ARCHITECTURE_V6 said 40 — **both wrong**. Ground
  truth: **53 SQL files, max `051`**, plus interleaved `030a_ensure_full_schema.sql`.

### 10.1 Two engines, layered (engine-of-record = `WorkflowManager`)
`processor.py` is the poll loop; `manager.py` (`WorkflowManager`) is the live executor in
prod (migration 043 applied → `_check_manager_available` engages it, `processor.py:697`). The
processor's standalone `_run_workflow` HITL path (skip-and-proceed, `processor.py:341`) is
**dead in prod** and has **opposite** HITL semantics to the manager (pause-and-stop). One
engine must win.

### 10.2 🔴 HITL deadline bug — lethal
`manager.create_instance` hardcodes `deadline = now + 1h` (`manager.py:148`) and never reads
the step's `timeout_minutes`. The 60s paused-deadline sweep (`manager.py:919-963`)
force-fails any parked instance past deadline. A 72h review (`on_proposal_advanced.py:195`)
parks, then dies `~60 min` later with `last_error='hitl_timeout'`. **71 of 72 hours
unreachable.**

### 10.3 🔴 HITL cannot resume — dead end
`resume_instance` (`manager.py:670`) has **zero callers**; no resume route exists; `wait_for`
is never matched against incoming events. `poll_retrying_instances` only finds
`status='retrying'`, which nothing sets from `paused`. Every HITL_WAIT is terminal even
before 10.2 kills it.

### 10.4 🔴 No timeout/retry on user-facing paths
- Frontend `invoke()` (`registry.ts:196-223`): **zero** timeout, **zero** retry. The costliest
  Job — `proposal-draft-section.ts` calling Anthropic — has **no deadline on handler or
  registry**. Other tools reinvent ad-hoc timeouts (`source-scout` 30/60s,
  `compliance-extract` 30s) — inconsistent and missing on the costly path.
- CMS `event_listener`: **no** per-action timeout, **no** retry (fire-and-forget,
  `event_listener.py:230`), **no** heartbeat, and **not** auto-restarted (the 6 workers are).

### 10.5 🔴 Multi-fire on shared events
- `finder:rfp.uploaded` → pipeline `OnRfpUploaded` (A) **+** CMS rule "New RFP ready" (B).
  Path C (direct shred insert) was deliberately cut (`rfp-upload/route.ts:464`) — *by comment,
  not enforced constraint*.
- CMS `_rule_matches` ignores `phase` (`event_listener.py:160`) → fires on **both** start and
  end (distinct event IDs, dedup misses) → **2 admin emails from B alone**. Same exposure for
  every start/end-paired event (application.accepted, proposal.*, source.change_detected,
  topic.pinned).

### 10.6 🔴 Duplicated logic
- **SHRED:** 1 canonical core (`shredder/runner.py`), 3 wrappers; `workers/rfp_shredder.py` is
  a **dead duplicate** (no importer).
- **SCOUT:** full **TS↔Python reimplementation** (`source-scout.ts` ≈ `workers/source_scout.py`),
  both live. **Field-name break:** scouts emit `extractedOpportunities` but
  `create_drafts_from_scout.py:163` reads `opportunities` → **draftsCreated always 0** (silent
  no-op).
- `finder:rfp.shredded` is emitted on the C/worker path but **not** the A/template path →
  divergent event surface between the two shred entry points.

### 10.7 🟡 Inert / dead / silent no-ops
- `on_timeout`/`on_failure`: declared in templates, **read nowhere**.
- CMS `unpublish_content`: rule live, **handler missing** → matches, logs success, does
  nothing.
- CMS `distribute_social`: rows created, but poster always `raise NotImplementedError` →
  every post fails.
- Frontend `ai/review` route: invokes phantom `proposal.review_section` (**unregistered, no
  caller**) → "review" reviews nothing.
- `proposal.draft_section` with no API key: returns a **success envelope** carrying an
  in-band `error` → metrics record a failure as success.
- Dead mechanisms: `agent_task_queue` dispatcher (D, `NotImplementedError` Phase-4),
  `AutomationEngine` (E), orphan workers (`embedder/emailer/grinder/reminder/document_fetcher`
  — empty TODO stubs).

### 10.8 🟡 Agents — written but dormant (V2, not today)
> ⚠️ **SUPERSEDED (2026-07-22) — this section describes the pre-#117 snapshot and is now FALSE.**
> As-built: **27 archetypes** auto-register and **are wired as workflow actors** (#117 + batches A/B/C +
> POD4/CMS + the library-seed pair); `AgentFabric` is passed into `run_workflow_processor()` (not discarded), AI_INVOKE routes via
> `fabric.invoke_agent()`, and guardrails ARE reached (advisory → guardrail → land-or-review). **RLS now
> has policies** — mig 117 FORCEs RLS + defines `tenant_isolation` on the tenant tables and adds the
> `rfp_agent` NOBYPASSRLS role (inert only because the app connects as the RLS-bypassing owner today; the
> non-owner cutover is launch-readiness item #9). Canonical current state:
> **docs/AGENT_WORKFORCE.md** + **docs/AGENT_FABRIC_DESIGN.md §0** + **docs/AUTOMATION_SPINE_MAP.md**. The
> original text is retained below only as the historical audit snapshot.

~4,800 LOC, 10 archetypes auto-register, full tool-use loop + budgets + rate-limits coded —
but **orphaned**: producer `requestAgentTask` has zero callers; consumer `AgentFabric` is
instantiated then discarded (`main.py:70`); AI_INVOKE deliberately skips. Guardrails (120s
timeout, 20-round cap, $0.50/call, 50/hr, $50/mo) exist in `fabric.invoke_agent` but it is
**never reached**. `human_gate` never enforced. **RLS enabled with ZERO policies** (0
`CREATE POLICY` in migrations) — isolation rests entirely on `WHERE tenant_id`, contradicting
CLAUDE.md. Budget column is `monthly_budget` (dollars), **not** `max_cost_per_month_cents`.
What runs live: the memory-lifecycle/learning scheduler (`lifecycle_scheduler.py`).

### 10.9 🟡 `automation_rules` dual-schema (the 12-hour-outage hazard)
Created twice via `CREATE TABLE IF NOT EXISTS` with incompatible schemas (`001_baseline:673`
trigger_bus/trigger_events vs `019:2` trigger_namespace/trigger_type), reconciled twice
(019 + 028), forcing the CMS listener to **sniff `information_schema.columns` at runtime**
(`event_listener.py:160`). The `trigger_bus` branch is dead in practice (v2 columns always
exist and win).

---

## 11. Gap Matrix to a unified V1 baseline (severity-ranked)

| # | Sev | Gap | Evidence | Fix lands in |
|---|-----|-----|----------|--------------|
| 1 | 🔴 P0 | HITL `wait_deadline` from binding (not hardcoded 1h) **+** resume path — must be ONE change | `manager.py:148`, `:670` | engine |
| 2 | 🔴 P0 | Job-intrinsic timeout+retry contract; enforce in `invoke()`, CMS actions, AI_INVOKE | `registry.ts:196`, `event_listener.py:230` | contract + 3 paths |
| 3 | 🔴 P0 | SCOUT field-name break (`extractedOpportunities` vs `opportunities`) | `create_drafts_from_scout.py:163` | job |
| 4 | 🔴 P0 | Phase-aware + single-owner matching (kill multi-fire) | `event_listener.py:160`; `028:62` | CMS matcher + rule audit |
| 5 | 🟡 P1 | Choose ONE engine (manager); delete processor's dead HITL path | `processor.py:341` | engine |
| 6 | 🟡 P1 | Wire `on_timeout`/`on_failure` to escalation Jobs | `base.py:101` read nowhere | engine |
| 7 | 🟡 P1 | Collapse SHRED (drop `rfp_shredder.py`) + SCOUT (one canonical, TS calls it) | §10.6 | jobs |
| 8 | 🟡 P1 | Remove dead mechanisms D + E + orphan workers; add `unpublish_content` handler; fix `distribute_social` or disable; remove phantom `ai/review` or register `review_section` | §10.7 | cleanup |
| 9 | 🟡 P1 | Golden-test gate + tests for the 5 action Jobs + costly tools | only shredder has fixtures | tests/CI |
| 10 | 🟢 P2 | Loop/depth guardrail per `correlationId` | not present | engine |
| 11 | 🟢 P2 | RLS policies (or document that isolation = `WHERE tenant_id`) | 0 `CREATE POLICY` | migration/doc |
| 12 | 🟢 V2 | Activate agent loop (producer+consumer+bridge); LISTEN/NOTIFY transport | §10.8, §2.3 | V2 |

---

## 12. Unification target & sequencing

**End state:** one engine (`WorkflowManager`) consuming the journal; one Job Contract (typed
I/O + idempotency + intrinsic timeout/retry + posts events); Jobs in `jobs/` by domain,
templates in `process_templates/` by outcome; **single owner per trigger** (templates own
multi-step chains; `automation_rules` own simple single-hop reactions; no overlap); CMS
actions become Jobs invoked through the same contract; agents are park-and-wait Jobs (V2).

**Sequence (each step = its own verified, committed increment):**
1. **P0 bug-fixes** (gaps 1, 3, 4) — highest value, most self-contained; fixes live breakage.
2. **Job Contract + timeout/retry** (gap 2) — lay the foundation all paths inherit.
3. **Engine consolidation** (gaps 5, 6) — one engine, escalation wired.
4. **De-dup + cleanup** (gaps 7, 8) — collapse SHRED/SCOUT, remove dead mechanisms.
5. **Golden-test gate** (gap 9) — lock reliability before composing new templates.
6. **Author `proposal_build` by reference** + relocate to `jobs/`+`process_templates/`.
7. **P2/V2** (gaps 10–12) — loop guard, RLS, agent activation, LISTEN/NOTIFY.

---

## 13. Naming migration (optional, separate task)

Prose/comments adopt **Process Template / Job** now. Renaming load-bearing identifiers is a
separate opt-in refactor because they cross frontend routes (`/api/admin/workflows/*`), the
`process_instances.workflow_name` column, and seeds.

| Today | Target |
|-------|--------|
| `Workflow` (base class) | `ProcessTemplate` |
| `workflows/` package | `process_templates/` |
| `workflows/actions/` | `jobs/` (by domain) |
| `Step` | `JobBinding` |
| `StepType` | `BindingKind` |
| `workflow_name` (column) | keep (BPMN process-definition name) or `template_name` |
| `/admin/workflows` | keep route; user-facing label "Processes" |

Until that refactor lands, **code keeps current names; only the conceptual vocabulary
changes.** This doc is the source of truth for the vocabulary.

---

*End of EVENT_CONTRACT_V3.md*

## Launch Review Corrections (2026-05-31)

Amendments to the contract from the end-to-end launch review. These supersede any
earlier text that conflicts.

1. **Phase matching is exact** (`EventTrigger.matches`): a `trigger`/`wait_for` only
   fires when `namespace`+`type`+`phase` all equal the event. Frontend producers:
   `emitEventStart→start`, `emitEventEnd→end`, `emitEventSingle→single`.
2. **End-event payload = `result` only.** `emitEventEnd` does not merge the start
   payload; the `result` must carry all fields downstream consumers/conditions read.
3. **Error-gating is mandatory.** Failed operations still emit `phase:'end'` with an
   `error`. Consumers now skip events where `error` is set (`matches()` + CMS loop).
   Producers should treat a terminal `end` with `error` as "do not propagate".
4. **NOTIFY delivery contract:** a NOTIFY step's `template` must resolve in the CMS
   `TEMPLATES` registry or it silently sends nothing. Template name is part of the
   contract; changing a NOTIFY template requires a matching registry entry.
5. **HITL resume producers:** every `wait_for` must name an event a real producer
   emits at the matching phase. The proposal review gate resumes on
   `proposal.advanced:end` (`previousStage=='review'`); the source-change gate resumes
   on `source_diff.reviewed:end` (the diffs-route PATCH emits it — NOT GET-only), with
   the process-ledger force-advance as the precise per-instance override.
6. **Agent dispatch is V2.** Events addressed to agent archetypes
   (`*.review_requested`, `*.draft_requested`, `compliance.checked`) have no runtime
   consumer yet; do not contract UI on their results.
7. **Tenant process surface:** `process_instances` state is exposed to tenants at
   `portal/<slug>/processes` (ledger + force-advance for `tenant_admin`, own-tenant
   scoped via `canForceAdvanceInstance`). rfp_admin gets the cross-tenant view at
   `admin/workflows` (tenant filter). Force-advance is the sanctioned HITL override.
