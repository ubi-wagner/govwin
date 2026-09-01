/**
 * THE PROSPECT TABLES HAVE NO RLS, SO NOTHING BUT THIS TEST STOPS A TENANT SURFACE READING THEM.
 *
 * `contacts`, `applications` and `waitlist` are PLATFORM scope: they hold people who are not
 * anybody's customer, most of whom will never be. They deliberately carry no `tenant_id` — see
 * migration 243 for why adding one is worse than not having one — which means Postgres has no
 * predicate to scope them by and RLS is not in the picture at all. Their protection is entirely
 * the app-layer admin gate.
 *
 * That is the correct design and it has exactly one failure mode: a route under `app/portal/` or
 * `app/partner/` that queries one of them. Such a route would answer 200, return every prospect we
 * have, and no isolation instrument on this box could see it — `check-rls-posture` measures
 * tenant-OWNED tables, so a table with no `tenant_id` is not merely passing there, it is invisible.
 * Handing a customer the list of everyone else considering the product is the leak that matters
 * commercially, and it would leave no trace.
 *
 * So the guard is a source scan, in the same shape as `email-transport-boundary`: name the tables,
 * name the trees that may not touch them, and make a violation a failing test rather than a quiet
 * 200.
 *
 * ── THE INSTRUMENT BEFORE THE FINDING ────────────────────────────────────────────────────────
 * The first two cases prove the scanner can see the tree and that its patterns match a string that
 * IS a violation. A scan whose file list is empty reports a clean codebase.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

/** Platform-scope tables with no RLS and no tenant column to scope by.
 *  `working_notes` (mig 244) joins them: an ops board naming staging defects and unreleased work
 *  is not something a customer should be able to read, and RLS cannot stop them. */
const PROSPECT_TABLES = ['contacts', 'applications', 'waitlist', 'working_notes'] as const;

/** Trees a tenant or partner can reach. None of them may name a prospect table. */
const TENANT_TREES = [
  join('app', 'portal'),
  join('app', 'api', 'portal'),
  join('app', 'partner'),
  join('app', 'api', 'partner'),
];

/**
 * `applications` is also an ordinary English word, so match it only where it is being used as a
 * TABLE — after a SQL keyword that takes one. `grantApplications`, a comment about "grant
 * applications", or a variable called `applications` are not findings, and a rule that flags them
 * gets suppressed wholesale, taking the real check with it.
 */
const tableRef = (t: string) =>
  new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE|DELETE\\s+FROM)\\s+(?:public\\.)?${t}\\b`, 'i');

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(full)) out.push(full);
    }
  };
  try { if (statSync(dir).isDirectory()) walk(dir); } catch { /* tree absent */ }
  return out;
}

/** Comments stripped — this repository documents each rule at its own site, and a scan of raw
 *  source reports the PROSE about a constraint as a violation of it (three instruments were wrong
 *  this way in one sitting). */
const code = (f: string) =>
  readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('prospect tables are admin-only', () => {
  it('the scanner can see the tenant trees at all', () => {
    const files = TENANT_TREES.flatMap((t) => filesUnder(join(ROOT, t)));
    expect(files.length, 'no files found — the scan roots are wrong').toBeGreaterThan(50);
  });

  it('the rules would flag a violation', () => {
    for (const t of PROSPECT_TABLES) {
      expect(tableRef(t).test(`SELECT * FROM ${t} WHERE id = 1`),
        `the rule for ${t} does not match its own example`).toBe(true);
    }
    // …and would NOT flag the English word, or an identifier that merely contains it.
    expect(tableRef('applications').test('const applications = await listApplications()')).toBe(false);
    expect(tableRef('applications').test('// grant applications are reviewed by an admin')).toBe(false);
    expect(tableRef('contacts').test('router.push("/admin/contacts")')).toBe(false);
  });

  it('no tenant or partner surface queries a prospect table', () => {
    const offenders: string[] = [];
    for (const tree of TENANT_TREES) {
      for (const f of filesUnder(join(ROOT, tree))) {
        const src = code(f);
        for (const t of PROSPECT_TABLES) {
          if (tableRef(t).test(src)) offenders.push(`${f.replace(ROOT + '/', '')} → ${t}`);
        }
      }
    }
    expect(
      offenders,
      'these tables have no tenant_id and therefore no RLS predicate: a tenant-reachable route '
      + 'that queries one returns every prospect on the platform, with a 200 and no audit trail. '
      + 'Read them from an rfp_admin surface (lib/contacts.ts) instead.',
    ).toEqual([]);
  });
});
