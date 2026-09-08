/**
 * EVERY REFUSAL IN THE TREE, AND WHETHER ANYTHING BUT THE CALLER LEARNS OF IT.
 *
 * The companion to `scripts/drive-failure-observability.mts`. The drive induces real failures and
 * proves what happens — but it can only reach the routes someone wrote a probe for, and it measured
 * 11 of 11 effect-requests emitting nothing. This extends that finding across the whole surface so
 * the rollout has a list instead of an estimate.
 *
 * The division of labour matters: **the drive is the ground truth and this is the coverage.** A
 * scan alone would be exactly what it could not answer before — whether the emit actually happens
 * at run time. The drive settled that on fourteen samples; this says where else to look.
 *
 * ── WHAT IT CLASSIFIES ─────────────────────────────────────────────────────────────────────────
 * A refusal is a site that returns a `code` with a non-2xx status. Two spellings:
 *
 *   domain   `return { ok: false, status: 409, error: '…', code: 'MILESTONES_OUTSTANDING' }`
 *   route    `return NextResponse.json({ error: '…', code: '…' }, { status: 409 })`
 *
 * EMIT REQUIRED for **409 and 5xx** — work the system looked at and declined, or something that
 * broke. NOT required for the caller's own 400/401/403/404: a bad uuid or a missing field is
 * information about the REQUEST, and emitting every one buries the signal in noise nothing can act
 * on. That judgement lives in `lib/api-refusal.ts` and is mirrored here; if it changes, change both.
 *
 * ── SCOPE, STATED RATHER THAN IMPLIED ──────────────────────────────────────────────────────────
 * `frontend/` only. The pipeline and CRM services raise and log in Python rather than returning
 * this envelope, so they are a different question with a different answer — and claiming this
 * number covers them would be the same kind of unearned total this repo keeps finding.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOTS = ['lib', 'app'];

const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const f = path.join(d, e.name);
  if (e.isDirectory()) return ['node_modules', '.next', '.next-dev', '__tests__'].includes(e.name) ? [] : walk(f);
  return /\.tsx?$/.test(e.name) ? [f] : [];
});

/** Comments blanked, newlines preserved so every reported line number is the real one. */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (c, p1) => p1 + ' '.repeat(c.length - p1.length));

/** The enclosing brace-block for an offset — how we ask "does THIS handler emit". */
function enclosingBlock(src, at) {
  let depth = 0;
  let start = at;
  for (let i = at; i >= 0; i -= 1) {
    if (src[i] === '}') depth += 1;
    else if (src[i] === '{') { if (depth === 0) { start = i; break; } depth -= 1; }
  }
  let d = 0;
  let end = src.length;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') d += 1;
    else if (src[i] === '}') { d -= 1; if (d === 0) { end = i; break; } }
  }
  return src.slice(start, end + 1);
}

