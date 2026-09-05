#!/usr/bin/env node
/**
 * audit-runtime-assets.mjs — does every file the app OPENS AT RUNTIME actually ship in the image?
 *
 * ── THE FAILURE THIS CATCHES ─────────────────────────────────────────────────────────────────
 * `output: 'standalone'` traces IMPORTS. A file opened by PATH — `readFileSync(join(process.cwd(),
 * 'ocr-data', …))` — is invisible to that tracer, so it lands in the image only if a human
 * remembered a COPY line. Nothing checks that they did, and the failure never crashes:
 *
 *   · `docs/guide-coverage.json` — `/admin/guides` rendered its "artifact is not in this build"
 *     notice in production. Honest, and dead.
 *   · `ocr-data/eng.traineddata.gz` — 2.9 MB, committed, read at runtime, and never copied into any
 *     runtime stage. `resolveLangPath()` returns null, OCR of uploaded image crops returns '' with
 *     engine 'none'. The source comment asserted it was "staged" there; nothing staged it.
 *
 * Both were found by reading, one after the other, which is the signal that there is a third. The
 * shape is the one this repo names as the worst: a capability that silently does nothing in
 * production, where the absence is indistinguishable from "no data yet".
 *
 * ── HOW ─────────────────────────────────────────────────────────────────────────────────────
 * Find every runtime read of a path rooted at `process.cwd()` in shipped code (`app/`, `lib/`,
 * `components/`), resolve the directory it names, and require that some COPY line in the Dockerfile
 * puts that directory into the FINAL stage.
 *
 * ── THREE THINGS THAT MAKE IT HONEST ────────────────────────────────────────────────────────
 *
 * 1. **Only the FINAL stage counts.** `COPY frontend/ .` in the builder puts everything in — which
 *    is exactly why this bug is easy to write and impossible to see by reading the builder. The
 *    parse tracks `FROM` and only considers COPY lines after the last one.
 *
 * 2. **Comments are stripped before the source is scanned.** This repo documents each defect at its
 *    own site, so a scan of raw source finds the PROSE about a missing asset and reports the fix as
 *    the bug. Three instruments were wrong this way in one sitting.
 *
 * 3. **An unresolvable path is reported as UNCHECKED, never as present.** A `process.cwd()` join
 *    whose first segment is a variable cannot be resolved statically; saying nothing about it is a
 *    finding this cannot make, and pretending it is fine is the clean run that hides the next one.
 *
 *   cd frontend && node scripts/audit-runtime-assets.mjs
 *   node scripts/audit-runtime-assets.mjs --check    # self-test only
 *
 * Exit 0 every runtime asset ships · 1 one does not · 2 the audit could not run.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Where the frontend is. `process.cwd()` when run as documented (`cd frontend && node scripts/…`),
 * which is also how CI runs it — a sandbox-absolute default would resolve to nothing on a runner and
 * the audit would exit 2 in CI forever, which is the same as not having it.
 */
const FRONTEND = path.resolve(
  process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1])
  || process.cwd(),
);
const DOCKERFILE = path.join(FRONTEND, 'Dockerfile');
const CODE_ROOTS = ['app', 'lib', 'components'];

/**
 * Directories a runtime read may name that are NOT expected in the image, each with the reason.
 * An unexplained exclusion is indistinguishable from an oversight the next time somebody reads it.
 */
const EXPECTED_ABSENT = {
  '.next': 'the build output itself — copied as `.next/standalone` and `.next/static`, not by name',
  node_modules: 'copied per-package by explicit COPY lines; a bare directory read would be a bug of a different kind',
};

/** Strip comments so the scan reads what a file DOES, not what it is ABOUT. */
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(path.join(FRONTEND, dir), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const rel = path.join(dir, e.name);
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(e.name)) out.push(rel);
  }
  return out;
}

/**
 * Every `process.cwd()`-rooted path read at runtime, as the FIRST directory segment.
 *
 * Both `path.join(process.cwd(), 'public', 'pdfjs')` and `join(process.cwd(), 'ocr-data')` reduce
 * to the segment that has to exist in the image. A first argument that is not a literal is returned
 * as `null` so the caller can report it UNCHECKED rather than silently dropping it.
 */
