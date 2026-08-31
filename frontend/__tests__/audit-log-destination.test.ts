/**
 * THERE IS ONE AUDIT TRAIL, AND ONE WAY INTO IT.
 *
 * `lib/db.ts` used to export `auditLog()`, which inserted into `audit_log` — a table migration 142
 * DROPPED, annotated `→ system_events (live audit trail)`. Nothing updated the function, and its
 * body was wrapped in a catch that only logged, so every call raised `relation "audit_log" does
 * not exist`, printed to stderr, and returned normally. It was a no-op for 74 migrations, at 45
 * call sites, all in the post-award Projects tree.
 *
 * ── THE FIX THAT LOOKED OBVIOUS AND WAS WRONG ────────────────────────────────────────────────
 * Pointing it at `system_events` seems right and is not. 36 of those 45 sites sat DIRECTLY BELOW
 * an `emitEventSingle`/`withEventBracket` recording the same fact with a conformant type, so the
 * redirect did not restore a missing trail — the trail was never missing. It DOUBLED it, adding a
 * malformed row per action (`baseline_set` beside `baseline.set`). Flat types violate
 * `entity.action_past_tense`, so none had a written label, and a customer's feed rendered them as
 * de-punctuated identifiers. The project-lifecycle drive caught it one run later.
 *
 * The 36 duplicates were deleted; the 9 sites where it really was the only record became
 * `emitEventSingle` with dotted types. The helper is gone.
 *
 * ── WHAT THESE CHECKS DEFEND ─────────────────────────────────────────────────────────────────
 * Not the deletion — the PROPERTY. A second, parallel "domain audit" concept is what let a dead
 * writer sit unnoticed beside a working one for over a year. These are static because the failure
 * was static: no runtime signal existed, since the function swallowed its own error and nothing
 * read the table back.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(p) && !/\.test\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const SOURCES = [join(ROOT, 'app'), join(ROOT, 'lib')].flatMap((d) => walk(d));
const rel = (f: string) => f.replace(ROOT + '/', '');

/**
 * Strip comments before scanning for CODE.
 *
 * lib/db.ts carries a long note explaining why `auditLog()` was removed, naming the function so the
 * next person does not re-add it. A scan for `auditLog(` matched that explanation and reported the
 * file as an offender — the guard failing on the documentation of the thing it guards against.
 * Removing the words to satisfy the check would delete the only record of WHY, which is the part
 * worth keeping.
 */
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('one audit trail, one way in', () => {
  it('no code touches the dropped audit_log table', () => {
    const offenders = SOURCES.filter((f) =>
      /\b(INSERT\s+INTO|FROM|UPDATE|DELETE\s+FROM)\s+audit_log\b/i.test(code(readFileSync(f, 'utf8'))));
    expect(offenders.map(rel), 'audit_log was dropped in migration 142 (→ system_events)').toEqual([]);
  });

  it('no auditLog() helper has come back', () => {
    // A second writer beside emitEvent* is the shape of the original bug, whatever it is called.
    // If a domain-audit concept is ever genuinely wanted, it needs a design decision and a place
    // to be read back from — not a quiet re-add of a function whose failures are invisible.
    const offenders = SOURCES.filter((f) => /\bauditLog\s*\(/.test(code(readFileSync(f, 'utf8'))));
    expect(offenders.map(rel), 'record domain facts with emitEvent* (lib/events.ts), not a parallel helper').toEqual([]);
  });

  it('the Projects tree still records what it does', () => {
    // THE INSTRUMENT BEFORE THE FINDING. The two checks above pass trivially if the Projects tree
    // simply stopped emitting — deleting 45 calls and leaving nothing behind would be GREEN here
    // and would have destroyed the audit trail. So assert the positive: these files emit, and they
    // emit a lot.
    const projects = SOURCES.filter((f) => rel(f).startsWith('lib/projects/'));
    expect(projects.length).toBeGreaterThan(15);
    const emits = projects.reduce((n, f) =>
      n + [...readFileSync(f, 'utf8').matchAll(/emitEventSingle\s*\(|withEventBracket\s*\(/g)].length, 0);
    expect(emits, 'the Projects tree should still carry its events').toBeGreaterThan(35);
  });

  it('every project event type is entity.action_past_tense', () => {
    // The malformed types are what made the redirect visible — no label, so the feed printed a
    // de-punctuated identifier at a customer. TYPE_RE here matches event-contract.test.ts.
    const TYPE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
    const bad: string[] = [];
    for (const f of SOURCES.filter((x) => rel(x).startsWith('lib/projects/'))) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/namespace:\s*'project',\s*\n\s*type:\s*'([^']+)'/g)) {
        if (!TYPE_RE.test(m[1])) bad.push(`${rel(f)}: "${m[1]}"`);
      }
    }
    expect(bad, `these have no dot, so they get no written label:\n  ${bad.join('\n  ')}`).toEqual([]);
  });
});
