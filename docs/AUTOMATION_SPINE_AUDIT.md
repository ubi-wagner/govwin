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

**The trigger side is airtight. The bracket side had one systematic hole, now closed.**

| Join | Question | Result |
|---|---|---|
| 1 | every workflow trigger ↔ something that emits it | **0 dead** — all 34 workflows can fire |
| 2 | every step `wait_for` ↔ something that emits it | **0 dead** — no step parks on a phantom |
| 3 | every `emitEventStart` ↔ an `end` on every exit path | **31 open brackets — fixed** |
| 4 | what is declared ↔ what the corpus has recorded | 394 emittable · 130 exercised here |
| 5 | `end` events ↔ triggers that consume them | 66 attachment points free |

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

## Verification

`tsc` 0 · `vitest` 1964 pass · 12/12 audit self-tests · joins 1, 2 and 3 all zero · the guard proven
red on the 28 unfixed files and green on the same build after the codemod.
