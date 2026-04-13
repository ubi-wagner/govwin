# Tool Conventions

Binding specification for the dual-use Tool framework.

See also: [API_CONVENTIONS.md](./API_CONVENTIONS.md), [EVENT_CONTRACT.md](./EVENT_CONTRACT.md), [NAMESPACES.md](./NAMESPACES.md), [ERROR_HANDLING.md](./ERROR_HANDLING.md), and the authoring guide at `frontend/lib/tools/README.md`.

---

## Why tools

Phase 0.5b solves the dual-use problem: agents and users both need to invoke the same business logic, and we refuse to write it twice. A **Tool** is the single business-logic implementation; an API route is a thin adapter over a Tool; a pipeline worker dequeues agent tasks and invokes Tools through the same registry.

**One implementation, three entry points.** If a developer writes `memory.search` once, it's automatically available to:

1. **Direct in-process call** from any API route or server component: `await invoke('memory.search', input, ctx)`
2. **HTTP** via the generic adapter `POST /api/tools/[name]` with a NextAuth session
3. **Agent fabric** (Phase 4) via the pipeline dispatcher polling `agent_task_queue` and POSTing to (2)

Adding a new capability is a one-file change (a new tool) — no API route boilerplate, no agent-side wiring.

---

## Tool interface

Full TypeScript (from `frontend/lib/tools/base.ts`):

```ts
export interface Tool<I = unknown, O = unknown> {
  name: string;              // unique, dotted — e.g. 'memory.search'
  namespace: string;         // top-level bucket from NAMESPACES.md
  description: string;       // for agent catalog + admin UI
  inputSchema: ZodSchema<I>; // parsed by the registry before handler runs
  requiredRole?: Role;       // minimum role — undefined means any authenticated actor
  tenantScoped: boolean;     // if true, ctx.tenantId must be non-null
  handler: (input: I, ctx: ToolContext) => Promise<O>;
}
```

**Invariants enforced at registration** (by `lib/tools/registry.ts::register()`):
- `name` is unique across the whole registry — duplicate throws
- `name` starts with `namespace + '.'` — mismatch throws
- The tool is added to an in-memory `Map` and listed by `list()` / queryable by `get()`

---

## `ToolContext`

The only thing a handler receives besides its typed `input`:

```ts
export interface ToolContext {
  actor: ToolActor;          // who's invoking (user, system, pipeline, agent)
  tenantId: string | null;   // null when the caller has no tenant (master_admin)
  requestId: string;         // per-invocation correlation id
  parentEventId?: string;    // for nested event trees
  log: Logger;               // pino child already scoped to 'tools' + tool name
}

export interface ToolActor {
  type: 'user' | 'system' | 'pipeline' | 'agent';
  id: string;
  email?: string;
  role?: Role;
}
```

**Where the context comes from:**

| Entry point | `ctx.actor` | `ctx.tenantId` | Built by |
|---|---|---|---|
| API route `withHandler` → `invoke()` direct | `type: 'user'`, from session | `session.user.tenantId` | API route handler body |
| `POST /api/tools/[name]` HTTP adapter | `type: 'user'`, from session | `session.user.tenantId` | `frontend/app/api/tools/[name]/route.ts` |
| Pipeline dispatcher (Phase 4) | `type: 'agent'` or `type: 'pipeline'`, id from `agent_task_queue.agent_role` | `agent_task_queue.tenant_id` | `pipeline/src/tools/dispatcher.py` |

---

## Actor types

| Type | When to use |
|---|---|
| `user` | Authenticated end user invoking via a browser or API call |
| `system` | Platform-level action with no specific user (migrations, cron, seed) |
| `pipeline` | Pipeline worker doing background work on its own (ingestion, scoring) |
| `agent` | AI agent invoking a tool through the Phase 4 agent fabric |

---

## `defineTool` helper

Type-inference helper for authoring tools — lets you define a tool without repeating the `<I, O>` generic arguments:

```ts
import { z } from 'zod';
import { defineTool } from '@/lib/tools/base';

export const memorySearch = defineTool({
  name: 'memory.search',
  namespace: 'memory',
  description: 'Text search over the tenant\u2019s agent memories.',
  inputSchema: z.object({ query: z.string().min(1), limit: z.number().default(10) }),
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    // input is typed as { query: string; limit: number }
    // ctx.tenantId is guaranteed non-null because tenantScoped=true
    // ...
    return { results: [] };
  },
});
```

---

## Registry (`frontend/lib/tools/registry.ts`)

Four exports make up the entire public API:

```ts
export function register<I, O>(tool: Tool<I, O>): void;
export function get(name: string): Tool | null;
export function list(): Tool[];
export async function invoke<O>(name: string, input: unknown, ctx: ToolContext): Promise<O>;
```

Plus `__resetForTest()` for integration test setup.

### `invoke()` — the enforcement chain

Every tool invocation goes through `invoke()`. This is a hard rule: the handler is not exported from the tool file, only the Tool object. The registry is the only way to run a tool.

`invoke()` runs in exactly this order:

1. **Lookup** by name. Throw `ToolNotFoundError` if missing.
2. **Role check**: if `requiredRole` is set, verify `hasRoleAtLeast(ctx.actor.role, tool.requiredRole)`. Throw `ToolAuthorizationError` on failure. `master_admin` always satisfies any required role.
3. **Tenant scope check**: if `tool.tenantScoped === true`, verify `ctx.tenantId !== null`. Throw `ToolValidationError` on failure.
4. **Input validation**: parse `input` through `tool.inputSchema.safeParse()`. Throw `ToolValidationError` with formatted zod issues on failure.
5. **Emit `tool.invoke.start` event** to `system_events` via `lib/events.ts::emitEventStart`. The returned event id becomes `parentEventId` for nested invocations.
6. **Call `tool.handler(parsedInput, handlerCtx)`** inside a try.
7. **On success**: emit `tool.invoke.end` with `{ outcome: 'success', result_shape }`, record a `tool_invocation_metrics` row with `success: true`, return the handler result.
8. **On failure**: emit `tool.invoke.end` with `{ outcome: 'error', error: payload }`, record a `tool_invocation_metrics` row with `success: false, error_code`, re-throw.

