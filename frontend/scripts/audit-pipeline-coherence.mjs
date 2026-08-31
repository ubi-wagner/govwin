#!/usr/bin/env node
/**
 * Do the ten pipelines behave like one product, or like ten products in one repo?
 *
 * ── THE QUESTION NO EXISTING INSTRUMENT ASKS ─────────────────────────────────────────────────
 * Every lens in this tree measures ONE pipeline against ITS OWN expectation. `verify-surfaces`
 * asks whether a page renders, `verify-api-contract` whether a route's envelope is shaped right,
 * `reconcile-capability` whether a capability has a door. All of them can be green on ten
 * pipelines that each solve the same problem a different way — and that is the failure this asks
 * about: a second uploader, a third date helper, a fourth way to raise a ToDo, one surface that
 * emits events and its sibling that does not.
 *
 * Siloing is not a bug in any one file. It is only visible in the JOIN, which is why it needs its
 * own instrument.
 *
 * ── WHAT IT MEASURES ─────────────────────────────────────────────────────────────────────────
 * Every file in the tree is assigned to at most one PIPELINE (by path — the assignment is data,
 * printed, and arguable). For each pipeline it then answers, per SEAM:
 *
 *   ADOPTED   files in this pipeline that reach the shared seam
 *   BESPOKE   files that do the seam's JOB without the seam — the finding
 *
 * A seam is only worth listing when a shared implementation exists AND more than one pipeline
 * needs it. `evidence` is not a seam; `emit an event` is.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────────────────────────
 * It does not conclude. A pipeline that never sends mail scores zero on the email seam, and that
 * is correct rather than a gap — so a zero is reported as `—` (not applicable) when the pipeline
 * has no file that does the seam's job at all. Only ADOPTED=0 with BESPOKE>0 is a finding, and
 * every finding names its files. A number with no file behind it is exactly the kind of confident
 * claim this repo has paid for.
 *
 * ── AND IT VALIDATES ITSELF FIRST ────────────────────────────────────────────────────────────
 * `--check` runs hand-verified answers, chosen because each one an earlier draft got wrong. The
 * first draft counted an IMPORT of `@/lib/events` as adoption, which made `lib/events.ts` itself
 * adopt its own seam and made a re-export look like a user. Adoption is a CALL.
 *
 *   node scripts/audit-pipeline-coherence.mjs           # the matrix + findings
 *   node scripts/audit-pipeline-coherence.mjs --check   # self-test only
 *   node scripts/audit-pipeline-coherence.mjs --seam events   # one seam, every file
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const REPO = path.resolve(FRONTEND, '..');
const INVENTORY = path.join(REPO, 'docs/frontend-inventory.json');

if (!existsSync(INVENTORY)) {
  console.error('docs/frontend-inventory.json missing — run `node scripts/inventory-frontend.mjs` first.');
  console.error('This audit reads the MANIFEST rather than walking the tree itself, so that a file');
  console.error('outside both walks cannot be outside this one too (B125).');
  process.exit(2);
}
const inv = JSON.parse(readFileSync(INVENTORY, 'utf8'));

// ── THE TEN PIPELINES, IN THE USER'S OWN WORDS ───────────────────────────────────────────────
// Ordered first-match-wins, so the more specific pattern is listed above the broader one:
// `lib/proposal/cost-forms.ts` is proposal-build, not doc-save-export, even though it renders.
// The overlap is real and the resolution has to be a decision rather than a coincidence of
// iteration order.
const PIPELINES = [
  { key: 'projects', label: 'project pipeline (post-award)', match: (f) =>
    /^(lib|app\/api\/portal\/\[tenantSlug\]|app\/portal\/\[tenantSlug\]|components)\/.*projects?\//.test(f)
    || /^lib\/projects\//.test(f) },
  { key: 'proposal-build', label: 'proposal build pipeline', match: (f) =>
    /^lib\/proposal[-/]/.test(f) || /^lib\/(compliance|review)\//.test(f)
    || /proposals?\//.test(f) && /^(app|components)\//.test(f) },
  { key: 'rfp-ingest', label: 'rfp ingest', match: (f) =>
    /^lib\/(ingest|curation|scout)\//.test(f) || /^lib\/(intake|clean-text|extract-topics)\.ts$/.test(f)
    || /^app\/(api\/)?admin\/(rfp|solicitations|scouts|intake)/.test(f) },
  { key: 'library-ingest', label: 'library ingest', match: (f) =>
    /^lib\/(library|vaults)\//.test(f) || /^lib\/(atoms|atom-[a-z]+|atomize-[a-z]+)\.ts$/.test(f)
    || /(atoms|library|vaults)\//.test(f) && /^(app|components)\//.test(f) },
  { key: 'templating', label: 'document templating', match: (f) =>
    /^lib\/templates?\//.test(f) || /^lib\/template-bridge\.ts$/.test(f)
    || /(templates|template-cards|molds)\//.test(f) && /^(app|components)\//.test(f) },
  { key: 'documents', label: 'document creation', match: (f) =>
    /^lib\/(documents|canvas)\//.test(f) || /^lib\/(content-canvas|content-admin)\.ts$/.test(f)
    || /documents\//.test(f) && /^(app|components)\//.test(f) },
  { key: 'export', label: 'document save + export', match: (f) =>
    /^lib\/(export|pdf)\//.test(f) || /^lib\/(numeric-cell|markdown)\.ts$/.test(f)
    || /^lib\/types\/canvas-document\.ts$/.test(f) },
  { key: 'opportunity', label: 'opportunity publish + update', match: (f) =>
    /^lib\/(cards|spotlight)\//.test(f) || /^lib\/(opportunity-[a-z]+|amendments|lifecycle)\.ts$/.test(f)
    || /(opportunit|cards|solicitation)/.test(f) && /^(app|components)\//.test(f) },
  { key: 'ranking', label: 'buckets + opportunity ranking', match: (f) =>
    /^lib\/bucket-ranking\.ts$/.test(f) || /bucket/i.test(f) && /^(app|components|lib)\//.test(f) },
  { key: 'automation', label: 'automation + agent framework', match: (f) =>
    /^lib\/(automation|tasks|process|ai|tools)\//.test(f)
    || /^lib\/(events|event-namespaces|agent-client|agent-output)\.ts$/.test(f)
    || /^(app|components)\/.*(agents|workflows|automation|todos)\//.test(f) },
];

/**
 * The seams. `job` is what makes a file a CANDIDATE — it does this seam's work; `uses` is whether
 * it reaches the shared implementation.
 *
 * The distinction is the whole instrument. Counting only `uses` reports a pipeline that never
 * needed the seam identically to one that reimplemented it, and those are opposite findings.
 */
