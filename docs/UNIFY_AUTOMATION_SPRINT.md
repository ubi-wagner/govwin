# UNIFY_AUTOMATION_SPRINT.md — Execution Plan: Unify Automation onto Jobs + Process Templates

**Date:** 2026-05-31
**Owner:** engineering
**Spec:** docs/EVENT_CONTRACT_V3.md (architecture) · CLAUDE_CLIFFNOTES.md Mistakes 17–22 (verified bugs)
**Model:** Plan all now → execute one **gap per commit** in sequence → each increment's
*develop → review → debug → document* result feeds the next. Every increment ships a
**targeted test wired into CI**. No batching of P0s.

**Status legend:** ☐ not started · ◐ in progress · ☑ done (commit `<sha>`)

---

## 0. Sequencing overview (V3 §12)

| Inc | Gap (V3 §11) | Title | Sev | Surface | Status |
|-----|--------------|-------|-----|---------|--------|
| **1** | 1 | HITL: derive `wait_deadline` from binding + wire resume path | 🔴 P0 | `manager.py`, `processor.py` | ☑ `<pending>` |
| **2** | 3 | SCOUT field-name break (`extractedOpportunities` vs `opportunities`) | 🔴 P0 | `create_drafts_from_scout.py` + scouts | ☐ |
| **3** | 4 | Phase-aware + single-owner matching (kill multi-fire) | 🔴 P0 | `event_listener.py`, rule seeds | ☐ |
| **4** | 2 | Job Contract: intrinsic timeout+retry; enforce in `invoke()` + CMS + AI_INVOKE | 🔴 P0 | `registry.ts`, `base.ts`, `event_listener.py` | ☐ |
| **5** | 5 | One engine (WorkflowManager); delete processor's dead HITL path | 🟡 P1 | `processor.py` | ☐ |
| **6** | 6 | Wire `on_timeout`/`on_failure` → escalation Jobs | 🟡 P1 | `manager.py`, templates | ☐ |
| **7** | 7 | Collapse SHRED + SCOUT duplicates to one canonical each | 🟡 P1 | `workers/`, `actions/`, tools | ☐ |
| **8** | 8 | Remove dead mechanisms; fix silent no-ops; phantom executor | 🟡 P1 | CMS, workers, `ai/review` | ☐ |
| **9** | 9 | Golden-test gate + tests for 5 action Jobs + costly tools | 🟡 P1 | `pipeline/tests/`, CI | ☐ |
| **10** | — | Author `proposal_build` by reference; relocate `jobs/`+`process_templates/` | 🟢 | pipeline | ☐ |
| **11** | 10 | Loop/depth guardrail per `correlationId` | 🟢 P2 | engine | ☐ |
| **12** | 11 | RLS policies (or document isolation = `WHERE tenant_id`) | 🟢 P2 | migration/doc | ☐ |
| **13** | 12 | Agent loop activation; LISTEN/NOTIFY transport | 🟢 V2 | pipeline | ☐ |

**Dependency notes (why this order):** INC-1 uses the existing `Step.timeout_minutes` (no
dependency on the Job Contract, so it goes first as a live-bug fix). INC-1's resume-path
design is an **input to** INC-5 (engine consolidation) and INC-6 (`on_timeout`). INC-4's Job
Contract is an **input to** INC-10 (templates) and INC-9 (test harness). INC-9's harness is
an **input to** INC-10 (no Job enters a template until golden-green).

**CI homes:** Python → `pipeline/tests/test_*.py` (pytest, `conftest.py` present). Frontend →
`frontend/__tests__/{unit,integration}/*.test.ts` (Vitest). Cross-service → `scripts/test-all.sh`.

---

## INCREMENT 1 — HITL deadline + resume (Gap 1) 🔴
**Goal:** A park-and-wait survives its full declared duration and can actually resume.
Eliminates the two lethal HITL bugs (CLIFFNOTES 17 + 18).

**Files / anchors:** `pipeline/src/workflows/manager.py:148` (hardcoded deadline), `:365-389`
(HITL pause), `:670` (`resume_instance`, zero callers), `:717-731` (`poll_retrying_instances`),
`:916-963` (paused-deadline sweep); `pipeline/src/workflows/processor.py:715-873` (poll loop —
where the awaited event must match `wait_for`); `base.py:100` (`Step.wait_for`).

**Tasks:**
- ☑ 1.1 Derive `wait_deadline` from the parking step's `timeout_minutes` at pause time
  (UPDATE `process_instances.deadline = now() + step.timeout_minutes*interval`), replacing the
  create-time hardcoded 1h for parked instances.
- ☑ 1.2 Keep the create-time deadline ONLY as a pre-park guard; ensure non-parked running
  instances are unaffected.