Known exceptions to the re-throw: unknown errors (anything without `httpStatus`) are wrapped in `ToolExecutionError` so the HTTP mapping stays consistent. Typed `AppError` subclasses (`NotFoundError`, `ForbiddenError`, etc.) propagate as-is.

**No tool can bypass this chain.** Registration-time checks enforce the name/namespace invariant; the enforcement chain runs on every `invoke()`. The contract is executable — see `frontend/__tests__/tools-registry.test.ts` for the 16 tests that pin every branch.

---

## Tenant isolation rule

**The ONLY way a tool reaches tenant scope is `ctx.tenantId`.** Never from `input`. Every SQL query inside a tool handler that touches tenant-scoped data MUST include `WHERE tenant_id = ${ctx.tenantId}`.

The registry validates `tenantScoped === true → ctx.tenantId !== null` before calling the handler, so handlers of tenant-scoped tools can safely assume `ctx.tenantId` is non-null (narrow it explicitly for TypeScript — see `lib/tools/memory-search.ts` for the pattern).

**Anti-patterns that break the isolation contract:**
- Accepting `tenant_id` or `tenant_slug` in the input schema
- Trusting a JOIN chain instead of a direct `WHERE tenant_id` filter
- Using `tenantScoped: false` for a tool that reads tenant data "just for convenience"

---

## Error handling

Tools throw `ToolError` subclasses (from `lib/tools/errors.ts`):

| Class | HTTP | Code |
|---|---|---|
| `ToolValidationError` | 422 | `TOOL_VALIDATION_ERROR` |
| `ToolAuthorizationError` | 403 | `TOOL_AUTHORIZATION_ERROR` |
| `ToolNotFoundError` | 404 | `TOOL_NOT_FOUND` |
| `ToolExecutionError` | 500 (overridable) | `TOOL_EXECUTION_ERROR` |
| `ToolExternalError` | 502 | `TOOL_EXTERNAL_ERROR` |

All extend `AppError` from `lib/errors.ts`, so the `withHandler` HTTP mapping in `lib/api-helpers.ts` works unchanged.

**Tools never return `null` to signal errors.** `null` means "no row found, which is a valid empty result" (e.g., `memory.search` returns `{ results: [] }`, not `null`). Error conditions throw.

---

## Audit logging

Every tool invocation produces **exactly two** rows in `system_events`:

1. **`tool.invoke.start`** — phase `start`, payload `{ tool, input_keys }`, parent_event_id from `ctx.parentEventId` for nested calls
2. **`tool.invoke.end`** — phase `end`, parent_event_id points at the start event, payload `{ outcome: 'success' | 'error', result_shape? }` or `error: { message, code, details? }`, `duration_ms` populated

Plus one row in `tool_invocation_metrics` via `lib/capacity.ts::recordInvoke` with `{ tool_name, tool_namespace, actor_type, actor_id, tenant_id, success, error_code, duration_ms }`.

The admin panel at `/admin/system` reads both tables to show recent activity and p50/p95 latency per tool.

**Nested tools** share a parent: if `memory.write` calls `memory.search` internally, the inner call's events carry `parent_event_id = outerStartEventId` so the event tree reconstructs cleanly. Callers can pass `ctx.parentEventId` through unchanged and the registry handles the threading.

---

## Dual-use entry points

### 1. Direct in-process call

```ts
import { invoke } from '@/lib/tools';
import type { ToolContext } from '@/lib/tools';

const ctx: ToolContext = buildCtxFromSession(session, requestId, log);
const result = await invoke<{ results: Memory[] }>('memory.search', { query: 'foo' }, ctx);
```

Fastest path; no network, no JSON serialization. Use from any API route that needs direct tool access (e.g., a complex handler that invokes multiple tools in sequence).

### 2. HTTP via `/api/tools/[name]`

```http
POST /api/tools/memory.search HTTP/1.1
Cookie: authjs.session-token=...
Content-Type: application/json

{ "input": { "query": "foo", "limit": 10 } }
```

Response:
```json
{ "data": { "results": [...], "count_by_type": {...} } }
```

On error (422 example):
```json
{ "error": "tool input failed schema validation", "code": "TOOL_VALIDATION_ERROR", "details": { "issues": [...] } }
```

The generic adapter lives at `frontend/app/api/tools/[name]/route.ts` and handles every registered tool without per-tool route files. Authentication is via NextAuth session cookie; the session's `tenantId` + `role` become the `ToolContext` automatically.

### 3. Pipeline dispatcher (Phase 4)

```python
# pipeline/src/tools/dispatcher.py
async def dispatch_next_task():
    task = await dequeue_pending()  # SELECT ... FOR UPDATE SKIP LOCKED
    result = await httpx.post(
        f"{FRONTEND_URL}/api/tools/{task.tool_name}",
        json={"input": task.input},
        headers={"X-Tool-Service-Token": SERVICE_TOKEN},  # Phase 5
    )
    await persist_result(task, result)
```

