/**
 * Every delivery route runs INSIDE the tenant context — the defect no lens could see.
 *
 * ── WHAT HAPPENED ────────────────────────────────────────────────────────────────────────────
 * `deliveryGate` called `enterTenant()` from inside itself. `AsyncLocalStorage.enterWith` sets the
 * store for the remainder of the CURRENT execution; a route that `await`s the gate resumes in a
 * different microtask, in the context captured before the await. So the store was gone by the time
 * the handler ran its first query, and **all 20 delivery handlers executed with `app.tenant_id`
 * unset.** RLS matched nothing:
 *
 *     GET   …/projects             → 200 {"data":{"projects":[]}}   for a tenant with two
 *     GET   …/projects/[id]/clins  → 404 Project not found          for a project on screen
 *     PATCH …/deliverables/[id]    → 404 Deliverable not found      on a button the page renders
 *
 * The pages were unaffected — they call `enterTenant` in their own frame — so the workspace
 * rendered perfectly while its entire API returned nothing.
 *
 * ── WHY EVERY LENS PASSED ────────────────────────────────────────────────────────────────────
 * `verify-api-contract` grades the ENVELOPE, and a 404 with `{error, code}` is textbook.
 * `verify-write-contract` asserts a client error answers 4xx with both fields — which a blanket 404
 * does, perfectly, on every verb. `verify-surfaces` and `verify-ui-vs-db` read the pages, which
 * worked. Five green lenses and a dead API. It was found by opening a screenshot of a red toast.
 *
 * ── SO THE GUARD IS STRUCTURAL, NOT BEHAVIOURAL ──────────────────────────────────────────────
 * `withDelivery` runs the handler inside `runInTenant` (`store.run()`), the primitive that actually
 * scopes a callback. A route cannot hold the actor without being inside the context. This test
 * fails if a route reaches for the raw gate again — which is the only way back to the bug.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const API = join(ROOT, 'app/api/portal/[tenantSlug]/delivery');

function routes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? routes(join(dir, e.name))
    : e.name === 'route.ts' ? [join(dir, e.name)] : []));
}

describe('delivery API routes are scoped to the tenant context', () => {
  const files = (() => {
    try { return statSync(API).isDirectory() ? routes(API) : []; } catch { return []; }
  })();

  it('found the delivery routes at all (a guard over nothing is not a guard)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it('no route imports the raw gate — every handler goes through withDelivery', () => {
    const offenders = files
      .map((f) => ({ rel: relative(ROOT, f), src: readFileSync(f, 'utf8') }))
      .filter(({ src }) => /\bdeliveryGate\b/.test(src))
      .map(({ rel }) => rel);
    expect(offenders, 'use withDelivery(tenantSlug, async (gate) => …) from lib/delivery/gate')
      .toEqual([]);
  });

  it('every handler body is wrapped', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const handlers = (src.match(/^export async function (GET|POST|PATCH|PUT|DELETE)\b/gm) ?? []).length;
      const wrapped = (src.match(/\bwithDelivery\(/g) ?? []).length;
      if (handlers !== wrapped) bad.push(`${relative(ROOT, f)}: ${handlers} handler(s), ${wrapped} wrapped`);
    }
    expect(bad).toEqual([]);
  });

  it('the gate itself does not enterWith — that is what silently unscoped every route', () => {
    const gate = readFileSync(join(ROOT, 'lib/delivery/gate.ts'), 'utf8');
    const code = gate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(/\benterTenant\(/.test(code), 'enterTenant() from inside an awaited gate does not reach the caller')
      .toBe(false);
    expect(/\brunInTenant\(/.test(code), 'the handler must be RUN inside the context').toBe(true);
  });
});