function cwdAssets(src) {
  const found = [];
  const re = /(?:path\.)?join\(\s*process\.cwd\(\)\s*,\s*([^)]*)\)/g;
  let m;
  while ((m = re.exec(src))) {
    const first = m[1].split(',')[0].trim();
    const lit = first.match(/^['"]([^'"]+)['"]$/);
    found.push(lit ? lit[1].replace(/^\.?\//, '').split('/')[0] : null);
  }
  return found;
}

/**
 * A path that climbs OUT of the app root, e.g. `join(process.cwd(), '../docs/guide-coverage.json')`.
 *
 * The first version of this audit reported these as assets missing from the image, which is a
 * finding no COPY line can answer: the runtime image has no parent directory to copy into. It is a
 * DEV-LAYOUT FALLBACK — running from `frontend/`, where `docs/` sits one level up — and the path
 * that must actually ship is the sibling primary. Reporting it as a defect sends someone to fix a
 * Dockerfile that is already right, which is how an audit teaches people to stop reading it.
 *
 * It is classified and printed, never silently dropped: a reader has to be able to see that the
 * audit considered it and why it is not a finding.
 */
const isParentRelative = (a) => a === '..';

/**
 * Directories the FINAL Dockerfile stage copies in.
 *
 * Only after the last `FROM`: the builder stage copies the whole tree, so counting its COPY lines
 * would mark every asset present and this audit would pass unconditionally — the failure mode that
 * makes a green meaningless.
 */
function finalStageCopies(dockerfile) {
  const lines = dockerfile.split('\n');
  let start = 0;
  lines.forEach((l, i) => { if (/^\s*FROM\s/i.test(l)) start = i; });
  const dests = [];
  for (const l of lines.slice(start)) {
    const line = l.replace(/#.*$/, '');
    const m = line.match(/^\s*COPY\s+(.*)$/i);
    if (!m) continue;
    const args = m[1].replace(/--[a-z-]+(=\S+)?/gi, '').trim().split(/\s+/).filter(Boolean);
    if (args.length < 2) continue;
    dests.push(args[args.length - 1]);
  }
  return dests;
}

/** Does any COPY destination place `asset` at the app root? */
const shipped = (asset, dests) =>
  dests.some((d) => {
    const norm = d.replace(/^\.\//, '').replace(/\/$/, '');
    return norm === asset || norm.startsWith(`${asset}/`);
  });

// ── SELF-TEST: the instrument before the finding ─────────────────────────────────────────────
//
// Each case is a property the audit's verdict depends on. A scanner whose patterns do not match,
// or whose Dockerfile parse reads the wrong stage, reports a clean codebase.
const CASES = [
  {
    why: 'a literal cwd join is extracted as its first segment',
    ok: () => cwdAssets(`readFileSync(path.join(process.cwd(), 'ocr-data', 'x.gz'))`)[0] === 'ocr-data',
  },
  // ── the build-context half. THE REGRESSION, pinned both ways ──────────────────────────────
  {
    why: 'THE REGRESSION: a bare `docs/` swallows the file a later `!` tries to rescue',
    ok: () => {
      const v = ignoreVerdict(['docs/', '!docs/guide-coverage.json'], 'docs/guide-coverage.json');
      return v.excluded === true && v.rescuable === false;
    },
  },
  {
    why: 'and `docs/*` + the same `!` DOES rescue it — the fix must read as fixed',
    ok: () => !ignoreVerdict(['docs/*', '!docs/guide-coverage.json'], 'docs/guide-coverage.json').excluded,
  },
  {
    why: 'the working `scripts/*` rule is not reported — a check that flags everything is useless',
    ok: () => !ignoreVerdict(
      ['scripts/*', '!scripts/seed_dev_accounts.mjs'], 'scripts/seed_dev_accounts.mjs',
    ).excluded,
  },
  {
    why: 'a path no rule mentions is in the context',
    ok: () => !ignoreVerdict(['docs/*', 'pipeline/'], 'db/migrations/migrate.mjs').excluded,
  },
  {
    why: 'a `--from=` COPY is NOT a context read — it cannot be broken by .dockerignore',
    ok: () => {
      const df = 'FROM node AS b\nFROM node AS r\nCOPY --from=b /app/ocr-data ./ocr-data\nCOPY docs/x.json ./docs/x.json\n';
      const s = contextCopySources(df);
      return s.length === 1 && s[0] === 'docs/x.json';
    },
  },
  {
    why: 'a non-literal first segment is reported as unresolvable, not dropped',
    ok: () => cwdAssets('join(process.cwd(), dir, "x")')[0] === null,
  },
  {
    why: 'ONLY the final stage counts — a builder-stage COPY of the whole tree must not satisfy it',
    ok: () => {
      const df = 'FROM node AS builder\nCOPY frontend/ .\nFROM node AS runner\nCOPY --from=builder /app/public ./public\n';
      const d = finalStageCopies(df);
      return shipped('public', d) && !shipped('ocr-data', d);
    },
  },
  {
    why: 'the real regression: ocr-data absent from the final stage is DETECTED',
    ok: () => {
      const df = 'FROM node AS builder\nCOPY frontend/ .\nFROM node AS runner\nCOPY --from=builder /app/.next/standalone ./\n';
      return !shipped('ocr-data', finalStageCopies(df));
    },
  },
  {
    why: 'and present in the final stage is ACCEPTED',
    ok: () => {
      const df = 'FROM node AS runner\nCOPY --from=builder --chown=n:n /app/ocr-data ./ocr-data\n';
      return shipped('ocr-data', finalStageCopies(df));
    },
  },
  {
    why: 'a nested destination satisfies its parent (docs/guide-coverage.json ships `docs`)',
    ok: () => shipped('docs', finalStageCopies('FROM r\nCOPY docs/guide-coverage.json ./docs/guide-coverage.json\n')),
  },
  {
    why: 'a commented-out COPY does not count as shipping anything',
    ok: () => !shipped('ocr-data', finalStageCopies('FROM r\n# COPY /app/ocr-data ./ocr-data\n')),
  },
  {
    why: 'comments are stripped, so prose ABOUT a missing asset is not read as code',
    ok: () => cwdAssets(strip(`// join(process.cwd(), 'ghost-dir')\nconst x = 1;`)).length === 0,
  },
  {
    // The first run reported `..` as an asset missing from the image — a finding no Dockerfile can
    // answer. Pinned so the classification cannot silently regress into a phantom finding again.
    why: 'a parent-relative dev fallback is classified, not reported as a missing asset',
    ok: () => isParentRelative(cwdAssets(`join(process.cwd(), '../docs/guide-coverage.json')`)[0])
      && !isParentRelative('ocr-data'),
  },
  {
    why: 'the code scan can see the tree at all',
    ok: () => CODE_ROOTS.flatMap((r) => walk(r)).length > 200,
  },
];

let selfFailed = 0;
console.log('── self-test ──');
for (const c of CASES) {
  let pass = false;
  try { pass = c.ok() === true; } catch { pass = false; }
  console.log(`  ${pass ? '✓' : '✗'} ${c.why}`);
  if (!pass) selfFailed += 1;
}
if (selfFailed) {
  console.error(`\n✗ HARNESS DEFECT — ${selfFailed} self-test(s) failed. Every verdict below would be unearned.`);
  process.exit(2);
}
if (process.argv.includes('--check')) process.exit(0);

// ── THE AUDIT ────────────────────────────────────────────────────────────────────────────────
if (!existsSync(DOCKERFILE)) {
  console.error(`\n✗ no Dockerfile at ${DOCKERFILE} — nothing to check against.`);
  process.exit(2);
}
const dests = finalStageCopies(readFileSync(DOCKERFILE, 'utf8'));
if (dests.length === 0) {
  console.error('\n✗ the final Dockerfile stage copies nothing — the parse is wrong, not the image.');
  process.exit(2);
}

const sites = new Map();      // asset → [files]
const unresolved = [];        // { file } — a cwd join this cannot read statically

for (const rel of CODE_ROOTS.flatMap((r) => walk(r))) {
  const full = path.join(FRONTEND, rel);
  let src;
  try { src = strip(readFileSync(full, 'utf8')); } catch { continue; }
  for (const a of cwdAssets(src)) {
    if (a === null) { unresolved.push(rel); continue; }
    if (!sites.has(a)) sites.set(a, []);
    sites.get(a).push(rel);
  }
}

console.log(`\n── ${sites.size} runtime asset director${sites.size === 1 ? 'y' : 'ies'} read from process.cwd() ──\n`);

const missing = [];
for (const [asset, files] of [...sites].sort()) {
  if (asset in EXPECTED_ABSENT) {
    console.log(`  · ${asset.padEnd(16)} exempt — ${EXPECTED_ABSENT[asset]}`);
    continue;
  }
  if (isParentRelative(asset)) {
    console.log(`  · ${asset.padEnd(16)} dev-layout fallback above the app root — no COPY can satisfy it (${files.join(', ')})`);
    continue;
  }
  // An asset that does not exist in the repo either is a dead read, not a packaging gap.
  if (!existsSync(path.join(FRONTEND, asset)) && !existsSync(path.join(FRONTEND, '..', asset))) {
    console.log(`  · ${asset.padEnd(16)} not in the repo — a dead read, not a packaging gap (${files[0]})`);
    continue;
  }
  if (shipped(asset, dests)) {
    console.log(`  ✓ ${asset.padEnd(16)} ships (${files.length} read site${files.length === 1 ? '' : 's'})`);
  } else {
    console.log(`  ✗ ${asset.padEnd(16)} IS NOT COPIED INTO THE RUNTIME IMAGE`);
    for (const f of files) console.log(`      read by ${f}`);
    missing.push(asset);
  }
}

if (unresolved.length) {
  console.log(`\n${unresolved.length} cwd join(s) UNCHECKED — the first segment is not a literal:`);
  for (const f of [...new Set(unresolved)]) console.log(`  · ${f}`);
  console.log('  (uncovered, not passing — read these by hand)');
}

// ── THE OTHER HALF: a COPY whose SOURCE is not in the build context ──────────────────────────
//
// Everything above asks whether a COPY line EXISTS. It never asks whether that line can run. A
// context COPY (one with no `--from=`) reads from the build context, and `.dockerignore` decides
// what is in it — so an excluded source is not a quiet gap like the ones above, it is
//
//     ERROR: failed to compute cache key: "/docs/guide-coverage.json": not found
//
// …which fails the IMAGE BUILD. Nothing deploys at all. This is strictly louder than a missing
// asset and was strictly less checked, because the fix for the missing asset (add a COPY) is
// exactly what creates it.
//
// THE TRAP, and it is why the bug survived review: excluding a DIRECTORY is not the same as
// excluding its CONTENTS. `docs/` cannot be rescued by a later `!docs/guide-coverage.json`;
// `docs/*` can. This repo already learned that on `scripts/` and wrote it in a comment two lines
// below the rule that then repeated it.
const CONTEXT_ROOT = path.join(FRONTEND, '..');

/** Sources of final-stage COPY lines that read the BUILD CONTEXT (no `--from=`). */
function contextCopySources(dockerfile) {
  const lines = dockerfile.split('\n');
  let start = 0;
  lines.forEach((l, i) => { if (/^\s*FROM\s/i.test(l)) start = i; });
  const out = [];
  for (const l of lines.slice(start)) {
    const line = l.replace(/#.*$/, '');
    const m = line.match(/^\s*COPY\s+(.*)$/i);
    if (!m) continue;
    if (/--from=/i.test(line)) continue;                       // comes from a stage, not the context
    const args = m[1].replace(/--[a-z-]+(=\S+)?/gi, '').trim().split(/\s+/).filter(Boolean);
    if (args.length < 2) continue;
    out.push(...args.slice(0, -1));
  }
  return out;
}

/**
 * Would `.dockerignore` keep `rel` out of the build context?
 *
 * Deliberately CONSERVATIVE about the parent-directory case: a bare directory exclusion is treated
 * as unrescuable by a later `!`. Some BuildKit versions are more permissive, and that is exactly
 * why the conservative rule is the right one to encode — a check written to the permissive
 * semantics would have passed the configuration that broke, and `docs/*` + `!docs/…` is correct
 * under either reading. Encode the rule that keeps both true.
 */
function ignoreVerdict(rules, rel) {
  const parts = rel.split('/');
  const ancestors = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'));
  for (const raw of rules) {
    const r = raw.trim();
    if (!r || r.startsWith('#') || r.startsWith('!')) continue;
    const dir = r.replace(/\/$/, '');
    // A bare directory rule (`docs/`, `docs`) with no glob swallows everything beneath it.
    if (!/[*?]/.test(dir) && ancestors.includes(dir)) {
      return { excluded: true, rule: raw.trim(), rescuable: false };
    }
  }
  // Otherwise last-match-wins over glob rules, where `!` can rescue.
  let excluded = false;
  let rule = null;
  for (const raw of rules) {
    const r = raw.trim();
    if (!r || r.startsWith('#')) continue;
    const neg = r.startsWith('!');
    const pat = (neg ? r.slice(1) : r).replace(/\/$/, '');
    const rx = new RegExp('^' + pat
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, ' ')
      .replace(/\*/g, '[^/]*')
      .replace(/ /g, '.*')
      .replace(/\?/g, '[^/]') + '(/.*)?$');
    if (rx.test(rel)) { excluded = !neg; rule = raw.trim(); }
  }
  return { excluded, rule, rescuable: true };
}

// A MISSING .dockerignore MUST NOT READ AS "nothing is excluded".
//
// It would: empty rules make every source pass, and this section would print six ticks and a green
// summary while measuring nothing — the exact shape this repo calls worse than not scanning. The
// file's absence is far more likely to mean this script is looking in the wrong place (it resolves
// the context root as `frontend/..`, and CI runs it with working-directory: frontend) than to mean
// somebody deleted it. Refuse the verdict.
const IGNORE_FILE = path.join(CONTEXT_ROOT, '.dockerignore');
if (!existsSync(IGNORE_FILE)) {
  console.error(`\n✗ HARNESS DEFECT — no .dockerignore at ${IGNORE_FILE}.`);
  console.error('  Every context COPY below would pass for free. Refusing to report a verdict.');
  process.exit(2);
}
const ignoreRules = readFileSync(IGNORE_FILE, 'utf8').split('\n');

const sources = contextCopySources(readFileSync(DOCKERFILE, 'utf8'));
console.log(`\n── ${sources.length} context COPY source(s) in the final stage, vs .dockerignore ──\n`);
const unbuildable = [];
for (const src of sources) {
  // A glob source (`db/migrations/*.sql`) is checked at its directory, which is what an
  // exclusion would actually swallow.
  const probe = /[*?]/.test(src) ? path.posix.dirname(src) : src;
  const v = ignoreVerdict(ignoreRules, probe);
  if (v.excluded) {
    console.log(`  ✗ ${src}`);
    console.log(`      excluded from the build context by \`${v.rule}\`${v.rescuable ? '' : ' — a bare directory rule, which a later `!` cannot rescue'}`);
    unbuildable.push({ src, rule: v.rule });
  } else {
    console.log(`  ✓ ${src.padEnd(38)} in the context`);
  }
}

console.log();
if (missing.length) {
  console.error(`✗ ${missing.length} runtime asset(s) are read from disk and never shipped: ${missing.join(', ')}`);
  console.error('  Next traces imports, not paths. Add a COPY line to the FINAL Dockerfile stage.');
  console.error('  The symptom is not a crash — it is a capability that quietly does nothing in production.');
}
if (unbuildable.length) {
  console.error(`✗ ${unbuildable.length} COPY source(s) are excluded from the build context — THE IMAGE BUILD FAILS.`);
  for (const u of unbuildable) console.error(`    ${u.src}  ←  ${u.rule}`);
  console.error('  Exclude the CONTENTS (`dir/*`) and re-include the file, never the bare directory.');
}
if (missing.length || unbuildable.length) process.exit(1);
console.log('✓ every runtime-read asset ships, and every COPY source is in the build context.');
process.exit(0);
