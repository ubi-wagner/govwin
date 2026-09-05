#!/usr/bin/env node
/**
 * audit-dead-code — what is in the tree that nothing reaches?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * The instruments here answer "does what the product does, work". None answers "is anything in
 * here doing nothing". Those are different questions and the second one rots quietly: a module
 * nobody imports still type-checks, still passes lint, still ships in the repo, and still has to be
 * read by the next person deciding whether it matters.
 *
 * `reconcile-capability` finds routes and tables with no caller; `inventory-scripts` finds harness
 * scripts that cannot run. Neither walks the MODULE graph, which is where library rot accumulates.
 *
 * ── THE ONE HARD PART: ENTRY POINTS ARE IMPLICIT ─────────────────────────────────────────────
 * Next.js has no import edge to a page. `app/admin/funnel/page.tsx` is reached by the FILESYSTEM
 * ROUTER, so a naive "nothing imports it" scan reports every page, every route handler, every
 * layout and the middleware as dead — which is a report about the scanner. The framework's
 * conventions are therefore roots, and so is every script and every test: a harness is its own
 * entry point, and a test file exists precisely to import something.
 *
 * Get that wrong in the other direction and the audit is useless the other way: mark too much as a
 * root and nothing is ever unreachable.
 *
 * ── WHAT IT WILL NOT CLAIM ───────────────────────────────────────────────────────────────────
 * "Unreachable" is not "delete it". A module reached only by a test is still dead product code but
 * live test fixture; a module reached only by a script may be a rescue tool somebody needs once a
 * year. The report says HOW something is reached, and leaves the decision where it belongs.
 *
 *   node frontend/scripts/audit-dead-code.mjs [--json]
 * Exit 0 always — this is a report, not a gate. Nothing here is a defect on its own.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const FE = process.cwd().endsWith('/frontend') ? process.cwd() : join(process.cwd(), 'frontend');
const rel = (f) => relative(FE, f);

// ── the file set ──────────────────────────────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.next', '.git', 'e2e-artifacts', 'public', 'coverage']);
function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|mts|jsx?)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(full);
  }
  return out;
}

/**
 * Files the FRAMEWORK reaches with no import edge, plus the two trees that are their own reason to
 * exist. Written as predicates rather than a list because `app/` has 445 files and the conventions
 * repeat at every depth.
 */
function isRoot(f) {
  const r = rel(f);
  // Next.js filesystem router + framework conventions.
  if (/^app\/.*\/(page|layout|route|template|loading|error|not-found|global-error|default)\.tsx?$/.test(r)) return true;
  if (/^app\/(page|layout|error|not-found|global-error)\.tsx?$/.test(r)) return true;
  if (/^(middleware|instrumentation|auth|next\.config|tailwind\.config|postcss\.config|vitest\.config|playwright\.config)\.[a-z]+$/.test(r)) return true;
  // A harness is its own entry point; a test exists to import something.
  if (/^scripts\//.test(r)) return true;
  if (/^(__tests__|e2e)\//.test(r)) return true;
  return false;
}

// ── import resolution ─────────────────────────────────────────────────────────────────────────
const EXTS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'];
function resolveSpec(spec, fromFile) {
  let base;
  if (spec.startsWith('@/')) base = join(FE, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;                                   // a package, not our code
  // `./foo` → foo.ts | foo.tsx | foo/index.ts …  A spec that already carries an extension still
  // has to be tried bare FIRST: `./paths.js` in an ESM script means `paths.ts` on disk.
  const candidates = [base, ...EXTS.map((e) => base + e), ...EXTS.map((e) => join(base, 'index' + e))];
  const stripped = base.replace(/\.(js|mjs|jsx)$/, '');
  if (stripped !== base) candidates.push(...EXTS.map((e) => stripped + e));
  for (const c of candidates) {
    try { if (statSync(c).isFile()) return c; } catch { /* next */ }
  }
  return null;
}

/** Every module specifier in a file: static imports, re-exports, and dynamic import(). */
function specifiers(src) {
  const out = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,          // import x from 'y' · export * from 'y'
    /\bimport\s*\(\s*['"]([^'"]+)['"]/g,   // await import('y')
    /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,        // side-effect import
  ];
  for (const p of patterns) for (const m of src.matchAll(p)) out.push(m[1]);
  return out;
}

// ── build the graph ───────────────────────────────────────────────────────────────────────────
const files = walk(FE);
const bySrc = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
const edges = new Map();                              // file → Set(file it imports)
for (const f of files) {
  const set = new Set();
  for (const s of specifiers(bySrc.get(f))) {
    const t = resolveSpec(s, f);
    if (t && bySrc.has(t)) set.add(t);
  }
  edges.set(f, set);
}

/** Reachability from a given root set, returning the reached set. */
function reachFrom(roots) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const t of edges.get(f) ?? []) if (!seen.has(t)) stack.push(t);
  }
  return seen;
}

