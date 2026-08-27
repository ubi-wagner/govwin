/**
 * A tenant-scoped transaction must carry the tenant context — `sql.begin` does not.
 *
 * ── THE ESCAPE, AND WHY IT WAS INVISIBLE ─────────────────────────────────────────────────────
 * `lib/db.ts`'s `sql` is a Proxy, and its own header says so:
 *
 *     Only the tagged-template CALL is routed — `sql.json/array/begin/…` forward to rawSql.
 *     So FRAGMENT-composing and `sql.begin` routes must use an explicit client.
 *
 * `lib/projects/baseline.ts` used `sql.begin`. It therefore ran on the raw `govtech_app` pool with
 * `app.tenant_id` UNSET, RLS matched nothing, and every statement in the transaction updated ZERO
 * rows — including the compare-and-swap on `projects`, whose empty result is interpreted as a lost
 * race. So the route answered, on the FIRST attempt, for a project nobody had ever baselined:
 *
 *     409  "This project was baselined by someone else a moment ago."
 *
 * **The baseline could not be set. At all.** And nothing saw it: the unit tests mock the database,
 * `verify-project-isolation` drives the tables with the OWNER client (which is not subject to the
 * policy), `verify-api-contract` grades envelopes and a 409 with `{error, code}` is textbook, and
 * `verify-write-contract` asserts exactly that a client error answers 4xx with both fields. It took
 * an end-to-end drive that POSTs the route as a signed-in person, and it failed on the first
 * complete run.
 *
 * Same family as the `enterWith`-across-an-await defect one commit earlier: a tenant context that
 * looks present and is not. Both are silent, both produce a plausible refusal, and neither is
 * visible to a lens that asks about SHAPE.
 *
 * ── SCOPE ────────────────────────────────────────────────────────────────────────────────────
 * Only the Projects tree and the portal API. Admin and bridge paths legitimately use `sql.begin`
 * with `sqlBypass` or a per-tenant `withTenant` fan-out, and flagging those would manufacture
 * findings — the rule this guards is "a TENANT-scoped write must not leave the tenant context".
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const ROOTS = ['lib/projects', 'app/api/portal/[tenantSlug]/projects'];

function walk(dir: string): string[] {
  try { if (!statSync(dir).isDirectory()) return []; } catch { return []; }
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory()
    ? walk(join(dir, e.name))
    : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

const strip = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Projects transactions stay inside the tenant context', () => {
  const files = ROOTS.flatMap((r) => walk(join(ROOT, r)));

  it('found the Projects tree (a guard over nothing is not a guard)', () => {
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it('no `sql.begin(` — it forwards past the context Proxy to the raw pool', () => {
    // The detector must SEE the unsafe form and LEAVE the safe one alone, or a clean run is unearned.
    expect(/\bsql\.begin\s*\(/.test(strip('const out = await sql.begin(async (tx) => {}) // x'))).toBe(true);
    expect(/\bsql\.begin\s*\(/.test(strip('const out = await withTenant(id, async (tx) => {})'))).toBe(false);
    expect(/\bsql\.begin\s*\(/.test(strip('// we used to call sql.begin( here\n'))).toBe(false);

    const offenders = files
      .filter((f) => /\bsql\.begin\s*\(/.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f));
    expect(offenders, 'use withTenant(tenantId, tx => …) from lib/rls — sql.begin loses app.tenant_id')
      .toEqual([]);
  });

  it('every transaction in the tree goes through withTenant, and imports it', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = strip(readFileSync(f, 'utf8'));
      if (!/\bwithTenant\s*\(/.test(src)) continue;
      if (!/from '@\/lib\/rls'/.test(readFileSync(f, 'utf8'))) bad.push(`${relative(ROOT, f)}: uses withTenant without importing it`);
    }
    expect(bad).toEqual([]);
  });
});

/**
 * ── THE THIRD WAY THE `lib/db.ts` PROXY BITES: A FRAGMENT IN A VALUE POSITION ────────────────
 * The Proxy intercepts the tagged-template CALL. So a nested ``sql`now()` `` written inside an
 * interpolation is NOT a SQL fragment — it is a **Promise**, which postgres.js then tries to
 * serialise as a value:
 *
 *     completed_at = ${next === 'done' ? sql`now()` : null}
 *     → RangeError: Invalid time value  → 500 {"error":"Failed to update the task"}
 *
 * Every task in the checklist failed to tick off, on a route whose envelope was textbook. It is the
 * same root as the other two traps in this file — `sql` is a Proxy and only the call is routed —
 * and `lib/db.ts`'s own header says fragment-composing needs an explicit client.
 *
 * Plain JavaScript values need no client at all, so the fix is to compute them in JS. This guard
 * says so rather than leaving the next author to rediscover it through a 500.
 */
describe('the Projects tree never nests a sql template inside a value', () => {
  const NESTED = /\$\{[^{}]*\bsql`/;

  it('has no `${… sql`…`}` interpolation', () => {
    const strip = (src: string) => src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    // The detector must see the defect and leave the fix alone.
    expect(NESTED.test(strip('completed_at = ${next === "done" ? sql`now()` : null},'))).toBe(true);
    expect(NESTED.test(strip('completed_at = ${completedAt},'))).toBe(false);
    expect(NESTED.test(strip('metrics = ${sql.json(m)},'))).toBe(false);

    const offenders = ROOTS.flatMap((r) => walk(join(ROOT, r)))
      .filter((f) => NESTED.test(strip(readFileSync(f, 'utf8'))))
      .map((f) => relative(ROOT, f));
    expect(offenders, 'compute the value in JS — a nested sql`` is a Promise, not a fragment')
      .toEqual([]);
  });
});
