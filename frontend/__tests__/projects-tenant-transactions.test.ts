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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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

/**
 * ── THE SAME FAMILY, ONE TABLE OVER: A WRITE THAT MATCHED NOTHING (B161) ──────────────────────
 *
 * Everything above guards a tenant context that LOOKS present and is not. This guards the case
 * where none was ever established — and the write still returns successfully.
 *
 * Under FORCE ROW LEVEL SECURITY an UPDATE or DELETE issued with no `app.tenant_id` matches ZERO
 * rows. Postgres does not treat "your predicate excluded everything" as an error, so the statement
 * returns, `rows.length` is 0, and the caller proceeds. `clearHouseDocs` did exactly that: measured
 * on a live box, the owner connection sees 355 atoms for a tenant and the app connection with no
 * context sees none.
 *
 * WHAT HID IT was the asymmetry. The seed half of that script goes through `createAtom`, which
 * wraps every write in `withTenant`, so it worked — while the "idempotent" clear beside it silently
 * did nothing and each run added another full copy of the house library. A function that throws
 * gets fixed; one that returns 0 gets believed.
 *
 * This asserts the SHAPE rather than the behaviour, because the behaviour needs a database: a
 * mutating statement against a FORCE-RLS table in this module must go through `withTenant`.
 */
describe('house-library writes are scoped, so a delete cannot silently match nothing', () => {
  const HOUSE = join(__dirname, '..', 'lib/library/house-docs.ts');

  it('found the module (a guard over nothing is not a guard)', () => {
    expect(existsSync(HOUSE), 'lib/library/house-docs.ts moved — repoint this guard').toBe(true);
  });

  it('every mutating statement goes through withTenant', () => {
    const src = readFileSync(HOUSE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

    // The detector must see the defect it exists for: the pre-fix line was a bare
    // `await sql`DELETE FROM library_atoms …``.
    const unsafeFixture = 'const rows = await sql`DELETE FROM library_atoms WHERE tenant_id = ${t}`;';
    const safeFixture = 'const rows = await withTenant(t, async (tx) => tx`DELETE FROM library_atoms`);';
    const mutatesUnscoped = (s: string) =>
      /\bawait\s+sql\s*(<[^`]*>)?\s*`[\s\S]{0,80}?\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/i.test(s);
    expect(mutatesUnscoped(unsafeFixture), 'must flag a bare mutating sql template').toBe(true);
    expect(mutatesUnscoped(safeFixture), 'must leave a withTenant-wrapped one alone').toBe(false);

    expect(
      mutatesUnscoped(src),
      'a mutating statement on a FORCE-RLS table through the context-aware `sql` matches zero rows '
        + 'and returns success when no tenant context is set — wrap it in withTenant(tenantId, tx => …)',
    ).toBe(false);
    expect(src.includes('withTenant'), 'the module must import and use withTenant').toBe(true);
  });
});