- ☑ 1.3 Resume path: in the poll loop, for each new event, find paused instances whose
  current HITL step `wait_for` matches the event → transition `paused → retrying` (so
  `poll_retrying_instances` re-drives from the next step). Add `match_waiting_instances(event)`.
- ☑ 1.4 On `wait_deadline` expiry, route to the step's `on_timeout` (observable event +
  `wait_deadline_exceeded` reason now; full execution in INC-6) instead of silent
  `hitl_timeout` fail. Record transition.
- ☑ 1.5 Exempt `paused` instances from the running-heartbeat stale sweep (confirmed: sweep
  only touches `status='running'` — asserted via the matcher tests).

**Targeted test (CI):** `pipeline/tests/test_hitl_lifecycle.py` (5 tests, all green) —
(a) park sets deadline from binding timeout (≈72h, not 1h);
(b) matching `wait_for` event resumes `paused→retrying`; non-matching does not;
(c) `EventTrigger.matches` predicate guard; (d) static lock that the sweep uses the
observable `wait_deadline_exceeded` / `workflow.wait_timed_out` path, never silent `hitl_timeout`.

**Acceptance:** ✅ `pytest tests/test_hitl_lifecycle.py` 5 passed; full importable suite 116
passed / 0 regressions; `ast.parse` clean on touched files. **Feeds:** INC-5 (engine), INC-6
(`on_timeout` full execution).
**Outcome:** Machinery was more complete than the audit severity implied — `resume_instance`
already worked end-to-end; the ONLY missing link was matching an incoming event to a paused
instance's `wait_for`. Fix reduced to: (A) park-time deadline from `step.timeout_minutes`,
(B) new `manager.match_waiting_instances(event)` + `_resolve_workflow_class()` helper,
(C) one call site in the processor per-event loop, (D) sweep now emits `workflow.wait_timed_out`
+ records `wait_deadline_exceeded` with `last_error_step` (gives INC-6 the pointer it needs to
run `on_timeout`). Note for INC-6: instances are still marked terminal `failed` on expiry —
INC-6 will run the `on_timeout` Job BEFORE failing. Env note: `pytest`/`pytest-asyncio`/
`asyncpg` had to be pip-installed in the sandbox; `httpx`-dependent test modules (ingest) can't
collect here (pre-existing, unrelated).

---

## INCREMENT 2 — SCOUT field-name break (Gap 3) 🔴
**Goal:** `OnSourceChangeDetected` actually creates draft solicitations (today: always 0).

**Files / anchors:** `pipeline/src/workflows/actions/create_drafts_from_scout.py:163`
(reads `region.get("opportunities")`); emitters `pipeline/src/workers/source_scout.py:348`
and `frontend/lib/tools/source-scout.ts:455` (both emit `extractedOpportunities`).

**Tasks:**
- ☐ 2.1 Decide canonical key = `extractedOpportunities` (matches both emitters); fix the
  consumer to read it. (Alternatively normalize at emit — but two emitters vs one consumer →
  fix the consumer.)
- ☐ 2.2 Grep for any other consumer of scout region payloads to ensure no second mismatch.
- ☐ 2.3 Add a shared constant/type for the region payload shape to prevent regression.

**Targeted test (CI):** `pipeline/tests/test_create_drafts_from_scout.py` — feed a scout-shaped
payload with `extractedOpportunities`, assert `draftsCreated == N` (not 0) and rows land in
`curated_solicitations`.

**Acceptance:** pytest green; `ast.parse` clean. **Feeds:** INC-7 (SCOUT de-dup).
**Outcome:** _(filled on completion)_

---

## INCREMENT 3 — Phase-aware + single-owner matching (Gap 4) 🔴
**Goal:** One admin notification per upload, not two-to-three. Kill the start/end double-fire
and the template-vs-rule overlap.

**Files / anchors:** `services/cms/src/event_listener.py:160-183` (`_rule_matches`, ignores
phase); rule seeds `db/migrations/028_automation_rules_v2.sql:62-89`; overlap with templates
`on_rfp_uploaded.py` / `on_source_change_detected.py`.

**Tasks:**
- ☐ 3.1 Add phase awareness to `_rule_matches`: rules match a single phase (default `single`;
  for start/end events, match `end` only). Store/读 an optional `trigger_phase` on the rule;
  default-end when absent.
