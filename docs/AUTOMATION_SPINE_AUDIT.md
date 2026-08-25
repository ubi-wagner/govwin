# Automation spine audit — 2026-08-25

**Is the trigger → start → end chain actually closed, everywhere, so a new automation can be
dropped into an existing workflow without ceremony?**

Run it:

```
cd frontend && node scripts/audit-automation-spine.mjs          # full report
node scripts/audit-automation-spine.mjs --check                 # self-test the joins only
node scripts/fix-open-event-brackets.mjs --dry                  # the codemod's plan, touching nothing
```

---

## The answer

**The trigger side and every step's interior are airtight. Two holes were found and closed:
the event bracket a throw walked out of, and eight notifications with no renderer.**

| Join | Question | Result |
|---|---|---|
| 1 | every workflow trigger ↔ something that emits it | **0 dead** — all 34 workflows can fire |
| 2 | every step `wait_for` ↔ something that emits it | **0 dead** — no step parks on a phantom |
| 3 | every `emitEventStart` ↔ an `end` on every exit path | **31 open brackets — fixed** |
| 4 | what is declared ↔ what the corpus has recorded | 394 emittable · 130 exercised here |
| 5 | `end` events ↔ triggers that consume them | 66 attachment points free |
| 6 | every step's `action` ↔ an implementation that exists | **0 unresolvable** — all 117 steps land |
| 7 | every NOTIFY step ↔ a renderer that exists | **8 with no renderer — written** |

Joins 1–5 cover the *edges* of a workflow — what starts it and what it emits. Joins 6 and 7 cover
its *interior*: whether each step can actually do the thing it declares. A workflow can have a live
trigger, a closed bracket, and a step that resolves to nothing.

Nothing in this audit is inference: the trigger side comes from `discover_workflows()` — the same
call the engine makes at boot — and the emitting side from the AST, the two languages, and the two
places the platform keeps emitters as *data*.

---

## What was broken: 31 brackets a throw walked out of

The canonical route template wraps a handler in one `try`, and `emitEventStart` lands inside it:

```ts
try {
  const startId = await emitEventStart({ namespace: 'finder', type: 'source.created', … });
  …work…
  await emitEventEnd(startId, { result: … });
  return NextResponse.json({ data });
} catch (e) {
  return NextResponse.json({ error: …, code: 'DB_ERROR' }, { status: 500 });   // ← no end
}
```

If anything in between throws, the `start` row is never terminated. Two such rows sat in the
sandbox corpus (`proposal.created`, both from the portal) as standing proof.

**This is not cosmetic**, and the reason is the thing this audit is about:

- `docs/EVENT_CONTRACT.md` §2 states it outright — *"a handler that emits `start` MUST emit `end` on
  every exit path (success return AND catch block)"*.
- The engine is **built on that guarantee**. `EventTrigger.matches()` returns false for any event
  carrying `error`, with the comment *"a failed op still emits a terminal phase='end' event (with
  error set + empty payload); matching it spawns junk workflow instances with no inputs."* A handler
  that emits nothing gives the engine **no terminal event at all** — so anything downstream waits
  forever, with nothing to tell it the wait is pointless.
- `duration_ms` is computed on `end`, so the failure path — the one you most want timed — had none.
- The audit trail kept a row saying "started" and never said anything else.

**Why it was written that way matters**: `const startId` is declared *inside* the try, so it is not
in scope in the catch. Closing the bracket there was a syntax error, not an oversight. Every one of
the 31 sites had made the same forced choice.

### The fix, in three parts

1. **`withEventBracket()`** (`frontend/lib/events.ts`) — new code should not have to remember any of
   this. It emits `start`, runs the body, emits `end` with a result on success or with `error` on a
   throw, **and rethrows** so the caller's own catch still shapes the HTTP response. Instrumentation
   never changes control flow; it only guarantees the bracket closes first.

2. **`scripts/fix-open-event-brackets.mjs`** — an AST codemod for the 31 sites that predate it:
   hoists the binding to `let startId: string | null = null` above the try, and closes the bracket
   as the first thing the catch does. 28 files, +151/−29.

3. **The guard, so the next one cannot be written.** `event-contract.test.ts` already claimed
   "orphan brackets" as check 3 — but *per file*: "this file has a start, does it have an end
   somewhere?" All 31 passed it, because each file did close the bracket, on the success path.
   Check 4 is now per *try*, via the AST: a start inside a try whose catch **returns** must have an
   end in that catch. A catch that rethrows is fine — the bracket is the caller's to close.

