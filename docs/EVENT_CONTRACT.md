# Event Contract

Binding specification for the structured event stream backed by the `system_events` table (see `db/migrations/007_system_events.sql`).

See also: [NAMESPACES.md](./NAMESPACES.md), [TOOL_CONVENTIONS.md](./TOOL_CONVENTIONS.md), [API_CONVENTIONS.md](./API_CONVENTIONS.md).

---

## Why events

Three reasons we have a structured event stream instead of relying on logs:

1. **Audit trail** — every significant action the platform takes is replayable from events. Logs get rotated; events are durable.
2. **Agent fabric subscription** (Phase 4) — AI agents subscribe to event namespaces via `pg_notify` and react in near-real-time. An agent can watch `events:finder` and trigger itself when a new RFP is released for analysis.
3. **Debugging + incident response** — "show me every action this user took in the last 10 minutes" is one SQL query against `system_events`, scoped by `actor_id` + `created_at`.

---

## Event shape

Full TypeScript interface (matches the `system_events` table columns via the postgres.js camelCase transform):

```ts
export interface SystemEvent {
  id: string;                    // UUID, auto-generated
  namespace: string;             // from NAMESPACES.md — e.g. 'finder', 'tool', 'identity'
  type: string;                  // dotted, e.g. 'rfp.curated_and_pushed'
  phase: 'start' | 'end' | 'single';
  actor: {
    type: 'user' | 'system' | 'pipeline' | 'agent';
    id: string;
    email?: string;              // populated for actor_type='user'
  };
  tenantId: string | null;       // populated for tenant-scoped actions
  parentEventId: string | null;  // correlates an 'end' event to its 'start'
  payload: Record<string, unknown>; // JSONB, small (<4KB), serializable, redacted
  error: { message: string; code?: string; details?: unknown } | null;
  durationMs: number | null;     // populated on 'end' events only
  createdAt: string;             // ISO 8601 timestamp
}
```

See the **Schema file** and **Indexes** sections below for the full `CREATE TABLE` and index rationale.

---

## The start/end pattern

Every significant bracketed action writes two rows:

1. **Start** — `emitEventStart({ namespace, type, actor, tenantId, payload })` returns an `eventId`
2. **Action runs** (handler, tool, DB transaction, etc.)
3. **End** — `emitEventEnd(eventId, { result?, error? })` — the wrapper looks up the start row, computes `duration_ms`, writes a second row with `parent_event_id = eventId`

The tool registry uses this exact pattern for every invocation:

```ts
const startId = await emitEventStart({
  namespace: 'tool',
  type: 'invoke.start',
  actor,
  tenantId,
  payload: { tool: name, input_keys: [...] },
});
try {
  const result = await tool.handler(input, ctx);
  await emitEventEnd(startId, {
    result: { outcome: 'success', result_shape: Object.keys(result) },
  });
  return result;
} catch (err) {
  await emitEventEnd(startId, {
    result: { outcome: 'error' },
    error: { message: err.message, code: err.code },
  });
  throw err;
}
```

### When to use `single` instead

For instantaneous events that don't bracket an operation, use `emitEventSingle`. Examples:
- `identity.user.signed_in` — happens once, no duration to measure
- `identity.user.password_changed` — already audited inside a start/end pair, emit a single as a clean "it happened" marker
- `system.deploy.completed` — no meaningful "start" to bracket against

Rule of thumb: if you can meaningfully compute `duration_ms` for the action, use start/end. If the action is atomic from the caller's perspective, use `single`.

---

## Namespace rules

The `namespace` field must be one of the top-level buckets listed in [NAMESPACES.md §"Event namespaces"](./NAMESPACES.md):

| Namespace | Owner phase | What lives in it |
|---|---|---|
| `finder.*` | Phase 1 | Opportunity ingestion, triage, curation, push-to-pipeline |
| `capture.*` | Phase 2 | Customer conversion, Stripe purchases, workspace provisioning |
| `proposal.*` | Phase 3 | Workspace lifecycle, section drafting, stage advancement, submission |
| `agent.*` | Phase 4 | Agent task queue lifecycle, memory writes, agent decisions |
| `identity.*` | Any | Auth, invites, password changes, role assignments |
| `system.*` | Any | Platform operations (deploys, migrations, errors, capacity thresholds) |
| `tool.*` | Any | Tool invocation audit (`tool.invoke.start`, `tool.invoke.end`) — emitted by the registry, not by individual tools |

