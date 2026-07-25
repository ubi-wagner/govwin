/**
 * Per-request tenant context (docs/RLS_CUTOVER.md) — the choke-point that makes the
 * NOBYPASSRLS cutover a ~4-file change instead of 73 call-site edits.
 *
 * A route resolves its tenant once (verifyTenantAccess) and calls `enterTenant(id)`, or an
 * admin path calls `enterBypass()`. The context-aware `sql` client (lib/db.ts) reads this
 * store: when a tenant context is active it runs each query inside a `SET LOCAL
 * app.tenant_id` transaction, so RLS scopes it; a bypass context (or no context) passes
 * straight through. `enterWith` sets the store for the remainder of the current async
 * execution (the request), so all downstream `sql`/lib calls inherit it with no threading.
 *
 * SAFETY: with NO context entered — every code path today — `sql` is byte-identical to the
 * raw client (pure passthrough), so this is inert until the choke points are wired AND a
 * request enters a context. And because every tenant query already carries a `WHERE
 * tenant_id` predicate (verified by the launch sweep), a wrong/unset GUC can only DENY-ALL
 * (a caught break), never leak — the app-layer predicate stays the primary filter.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext { tenantId: string | null; bypass: boolean }

// Cache the ALS on globalThis so there is EXACTLY ONE instance even if this module is
// evaluated more than once (Next dev module reloading, bundler edge-cases, mixed import
// specifiers). Two instances = the context set by one is invisible to the db-client Proxy
// reading the other — a silent DENY-ALL. The Symbol.for keying guarantees the singleton.
const GKEY = Symbol.for('govwin.tenantContextALS');
const g = globalThis as unknown as { [GKEY]?: AsyncLocalStorage<TenantContext> };
const store: AsyncLocalStorage<TenantContext> = g[GKEY] ?? (g[GKEY] = new AsyncLocalStorage<TenantContext>());

/** Pin the current async execution to a tenant — the context-aware `sql` sets its GUC. */
export function enterTenant(tenantId: string): void {
  store.enterWith({ tenantId, bypass: false });
}

/** Mark the current async execution as a legitimate cross-tenant (owner/bypass) read. */
export function enterBypass(): void {
  store.enterWith({ tenantId: null, bypass: true });
}

/** The active context, or undefined (→ `sql` passthrough). */
export function currentTenantContext(): TenantContext | undefined {
  return store.getStore();
}

/** Scoped variant (wraps fn) — for drives/tests and non-request callers. */
export function runInTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ tenantId, bypass: false }, fn);
}