const EMITS = /\brefuse\s*\(|\bemitEventSingle(Strict)?\s*\(|\bemitEventEnd\s*\(|\bwithEventBracket\s*\(|\.refused\b/;
/** Mirrors `shouldEmit` in lib/api-refusal.ts. */
const emitRequired = (status) => status === 409 || status >= 500;

const sites = [];
const unparsed = [];
for (const r of ROOTS) {
  const dir = path.join(FRONTEND, r);
  try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
  for (const file of walk(dir)) {
    const rel = path.relative(FRONTEND, file);
    const src = blank(readFileSync(file, 'utf8'));

    // domain: an object literal carrying ok:false with a status and a code
    const dre = /\bok:\s*false\b/g;
    let m;
    while ((m = dre.exec(src))) {
      const near = src.slice(m.index, m.index + 400);
      const st = near.match(/status:\s*(\d{3})/);
      const cd = near.match(/code:\s*['"]([A-Z0-9_]+)['"]/);
      if (!st || !cd) { unparsed.push(`${rel}:${src.slice(0, m.index).split('\n').length} — ok:false with no status/code within 400 chars`); continue; }
      sites.push({ rel, line: src.slice(0, m.index).split('\n').length, kind: 'domain', status: +st[1], code: cd[1], at: m.index });
    }

    // route: NextResponse.json({ error, code }, { status })
    const rre = /NextResponse\.json\(\s*\{[^}]*\bcode:\s*['"]?([A-Za-z0-9_.]+)['"]?[^}]*\}\s*,\s*\{\s*status:\s*(\d{3})/g;
    while ((m = rre.exec(src))) {
      sites.push({ rel, line: src.slice(0, m.index).split('\n').length, kind: 'route', status: +m[2], code: m[1], at: m.index });
    }

    for (const s of sites.filter((x) => x.rel === rel && x.emits === undefined)) {
      s.emits = EMITS.test(enclosingBlock(src, s.at));
    }
  }
}

// ── self-test: the two converted routes must read as emitting ──────────────────────────────────
/**
 * THE UNIT OF WORK IS A REFUSAL PATH, NOT A FILE — which this self-test learned the hard way.
 *
 * It first asserted that every 409/5xx site in a converted file reads as emitting, and failed. The
 * scanner was right: `baseline/route.ts` holds SIX refusal sites and only the POST had been
 * converted — the PATCH (rebaseline) beside it and three 500 catch-alls were still silent. Saying
 * "that route is done" would have been wrong by five sixths.
 *
 * So it asserts the two things that are actually true of a conversion: the file reaches the seam,
 * and a file that has not been touched still reads as silent (a detector that cannot see the gap
 * would report the rollout complete on day one).
 */
const selfTest = [];
const convertedFiles = [
  'app/api/portal/[tenantSlug]/projects/[projectId]/baseline/route.ts',
  'app/api/portal/[tenantSlug]/projects/[projectId]/route.ts',
];
for (const c of convertedFiles) {
  const src = (() => { try { return readFileSync(path.join(FRONTEND, c), 'utf8'); } catch { return ''; } })();
  selfTest.push([`${c} reaches the refusal seam`, /\brefuse\s*\(/.test(src)]);
}
selfTest.push([
  'an untouched 409 still reads as SILENT — the detector can see the gap it exists for',
  sites.some((s) => s.status === 409 && !s.emits && !convertedFiles.includes(s.rel)),
]);
const q404 = sites.find((s) => s.status === 404);
selfTest.push(['a 404 is not counted as requiring an emit', q404 ? !emitRequired(q404.status) : false]);
console.log('── self-test ──');
let selfBad = 0;
for (const [label, ok] of selfTest) { console.log(`  ${ok ? '✓' : '✗'} ${label}`); if (!ok) selfBad += 1; }
if (selfBad) {
  console.error(`\n✗ HARNESS DEFECT — ${selfBad} self-test(s) failed; every count below would be unearned.`);
  process.exit(2);
}

const required = sites.filter((s) => emitRequired(s.status));
const silent = required.filter((s) => !s.emits);
const byFile = {};
for (const s of silent) (byFile[s.rel] ??= []).push(s);

console.log(`\n── ${sites.length} refusal site(s) — ${sites.filter((s) => s.kind === 'domain').length} domain · ${sites.filter((s) => s.kind === 'route').length} route ──`);
console.log(`   ${required.length} are 409 or 5xx and REQUIRE an emit`);
console.log(`   ${required.length - silent.length} of those emit`);
console.log(`   ${silent.length} do NOT — the rollout list\n`);

/**
 * ONE NUMBER IS NOT A PLAN. The silent set splits into two populations that want different work,
 * and lumping them makes the smaller, more valuable one invisible:
 *
 *   409 · a BUSINESS refusal — a conflict, a gate, a precondition. The system looked at real work
 *         and declined, and nothing anywhere records it. Convert these first: each is a deliberate
 *         decision someone already wrote a code for.
 *   5xx · a crash path. Already `console.error`-ed, so not invisible to an operator reading server
 *         logs — but invisible to `/admin/events`, the Command Center and every product surface
 *         that reads the event stream. Mechanical, and lower value per site.
 */
const business = silent.filter((s) => s.status === 409);
const crashes = silent.filter((s) => s.status >= 500);
console.log(`   of those: ${business.length} are 409 BUSINESS refusals · ${crashes.length} are 5xx crash paths`);
const topCodes = Object.entries(business.reduce((a, s) => { a[s.code] = (a[s.code] ?? 0) + 1; return a; }, {}))
  .sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\n  409 codes nothing records, most frequent first:');
console.log('  ' + topCodes.map(([c, n]) => `${c}×${n}`).join(' · ') + '\n');

const ranked = Object.entries(byFile).sort((a, b) => b[1].length - a[1].length);
for (const [f, list] of ranked.slice(0, 25)) {
  console.log(`  ${String(list.length).padStart(3)}  ${f}`);
  console.log(`       ${list.slice(0, 6).map((s) => `${s.code}(${s.status})`).join(' · ')}${list.length > 6 ? ' …' : ''}`);
}
if (ranked.length > 25) console.log(`\n  … and ${ranked.length - 25} more file(s)`);

if (unparsed.length) {
  console.log(`\n── ${unparsed.length} site(s) NOT classified (reported, never assumed innocent) ──`);
  unparsed.slice(0, 10).forEach((u) => console.log('  ' + u));
  if (unparsed.length > 10) console.log(`  … and ${unparsed.length - 10} more`);
}

console.log(`\n  Ground truth for this class is the DRIVE (drive-failure-observability.mts), which proves`);
console.log('  what actually happens at run time. This is the coverage map that tells it where to go.');
process.exit(0);