The `type` field is scoped within the namespace and dotted:
- Start/end pairs: usually a noun.verb form, e.g. `finder.rfp.release_for_analysis` (start) → `finder.rfp.release_for_analysis` (end). The `phase` column distinguishes them.
- Single events: past-tense verb form, e.g. `identity.user.signed_in`, `finder.rfp.curated_and_pushed`.

**Adding a new namespace** requires updating [NAMESPACES.md](./NAMESPACES.md) in the same PR. Adding a new event `type` within an existing namespace does not.

---

## Payload rules

`payload` is a JSONB column. Rules:

1. **Small** — aim for <4KB per row. Large results (memory content, file data) go into dedicated tables, not the event payload.
2. **Serializable** — no `Date` objects, no `undefined`, no functions. Use ISO strings for timestamps.
3. **Redacted** — never include passwords, password hashes, API keys, session tokens, or authorization headers. `lib/logger.ts` has a redaction list; apply the same rules manually when building event payloads.
4. **Structured** — prefer nested objects over stringified JSON-in-JSON. Consumers parse JSONB, not strings.

Example good payload:
```json
{ "tool": "memory.search", "input_keys": ["query", "limit"], "result_count": 7 }
```

Example bad payload:
```json
{ "tool": "memory.search", "password": "!Wags$$", "full_input": "{\"query\":\"foo\"}" }
```

---

## Error rules

The `error` column is `null` on success and populated on failure `end` events:

```ts
error: { message: string; code?: string; details?: unknown }
```

- `message` — human-readable, from `err.message`
- `code` — stable machine-readable, from `AppError.code` if the thrown error is a subclass, otherwise `'UNKNOWN'`
- `details` — optional extra context. May include a stack trace in dev environments; redact in production.

The registry's `invoke()` error path builds this automatically from any thrown `AppError` subclass — handlers don't assemble it manually.

---

## Correlation — `parent_event_id`

Every `end` event points at its `start` event via `parent_event_id`. Nested tools inherit the parent from `ctx.parentEventId`, so the event tree reconstructs cleanly.

### Example: one API call spawning three tool invocations

```
identity.user.signed_in (single)                            ← id: abc, parent: null
finder.rfp.release_for_analysis (start)                     ← id: def, parent: null
  tool.invoke.start (memory.search)                         ← id: ghi, parent: def
  tool.invoke.end (memory.search)                           ← id: jkl, parent: def (points back at start event ghi via separate correlation)
  tool.invoke.start (memory.write)                          ← id: mno, parent: def
  tool.invoke.end (memory.write)                            ← id: pqr, parent: def
  tool.invoke.start (opportunity.score)                     ← id: stu, parent: def
  tool.invoke.end (opportunity.score)                       ← id: vwx, parent: def
finder.rfp.release_for_analysis (end)                       ← parent: def (points back at the start via event lookup)
```

Reconstruction query:
```sql
WITH RECURSIVE tree AS (
  SELECT id, namespace, type, phase, parent_event_id, created_at, 0 AS depth
  FROM system_events
  WHERE id = 'def'
  UNION ALL
  SELECT e.id, e.namespace, e.type, e.phase, e.parent_event_id, e.created_at, t.depth + 1
  FROM system_events e
  JOIN tree t ON e.parent_event_id = t.id
)
SELECT * FROM tree ORDER BY created_at;
```

---

## Events vs logs

| Question | Events | Logs |
|---|---|---|
| Durable? | Yes (until retention policy) | No (rotated) |
| Structured? | Yes (JSONB schema) | Yes (pino JSON) |
| Subscribable in real time? | Yes (Phase 4 via pg_notify) | No |
| Good for debugging a specific request? | OK | Better |
| Good for counting things across time? | Better | OK |
| Agents can read them? | Yes (subscription) | No |

**Rule of thumb**: emit an event if anything phase ≥4 might want to subscribe to or replay; log everything else. Most significant actions emit BOTH — one event for auditability, logs for debugging context.