Skeleton exists in Phase 0.5b; full implementation lands in Phase 4 alongside the agent runtime. The interesting part is that Phase 4 needs **zero frontend changes** to invoke any tool — the registry and the HTTP adapter already handle it.

---

## Authoring a new tool

1. **Check [NAMESPACES.md §"Tool namespaces"](./NAMESPACES.md)** — the top-level bucket you're using must be registered. Adding a new namespace requires a PR touching that doc.
2. **Create `frontend/lib/tools/<kebab-name>.ts`** exporting `defineTool({...})`.
3. **Write the zod schema** for input. Use primitives from `lib/validation.ts` where possible.
4. **Implement the handler**. Throw `ToolError` subclasses on failure; return the success value directly.
5. **Register** in `frontend/lib/tools/index.ts`:
   ```ts
   import { myNewTool } from './my-new-tool';
   register(myNewTool);
   ```
6. **Write a test** in `frontend/__tests__/` that invokes the tool through the registry (not the handler directly). For tenant-scoped tools, verify tenant isolation by invoking twice with different `ctx.tenantId` values.
7. **Done.** The tool is now invokable via all three entry points with no additional wiring.

See `frontend/lib/tools/README.md` for the full step-by-step walkthrough with examples.

---

## Worked examples

### Example A — `memory.search` (tenant-scoped read)

**File:** `frontend/lib/tools/memory-search.ts`

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { sql } from '@/lib/db';

const MemoryType = z.enum(['episodic', 'semantic', 'procedural']);

const InputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  memoryTypes: z.array(MemoryType).min(1).default(['episodic', 'semantic', 'procedural']),
  agentRole: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(10),
});

interface MemoryHit {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  agentRole: string | null;
  content: string;
  createdAt: string;
}

export const memorySearch = defineTool({
  name: 'memory.search',
  namespace: 'memory',
  description: 'Text search over the tenant\u2019s agent memories (episodic/semantic/procedural).',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    // Registry guarantees ctx.tenantId is non-null when tenantScoped = true.
    const tenantId = ctx.tenantId as string;
    const pattern = `%${input.query}%`;
    const results: MemoryHit[] = [];

    if (input.memoryTypes.includes('episodic')) {
      const rows = await sql<MemoryHit[]>`
        SELECT id, 'episodic' AS type, agent_role AS "agentRole",
               content, created_at AS "createdAt"
        FROM episodic_memories
        WHERE tenant_id = ${tenantId}
          AND content ILIKE ${pattern}
          AND (${input.agentRole ?? null}::text IS NULL OR agent_role = ${input.agentRole ?? ''})
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `;
      results.push(...rows);
    }

    // ...similar blocks for semantic_memories and procedural_memories

    const countByType: Record<string, number> = {};
    for (const r of results) countByType[r.type] = (countByType[r.type] ?? 0) + 1;

    ctx.log.debug({ tenantId, found: results.length }, 'memory search complete');
    return { results: results.slice(0, input.limit), countByType };
  },
});
```

**Tenant check pattern:** every SELECT includes `WHERE tenant_id = ${tenantId}`. The registry has already asserted `ctx.tenantId !== null`.

**Audit logging:** automatic. The registry emits `tool.invoke.start` before calling the handler and `tool.invoke.end` after, with `duration_ms` and `result_shape: { resultCount: results.length }`. The handler itself logs a debug line for in-process correlation.

**Unit test skeleton:**

```ts
import { register, invoke, __resetForTest } from '@/lib/tools/registry';
import { memorySearch } from '@/lib/tools/memory-search';

beforeEach(() => {
  __resetForTest();
  register(memorySearch);
});

test('isolates by tenant', async () => {
  // seed: tenant A has 2 matching memories, tenant B has 3
  const ctxA = makeCtx({ tenantId: TENANT_A });
  const ctxB = makeCtx({ tenantId: TENANT_B });
  const a = await invoke<{ results: unknown[] }>('memory.search', { query: 'shared' }, ctxA);
  const b = await invoke<{ results: unknown[] }>('memory.search', { query: 'shared' }, ctxB);
  expect(a.results).toHaveLength(2);
  expect(b.results).toHaveLength(3);
});