const appRoots = files.filter((f) => isRoot(f) && /^app\//.test(rel(f)) || /^(middleware|instrumentation|auth|next\.config)\./.test(rel(f)));
const scriptRoots = files.filter((f) => /^scripts\//.test(rel(f)));
const testRoots = files.filter((f) => /^(__tests__|e2e)\//.test(rel(f)));

const reachedByApp = reachFrom(appRoots);
const reachedByScripts = reachFrom(scriptRoots);
const reachedByTests = reachFrom(testRoots);

// ── self-tests: the instrument before the finding ─────────────────────────────────────────────
const t = [];
const check = (label, got) => t.push([label, got]);
check('the walk found the tree, not a corner', files.length > 900);
check('roots include the framework pages', appRoots.length > 100);
check('a known-live lib module is reached by the app',
  reachedByApp.has(join(FE, 'lib/db.ts')));
check('a known-live component is reached by the app',
  reachedByApp.has(join(FE, 'components/portal/spotlight-buckets.tsx')));
check('the @/ alias resolves', resolveSpec('@/lib/db', join(FE, 'app/page.tsx')) === join(FE, 'lib/db.ts'));
check('a relative spec resolves', !!resolveSpec('./ledger', join(FE, 'lib/email/index.ts')));
check('a directory index resolves', !!resolveSpec('@/lib/email', join(FE, 'app/page.tsx')));
check('a package spec resolves to nothing', resolveSpec('react', join(FE, 'app/page.tsx')) === null);
check('a dynamic import is an edge',
  specifiers("const m = await import('@/lib/events');").includes('@/lib/events'));
check('an invented module is NOT reachable',
  !reachedByApp.has(join(FE, 'lib/definitely-not-here.ts')));
// The scanner must be able to see a module that only a test reaches, or the third bucket below is
// always empty and looks like good news.
check('the test-root set is non-empty', testRoots.length > 100);
// The auto-discovery exemption, both ways — it must spare a workflow module and NOT spare an
// ordinary one, or it silently turns the whole python section into "none".
check('an auto-discovered workflow module is exempt',
  /(^|\/)(workflows|archetypes)\/[^/]+\.py$/.test('pipeline/src/workflows/on_tenant_rescore.py'));
check('an ordinary python module is NOT exempt',
  !/(^|\/)(workflows|archetypes)\/[^/]+\.py$/.test('pipeline/src/ingest/sam_gov.py'));
check('a nested file under workflows/actions is NOT exempt',
  !/(^|\/)(workflows|archetypes)\/[^/]+\.py$/.test('pipeline/src/workflows/actions/rescore.py'));

const bad = t.filter(([, g]) => !g);
console.log('── self-test ──');
for (const [label, got] of t) console.log(`  ${got ? '✓' : '✗'} ${label}`);
if (bad.length) {
  console.error(`\n✗ ${bad.length} self-test(s) failed — every number below would be about the scanner.`);
  process.exit(2);
}

// ── 1 · modules nothing reaches ───────────────────────────────────────────────────────────────
const productCode = files.filter((f) => /^(lib|components|hooks|types)\//.test(rel(f)));
const orphans = productCode.filter((f) => !reachedByApp.has(f) && !reachedByScripts.has(f) && !reachedByTests.has(f));
const testOnly = productCode.filter((f) => !reachedByApp.has(f) && !reachedByScripts.has(f) && reachedByTests.has(f));
const scriptOnly = productCode.filter((f) => !reachedByApp.has(f) && reachedByScripts.has(f) && !reachedByTests.has(f));

const lines = (f) => bySrc.get(f).split('\n').length;
const report = (label, set, note) => {
  console.log(`\n══ ${label} — ${set.length} file(s), ${set.reduce((n, f) => n + lines(f), 0)} lines ══`);
  if (note) console.log(`   ${note}`);
  for (const f of [...set].sort((a, b) => lines(b) - lines(a))) {
    console.log(`   ${String(lines(f)).padStart(5)}  ${rel(f)}`);
  }
};

report('1 · REACHED BY NOTHING — not the app, not a script, not a test', orphans,
  'Dead by every measure available here. Check for a dynamic string-built import before removing.');
report('2 · reached ONLY by tests', testOnly,
  'Live test fixture, dead product code — or a test that outlived what it tested.');
report('3 · reached ONLY by scripts', scriptOnly,
  'Harness-only. Often correct (a rescue tool), sometimes a migration helper that already ran.');

// ── 2 · duplicate file contents ───────────────────────────────────────────────────────────────
const byHash = new Map();
for (const f of files) {
  const h = createHash('sha1').update(bySrc.get(f).replace(/\s+/g, ' ').trim()).digest('hex');
  if (!byHash.has(h)) byHash.set(h, []);
  byHash.get(h).push(f);
}
const dupes = [...byHash.values()].filter((g) => g.length > 1);
console.log(`\n══ 4 · byte-identical files (whitespace-normalised) — ${dupes.length} group(s) ══`);
for (const g of dupes) console.log(`   ${lines(g[0])} lines ×${g.length}: ${g.map(rel).join('  ·  ')}`);
if (!dupes.length) console.log('   none');

// ── 3 · declared dependencies nothing imports ─────────────────────────────────────────────────
const pkg = JSON.parse(readFileSync(join(FE, 'package.json'), 'utf8'));
const allSrc = [...bySrc.values()].join('\n');
const configSrc = ['next.config.ts', 'next.config.js', 'tailwind.config.ts', 'postcss.config.mjs', 'vitest.config.ts']
  .map((f) => { try { return readFileSync(join(FE, f), 'utf8'); } catch { return ''; } }).join('\n');
const scriptsBlock = JSON.stringify(pkg.scripts ?? {});
const unusedDeps = Object.keys(pkg.dependencies ?? {}).filter((d) => {
  const used = new RegExp(`['"]${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^'"]*)?['"]`);
  return !used.test(allSrc) && !used.test(configSrc) && !scriptsBlock.includes(d);
});
console.log(`\n══ 5 · dependencies nothing imports — ${unusedDeps.length} of ${Object.keys(pkg.dependencies ?? {}).length} ══`);
console.log(unusedDeps.length ? unusedDeps.map((d) => `   ${d}`).join('\n')
  : '   none — every declared dependency is imported somewhere');
if (unusedDeps.length) {
  console.log('   ⚠ a plugin loaded by NAME (a postcss/tailwind/eslint plugin, a driver) has no import');
  console.log('     and will appear here. Check the config files before removing one.');
}

console.log(`\n── ${files.length} source file(s) · ${productCode.length} in lib/components/hooks/types ──`);
console.log(`   reached by the app: ${productCode.filter((f) => reachedByApp.has(f)).length}`);

// ── 4 · the OTHER two services ────────────────────────────────────────────────────────────────
// The frontend is one of three trees and the smallest share of the risk: `pipeline/src` is 55k
// lines and `services/cms/src` carries routers the CMS/CRM consolidation superseded. A dead-code
// audit that stops at the TypeScript is a report about the language, not the project.
//
// Python reachability is looser than the TS graph on purpose. Workers are started by name from a
// scheduler table, archetypes are auto-registered by the fabric, and `pipeline_schedules.source`
// names entry points that live in the DATABASE — the same five-emit-mechanism problem
// `audit-automation-spine` documents (B140). So a module here is reported as UNREFERENCED only
// when no other module imports it AND its own basename appears nowhere else in either tree; that
// is deliberately conservative, because the failure mode of over-reporting is somebody deleting a
// worker the scheduler starts.
const ROOT = dirname(FE);
function pyFiles(sub) {
  const out = [];
  const walkPy = (dir) => {
    let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name.startsWith('.') || e.name === '__pycache__' || e.name === 'node_modules') continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walkPy(full);
      else if (e.name.endsWith('.py')) out.push(full);
    }
  };
  walkPy(join(ROOT, sub));
  return out;
}

for (const [label, sub] of [['pipeline', 'pipeline'], ['rfp-crm service', 'services/cms']]) {
  const py = pyFiles(sub);
  if (!py.length) continue;
  const src = new Map(py.map((f) => [f, readFileSync(f, 'utf8')]));
  const all = [...src.values()].join('\n');
  const orphanPy = py.filter((f) => {
    const r = relative(ROOT, f);
    const base = f.split('/').pop().replace(/\.py$/, '');
    if (base === '__init__' || base === '__main__' || base === 'conftest') return false;
    if (/(^|\/)(tests?|scripts)\//.test(r)) return false;   // own entry points
    // ⚠️ AUTO-DISCOVERED PACKAGES ARE ROOTS, AND THIS COST TWO FALSE POSITIVES.
    // `workflows/base.py` walks its own package with `pkgutil.iter_modules` and registers every
    // Workflow subclass it finds. A workflow module is therefore reached with NO import edge and
    // NO mention of its name anywhere — which is exactly what "orphan" meant here, so the first
    // run reported `on_contract_started` and `on_tenant_rescore` as dead. `OnCardApplied` has run
    // 96 times and `OnBucketsUpdated` 53 times, the most recent today. The same shape as B140: an
    // emit mechanism that is not a source reference reads as absence to a source-only scan.
    // Agent archetypes register the same way.
    if (/(^|\/)(workflows|archetypes)\/[^/]+\.py$/.test(r)) return false;
    // Imported by module path, or named as a bare string anywhere (a scheduler row, a registry,
    // a CLI target). Either counts as reached.
    const named = new RegExp(`\\b${base.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'g');
    let hits = 0;
    for (const [g, s] of src) { if (g === f) continue; if (named.test(s)) { hits++; break; } }
    if (hits) return false;
    return !allSrc.includes(base);        // …or referenced from the frontend tree
  });
  const plines = (f) => src.get(f).split('\n').length;
  console.log(`\n══ 6 · ${label}: python modules nothing names — ${orphanPy.length} of ${py.length} ══`);
  if (!orphanPy.length) console.log('   none — every module is imported or named somewhere');
  for (const f of orphanPy.sort((a, b) => plines(b) - plines(a)).slice(0, 25)) {
    console.log(`   ${String(plines(f)).padStart(5)}  ${relative(ROOT, f)}`);
  }
}