---

## Subscription model (Phase 4+)

Migration 007 installs a trigger that calls `pg_notify` on every INSERT to `system_events`:

```sql
CREATE OR REPLACE FUNCTION notify_system_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'events:' || NEW.namespace,
    json_build_object('id', NEW.id, 'namespace', NEW.namespace, 'type', NEW.type, 'phase', NEW.phase, 'tenant_id', NEW.tenant_id)::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

Channel naming: `events:{namespace}` — e.g., `events:finder`, `events:agent`, `events:tool`. Subscribers `LISTEN events:finder` and decode the JSON payload to get the row id; they then SELECT the full row if they need the payload.

Phase 4 wires the agent fabric to subscribe. Phase 0.5b only installs the trigger so the infrastructure is ready.

---

## Retention policy (Phase 5+)

Not enforced yet. Documented intent:
- **30 days** for successful events
- **90 days** for error events
- **Permanent** for compliance-relevant events (marked via payload flag)

Phase 5 adds a cron job that runs weekly to prune per these rules. Until then, `system_events` grows monotonically; this is acceptable because V1 pre-launch volumes are low.

---

## API — `lib/events.ts`

Three entry points:

```ts
export async function emitEventStart(params: {
  namespace: string;
  type: string;
  actor: EventActor;
  tenantId?: string | null;
  payload?: Record<string, unknown>;
  parentEventId?: string | null;
}): Promise<string>;  // returns the new row id

export async function emitEventEnd(
  startEventId: string,
  params?: { result?: Record<string, unknown>; error?: { message: string; code?: string; details?: unknown } | null },
): Promise<void>;

export async function emitEventSingle(params: {
  namespace: string;
  type: string;
  actor: EventActor;
  tenantId?: string | null;
  payload?: Record<string, unknown>;
}): Promise<void>;
```

Plus actor helpers: `userActor(id, email?)`, `systemActor(id?)`, `pipelineActor(workerId)`, `agentActor(role, tenantId)`.

**Critical invariant**: these functions NEVER throw. Event emission is best-effort — instrumentation failures are logged via `createLogger('events')` but never propagate to the caller. Business logic must never break because the event table is unreachable.

---

## Worked examples

### 1. `identity.user.signed_in` — single phase

From the NextAuth `signIn` callback (wire in Phase 1 when the event fires):

```ts
import { emitEventSingle, userActor } from '@/lib/events';