test('rejects missing tenantId for tenantScoped tool', async () => {
  await expect(
    invoke('memory.search', { query: 'x' }, makeCtx({ tenantId: null })),
  ).rejects.toThrow('tenant scope required');
});
```

**API adapter:** none needed. The generic `/api/tools/[name]/route.ts` adapter serves this tool automatically.

---

### Example B — `memory.write` (tenant-scoped write)

**File:** `frontend/lib/tools/memory-write.ts`

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { sql } from '@/lib/db';

const InputSchema = z.discriminatedUnion('memoryType', [
  z.object({
    memoryType: z.literal('episodic'),
    agentRole: z.string().min(1),
    content: z.string().min(1).max(10_000),
    eventType: z.string().min(1),
    refs: z.record(z.string()).default({}),
  }),
  z.object({
    memoryType: z.literal('semantic'),
    agentRole: z.string().min(1),
    content: z.string().min(1).max(10_000),
    category: z.string().min(1),
  }),
  z.object({
    memoryType: z.literal('procedural'),
    agentRole: z.string().min(1),
    content: z.string().min(1).max(10_000),
    procedureName: z.string().min(1),
  }),
]);

export const memoryWrite = defineTool({
  name: 'memory.write',
  namespace: 'memory',
  description: 'Insert one memory row for the tenant. Zero-embedding until Phase 4 backfills real vectors.',
  inputSchema: InputSchema,
  requiredRole: 'tenant_user',
  tenantScoped: true,
  async handler(input, ctx) {
    const tenantId = ctx.tenantId as string;

    if (input.memoryType === 'episodic') {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO episodic_memories (tenant_id, agent_role, event_type, content, refs)
        VALUES (${tenantId}, ${input.agentRole}, ${input.eventType}, ${input.content}, ${JSON.stringify(input.refs)})
        RETURNING id
      `;
      ctx.log.info({ tenantId, id: row.id, type: 'episodic' }, 'memory written');
      return { id: row.id, memoryType: 'episodic' as const };
    }

    if (input.memoryType === 'semantic') {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO semantic_memories (tenant_id, agent_role, category, content)
        VALUES (${tenantId}, ${input.agentRole}, ${input.category}, ${input.content})
        RETURNING id
      `;
      return { id: row.id, memoryType: 'semantic' as const };
    }

    const [row] = await sql<{ id: string }[]>`
      INSERT INTO procedural_memories (tenant_id, agent_role, procedure_name, content)
      VALUES (${tenantId}, ${input.agentRole}, ${input.procedureName}, ${input.content})
      RETURNING id
    `;
    return { id: row.id, memoryType: 'procedural' as const };
  },
});
```

**Tenant check pattern:** the INSERT includes `tenant_id = ${tenantId}` from `ctx.tenantId`. The input never carries a `tenant_id` field.

**Audit logging:** registry-driven start/end events plus handler-level `ctx.log.info` on success.

**Unit test skeleton:**

```ts
test('discriminated union routes episodic vs semantic', async () => {
  const ctx = makeCtx({ tenantId: TENANT_A });
  const ep = await invoke<{ memoryType: string }>('memory.write', {
    memoryType: 'episodic', agentRole: 'finder', content: 'x', eventType: 'test.created',
  }, ctx);
  expect(ep.memoryType).toBe('episodic');

  const se = await invoke<{ memoryType: string }>('memory.write', {
    memoryType: 'semantic', agentRole: 'finder', category: 'domain', content: 'x',
  }, ctx);
  expect(se.memoryType).toBe('semantic');
});

test('rejects cross-tenant write attempt via input', async () => {
  const ctx = makeCtx({ tenantId: TENANT_A });
  // The input schema has no tenant field — this call writes to TENANT_A regardless
  // of anything the caller tries. Verified by querying the row back with TENANT_B.
  const { id } = await invoke<{ id: string }>('memory.write', {
    memoryType: 'semantic', agentRole: 'x', category: 'y', content: 'z',
  }, ctx);
  const inB = await sql`SELECT id FROM semantic_memories WHERE id = ${id} AND tenant_id = ${TENANT_B}`;
  expect(inB).toHaveLength(0);
});
```

**API adapter:** generic `/api/tools/[name]/route.ts`.

---

### Example C — `opportunity.get_by_id` (global read, admin-gated)

**File:** `frontend/lib/tools/opportunity-get-by-id.ts` (Phase 1)

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { sql } from '@/lib/db';
import { ToolNotFoundError } from './errors';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({
  opportunityId: zUuid,
});

interface OpportunityDetail {
  id: string;
  title: string;
  agency: string | null;
  source: string;
  sourceUrl: string | null;
  dueDate: string | null;
  compliance: Array<{ id: string; section: string; requirement: string }>;
}

export const opportunityGetById = defineTool({
  name: 'opportunity.get_by_id',
  namespace: 'opportunity',
  description: 'Look up a single opportunity by id, including its solicitation compliance matrix.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false, // opportunities are global
  async handler(input, ctx) {
    const [opp] = await sql<OpportunityDetail[]>`
      SELECT id, title, agency, source, source_url AS "sourceUrl",
             due_date AS "dueDate"
      FROM opportunities
      WHERE id = ${input.opportunityId}
      LIMIT 1
    `;
    if (!opp) throw new ToolNotFoundError(`opportunity ${input.opportunityId} not found`);

    const compliance = await sql<Array<{ id: string; section: string; requirement: string }>>`
      SELECT sc.id, sc.section, sc.requirement
      FROM solicitation_compliance sc
      JOIN curated_solicitations cs ON cs.id = sc.solicitation_id
      WHERE cs.opportunity_id = ${input.opportunityId}
      ORDER BY sc.section, sc.id
    `;

    ctx.log.info({ opportunityId: input.opportunityId, complianceRows: compliance.length }, 'opportunity fetched');
    return { ...opp, compliance };
  },
});
```

**Tenant check pattern:** none — `tenantScoped: false`. Global visibility is acceptable because `requiredRole: 'rfp_admin'` prevents tenant users from calling it. The baseline rule holds: a tool is either tenant-scoped OR gated on an admin role, never neither.

**Audit logging:** registry-driven. The `actor` field on the start/end events records which admin ran the lookup — important for the audit trail of who has viewed which solicitations.

**Unit test skeleton:**

```ts
test('tenant_user is rejected', async () => {
  const ctx = makeCtx({ role: 'tenant_user', tenantId: TENANT_A });
  await expect(
    invoke('opportunity.get_by_id', { opportunityId: SAMPLE_OPP }, ctx),
  ).rejects.toThrow('TOOL_AUTHORIZATION_ERROR');
});

test('rfp_admin reads any opportunity regardless of tenant', async () => {
  const ctx = makeCtx({ role: 'rfp_admin', tenantId: null });
  const out = await invoke<{ id: string; compliance: unknown[] }>(
    'opportunity.get_by_id', { opportunityId: SAMPLE_OPP }, ctx,
  );
  expect(out.id).toBe(SAMPLE_OPP);
});

test('unknown id throws ToolNotFoundError → 404', async () => {
  const ctx = makeCtx({ role: 'rfp_admin', tenantId: null });
  await expect(
    invoke('opportunity.get_by_id', { opportunityId: '00000000-0000-0000-0000-000000000000' }, ctx),
  ).rejects.toThrow(/not found/);
});
```

**API adapter:** generic `/api/tools/[name]/route.ts`. An admin-only wrapper is unnecessary because the `requiredRole` check inside `invoke()` runs regardless of entry point.

---

## Phase 1 worked examples — curation tools

These examples are the canonical Phase 1 curation tools. They exercise the three hardest patterns in the curation workspace: race-safe atomic state transitions (`solicitation.claim`), external-service calls with no DB writes (`compliance.extract_from_text`), and cross-table namespace filtering over the three memory tables (`memory.search_namespace`). Each example is followed by its unit test skeleton and the paper-thin API route that adapts it to HTTP.

### Example D — `solicitation.claim` (race-safe atomic state transition)

**File:** `frontend/lib/tools/solicitation-claim.ts`

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { ConflictError, NotFoundError } from '@/lib/errors';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({
  solicitationId: zUuid,
});

interface ClaimResult {
  solicitationId: string;
  claimedBy: string;
  claimedAt: string;
}

export const solicitationClaim = defineTool({
  name: 'solicitation.claim',
  namespace: 'solicitation',
  description: 'Claim an unclaimed solicitation into the calling rfp_admin\u2019s triage queue. Race-safe.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false, // curation is global admin scope, not tenant scope
  async handler(input, ctx) {
    // Step 1: verify the row exists at all. We need this so the caller
    // gets a distinct 404 vs 409 instead of a generic "already claimed".
    const [existing] = await sql<Array<{ id: string; status: string; claimedBy: string | null }>>`
      SELECT id, status, claimed_by AS "claimedBy"
      FROM curated_solicitations
      WHERE id = ${input.solicitationId}
      LIMIT 1
    `;
    if (!existing) {
      throw new NotFoundError('solicitation not found', { solicitationId: input.solicitationId });
    }
    if (existing.status !== 'new' || existing.claimedBy !== null) {
      throw new ConflictError('solicitation is not available to claim', {
        solicitationId: input.solicitationId,
        currentStatus: existing.status,
        currentClaimedBy: existing.claimedBy,
      });
    }

    // Step 2: atomic UPDATE. The WHERE clause enforces the invariant a
    // second time inside the SQL engine, so a concurrent claim by
    // another admin loses the race cleanly (zero rows returned).
    const [claimed] = await sql<Array<{ id: string; claimedBy: string; claimedAt: Date }>>`
      UPDATE curated_solicitations
      SET status = 'claimed',
          claimed_by = ${ctx.actor.id},
          claimed_at = now(),
          updated_at = now()
      WHERE id = ${input.solicitationId}
        AND status = 'new'
        AND claimed_by IS NULL
      RETURNING id, claimed_by AS "claimedBy", claimed_at AS "claimedAt"
    `;

    if (!claimed) {
      // The pre-check passed but the UPDATE affected zero rows — a
      // concurrent claim won the race between step 1 and step 2.
      throw new ConflictError('solicitation was claimed by another user', {
        solicitationId: input.solicitationId,
      });
    }

    // Step 3: fire an instantaneous event for the audit trail. The
    // registry is already emitting tool.invoke.start/end; this event
    // is the business-domain event that other subsystems (memory,
    // metrics, UIs) care about.
    await emitEventSingle({
      namespace: 'finder',
      type: 'rfp.triage_claimed',
      actor: { type: ctx.actor.type, id: ctx.actor.id, email: ctx.actor.email },
      tenantId: null, // curation is not tenant-scoped
      payload: { solicitation_id: claimed.id },
      parentEventId: ctx.parentEventId ?? null,
    });

    const result: ClaimResult = {
      solicitationId: claimed.id,
      claimedBy: claimed.claimedBy,
      claimedAt: claimed.claimedAt.toISOString(),
    };
    ctx.log.info({ solicitationId: claimed.id, claimedBy: claimed.claimedBy }, 'solicitation claimed');
    return result;
  },
});
```

**Why the UPDATE is race-safe:** the `WHERE status = 'new' AND claimed_by IS NULL` clause runs inside the same SQL statement as the assignment. Postgres serializes row-level writes, so exactly one concurrent `UPDATE` succeeds and every other concurrent `UPDATE` touches zero rows. The zero-row case maps to a `ConflictError`. There is no time window between check and write — the invariant lives inside the database, not in application code.

**What the pre-check buys you:** nothing that affects correctness — the atomic UPDATE alone is sufficient. The pre-SELECT exists purely to return a useful 404 when the row doesn't exist at all. Without it, a missing row and an already-claimed row would both return the same generic 409. Worth the extra roundtrip for the UX.

**Unit test skeleton:**

```ts
import { register, invoke, __resetForTest } from '@/lib/tools/registry';
import { solicitationClaim } from '@/lib/tools/solicitation-claim';
import { NotFoundError, ConflictError } from '@/lib/errors';

beforeEach(() => {
  __resetForTest();
  register(solicitationClaim);
});

test('claims an unclaimed new solicitation', async () => {
  const solId = await seedSolicitation({ status: 'new', claimedBy: null });
  const ctx = makeCtx({ role: 'rfp_admin', actorId: ADMIN_A });
  const out = await invoke<{ solicitationId: string; claimedBy: string }>(
    'solicitation.claim', { solicitationId: solId }, ctx,
  );
  expect(out.claimedBy).toBe(ADMIN_A);
  const [row] = await sql`SELECT status, claimed_by FROM curated_solicitations WHERE id = ${solId}`;
  expect(row.status).toBe('claimed');
  expect(row.claimed_by).toBe(ADMIN_A);
});

test('throws NotFoundError for unknown solicitation id', async () => {
  const ctx = makeCtx({ role: 'rfp_admin', actorId: ADMIN_A });
  await expect(
    invoke('solicitation.claim', { solicitationId: '00000000-0000-0000-0000-000000000000' }, ctx),
  ).rejects.toThrow(NotFoundError);
});

test('throws ConflictError when already claimed', async () => {
  const solId = await seedSolicitation({ status: 'claimed', claimedBy: ADMIN_B });
  const ctx = makeCtx({ role: 'rfp_admin', actorId: ADMIN_A });
  await expect(
    invoke('solicitation.claim', { solicitationId: solId }, ctx),
  ).rejects.toThrow(ConflictError);
});

test('race: only one of two concurrent claims wins', async () => {
  const solId = await seedSolicitation({ status: 'new', claimedBy: null });
  const ctxA = makeCtx({ role: 'rfp_admin', actorId: ADMIN_A });
  const ctxB = makeCtx({ role: 'rfp_admin', actorId: ADMIN_B });
  const results = await Promise.allSettled([
    invoke('solicitation.claim', { solicitationId: solId }, ctxA),
    invoke('solicitation.claim', { solicitationId: solId }, ctxB),
  ]);
  const wins = results.filter((r) => r.status === 'fulfilled');
  const losses = results.filter((r) => r.status === 'rejected');
  expect(wins).toHaveLength(1);
  expect(losses).toHaveLength(1);
  expect((losses[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
});
```

**API route wrapper** (`frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts`):

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';
import { zUuid } from '@/lib/validation';

export const POST = withHandler({
  scope: 'api',
  inputSchema: z.object({ solId: zUuid }),
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    return invoke('solicitation.claim', { solicitationId: input.solId }, {
      actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    });
  },
});
```

Six lines of handler body. Every error path (404, 409, race-loss) is translated by the registry + wrapper with zero per-route plumbing.

---

### Example E — `compliance.extract_from_text` (read-only external-service call)

**File:** `frontend/lib/tools/compliance-extract-from-text.ts`

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { ToolExternalError } from './errors';

const SourceLocation = z.object({
  page: z.number().int().min(0),
  offset: z.number().int().min(0),
  length: z.number().int().min(1),
});

const InputSchema = z.object({
  solicitationId: z.string().uuid(),
  textFragment: z.string().min(1).max(50_000),
  sourceLocation: SourceLocation,
});

export interface ComplianceVariableSuggestion {
  name: string;       // matches compliance_variables.name
  category: string;   // matches compliance_variables.category
  value: string;      // the extracted value
  confidence: number; // 0..1
}

const SHREDDER_URL = process.env.PIPELINE_URL ?? 'http://pipeline:8000';

export const complianceExtractFromText = defineTool({
  name: 'compliance.extract_from_text',
  namespace: 'compliance',
  description: 'Ask the shredder worker to extract compliance variable candidates from a highlighted text fragment.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false,
  async handler(input, ctx) {
    // The shredder is the Python pipeline worker. Phase 1 Section D
    // lands the `/internal/shred` endpoint; until then this tool is
    // skeleton-only and the test double below is the reference
    // implementation.
    let response: Response;
    try {
      response = await fetch(`${SHREDDER_URL}/internal/shred`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-request-id': ctx.requestId,
        },
        body: JSON.stringify({
          solicitation_id: input.solicitationId,
          text: input.textFragment,
          source: input.sourceLocation,
        }),
      });
    } catch (err) {
      throw new ToolExternalError('shredder worker unreachable', {
        upstream: 'pipeline.shredder',
        cause: err instanceof Error ? err.message : String(err),
      });
    }

    if (!response.ok) {
      const bodyText = await response.text().catch(() => '');
      throw new ToolExternalError('shredder worker returned non-2xx', {
        upstream: 'pipeline.shredder',
        status: response.status,
        body: bodyText.slice(0, 1000),
      });
    }

    const body = (await response.json()) as { suggestions?: unknown };
    const suggestions = parseSuggestions(body.suggestions);

    ctx.log.info(
      { solicitationId: input.solicitationId, count: suggestions.length },
      'shredder returned suggestions',
    );
    return { suggestions };
  },
});

function parseSuggestions(raw: unknown): ComplianceVariableSuggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      name: String(r.name ?? ''),
      category: String(r.category ?? ''),
      value: String(r.value ?? ''),
      confidence: typeof r.confidence === 'number' ? r.confidence : 0,
    }))
    .filter((s) => s.name && s.category);
}
```