Red-first: check 4 was run against the 28 unfixed files and reported all 31 before the fix landed.

### One test asserted the old behaviour

`proposals-create.test.ts` had `'DB failure inside sql.begin → 500 and emitEventEnd is NOT called'`,
reasoning that *"the proposal was not created → emitEventEnd signals completion"*.

That reads `end` as **succeeded**. The contract says it means **terminated**, and the `error` column
is what distinguishes them — which is precisely why the engine refuses to trigger on an `end`
carrying `error`. Emitting the failed `end` cannot start anything; *not* emitting it strands every
downstream waiter. The test now asserts the contract: the bracket closes, carries the error, and
carries no `result`.

---

## How to drop a new automation in

This is what the audit exists to make safe, and it is shorter than it looks. There are exactly two
shapes, and the platform already supports both.

### A. React to something that already happens

Find an `end` nothing consumes (there are 66 — `docs/automation-spine-audit.json`, or §5 of the
report), and write a workflow whose trigger names it:

```python
class OnSourceUpdated(Workflow):
    trigger = EventTrigger(namespace="finder", type="source.updated", phase="end")
    steps = [Step(name="rescan", action="scout.rescan_source", input_map={"sourceId": "payload.sourceId"})]
```

No emitter to write, no route to touch. `discover_workflows()` picks it up at boot and
`validate()` gates it. The trigger fires on the **`end`**, so it runs after the operation actually
finished — and never on the failure, because `matches()` skips events carrying `error`.

### B. A workflow someone starts on purpose

Declare a **single-phase** trigger. `launchTemplate()` (`lib/process/launch-template.ts`) reads
`process_templates.trigger_key`, parses `namespace:type:phase`, and emits it — so **every registered
single-phase trigger is launchable from the admin UI with no code written for it.** It refuses
anything that is not `phase='single'`, because a launch is one fire and a bracketed template is
reactive by nature.

The shared cron is the same idea: a `pipeline_schedules` row with `run_type='event'` and
`source='system:ops.digest_requested'` makes the event fire on a cadence. Four workflows run this
way. **The event type is configuration, not code.**

### Nesting one automation inside another

Chain on domain events, not on the engine. A step in workflow A emits a domain `end`; workflow B
triggers on it. This is deliberate: `validate()` **rejects** any workflow triggering on
`system:workflow.*`, because the processor's poll excludes those to stop the engine triggering
itself. So the composition unit is the *domain event*, which is exactly why join 3 mattered — a
dropped `end` is a broken link between two automations.

---

## Join 6 — every step resolves

`_execute_action()` resolves a dotted `module.function` with `importlib` **at execution time**. A
typo passes `validate()`, registers cleanly, and raises mid-instance the first time the workflow
runs for real. `validate()` gates unmapped `AI_INVOKE` actions at boot for exactly this reason; the
`ACTION` case had no equivalent, so the audit now resolves all of them the same way the engine will.

**All 117 steps land**: 65 `ai_invoke` (all mapped in `TOOL_ACTION_TO_ARCHETYPE`), 26 `action` (all
importable), 16 `notify`, 9 `todo`, 1 `hitl_wait`. Zero unresolvable.

Two dispatcher branches say "not implemented in V1" and are worth knowing about:

- **`API_CALL` steps are skipped.** There are none, so it is moot — but a new one would silently
  no-op, and `validate()` would not object. The audit reports any that appear.
- **`HITL_WAIT` steps are skipped** *in the dispatcher* — and never reach it. `manager.py:539`
  intercepts `TODO` and `HITL_WAIT` alike and parks the instance, so the one `hitl_wait` step
  (`OnApplicationAccepted.schedule_login_reminder`, waiting on `identity:user.logged_in`) gates
  correctly. The dispatcher branch is unreachable defence, exactly as its comment claims.

## Join 7 — the notification that never sends

A NOTIFY step names a template as a **string**; the CRM, a different service with a different
database, defines one. Nothing compared them.

**Eight of the fifteen named templates existed nowhere.** `render_template()` returned None and
`_handle_notification_requested` emitted `system:notification.failed` instead of an email — loudly,
to its credit, but no mail. Six of the eight had already been requested in this sandbox: 13 of its
30 notification requests.