await emitEventSingle({
  namespace: 'identity',
  type: 'user.signed_in',
  actor: userActor(user.id, user.email),
  tenantId: user.tenantId,
  payload: { via: 'credentials' },
});
```

### 2. `finder.rfp.curated_and_pushed` — start/end pair

From `app/api/admin/rfp-curation/[solId]/push/route.ts` (Phase 1):

```ts
const startId = await emitEventStart({
  namespace: 'finder',
  type: 'rfp.curated_and_pushed',
  actor: userActor(ctx.actor.id, ctx.actor.email),
  payload: { solicitationId: params.solId },
});
try {
  await pushToPipeline(params.solId);
  await emitEventEnd(startId, { result: { published: true } });
} catch (err) {
  await emitEventEnd(startId, { error: { message: err.message, code: err.code ?? 'UNKNOWN' } });
  throw err;
}
```

### 3. `tool.invoke` — emitted by the registry, not tools

Every tool invocation goes through `lib/tools/registry.ts::invoke()` which emits the start/end pair automatically. Tool authors never call `emitEventStart('tool', ...)` themselves — that would produce duplicate events. Tools emit their own semantic events (e.g., `memory.write` might emit a `memory.persisted` single event), which will carry `parentEventId = ctx.parentEventId` so the registry's `tool.invoke.start` shows up as the parent.

Full registry wrapper (reference implementation for Phase 0.5b):

```ts
// lib/tools/registry.ts
export async function invoke<I, O>(
  name: string,
  input: I,
  ctx: ToolCtx,
): Promise<O> {
  const tool = registry.get(name);
  if (!tool) throw new ToolNotFoundError(name);

  const startId = await emitEventStart({
    namespace: 'tool',
    type: 'invoke',
    actor: ctx.actor,
    tenantId: ctx.tenantId,
    parentEventId: ctx.parentEventId ?? null,
    payload: { tool: name, input_keys: Object.keys(input as object) },
  });
  const childCtx: ToolCtx = { ...ctx, parentEventId: startId };
  try {
    const result = await tool.handler(input, childCtx);
    await emitEventEnd(startId, {
      result: { outcome: 'success', result_keys: Object.keys(result as object) },
    });
    return result as O;
  } catch (err) {
    const appErr = err instanceof AppError ? err : new InternalError(String(err));
    await emitEventEnd(startId, {
      error: {
        message: appErr.message,
        code: appErr.code,
        details: process.env.NODE_ENV === 'production' ? undefined : { stack: appErr.stack },
      },
    });
    throw err;
  }
}
```

---

## Schema file

The canonical CREATE TABLE lives in `db/migrations/007_system_events.sql` (created in Phase 0.5b section B7). Expected shape:

```sql
-- db/migrations/007_system_events.sql
CREATE TABLE IF NOT EXISTS system_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace         TEXT NOT NULL,
    type              TEXT NOT NULL,
    phase             TEXT NOT NULL CHECK (phase IN ('start','end','single')),
    actor_type        TEXT NOT NULL CHECK (actor_type IN ('user','system','pipeline','agent')),
    actor_id          TEXT NOT NULL,
    actor_email       TEXT,
    tenant_id         UUID REFERENCES tenants(id),
    parent_event_id   UUID REFERENCES system_events(id),
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    error             JSONB,
    duration_ms       INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT payload_size_limit CHECK (pg_column_size(payload) < 8192),
    CONSTRAINT end_has_parent CHECK (phase <> 'end' OR parent_event_id IS NOT NULL),
    CONSTRAINT end_has_duration CHECK (phase <> 'end' OR duration_ms IS NOT NULL)
);

-- Indexes: see next section for rationale.
CREATE INDEX IF NOT EXISTS idx_events_ns_type       ON system_events (namespace, type);
CREATE INDEX IF NOT EXISTS idx_events_tenant        ON system_events (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_parent        ON system_events (parent_event_id) WHERE parent_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_created_desc  ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_errors        ON system_events (created_at DESC) WHERE error IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_actor         ON system_events (actor_id, created_at DESC);

-- pg_notify trigger (subscription fabric, Phase 4 consumer)
CREATE OR REPLACE FUNCTION notify_system_event() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify(
    'events:' || NEW.namespace,
    json_build_object(
      'id', NEW.id,
      'namespace', NEW.namespace,
      'type', NEW.type,
      'phase', NEW.phase,
      'tenant_id', NEW.tenant_id
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_events_notify ON system_events;
CREATE TRIGGER system_events_notify
  AFTER INSERT ON system_events
  FOR EACH ROW EXECUTE FUNCTION notify_system_event();
```

The schema is idempotent — re-applying migration 007 is safe.

---

## Indexes

Each index exists for a specific query pattern. Do not add indexes without a documented query.

| Index | Query it serves |
|---|---|
| `(namespace, type)` | "Show me every `finder.rfp.curated_and_pushed` in the last hour" — admin dashboard, retention-cleaner, replay tools |
| `(tenant_id) WHERE tenant_id IS NOT NULL` | Per-tenant audit log: "every action a tenant took" — partial index skips global/system events |
| `(parent_event_id) WHERE parent_event_id IS NOT NULL` | Event-tree reconstruction: finding all children of a start event for the trace viewer |
| `(created_at DESC)` | Default recency ordering for most queries; supports `LIMIT n` scans without a sort |
| `(created_at DESC) WHERE error IS NOT NULL` | Admin "recent errors" panel — partial index keeps this cheap even as the table grows |
| `(actor_id, created_at DESC)` | "Show me everything this user did" — on-call incident response, user-reported bug triage |

Not indexed on purpose:
- `payload` — JSONB indexing is expensive and rarely necessary. Add a functional index per query pattern when one proves needed.
- `duration_ms` — rarely filtered on; add later if a "slow actions" panel is built.
