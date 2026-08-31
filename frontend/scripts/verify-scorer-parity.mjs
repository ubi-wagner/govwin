/**
 * verify-scorer-parity — the two scorers are a mirror pair. Assert it.
 *
 * `scoreCard` (frontend/lib/bucket-ranking.ts) and `score_card`
 * (pipeline/src/workflows/actions/rescore.py) score the same card against the same bucket and MUST
 * agree. The Python file's own docstring calls itself "a faithful Python port"; the TS file names
 * the Python one in a comment. Neither claim was checked, and they have already been observed
 * mirroring each other INCLUDING a bug — which is the failure mode a comment cannot catch.
 *
 * Runs both over one shared fixture set and diffs score AND every factor, naming the factor that
 * diverged. Two runtimes, so this is a drive, not a vitest.
 *
 * RED TEST (do this after any change here — a check that has never failed proves nothing):
 *     change one default weight on ONE side, run, confirm it fails and names the factor, revert.
 *
 * Usage:  node frontend/scripts/verify-scorer-parity.mjs
 * Exit:   0 agree · 1 diverged · 2 HARNESS DEFECT (a runner did not produce comparable output)
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontend = resolve(here, '..');
const repo = resolve(frontend, '..');
const FIXTURES = join(here, 'fixtures', 'scorer-parity.json');

const die = (code, msg) => { console.error(`\n${msg}\n`); process.exit(code); };

if (!existsSync(FIXTURES)) die(2, `HARNESS DEFECT: fixtures missing at ${FIXTURES}`);
const fx = JSON.parse(readFileSync(FIXTURES, 'utf8'));
const expected = fx.cases.length;

const run = (label, cmd, args, cwd) => {
  let raw;
  try {
    raw = execFileSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    die(2, `HARNESS DEFECT: the ${label} runner failed to execute.\n${e.stderr || e.message}`);
  }
  // A runner that printed a warning before its JSON must not be silently truncated into nothing —
  // that is how a scanner reports a clean run on input it could not parse.
  const start = raw.indexOf('[');
  if (start < 0) die(2, `HARNESS DEFECT: the ${label} runner produced no JSON array.\n${raw.slice(0, 400)}`);
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start));
  } catch (e) {
    die(2, `HARNESS DEFECT: the ${label} runner's output did not parse.\n${e.message}\n${raw.slice(0, 400)}`);
  }
  if (!Array.isArray(parsed) || parsed.length !== expected) {
    die(2, `HARNESS DEFECT: the ${label} runner returned ${Array.isArray(parsed) ? parsed.length : 'non-array'} result(s), fixtures declare ${expected}. A partial run must never be graded.`);
  }
  return parsed;
};

console.log(`\nverify-scorer-parity — ${expected} case(s), two runtimes\n`);

const ts = run('TS', process.execPath, ['--import', 'tsx', join(here, 'parity-score-ts.mts')], frontend);
const py = run('Python', 'python3', [join(repo, 'pipeline', 'tests', 'parity_score_py.py')], repo);

let diverged = 0;
for (let i = 0; i < expected; i++) {
  const a = ts[i], b = py[i];
  const problems = [];
  if (a.name !== b.name) problems.push(`case order diverged: "${a.name}" vs "${b.name}"`);
  if (a.score !== b.score) problems.push(`score ${a.score} vs ${b.score}`);
  const keys = [...new Set([...Object.keys(a.factors ?? {}), ...Object.keys(b.factors ?? {})])].sort();
  for (const k of keys) {
    const va = a.factors?.[k], vb = b.factors?.[k];
    if (va === undefined && vb !== undefined) problems.push(`factor "${k}" present in PYTHON only (${vb})`);
    else if (vb === undefined && va !== undefined) problems.push(`factor "${k}" present in TS only (${va})`);
    else if (va !== vb) problems.push(`factor "${k}" ${va} vs ${vb}`);
  }
  if (problems.length) {
    diverged++;
    console.log(`  ✗ ${a.name}`);
    for (const p of problems) console.log(`      ${p}`);
  }
}

if (diverged === 0) {
  console.log(`  ✓ all ${expected} cases agree — score and every factor\n`);
  process.exit(0);
}
console.log(`\n✗ ${diverged} of ${expected} case(s) diverged. The two scorers are NOT a mirror pair.\n`);
process.exit(1);
