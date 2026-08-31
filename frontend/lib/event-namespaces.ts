/**
 * THE EVENT-NAMESPACE REGISTRY — the one TypeScript copy, in a module with NO imports.
 *
 * ── WHY IT LIVES HERE AND NOT IN `lib/events.ts` ─────────────────────────────────────────────
 * It started in `lib/events.ts`, next to the emitters. That module imports `@/lib/db`, which
 * imports `postgres`, which reaches `net` and `node:async_hooks` — all server-only. The moment a
 * CLIENT component imported the registry (`app/admin/events/event-stream-client.tsx`, to build its
 * namespace filter), the whole chain was pulled into the browser bundle and the build failed:
 *
 *     Module build failed: UnhandledSchemeError: Reading from "node:async_hooks" …
 *     Import trace: node:async_hooks → lib/tenant-context.ts → lib/db.ts → lib/events.ts
 *                   → app/admin/events/event-stream-client.tsx
 *
 * `tsc` and vitest both passed. **A client component importing a server module is invisible to
 * both** — only `next build` sees it, which is why the verification backbone runs a build for
 * risky changes.
 *
 * So: zero imports here, deliberately, and it must stay that way.
 * `__tests__/event-namespace-registry.test.ts` asserts it.
 *
 * ── THE REGISTRY ITSELF ──────────────────────────────────────────────────────────────────────
 * Eight namespaces. `project` = post-award delivery: baselines, milestone gates, deliverable
 * acceptance. None of the other seven owns that — `proposal` is the PRE-award workspace, `capture`
 * is the customer lifecycle up to purchase, `system` is infra.
 *
 * Three copies is the floor: this one, `pipeline/src/events.py` (Python cannot import TypeScript),
 * and `system_events_namespace_chk` in Postgres (which can import neither, and is the only one that
 * FAILS rather than warns). The registry test reconciles all three plus the migration SQL and every
 * document that writes the list out.
 */
export const EVENT_NAMESPACES = [
  'finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool',
  'project',
] as const;

export type EventNamespace = (typeof EVENT_NAMESPACES)[number];

/** Never these, in any position (docs/EVENT_CONTRACT.md §4). */
export const FORBIDDEN_NAMESPACES = ['admin', 'cms', 'spotlight'] as const;