/**
 * `owner` — the file(s) that IMPLEMENT a seam, excluded from its own adoption count.
 *
 * `lib/events.ts` calls `emitEventStart`/`emitEventEnd` from inside `withEventBracket`, so on the
 * first draft it counted as an adopter of the seam it defines. That inflates every ratio by one
 * and, worse, makes a seam with exactly one user look like it has two. A seam's owner is not
 * evidence that anybody adopted it.
 */
const SEAMS = [
  {
    key: 'events',
    label: 'events → system_events',
    owner: /^lib\/(events|event-namespaces)\.ts$/,
    // Writing to system_events is the job. Reaching lib/events is the seam.
    job: (r, src) => /system_events/.test(src) || /emitEvent|withEventBracket/.test(src),
    uses: (r) => (r.calls ?? []).some((c) => /^(emitEventSingle|emitEventSingleStrict|emitEventStart|emitEventEnd|withEventBracket|emitEvent)$/.test(c)),
    bespoke: (r, src) => /INSERT\s+INTO\s+system_events/i.test(src),
  },
  {
    key: 'email',
    owner: /^lib\/email\//,
    label: 'outbound mail → lib/email',
    job: (r, src) => /sendEmail|mailer|nodemailer|notification\.requested|sendMail/.test(src),
    // Two legitimate paths, and both are the seam. A direct `lib/email` send renders in TS; an
    // emitted `system:notification.requested` renders in the CRM — and BOTH write the same
    // `email_send_ledger` and honour the same suppressions (docs/EMAIL_INTERFACE_DESIGN.md).
    // Counting only the first reported the whole Projects capability as 0/3 while it was sending
    // correctly through the path its own comments name.
    uses: (r, src) => imports(r, /^lib\/email/)
      || (r.calls ?? []).some((c) => /^(sendEmail|queueEmail)$/.test(c))
      || /notification\.requested/.test(src ?? ''),
    bespoke: (r, src) => /nodemailer|createTransport|smtplib|postmarkapp\.com/.test(src),
  },
  {
    key: 'todos',
    owner: /^lib\/(tasks\/|automation\/(triggers|prestage-todos)\.ts|projects\/todos\.ts)/,
    label: 'human work → the tasks spine',
    job: (r, src) => /\btasks\b/.test(src) && /(INSERT|raiseTask|createTask|projectTodo)/.test(src),
    uses: (r) => imports(r, /^lib\/(tasks\/|automation\/(triggers|prestage-todos)|projects\/todos)/),
    bespoke: (r, src) => /INSERT\s+INTO\s+tasks\b/i.test(src),
  },
  {
    key: 'canvas',
    owner: /^lib\/(types\/canvas-document\.ts|canvas\/)/,
    label: 'authored content → CanvasDocument',
    job: (r, src) => /CanvasDocument|canvas_versions|\bcanvas\b/.test(src),
    uses: (r) => imports(r, /canvas-document|^lib\/canvas\//),
    bespoke: () => false, // a second document model would be a design decision, not a grep
  },
  {
    key: 'floor',
    owner: /^lib\/(types\/canvas-document\.ts|export\/paginate\.ts)$/,
    label: 'size/compliance floor on write + export',
    job: (r, src) => /estimatePageCount|paginate\(|validateCanvas|validateStandalone|X-Compliance/.test(src),
    uses: (r) => (r.calls ?? []).some((c) => /^(validateCanvasAgainstSpec|validateStandaloneCanvas)$/.test(c)),
    bespoke: (r, src) => /\.length\s*\/\s*(?:3000|2500|500)\b/.test(src), // a hand-rolled page guess
  },
  {
    key: 'tenant',
    owner: /^lib\/(db\.ts|rls\.ts|tenant-context\.ts|projects\/gate\.ts)$/,
    label: 'tenant authority + RLS scope',
    job: (r) => /^app\/(api\/)?portal\/\[tenantSlug\]/.test(r.file),
    uses: (r) => (r.calls ?? []).some((c) => /^(verifyTenantAccess|verifyProposalAccess|withProject|withTenant|runInTenant|resolveVaultAccess|verifyPortalAccess|requireTenantMember)$/.test(c)),
    bespoke: (r, src) => /\bsql\.begin\s*\(/.test(src), // the documented Proxy trap: bypasses app.tenant_id
  },
  {
    key: 'audit',
    owner: /^lib\/db\.ts$/,
    label: 'domain audit trail',
    job: (r, src) => /auditLog|audit_logs/.test(src),
    uses: (r) => (r.calls ?? []).some((c) => c === 'auditLog'),
    bespoke: (r, src) => /INSERT\s+INTO\s+audit_logs/i.test(src),
  },
  {
    key: 'agents',
    owner: /^lib\/(ai\/|agent-client\.ts|agent-output\.ts|tools\/)/,
    label: 'AI through the fabric, not a direct call',
    job: (r, src) => /anthropic|claude|agent_task_queue|AI_INVOKE|archetype/i.test(src),
    uses: (r) => imports(r, /^lib\/(ai\/|agent-client|agent-output|tools\/)/)
      || (r.calls ?? []).some((c) => /^(emitEventSingle|emitEventSingleStrict|withEventBracket)$/.test(c)),
    bespoke: (r, src) => /api\.anthropic\.com/.test(src),
  },
  {
    key: 'dates',
    owner: /^lib\/projects\/dates\.ts$/,
    label: 'date columns read as Date, not sliced',
    job: (r, src) => /toISOString\(\)\.slice|String\([a-zA-Z.]+\)\.slice|isoDate|daysBetween/.test(src),
    uses: (r) => imports(r, /projects\/dates/) || (r.calls ?? []).some((c) => /^(isoDate|daysBetween)$/.test(c)),
    // THE bug class, three shipped occurrences: slicing the STRING form of a Date column.
    bespoke: (r, src) => /String\(\s*[a-zA-Z_$][\w.$]*\s*\)\s*\.slice\(\s*0\s*,\s*10\s*\)/.test(src),
  },
  {
    key: 'toast',
    owner: /^lib\/toast\.tsx$/,
    label: 'user feedback → toast(), not alert()',
    job: (r, src) => r.client && /alert\(|toast\(/.test(src),
    uses: (r) => imports(r, /^lib\/toast/),
    bespoke: (r, src) => /(?<![.\w])alert\s*\(/.test(src),
  },
];

// ── READ THE SOURCE ONCE ─────────────────────────────────────────────────────────────────────
// The inventory carries imports and calls but not the text, and half the seams above are text
// questions ("does this file INSERT INTO tasks"). Reading is cheap; guessing is not.
const SKIP = /^(scripts|e2e|__tests__|\.next)\//;
const src = new Map();   // comments INTACT — `job` asks what a file is about
const code = new Map();  // comments STRIPPED — `bespoke` asks what it does
const records = inv.records.filter((r) => !SKIP.test(r.file) && !/^(test|e2e|script)$/.test(r.kind));

/**
 * Strip comments before asking whether a file DOES something.
 *
 * The first run of this reported ten date-slicing defects. Three were in `lib/projects/*.ts` and
 * all three were the COMMENT above the correct code, explaining the bug the line used to have —
 * this repo documents its defects at the site, so a text search for a bug pattern finds its own
 * changelog. An instrument that reads documentation as code will find the most bugs exactly where
 * the most care was taken, which inverts the signal.
 *
 * `job` still reads the full text: what a file is ABOUT is fairly claimed by its prose.
 */
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      // block comments
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1'); // line comments, but not `https://` or a quoted //
}

for (const r of records) {
  const p = path.join(FRONTEND, r.file);
  let text = '';
  try { text = readFileSync(p, 'utf8'); } catch { text = ''; }
  src.set(r.file, text);
  code.set(r.file, stripComments(text));
}

/**
 * A file's imports as REPO-RELATIVE module paths.
 *
 * `uses` predicates used to match the import SPELLING, and the spelling varies: `lib/projects/
 * milestones.ts` reaches the ToDo seam as `./todos`, not `@/lib/projects/todos`. Three separate
 * "this pipeline does not use the seam" findings turned out to be that — the projects ToDo
 * column read 3/9 while eight of the nine used it, and the ninth had no ToDos to raise.
 *
 * A predicate that answers a question about MODULES must be asked in modules. Relative specifiers
 * are resolved against the importing file's directory; `@/` is the repo alias; a bare package name
 * is left alone.
 */
function importedModules(rec) {
  const dir = path.posix.dirname(rec.file);
  return (rec.imports ?? []).map((i) => {
    const spec = i.spec ?? '';
    if (spec.startsWith('@/')) return spec.slice(2);
    if (spec.startsWith('.')) return path.posix.normalize(path.posix.join(dir, spec));
    return spec;
  });
}
/** Does this record import a module matching `re`, however the import was spelled? */
const imports = (rec, re) => importedModules(rec).some((m) => re.test(m));

function pipelineOf(file) {
  for (const p of PIPELINES) if (p.match(file)) return p.key;
  return null;
}

// ── THE MATRIX ───────────────────────────────────────────────────────────────────────────────
const cells = new Map(); // `${pipeline}:${seam}` → { adopted: [], bespoke: [], candidates: [] }
const cell = (p, s) => {
  const k = `${p}:${s}`;
  if (!cells.has(k)) cells.set(k, { adopted: [], bespoke: [], candidates: [] });
  return cells.get(k);
};

for (const r of records) {
  const pk = pipelineOf(r.file);
  if (!pk) continue;
  const text = src.get(r.file) ?? '';
  for (const seam of SEAMS) {
    // A seam's own implementation is neither an adopter nor a divergence from itself.
    if (seam.owner?.test(r.file)) continue;
    let isJob = false;
    try { isJob = Boolean(seam.job(r, text)); } catch { isJob = false; }
    if (!isJob) continue;
    const c = cell(pk, seam.key);
    c.candidates.push(r.file);
    if (seam.uses(r, text)) c.adopted.push(r.file);
    let bad = false;
    try { bad = Boolean(seam.bespoke(r, code.get(r.file) ?? '')); } catch { bad = false; }
    if (bad) c.bespoke.push(r.file);
  }
}

// ── SELF-TEST — hand-verified, and each one an earlier draft got wrong ───────────────────────
const SELF_TEST = [
  {
    why: 'lib/projects/gate.ts is the projects pipeline, not automation, despite importing runInTenant',
    ok: () => pipelineOf('lib/projects/gate.ts') === 'projects',
  },
  {
    why: 'lib/events.ts is the automation pipeline — the seam OWNER is not one of its adopters',
    ok: () => pipelineOf('lib/events.ts') === 'automation'
      && !cell('automation', 'events').adopted.includes('lib/events.ts'),
  },
  {
    why: 'a project route that calls withProject counts as tenant-authorised',
    ok: () => cell('projects', 'tenant').adopted
      .includes('app/api/portal/[tenantSlug]/projects/[projectId]/baseline/route.ts'),
  },
  {
    why: 'the email seam has NO bespoke transport anywhere — proven separately, and the grep must agree',
    ok: () => [...cells.values()].every((c) => c.bespoke.length === 0 || true)
      && SEAMS.find((s) => s.key === 'email')
      && ![...cells.entries()].some(([k, c]) => k.endsWith(':email') && c.bespoke.length),
  },
  {
    why: 'the date seam\'s OWNER is excluded from its own count, and a real caller is counted',
    ok: () => !cell('projects', 'dates').candidates.includes('lib/projects/dates.ts')
      && cell('projects', 'dates').adopted.includes('lib/projects/milestones.ts'),
  },
  {
    why: 'every record classified into a pipeline is a real file that was read',
    ok: () => records.filter((r) => pipelineOf(r.file)).every((r) => src.has(r.file)),
  },
  {
    // The exact three false positives the first run produced, pinned so the comment-stripper
    // cannot silently regress into reading a changelog as a defect.
    why: 'a file whose COMMENT quotes the date-slicing bug, above correct code, is not a finding',
    ok: () => ['lib/projects/cdrl.ts', 'lib/projects/invoices.ts', 'lib/projects/milestones.ts']
      .every((f) => /String\(d\)\.slice\(0,10\)|String\(row\.baselineDate\)/.test(src.get(f) ?? '')
        && !cell('projects', 'dates').bespoke.includes(f)),
  },
  {
    // Each of these was a "this pipeline does not use the seam" finding that turned out to be the
    // predicate. Pinned, because a false NEGATIVE is the dangerous direction here: it invents work
    // and spends the reader's trust, and unlike a false positive nothing downstream contradicts it.
    why: 'mail sent by emitting system:notification.requested counts as the email seam',
    ok: () => cell('projects', 'email').adopted.includes('lib/projects/todos.ts'),
  },
  {
    why: 'a RELATIVE import of the seam counts — `./todos` is the same module as `@/lib/projects/todos`',
    ok: () => cell('projects', 'todos').adopted.includes('lib/projects/milestone-tasks.ts')
      && importedModules({ file: 'lib/projects/milestone-tasks.ts', imports: [{ spec: './todos' }] })
        .includes('lib/projects/todos'),
  },
  {
    why: 'stripping comments does not eat a URL — `https://x` survives intact',
    ok: () => stripComments("const u = 'https://api.example.com/x'; // gone").includes('https://api.example.com/x')
      && !stripComments("const u = 1; // gone").includes('gone'),
  },
];

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const seamFilter = args.includes('--seam') ? args[args.indexOf('--seam') + 1] : null;

console.log('── self-test (validate the instrument before believing its output) ──');
let failed = 0;
for (const t of SELF_TEST) {
  let pass = false;
  try { pass = Boolean(t.ok()); } catch (e) { pass = false; t.why += ` [threw: ${e.message}]`; }
  console.log(`  ${pass ? '✓' : '✗'} ${t.why}`);
  if (!pass) failed += 1;
}
if (failed) {
  console.error(`\n✗ ${failed} self-test(s) failed — every number below would be unearned. Exiting 2.`);
  process.exit(2);
}
if (checkOnly) process.exit(0);

// ── REPORT ───────────────────────────────────────────────────────────────────────────────────
const seams = seamFilter ? SEAMS.filter((s) => s.key === seamFilter) : SEAMS;
if (seamFilter && !seams.length) {
  console.error(`unknown seam '${seamFilter}' — one of: ${SEAMS.map((s) => s.key).join(', ')}`);
  process.exit(2);
}

console.log('\n── seam adoption by pipeline ──');
console.log('  adopted / candidates   ·  "—" = the pipeline never does this seam\'s job at all\n');
const W = 26;
const head = ['pipeline'.padEnd(W), ...seams.map((s) => s.key.padStart(9))].join(' ');
console.log('  ' + head);
console.log('  ' + '-'.repeat(head.length));
for (const p of PIPELINES) {
  const row = [p.key.padEnd(W)];
  for (const s of seams) {
    const c = cells.get(`${p.key}:${s.key}`);
    if (!c || !c.candidates.length) { row.push('—'.padStart(9)); continue; }
    const uniq = (a) => new Set(a).size;
    row.push(`${uniq(c.adopted)}/${uniq(c.candidates)}`.padStart(9));
  }
  console.log('  ' + row.join(' '));
}

console.log('\n── findings: a file doing a seam\'s job the seam\'s own way is not one ──');
const findings = [];
for (const p of PIPELINES) {
  for (const s of seams) {
    const c = cells.get(`${p.key}:${s.key}`);
    if (!c) continue;
    for (const f of new Set(c.bespoke)) {
      findings.push({ pipeline: p.key, seam: s.key, file: f, kind: 'BESPOKE' });
    }
  }
}
if (!findings.length) console.log('  none — no file reimplements a seam it could have reached.');
for (const f of findings) console.log(`  ✗ ${f.kind}  ${f.pipeline} · ${f.seam}  ${f.file}`);

if (seamFilter) {
  console.log(`\n── every candidate for '${seamFilter}' ──`);
  for (const p of PIPELINES) {
    const c = cells.get(`${p.key}:${seamFilter}`);
    if (!c || !c.candidates.length) continue;
    console.log(`\n  ${p.key}:`);
    for (const f of new Set(c.candidates)) {
      const tag = c.bespoke.includes(f) ? 'BESPOKE ' : c.adopted.includes(f) ? 'adopted ' : 'neither ';
      console.log(`    ${tag} ${f}`);
    }
  }
}

const out = { generatedFrom: 'frontend/scripts/audit-pipeline-coherence.mjs', selfTestPassed: true,
  pipelines: PIPELINES.map((p) => p.key), seams: SEAMS.map((s) => s.key),
  matrix: Object.fromEntries([...cells].map(([k, v]) => [k, {
    adopted: [...new Set(v.adopted)], bespoke: [...new Set(v.bespoke)], candidates: [...new Set(v.candidates)].length,
  }])), findings };
writeFileSync(path.join(REPO, 'docs/pipeline-coherence.json'), JSON.stringify(out, null, 1));
console.log('\n  wrote docs/pipeline-coherence.json');
process.exit(0);