- ☐ 3.2 Single-owner audit: for `finder:rfp.uploaded` and `finder:source.change_detected`,
  decide owner = the Process Template (multi-step) and **demote/remove** the duplicate
  `notify_admin` automation_rule (or scope it so it can't double with the template NOTIFY).
  Migration to deactivate the overlapping seeded rules.
- ☐ 3.3 Document the single-owner rule in the rule-seed migration header.

**Targeted test (CI):** `services/cms` test (pytest) `test_rule_matching_phase.py` — assert a
rule on `rfp.uploaded` matches the `end` row only, not `start`; assert no double-match across
a start/end pair.

**Acceptance:** test green; migration applies cleanly on a fresh DB (`migrate.mjs` dry path).
**Feeds:** INC-8 (CMS cleanup). **Outcome:** _(filled on completion)_

---

## INCREMENT 4 — Job Contract: timeout + retry everywhere (Gap 2) 🔴
**Goal:** Every Job carries its own default timeout + retry; the three executors enforce it.

**Files / anchors:** `frontend/lib/tools/base.ts:48-62` (add bounds to tool def + ctx signal),
`frontend/lib/tools/registry.ts:196-223` (wrap handler in timeout + bounded retry),
`frontend/lib/tools/proposal-draft-section.ts:155-167` (pass `AbortSignal`),
`services/cms/src/event_listener.py:230-250,747-771` (wrap actions in `asyncio.wait_for` +
bounded retry).

**Tasks:**
- ☐ 4.1 Extend the tool definition with `timeoutMs` + `retry` (count/backoff); sane defaults.
- ☐ 4.2 `invoke()` wraps the handler in `AbortController`/timeout + a bounded retry loop;
  thread `signal` through `ToolContext`.
- ☐ 4.3 `proposal-draft-section.ts`: pass the `signal` to the Anthropic call; stop returning a
  success envelope on no-key — raise a typed error (ties to CLIFFNOTES 22).
- ☐ 4.4 CMS `_do_action`: `asyncio.wait_for(per-action timeout)` + bounded retry with backoff;
  failures that exhaust retries write `automation_log status='failed'` (already) AND remain
  re-pollable within the dedup window.
- ☐ 4.5 Centralize defaults in one place per service (no per-handler ad-hoc timeouts).

**Targeted tests (CI):**
- `frontend/__tests__/unit/registry-timeout.test.ts` — a handler that never resolves is
  aborted at `timeoutMs`; a transient-throwing handler is retried then succeeds.
- `pipeline/tests/` or CMS test — a slow action is cancelled at the deadline; a failing action
  is retried `n` times.

**Acceptance:** `cd frontend && npx tsc --noEmit` clean; both tests green. **Feeds:** INC-10
(templates inherit), INC-9 (harness asserts bounds). **Outcome:** _(filled on completion)_

---

## INCREMENT 5 — One engine; delete dead HITL path (Gap 5) 🟡
**Goal:** WorkflowManager is the sole engine; remove the processor's contradictory
skip-and-proceed HITL path so there's one HITL semantic.

**Files / anchors:** `processor.py:325-360` (`_execute_step` HITL skip), `:424-603`
(`_run_workflow` dormant fire-and-forget path), `:697` (`_check_manager_available`).

**Tasks:**
- ☐ 5.1 Confirm prod always has `process_instances` (migration 043) → manager always engaged;
  remove or guard the fire-and-forget fallback so HITL can't silently skip.
- ☐ 5.2 Delete/neutralize `_run_workflow`'s HITL skip + dependency-skip block (dead in prod).
- ☐ 5.3 Keep one documented code path; update module docstrings.

**Targeted test (CI):** `pipeline/tests/test_engine_single_path.py` — assert a HITL template
routed through the live path pauses (never returns `skipped: hitl_wait_v1`).

**Acceptance:** pytest green; INC-1 tests still green (regression gate). **Feeds:** INC-6.
**Outcome:** _(filled on completion)_

---

## INCREMENT 6 — Wire `on_timeout` / `on_failure` (Gap 6) 🟡
**Goal:** Declared escalation/compensation actually runs.

**Files / anchors:** `base.py:101-102` (fields, read nowhere), `manager.py:408-474`
(failure/timeout handling), templates set `on_timeout` (`on_proposal_advanced.py:196` etc.).

**Tasks:**
- ☐ 6.1 On step timeout (incl. park `wait_deadline` from INC-1): if `on_timeout` set, run that
  Job/step before failing; record transition.
- ☐ 6.2 On step failure after retries: if `on_failure` set, run it (compensation) before
  marking instance failed.
- ☐ 6.3 Validate `on_timeout`/`on_failure` reference real steps/Jobs in `Workflow.validate()`.

**Targeted test (CI):** `pipeline/tests/test_escalation.py` — a step that times out triggers
its `on_timeout`; a failing step triggers `on_failure`.

**Acceptance:** pytest green. **Feeds:** INC-10. **Outcome:** _(filled on completion)_

---

## INCREMENT 7 — Collapse SHRED + SCOUT duplicates (Gap 7) 🟡
**Goal:** One canonical implementation per Job.

**Files / anchors:** SHRED canonical `shredder/runner.py`; wrappers `actions/shred.py`,
`workers/rfp_shredder.py` (DEAD), `dispatcher.py:231`. SCOUT `source-scout.ts` ≈
`workers/source_scout.py` (full reimplementation).

**Tasks:**
- ☐ 7.1 Delete `workers/rfp_shredder.py` (orphan); confirm no import breaks.
- ☐ 7.2 Pick canonical SCOUT = Python worker; make the TS tool call the pipeline (enqueue
  `scout_source`) rather than reimplement, OR extract the shared contract + a single source of
  the Claude prompt. Decide in 7.2a, record in Outcome.
- ☐ 7.3 Ensure both shred entry points emit the SAME event surface (`rfp.shredded`) so
  downstream consumers don't diverge (audit §10.6).

**Targeted test (CI):** regression — `test_shred_event_surface.py` asserts both shred paths
emit `finder:rfp.shredded`. SCOUT: assert one canonical code path exercised.

**Acceptance:** pytest + tsc green; no orphan-import errors. **Feeds:** INC-10.
**Outcome:** _(filled on completion)_

---

## INCREMENT 8 — Remove dead mechanisms; fix silent no-ops (Gap 8) 🟡
**Goal:** No live rule points at a missing/failing handler; dead code gone.

**Tasks:**
- ☐ 8.1 CMS `unpublish_content`: implement the handler (rule is live) OR deactivate the rule.
- ☐ 8.2 `distribute_social`: gate behind a feature flag / mark inactive until LinkedIn is
  implemented (today every post fails).
- ☐ 8.3 `ai/review` route: register `proposal.review_section` OR remove the route + point UI at
  the real `proposal.draft_section` revise path.
- ☐ 8.4 Remove dead `agent_task_queue` dispatcher entrypoint + `AutomationEngine` orphan + the
  5 empty stub workers (embedder/emailer/grinder/reminder/document_fetcher) — or keep with a
  clear `NotImplemented`/V2 marker if a stub is intentionally reserved. Decide per item.

**Targeted test (CI):** `test_no_phantom_executors.py` — every active `automation_rules.action_type`
has a handler; every route-referenced tool is registered.

**Acceptance:** test green. **Feeds:** INC-9. **Outcome:** _(filled on completion)_

---

## INCREMENT 9 — Golden-test gate (Gap 9) 🟡
**Goal:** Reliability is mechanical: a Job can't enter a template until golden-green.

**Tasks:**
- ☐ 9.1 Harness `pipeline/tests/jobs/` (fixture in → assert output + asserted emitted events;
  external services stubbed, internal code real).
- ☐ 9.2 Golden tests for the 5 action Jobs (shred, extract_compliance, match_tenants,
  create_default_categories, generate_preview, create_drafts_from_scout).
- ☐ 9.3 CI gate: add a check that any Job cited by a template has a golden test.

**Targeted test (CI):** the harness itself + the per-Job goldens.

**Acceptance:** all goldens green in CI. **Feeds:** INC-10 (gate). **Outcome:** _(filled)_

---

## INCREMENT 10 — Author `proposal_build`; relocate by axis 🟢
**Goal:** Compose the canonical template by reference; move Jobs→`jobs/` (domain), templates→
`process_templates/` (outcome).

**Tasks:**
- ☐ 10.1 Relocate action Jobs to `pipeline/src/jobs/<domain>_jobs.py` (re-export shims to avoid
  breaking dotted-path `Step.action` until templates updated).
- ☐ 10.2 Relocate templates to `pipeline/src/process_templates/`.
- ☐ 10.3 Author `proposal_build.py` (V3 §7) citing Jobs by reference, all golden-gated.
- ☐ 10.4 Update `discover_workflows()` path + admin route labels.

**Acceptance:** discovery registers all templates; tsc/pytest green. **Outcome:** _(filled)_

---

## INCREMENT 11–13 — P2/V2 🟢
- **11 (Gap 10):** loop/depth guardrail per `correlationId` (refuse self-triggered re-spawn
  beyond depth N). Test: a cyclic trigger stops at depth N.
- **12 (Gap 11):** add RLS `CREATE POLICY` on agent memory tables keyed on a session GUC, OR
  formally document isolation = `WHERE tenant_id` and fix CLAUDE.md's RLS claim. Decide.
- **13 (Gap 12):** activate agent loop (producer + consumer + AI_INVOKE bridge) and optionally
  LISTEN/NOTIFY transport. Large; V2.

---

## Change log (append per increment)
- 2026-05-31 — Plan created. Docs (V3 + CLIFFNOTES) locked at `13411c5`.
