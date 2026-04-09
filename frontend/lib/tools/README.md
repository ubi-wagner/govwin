# Tool Framework — Authoring Guide

The `frontend/lib/tools/` directory holds the dual-use Tool framework.
A **Tool** is a single business-logic implementation that can be
invoked from three places without duplication:

1. **Direct in-process call** from an API route or server component:
   ```ts
   import { invoke } from '@/lib/tools';
   const result = await invoke('memory.search', { query: 'foo', limit: 10 }, ctx);
   ```
2. **HTTP** via the generic adapter at `POST /api/tools/[name]`
   (added in Section D of the Phase 0.5b plan).
3. **Pipeline worker** dequeueing `agent_task_queue` and POSTing to (2).

See `docs/TOOL_CONVENTIONS.md` for the binding specification of the
`Tool` interface, `ToolContext`, the audit logging contract, and the
tenant isolation rule.

## Files in this directory

| File | Purpose |
|------|---------|
| `base.ts` | The `Tool<I, O>` interface, `ToolContext`, `ToolActor`, `defineTool` helper, `ToolResult` wire envelope |
| `errors.ts` | `ToolValidationError`, `ToolAuthorizationError`, `ToolNotFoundError`, `ToolExecutionError`, `ToolExternalError` — all extend `AppError` so HTTP mapping works unchanged |
| `registry.ts` | In-memory `tools` map, `register()`, `get()`, `list()`, `invoke()` — the single entry point |
| `index.ts` | Imports every tool file and calls `register()` on it — side-effect import |
| `memory-search.ts` | Reference tool: text-search over episodic/semantic/procedural memories, tenant-scoped |
| `memory-write.ts` | Reference tool: insert one memory row, tenant-scoped, discriminated-union input by `memory_type` |
| `README.md` | This file |

## Authoring a new tool — step by step

### 1. Pick a name + namespace

Consult `docs/NAMESPACES.md` §"Tool namespaces" for the authoritative
list of namespaces (`memory`, `opportunity`, `compliance`, `proposal`,
`library`, `tenant`, `solicitation`). Adding a new top-level namespace
requires updating that document in the same PR.

Tool names are dotted: `<namespace>.<verb>` — e.g., `memory.search`,
`opportunity.score`, `proposal.advance_stage`. The registry enforces
that `tool.name.startsWith(tool.namespace + '.')`.

### 2. Define the input schema

Use zod. Import shared primitives from `@/lib/validation` where
possible (`zUuid`, `zEmail`, `zTenantSlug`, `zPassword`, etc.). Every
field the tool reads must be in the schema — the registry parses the
caller's `input` through it before invoking the handler, so anything
not in the schema is dropped.

```ts
import { z } from 'zod';
import { zUuid } from '@/lib/validation';

const InputSchema = z.object({
  opportunity_id: zUuid,
  include_compliance: z.boolean().default(false),
});
```

### 3. Define the output type (optional but recommended)

```ts
interface Output {
  id: string;
  title: string;
  agency: string;
  compliance?: ComplianceMatrix;
}
```

### 4. Implement the handler

```ts
import { defineTool } from './base';
import { ToolExecutionError, ToolNotFoundError } from './errors';
import { sql } from '@/lib/db';

export const opportunityGetById = defineTool<z.infer<typeof InputSchema>, Output>({
  name: 'opportunity.get_by_id',
  namespace: 'opportunity',
  description: 'Fetch a single opportunity by ID, optionally with its compliance matrix.',
  inputSchema: InputSchema,
  requiredRole: 'rfp_admin',      // rfp_admin+ can read curated opportunities
  tenantScoped: false,            // opportunities are global, not tenant-scoped
  async handler(input, ctx) {
    const [row] = await sql<Output[]>`
      SELECT id, title, agency
      FROM opportunities
      WHERE id = ${input.opportunity_id}
      LIMIT 1
    `;
    if (!row) {
      throw new ToolNotFoundError(`opportunity ${input.opportunity_id}`);
    }
    // ... additional logic (e.g., fetch compliance if requested)
    return row;
  },
});
```