**Why no DB writes:** this tool is explicitly pure-read. The curation UI shows the returned suggestions, the curator ticks the ones they accept, and the UI calls `compliance.save_variable_value` once per acceptance. Splitting extraction from persistence keeps the UI in charge of the human-in-the-loop approval step, keeps the tool idempotent, and lets us retry the shredder call without worrying about duplicate writes. If this tool wrote its own rows, a reload of the curation panel would re-insert the same suggestions every time.

**Unit test skeleton (with mocked fetch):**

```ts
import { register, invoke, __resetForTest } from '@/lib/tools/registry';
import { complianceExtractFromText } from '@/lib/tools/compliance-extract-from-text';
import { ToolExternalError } from '@/lib/tools/errors';

beforeEach(() => {
  __resetForTest();
  register(complianceExtractFromText);
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('parses shredder response into typed suggestions', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({
        suggestions: [
          { name: 'page_limit_technical', category: 'format', value: '15', confidence: 0.92 },
          { name: 'font_family', category: 'format', value: 'Times New Roman', confidence: 0.81 },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );

  const ctx = makeCtx({ role: 'rfp_admin' });
  const out = await invoke<{ suggestions: Array<{ name: string }> }>(
    'compliance.extract_from_text',
    {
      solicitationId: '550e8400-e29b-41d4-a716-446655440000',
      textFragment: 'The technical volume shall not exceed 15 pages, Times New Roman 12pt.',
      sourceLocation: { page: 3, offset: 120, length: 64 },
    },
    ctx,
  );

  expect(out.suggestions).toHaveLength(2);
  expect(out.suggestions[0].name).toBe('page_limit_technical');
});

test('non-2xx upstream → ToolExternalError with upstream details', async () => {
  jest.spyOn(global, 'fetch').mockResolvedValue(
    new Response('shredder crashed: OOM', { status: 500 }),
  );
  const ctx = makeCtx({ role: 'rfp_admin' });
  await expect(
    invoke('compliance.extract_from_text', {
      solicitationId: '550e8400-e29b-41d4-a716-446655440000',
      textFragment: 'hello',
      sourceLocation: { page: 0, offset: 0, length: 5 },
    }, ctx),
  ).rejects.toMatchObject({
    constructor: ToolExternalError,
    details: { upstream: 'pipeline.shredder', status: 500 },
  });
});

test('fetch throws → ToolExternalError with cause', async () => {
  jest.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
  const ctx = makeCtx({ role: 'rfp_admin' });
  await expect(
    invoke('compliance.extract_from_text', {
      solicitationId: '550e8400-e29b-41d4-a716-446655440000',
      textFragment: 'x',
      sourceLocation: { page: 0, offset: 0, length: 1 },
    }, ctx),
  ).rejects.toThrow(ToolExternalError);
});
```

