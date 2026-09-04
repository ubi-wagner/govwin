/**
 * A ROUTE THAT AUTHENTICATES BY BEARER TOKEN IS UNREACHABLE UNTIL THE MIDDLEWARE LETS IT THROUGH.
 *
 * `middleware.ts` gates everything except `_next/static`, `_next/image` and `favicon.ico`, and
 * redirects or 401s anything without a session. A cron endpoint has no session — it carries
 * `Authorization: Bearer $CRON_SECRET` — so it only works if its exact path is in
 * `CRON_EXACT_PATHS`. Miss that line and the handler never runs.
 *
 * THE FAILURE IS NEARLY INVISIBLE. The route answers
 *
 *     401 {"error":"unauthenticated","code":"UNAUTHENTICATED"}
 *
 * which is a textbook SOP envelope, so every contract lens grades it green. It is also what the
 * route itself returns for a WRONG token, so the two cases are indistinguishable unless you call it
 * with the RIGHT secret — which no automated check was doing. Meanwhile the capability is simply
 * off: the poker fires on schedule, gets a 401 forever, and nothing anywhere says so.
 *
 * This has now happened FIVE times. `middleware.ts` carries a comment at the third occurrence
 * saying "a comment explaining a trap does not prevent the trap; the LIST is the mechanism" — and
 * then it happened twice more, because a list nothing reconciles is just a longer comment. This
 * test is the reconciliation: every route that reads `CRON_SECRET` must appear in the list.
 *
 * Verified on a live server with the correct secret at the time of writing:
 *   /api/admin/space-presence/sweep  → 200 (listed)   ·   /api/admin/tasks/sweep-claims → 401 (not)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = join(__dirname, '..');
const API = join(ROOT, 'app', 'api');
const MIDDLEWARE = readFileSync(join(ROOT, 'middleware.ts'), 'utf8');

/** Strip comments before asking what a file DOES — this repo documents its bugs at their own site. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function routeFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) routeFiles(p, out);
    else if (e === 'route.ts') out.push(p);
  }
  return out;
}

/** `app/api/admin/tasks/sweep-claims/route.ts` → `/api/admin/tasks/sweep-claims` */
const urlOf = (file: string) =>
  '/' + relative(join(ROOT, 'app'), file).split(sep).slice(0, -1).join('/');

/** The exact-path allowlist, read out of middleware.ts rather than duplicated here. */
function cronExactPaths(): string[] {
  const block = stripComments(MIDDLEWARE).match(/const CRON_EXACT_PATHS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error('CRON_EXACT_PATHS not found in middleware.ts — this test cannot run');
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('every cron-authenticated route is reachable through the middleware', () => {
  const listed = cronExactPaths();

  it('the allowlist parses and is not empty — otherwise every check below is vacuous', () => {
    // The instrument before the finding: if the regex stopped matching (the array is renamed, or
    // reformatted), this file would report a clean run over nothing at all.
    expect(listed.length).toBeGreaterThan(0);
    expect(listed).toContain('/api/admin/reconcile-cards');
  });

  it('a route that checks CRON_SECRET is in CRON_EXACT_PATHS', () => {
    const cronRoutes = routeFiles(API)
      .filter((f) => /CRON_SECRET/.test(stripComments(readFileSync(f, 'utf8'))))
      .map(urlOf)
      .sort();

    // If this ever finds nothing, the detector is broken rather than the codebase being clean.
    expect(cronRoutes.length, 'no route reads CRON_SECRET — the scan is broken').toBeGreaterThan(0);

    const missing = cronRoutes.filter((r) => !listed.includes(r));
    expect(
      missing,
      `these routes authenticate by Bearer CRON_SECRET but middleware refuses them before the `
        + `handler runs, answering 401 {"error":"unauthenticated"} forever:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('every listed path corresponds to a real route — a stale entry opens a path to nothing', () => {
    const all = new Set(routeFiles(API).map(urlOf));
    const dangling = listed.filter((p) => !all.has(p));
    expect(dangling, `listed in CRON_EXACT_PATHS with no route on disk: ${dangling.join(', ')}`)
      .toEqual([]);
  });
});