### 5. Register it

Open `frontend/lib/tools/index.ts` and add:

```ts
import { opportunityGetById } from './opportunity-get-by-id';
// ... existing imports

register(opportunityGetById);
```

### 6. Write a test

Add an integration test under `frontend/__tests__/tools/` that:

1. Seeds the test DB with a known row via fixtures
2. Invokes the tool through the registry (NOT by calling the handler directly):
   ```ts
   import { invoke } from '@/lib/tools';
   const result = await invoke('opportunity.get_by_id', { opportunity_id: known.id }, testCtx);
   ```
3. Asserts the result shape matches the output type
4. Asserts a `tool.invoke.start` and `tool.invoke.end` event were written to `system_events`
5. Asserts that invoking with a missing id throws `ToolNotFoundError`
6. For tenant-scoped tools, asserts that one tenant's data is NOT visible when `ctx.tenantId` belongs to a different tenant

### 7. Wire the API route (usually automatic)

The generic `POST /api/tools/[name]` adapter (built in Phase 0.5b
Section D) handles every registered tool automatically. You don't
write a per-tool route file unless you need custom behavior (e.g.,
different auth, streaming response).

## Rules the registry enforces (so you don't have to)

The `registry.invoke()` function is the ONLY way a tool runs. It
enforces these invariants before calling your handler:

1. **Name lookup** — throws `ToolNotFoundError` if the name isn't registered
2. **Role check** — if `requiredRole` is set, throws `ToolAuthorizationError` when `ctx.actor.role < requiredRole` per `hasRoleAtLeast`. `master_admin` always satisfies.
3. **Tenant scope** — if `tenantScoped: true`, throws `ToolValidationError` when `ctx.tenantId` is null
4. **Input validation** — parses `input` through `tool.inputSchema`, throws `ToolValidationError` with formatted zod issues on failure
5. **Audit logging** — emits `tool.invoke.start` to `system_events` before calling the handler, emits `tool.invoke.end` after (with success shape or error payload)
6. **Error translation** — unknown exceptions from the handler are wrapped in `ToolExecutionError`; typed `AppError` subclasses propagate as-is

You can therefore assume inside a `tenantScoped: true` handler that
`ctx.tenantId` is non-null, and assume the `input` parameter matches
the schema. Validate nothing beyond that.

## Anti-patterns

- **Reading tenant scope from `input`** — never accept `tenant_id` or `tenant_slug` in the input schema. Always read from `ctx.tenantId`.
- **Returning `null` to signal an error** — throw `ToolNotFoundError` or `ToolExecutionError` instead.
- **Using raw `console.error`** — use `ctx.log.error(...)` which is a pino child logger already scoped to `tools` + the tool name.
- **Skipping the registry** — never import a tool's handler and call it directly. You bypass audit logging, authz, and validation.
- **Cross-tenant joins** — if a tool touches two tables, every tenant-scoped table in the query gets its own `tenant_id = ${ctx.tenantId}` filter. Don't rely on FK chains for isolation.

## Testing patterns

See `docs/TESTING_STRATEGY.md` §"Integration tests" for the full
setup. Tool tests live in `frontend/__tests__/tools/` and import from
`@/lib/tools` (not from individual tool files) so they exercise the
registry path.

```ts
import { invoke, __resetForTest } from '@/lib/tools';
import '@/lib/tools';  // triggers registration

beforeEach(() => { /* seed fixtures */ });

test('memory.search returns tenant-scoped rows', async () => {
  const ctx = buildTestCtx({ tenantId: tenantA.id, role: 'tenant_user' });
  const result = await invoke<{ results: MemoryHit[] }>('memory.search', { query: 'foo' }, ctx);
  expect(result.results).toHaveLength(3);
  // assert tenant isolation
  const ctx2 = buildTestCtx({ tenantId: tenantB.id, role: 'tenant_user' });
  const result2 = await invoke<{ results: MemoryHit[] }>('memory.search', { query: 'foo' }, ctx2);
  expect(result2.results).toHaveLength(0);
});
```