**API route wrapper** (`frontend/app/api/admin/rfp-curation/[solId]/extract/route.ts`):

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';

const BodySchema = z.object({
  textFragment: z.string().min(1).max(50_000),
  sourceLocation: z.object({
    page: z.number().int().min(0),
    offset: z.number().int().min(0),
    length: z.number().int().min(1),
  }),
  solicitationId: z.string().uuid(),
});

export const POST = withHandler({
  scope: 'api',
  inputSchema: BodySchema,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    return invoke('compliance.extract_from_text', input, {
      actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    });
  },
});
```

> Note: the `/internal/shred` endpoint on the pipeline side lands in Phase 1 Section D. Until then this tool is a skeleton; the test suite mocks `fetch` and the wire contract is stable.

---

### Example F — `memory.search_namespace` (cross-table namespace filter)

**File:** `frontend/lib/tools/memory-search-namespace.ts`

```ts
import { z } from 'zod';
import { defineTool } from './base';
import { sql } from '@/lib/db';
import { ToolValidationError } from './errors';

// {agency}:{program_office}:{type}:{phase} per NAMESPACES.md §"Memory namespaces"
const NAMESPACE_KEY_RE = /^[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+:[a-z0-9_]+$/;

const InputSchema = z.object({
  namespaceKey: z.string().regex(NAMESPACE_KEY_RE, {
    message: 'namespaceKey must match {agency}:{program_office}:{type}:{phase}',
  }),
  limit: z.number().int().min(1).max(200).optional(),
  kind: z.enum(['episodic', 'semantic', 'procedural']).optional(),
});

export interface NamespaceMemory {
  id: string;
  kind: 'episodic' | 'semantic' | 'procedural';
  namespace: string;
  agentRole: string;
  content: string;
  createdAt: string;
}

export const memorySearchNamespace = defineTool({
  name: 'memory.search_namespace',
  namespace: 'memory',
  description: 'Return memories whose namespace matches the given {agency}:{program_office}:{type}:{phase} key or any descendant of it. Admin-scoped, cross-tenant.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',
  tenantScoped: false, // curation memories are admin-scoped, not tenant-scoped
  async handler(input, ctx) {
    // Extra belt-and-suspenders validation. The zod regex already
    // guarantees this, but throwing ToolValidationError here gives a
    // consistent error shape when the regex is relaxed in the future.
    if (!NAMESPACE_KEY_RE.test(input.namespaceKey)) {
      throw new ToolValidationError('malformed namespaceKey', { namespaceKey: input.namespaceKey });
    }

    const prefixPattern = `${input.namespaceKey}:%`;
    const limit = input.limit ?? 50;
    const results: NamespaceMemory[] = [];

    // NOTE: the three memory tables currently key by (tenant_id, agent_role)
    // from 001_baseline.sql; a `namespace` column is added in the Phase 1
    // migration that lands alongside this tool. Until then the query below
    // targets the Phase 1 schema.

    if (!input.kind || input.kind === 'episodic') {
      const rows = await sql<NamespaceMemory[]>`
        SELECT id, 'episodic'::text AS kind, namespace,
               agent_role AS "agentRole", content,
               created_at AS "createdAt"
        FROM episodic_memories
        WHERE (namespace = ${input.namespaceKey} OR namespace LIKE ${prefixPattern})
          AND NOT is_archived
        ORDER BY embedding <-> (SELECT embedding FROM episodic_memories
                                WHERE namespace = ${input.namespaceKey}
                                ORDER BY created_at DESC LIMIT 1)
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    if (!input.kind || input.kind === 'semantic') {
      const rows = await sql<NamespaceMemory[]>`
        SELECT id, 'semantic'::text AS kind, namespace,
               agent_role AS "agentRole", content,
               created_at AS "createdAt"
        FROM semantic_memories
        WHERE (namespace = ${input.namespaceKey} OR namespace LIKE ${prefixPattern})
          AND is_active
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    if (!input.kind || input.kind === 'procedural') {
      const rows = await sql<NamespaceMemory[]>`
        SELECT id, 'procedural'::text AS kind, namespace,
               agent_role AS "agentRole",
               description AS content,
               created_at AS "createdAt"
        FROM procedural_memories
        WHERE (namespace = ${input.namespaceKey} OR namespace LIKE ${prefixPattern})
          AND is_active
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;
      results.push(...rows);
    }

    ctx.log.debug(
      { namespaceKey: input.namespaceKey, count: results.length, kind: input.kind ?? 'any' },
      'namespace memory search complete',
    );
    return { results: results.slice(0, limit), count: results.length };
  },
});
```

**How this differs from `memory.search`:** the existing `memory.search` tool is query-text-scoped — you give it a search string and it scans the calling tenant's memories via ILIKE or vector distance against that string. `memory.search_namespace` is namespace-scoped — you give it a structured namespace key (or a prefix) and it returns every memory tagged with that namespace across all tenants. It's the tool the curation UI calls when an admin opens a solicitation and wants to see "everything the fabric learned about `afrl:afwerx:sbir:phase_1`". `memory.search` answers "what do we know about X in my tenant"; `memory.search_namespace` answers "what have we globally learned about this agency/program/phase".

**Unit test skeleton:**

```ts
import { register, invoke, __resetForTest } from '@/lib/tools/registry';
import { memorySearchNamespace } from '@/lib/tools/memory-search-namespace';
import { ToolValidationError } from '@/lib/tools/errors';

beforeEach(() => {
  __resetForTest();
  register(memorySearchNamespace);
});

test('returns memories whose namespace matches exactly', async () => {
  const ns = 'afrl:afwerx:sbir:phase_1';
  await seedMemory({ kind: 'episodic', namespace: ns });
  await seedMemory({ kind: 'semantic', namespace: 'afrl:afwerx:sbir:phase_2' });

  const ctx = makeCtx({ role: 'rfp_admin' });
  const out = await invoke<{ results: Array<{ namespace: string }> }>(
    'memory.search_namespace', { namespaceKey: ns }, ctx,
  );
  expect(out.results).toHaveLength(1);
  expect(out.results[0].namespace).toBe(ns);
});

test('returns descendants via LIKE prefix match', async () => {
  await seedMemory({ kind: 'episodic', namespace: 'afrl:afwerx:sbir:phase_1' });
  await seedMemory({ kind: 'episodic', namespace: 'afrl:afwerx:sbir:phase_1:topic_x' });

  const ctx = makeCtx({ role: 'rfp_admin' });
  const out = await invoke<{ results: unknown[] }>(
    'memory.search_namespace', { namespaceKey: 'afrl:afwerx:sbir:phase_1' }, ctx,
  );
  expect(out.results).toHaveLength(2);
});

test('filters by kind when provided', async () => {
  const ns = 'afrl:afwerx:sbir:phase_1';
  await seedMemory({ kind: 'episodic', namespace: ns });
  await seedMemory({ kind: 'semantic', namespace: ns });

  const ctx = makeCtx({ role: 'rfp_admin' });
  const out = await invoke<{ results: Array<{ kind: string }> }>(
    'memory.search_namespace', { namespaceKey: ns, kind: 'semantic' }, ctx,
  );
  expect(out.results).toHaveLength(1);
  expect(out.results[0].kind).toBe('semantic');
});

test('rejects malformed namespaceKey', async () => {
  const ctx = makeCtx({ role: 'rfp_admin' });
  await expect(
    invoke('memory.search_namespace', { namespaceKey: 'not-a-namespace' }, ctx),
  ).rejects.toThrow(ToolValidationError);
});

test('rejects tenant_user role', async () => {
  const ctx = makeCtx({ role: 'tenant_user' });
  await expect(
    invoke('memory.search_namespace', { namespaceKey: 'afrl:afwerx:sbir:phase_1' }, ctx),
  ).rejects.toThrow(/TOOL_AUTHORIZATION_ERROR/);
});
```

**API route wrapper** (`frontend/app/api/admin/memory/search-namespace/route.ts`):

```ts
import { z } from 'zod';
import { withHandler } from '@/lib/api-helpers';
import { invoke } from '@/lib/tools/registry';

const QuerySchema = z.object({
  namespaceKey: z.string(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  kind: z.enum(['episodic', 'semantic', 'procedural']).optional(),
});

export const GET = withHandler({
  scope: 'api',
  method: 'GET',
  inputSchema: QuerySchema,
  requiredRole: 'rfp_admin',
  async handler(input, ctx) {
    return invoke('memory.search_namespace', input, {
      actor: { type: 'user', id: ctx.actor!.id, email: ctx.actor!.email, role: ctx.actor!.role },
      tenantId: ctx.actor!.tenantId,
      requestId: ctx.requestId,
      log: ctx.log,
    });
  },
});
```

---

## Non-goals

Things tools are NOT:

- **Authentication.** Middleware resolves the session before a route handler runs; tools receive the actor via `ctx` and trust it.
- **HTML rendering.** Tools return typed data. API routes or server components format for the client.
- **Client-specific formatting.** The same tool output goes to the UI and to an agent — the caller projects it as needed.
- **Transaction orchestrators.** Calling `memory.write` then `memory.search` is the caller's concern; tools don't nest transactions across each other.
- **Authorization scopes beyond `requiredRole` + `tenantScoped`.** Finer-grained checks (e.g., "user can only edit their own row") happen inside the handler via explicit checks on `ctx.actor.id` against the row being mutated.