| workflow step | template |
|---|---|
| `OnCmsContentRequested.notify_author` | `content_published` |
| `OnCollaboratorInvited.notify_admin_partner_draft` | `partner_onboarding_ready` |
| `OnContentResurfaceRequested.email_curation` | `content_reshare_ready` |
| `OnIngestAssessmentRequested.notify_admin` | `ingest_assessment_ready` |
| `OnOpsDigestRequested.notify_master_admin` | `ops_digest_ready` |
| `OnSocialScheduleRequested.email_social_queue` | `social_queue_ready` |
| `OnSolicitationReviewRequested.notify_reviewer` | `curation_qa_ready` |
| `OnSolicitationUpdateScan.notify_admin` | `amendment_delta_ready` |

**This is the second time.** The `TEMPLATES.update({...})` block in `services/cms/src/templates.py`
carries the note from the first: *"absence meant rfp_admin stopped being notified (the 052
regression)"*. It recurs because neither side fails at boot — the workflow registers fine, the CRM
starts fine, and the only symptom is mail that never arrives.

All eight are written, following the existing `_layout` / `_button` / defensive-`p.get()` pattern,
with payload fields taken from each step's own `input_map` (which `_execute_notify` spreads into the
event payload verbatim). Each renders from an **empty** payload as well as a populated one — a
template that raises returns None and drops the mail exactly like a missing one.

`pipeline/tests/test_notify_templates_exist.py` is the guard, proven red on the eight before the
fix. It reads the registry with the **AST**, because it is assembled in two pieces (`TEMPLATES = {}`
then `TEMPLATES.update({})`) and a regex over `'name': lambda` catches both today only by luck — it
would silently miss a third piece.

## The extension surface

66 bracketed operations emit an `end` that no workflow consumes yet. Every one is an attachment
point requiring no code change beyond the new workflow:

| namespace | free `end` events | examples |
|---|---|---|
| `finder` | 29 | `amendment.confirmed`, `annotation.saved`, `compliance.extracted`, `source.updated` |
| `proposal` | 18 | `compliance.checked`, `draft.completed`, `outcome.attributed`, `gate_requirement.toggled` |
| `system` | 8 | `content.page_published`, `content.document_saved` |
| `tool` | 5 | `agent.invoked`, `memory.stored` |
| `capture` | 4 | `application.rejected`, `team_member.invited` |
| `identity` | 1 | `user.password_changed` |
| `library` | 1 | `package.atomized` |

Not a defect list — headroom. 13 `end` events already have a workflow attached.

---

## The one place the spine is deliberately asymmetric

The workflow **engine instruments its own work with six unpaired `single`s**:
`workflow.instance_created` · `_started` · `_completed` · `_failed` · `_cancelled` · `_recovered`,
plus `workflow.step_started` / `_completed`. In this corpus that is **1,088 rows with zero
`duration_ms` and zero `parent_event_id`**. The mechanical cause is visible in one line:
`WorkflowManager._emit_event()` takes no `phase` parameter at all, so everything it writes is
`single` by construction.

**This was examined and left alone, on purpose.** The case for bracketing it is real but small, and
the case against is concrete:

- The data is **already authoritative elsewhere**. `process_instances` carries `started_at`,
  `completed_at`, `trigger_event_id` and `correlation_id` — duration and parentage are a column
  read away. The event stream is the notification, not the record.
- Nothing can trigger on these events anyway: the processor poll excludes `system:workflow.*` and
  `validate()` rejects such a trigger at registration. Bracketing them buys no composability.
- `emit_end()` **re-derives `type` from the start row**, so bracketing `instance_started` →
  `instance_completed` would collapse three distinct terminal type names (`_completed`, `_failed`,
  `_cancelled`) into one. That is a vocabulary change across 1,088 rows and every saved query and
  operator habit built on them, bought for observability the table already provides.

The one genuine ergonomic cost: **"which instances are hung" does not answer to the standard orphan
query.** Use the instance table, which is authoritative:

```sql
SELECT id, workflow_name, status, started_at, last_heartbeat_at
FROM process_instances
WHERE status NOT IN ('completed', 'cancelled')
  AND last_heartbeat_at < now() - interval '1 hour';
```

If that asymmetry ever needs closing, the shape is: give `_emit_event` a `phase` and a
`parent_event_id`, emit `instance_started` as `start` parented to `trigger_event_id`, and emit the
terminals as `end` **without** going through `emit_end()`'s type re-derivation, so the three names
survive.

---

## What the instrument got wrong first

The first run reported **9 workflows that could never fire and 1 step parked on a phantom event**.
All ten were false. Every one was a real emit mechanism the scan did not know about — and the
pattern is worth keeping, because the platform has *five* ways to emit and only two are ordinary
function calls:

| The miss | What it reported | The mechanism |
|---|---|---|
| literals only | `OnRfpUploaded` dead | the type is a **ternary**: `existingSolId ? 'rfp.attached' : 'rfp.uploaded'` |
| literals only | both `AdvisoryOverlay` workflows dead | **module constants**: `namespace=_OVERLAY_NAMESPACE, type=_OVERLAY_TYPE` |
| `emitEvent*` calls only | a HITL gate waiting forever | **raw INSERT** — `auth.ts` writes `identity:user.logged_in` directly (allowlisted in the contract guard) |
| source files only | 4 scheduled workflows dead | **the shared cron** — the event lives in `pipeline_schedules.source` |
| source files only | `ProjectCollaboration` dead | **the generic launcher** — the event lives in `process_templates.trigger_key` |

Three more surfaced while verifying:

- A Python function splitter that treated **nested `def`s** as new functions, so
  `analyze_section_diff` looked like it leaked a bracket — it closes it from a nested `def _end()`.
- A count that matched **one emit twice** (`_emit_start(` *and* its `phase="start"` kwarg), making
  the balanced `draft_v0` look unbalanced.
- A self-test pinned to a **real defect**: "the detector finds `proposals/create/route.ts`" was true,
  hand-verified, and became a failure the moment the bracket was closed — leaving only the choice of
  deleting the check or keeping the bug. It now carries a **synthetic control**: two handlers,
  identical but for the one line that matters, which the detector must tell apart before any clean
  result above is believed.

Three event types are still emitted with no emitter the scan can see, and that is honest rather than
fixable: `workflow.instance_*` is built by an f-string (`f"workflow.instance_{final_status}"`), so
no literal exists anywhere.

---

## What this still does not cover

"Every action, event and workflow" is the goal; this is the honest edge of it. Each item below was
looked at and left, with the reason — a surface nobody has an expectation for is **uncovered, not
passing**.

**Covered, for the record.** All three services emit into the same `system_events` table and all
three are in the bracket scan: the frontend (`emitEvent*`, 31 open brackets found and closed), the
pipeline (`emit_event`/`emit_start`/`emit_end`, 0 unbalanced), and the CRM
(`emit_system_event`, 8 sites, 2 bracketed pairs — `action.{type}` in `event_listener.py` and
`drip.step_sent` in `drip_engine.py`, both closing on the error path as well as the success one).

**Not covered:**

1. **The engine's own instance lifecycle** — six unpaired `single`s, deliberately. Reasoning and the
   exact shape of the change are in the section above; the data is authoritative in
   `process_instances` either way.
2. **`on_timeout` / `on_failure` handlers.** `validate()` proves they name real steps. Nothing proves
   the timeout path emits anything, or that a handler step is itself reachable. A step that times out
   into a handler that also fails is not modelled here.
3. **Anything resolved at run time.** One NOTIFY step takes its template from `payload.completeTemplate`;
   `workflow.instance_*` types are built by an f-string; `EventTrigger.condition` and
   `Step.condition` are Python lambdas over payloads. All are reported as unresolvable rather than
   silently counted either way — but they are not checked.
4. **`input_map` semantics.** `validate()` proves a `step.<name>` reference points at a transitive
   `depends_on` ancestor. It does not prove the referenced field will *exist* in that step's result.
5. **"Never fired here" is not "unreachable."** Join 4's 267 never-exercised (ns,type,phase)
   combinations describe this sandbox's history, not the product's capability.
6. **The audit proves a workflow CAN fire, not that it does the right thing.** Every join here is
   structural. Whether `OnSolicitationPushed` fans out correctly is a question for the drives and the
   e2e specs, not for this instrument.

## Verification

`tsc` 0 · `vitest` 1968 pass · `pytest` 1319 pass / 9 skipped / 0 failed · `next build` clean ·
14/14 audit self-tests · joins 1, 2, 3, 6 and 7 all zero, and the audit exits non-zero if any of
them is not.

Both fixes proven **red first** on the same build: check 4 reported all 31 open brackets against the
28 unfixed files, and `test_notify_templates_exist.py` reported all 8 missing templates before they
were written.

⚠️ Run the pipeline tests as `python3 -m pytest` **with `scripts/sandbox-env.sh` sourced**. The
`pytest` on `PATH` is a uv-managed tool that cannot see `asyncpg` (66 collection errors), and
without `DATABASE_URL` the ~22 live-DB tests do not skip — they run and fail at connect, which reads
exactly like a broken pipeline. See docs/CONTINUATION.md §2.
