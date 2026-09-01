#!/usr/bin/env node
/**
 * audit-doc-currency — does the documentation still describe the system that exists?
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────────────────
 * There are 181 documents in `docs/` plus six at the root, and every instrument in this repository
 * measures the CODE. Nothing measures the prose. That asymmetry has already cost real time twice in
 * ways the repo records: CLAUDE_CLIFFNOTES §1 froze at migration 067 and misled for 135 migrations,
 * and docs pointing at rotted harness scripts made 16 of them "documented-but-rotted" — a doc points
 * at them, and they fail confusingly.
 *
 * A stale sentence is not a cosmetic problem. It is an instruction to the next reader, and the next
 * reader is usually an agent with no independent way to know the sentence is false.
 *
 * ── WHAT IT CAN AND CANNOT CHECK ─────────────────────────────────────────────────────────────
 * It checks REFERENCES, not prose. A reference is falsifiable — the file is there or it is not, the
 * route resolves or it does not, the table exists or it does not. Whether a paragraph still
 * describes the design accurately is a judgement, and an instrument that pretended to make it would
 * produce confident nonsense.
 *
 * ⚠️ THE DISCRIMINATION PROBLEM, stated because getting it wrong makes this instrument useless.
 * Most docs here deliberately carry HISTORY: "at migration head 205 we did X", "superseded by Y",
 * "the old table was dropped in mig 125". A naive scan reports every one of those as a stale
 * reference, buries the two real findings in ninety phantom ones, and the whole audit gets ignored.
 * So:
 *   · cross-references and file paths are checked EVERYWHERE — a path either resolves or it does
 *     not, regardless of tense, and a dead path is always worth fixing;
 *   · table and count claims are checked only in a NAMED SET of live-claim documents, listed below
 *     with a reason each. Scoping by name rather than by a tense heuristic is the honest way to do
 *     it: a regex cannot tell "is" from "was" reliably, and pretending otherwise is how an
 *     instrument earns a reputation for crying wolf.
 *
 *   node frontend/scripts/audit-doc-currency.mjs          # from the repo root
 * Exit 0 when nothing is broken, 1 on findings, 2 if it could not earn a verdict.
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import postgres from 'postgres';

const ROOT = process.cwd().endsWith('/frontend') ? dirname(process.cwd()) : process.cwd();
const DOCS = join(ROOT, 'docs');
const ROOT_DOCS = ['CLAUDE.md', 'CLAUDE_CLIFFNOTES.md', 'ARCHITECTURE_V10.md', 'ARCHITECTURE_V9.md',
  'CHANGELOG.md', 'RAILWAY.md'];

/**
 * Documents that make LIVE claims about the current system — the ones a reader treats as "how it
 * is today" rather than "how it was in August". Table and count claims are checked here only.
 * Each entry states why it is on the list, so adding one is a decision rather than a habit.
 */
const LIVE_CLAIM_DOCS = {
  'CLAUDE.md': 'the standing instructions — every claim in it is read as present tense',
  'ARCHITECTURE_V10.md': 'the as-built architecture of record',
  'docs/DATA_FLOW.md': 'the static cross-section of the request path as it is now',
  'docs/MARKETING_SALES_SYSTEM.md': 'the design of a capability shipped this week',
  'docs/ARCHIVABLE_CONTRACT.md': 'states which entities are archivable, and code enforces it',
  'docs/EVENT_CONTRACT.md': 'the event registry contract, mirrored in three runtimes',
};

/** Generated documents that carry their own provenance stamp — checked against live reality. */
const GENERATED = [
  { file: 'docs/SCHEMA_MAP.md', re: /migration head `([^`]+)`/, what: 'migration head' },
  { file: 'docs/FRONTEND_INVENTORY.md', re: null, what: null },
  { file: 'docs/UI_CATALOG.md', re: null, what: null },
];

let findings = 0;
let unmeasured = 0;
const out = [];
const ok = (m) => out.push(`  ok    ${m}`);
const no = (m) => { out.push(`  FIND  ${m}`); findings++; };
const cant = (m) => { out.push(`  CANT  ${m}`); unmeasured++; };

// ── the corpus ────────────────────────────────────────────────────────────────────────────────
function corpus() {
  const files = [];
  for (const f of readdirSync(DOCS)) if (f.endsWith('.md')) files.push(`docs/${f}`);
  for (const f of ROOT_DOCS) if (existsSync(join(ROOT, f))) files.push(f);
  return files.sort();
}
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * A reference inside a fenced code block is usually an EXAMPLE, not a claim — `docs/YOUR_DOC.md`
 * in a template, a `scripts/foo.mjs` in an illustrative command. Stripping fences first is what
 * keeps the file-path check from reporting a doc's own worked examples.
 */
const unfenced = (src) => src
  .replace(/```[\s\S]*?```/g, '\n')
  // ~~strikethrough~~ is how this repository writes "this thing does not exist" — a doc correcting
  // a dead reference has to NAME the dead reference, and flagging that naming forever would mean
  // the only way to satisfy the audit is to delete the correction. Struck-through spans are
  // therefore mentions, not citations.
  .replace(/~~[\s\S]{0,200}?~~/g, ' ');

// ── self-tests: the instrument before the finding ────────────────────────────────────────────
function selfTest() {
  const t = [];
  const check = (label, got) => { t.push([label, got]); };

  check('the corpus is the real one, not empty', corpus().length > 150);
  check('the corpus includes CLAUDE.md', corpus().includes('CLAUDE.md'));
  check('fenced examples are stripped before path checking',
    !unfenced('text\n```\ndocs/NOT_REAL.md\n```\n').includes('NOT_REAL'));
  check('a path outside a fence survives stripping',
    unfenced('see docs/DATA_FLOW.md now').includes('DATA_FLOW'));
  // The rule must match a real reference AND reject a lookalike that is not one.
  check('the doc-ref pattern matches a real citation',
    /docs\/[A-Za-z0-9_./-]+\.md/.test('canonical: docs/AGENT_WORKFORCE.md'));
  check('the script-ref pattern does not match a bare directory',
    !/\b(?:frontend\/)?scripts\/[A-Za-z0-9_/-]+\.(?:mjs|mts|ts|sh|js|py)\b/.test('under scripts/ there are'));
  check('LIVE_CLAIM_DOCS all exist on disk',
    Object.keys(LIVE_CLAIM_DOCS).every((f) => existsSync(join(ROOT, f))));
  // The elision guard, both ways: it must reject a shorthand AND pass a real path.
  check('an elided path is not treated as a broken reference',
    !isFollowable('app/api/portal/.../archive/route.ts'));
  check('a naming template is not treated as a broken reference',
    !isFollowable('db/migrations/NNN_description.sql'));
  check('a struck-through name is a mention, not a citation',
    !unfenced('there is no ~~docs/GONE.md~~ any more').includes('GONE'));
  check('a live name beside a struck-through one still counts',
    unfenced('~~docs/GONE.md~~ superseded by docs/DATA_FLOW.md').includes('DATA_FLOW'));
  check('a real dynamic-segment path IS still followable',
    isFollowable('frontend/app/portal/[tenantSlug]/dashboard/page.tsx'));
  // Multi-service resolution, against a file that really is under pipeline/ and nowhere else.
  check('a pipeline-relative path resolves',
    ROOTS.some((r) => existsSync(join(ROOT, r, 'scripts/drive_prove_agents.py'))));
  check('a frontend-relative path resolves',
    ROOTS.some((r) => existsSync(join(ROOT, r, 'scripts/verify-surfaces.mjs'))));
  check('an invented path resolves nowhere',
    !ROOTS.some((r) => existsSync(join(ROOT, r, 'scripts/definitely-not-here.mjs'))));

  const bad = t.filter(([, g]) => !g);
  for (const [label, got] of t) console.log(`  ${got ? '✓' : '✗'} ${label}`);
  if (bad.length) {
    console.error(`\n✗ ${bad.length} self-test(s) failed — every finding below would be unearned.`);
    process.exit(2);
  }
}

// ── 1 · cross-references between documents ───────────────────────────────────────────────────
function checkDocRefs() {
  const missing = new Map();
  for (const rel of corpus()) {
    const src = unfenced(read(rel));
    for (const m of src.matchAll(/\bdocs\/[A-Za-z0-9_./-]+\.md\b/g)) {
      const target = m[0];
      if (existsSync(join(ROOT, target))) continue;
      // `docs/archive/…` in a table recording that something WAS archived is a historical note,
      // and the archive directory may legitimately not be checked in. Report it separately.
      if (!missing.has(target)) missing.set(target, []);
      missing.get(target).push(rel);
    }
  }
  if (missing.size === 0) { ok(`every docs/*.md cross-reference resolves`); return; }
  for (const [target, citers] of missing) {
    no(`${target} does not exist — cited by ${citers.join(', ')}`);
  }
}

// ── 2 · referenced harness scripts and source files ──────────────────────────────────────────
/**
 * Is this string a path a reader could actually follow, or a shorthand for one?
 *
 * The first run of this audit reported `app/api/portal/.../proposals/[p]/archive/route.ts` and
 * `db/migrations/NNN_description.sql` as missing files. Both are correct prose: one elides a long
 * path with `...`, the other is the naming TEMPLATE for a new migration. Neither is a broken
 * reference, and reporting them buries the ones that are — which is the whole failure mode this
 * instrument exists to avoid, committed by the instrument itself on its first output.
 */
function isFollowable(p) {
  if (p.includes('...')) return false;                 // elided middle
  // `NNN` marks a placeholder migration number. NOT `\bNNN\b` — the real string is
  // `NNN_description.sql`, and `_` is a word character, so there is no boundary after the last N.
  // The self-test above caught exactly that, which is the reason it asserts both directions.
  if (/NNN|<|>|\{|\}/.test(p)) return false;           // a template, not a path
  return true;
}

/**
 * Where a documented path might live.
 *
 * This repository is three services, and each document writes paths relative to whichever tree its
 * subject is in: `scripts/drive_prove_agents.py` in docs/AGENT_WORKFORCE.md means
 * `pipeline/scripts/…`, while `scripts/verify-surfaces.mjs` in TESTING_STRATEGY means
 * `frontend/scripts/…`. Resolving against only the repo root and `frontend/` reported eleven real,
 * present files as missing — the second time this instrument's first output was about the
 * instrument.
 */
const ROOTS = ['', 'frontend', 'pipeline', 'services/cms'];

function checkFileRefs() {
  const missing = new Map();
  const becameDir = new Map();
  const RE = /\b(?:frontend\/)?(?:scripts|lib|app|db|services|pipeline)\/[A-Za-z0-9_/.[\]-]+\.(?:mjs|mts|tsx?|sh|jsx?|py|sql|json)\b/g;
  for (const rel of corpus()) {
    for (const m of unfenced(read(rel)).matchAll(RE)) {
      const p = m[0];
      if (!isFollowable(p)) continue;
      if (ROOTS.some((r) => existsSync(join(ROOT, r, p)))) continue;
      // A FILE that became a DIRECTORY is the most common shape here (`lib/email.ts` →
      // `lib/email/`), and it is a more useful thing to say than "missing": the capability is
      // still there, the reader is being sent one level too deep.
      const asDir = p.replace(/\.(mjs|mts|tsx?|sh|jsx?|py|sql|json)$/, '');
      const dirRoot = ROOTS.find((r) => { try { return statSync(join(ROOT, r, asDir)).isDirectory(); } catch { return false; } });
      const bucket = dirRoot !== undefined ? becameDir : missing;
      if (!bucket.has(p)) bucket.set(p, new Set());
      bucket.get(p).add(rel);
    }
  }
  if (becameDir.size) {
    no(`${becameDir.size} path(s) name a FILE that is now a DIRECTORY — the reader is sent one level too deep:`);
    for (const [p, citers] of becameDir) {
      out.push(`          · ${p} → ${p.replace(/\.[a-z]+$/, '/')}  ← ${[...citers].join(', ')}`);
    }
  }
  if (missing.size === 0) {
    if (!becameDir.size) ok('every referenced script/source path resolves');
    return;
  }
  // Sorted by how many documents point at it: a path six docs cite is a worse lie than one.
  const ranked = [...missing.entries()].sort((a, b) => b[1].size - a[1].size);
  no(`${ranked.length} referenced path(s) do not exist:`);
  for (const [p, citers] of ranked.slice(0, 40)) {
    out.push(`          · ${p}  ← ${[...citers].slice(0, 3).join(', ')}${citers.size > 3 ? ` +${citers.size - 3}` : ''}`);
  }
  if (ranked.length > 40) out.push(`          … and ${ranked.length - 40} more`);
}

// ── 3 · referenced admin/portal routes ───────────────────────────────────────────────────────
function checkRouteRefs(routes) {
  const missing = new Map();
  const RE = /(?<![\w/])\/(?:admin|partner)\/[a-z0-9-]+(?:\/[a-z0-9-]+)?/g;
  for (const rel of corpus()) {
    for (const m of unfenced(read(rel)).matchAll(RE)) {
      const r = m[0];
      if (routes.has(r)) continue;
      // A deeper path whose PARENT is a real route is a sub-path or a dynamic segment written out.
      const parent = r.split('/').slice(0, 3).join('/');
      if (routes.has(parent)) continue;
      if (!missing.has(r)) missing.set(r, new Set());
      missing.get(r).add(rel);
    }
  }
  if (missing.size === 0) { ok(`every referenced /admin and /partner route exists (${routes.size} routes on disk)`); return; }
  const ranked = [...missing.entries()].sort((a, b) => b[1].size - a[1].size);
  no(`${ranked.length} referenced route(s) do not exist:`);
  for (const [r, citers] of ranked.slice(0, 25)) {
    out.push(`          · ${r}  ← ${[...citers].slice(0, 3).join(', ')}${citers.size > 3 ? ` +${citers.size - 3}` : ''}`);
  }
}

function routesOnDisk() {
  const set = new Set();
  const app = join(ROOT, 'frontend', 'app');
  const walk = (dir, url) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const name = e.name;
      // Route groups (parenthesised) do not appear in the URL.
      const next = name.startsWith('(') ? url : `${url}/${name}`;
      const full = join(dir, name);
      if (existsSync(join(full, 'page.tsx')) || existsSync(join(full, 'route.ts'))) set.add(next);
      walk(full, next);
    }
  };
  try { walk(app, ''); } catch { /* tree absent */ }
  return set;
}

// ── 4 · table names in the live-claim documents ──────────────────────────────────────────────
async function checkTableRefs(tables) {
  if (!tables) { cant('table references — no database connection'); return; }
  const missing = new Map();
  // Only where a table name is used AS a table: after a SQL keyword, or in backticks next to a
  // column. A bare word in prose is not a claim about the schema.
  const RE = /(?:\b(?:FROM|JOIN|INTO|UPDATE|TABLE)\s+|`)([a-z][a-z0-9_]{3,})(?:`|\b)/g;
  for (const rel of Object.keys(LIVE_CLAIM_DOCS)) {
    for (const m of unfenced(read(rel)).matchAll(RE)) {
      const name = m[1];
      if (!name.includes('_')) continue;            // single words are almost never table names
      if (tables.has(name)) continue;
      if (!/^[a-z]+(_[a-z0-9]+)+$/.test(name)) continue;
      if (!missing.has(name)) missing.set(name, new Set());
      missing.get(name).add(rel);
    }
  }
  if (missing.size === 0) { ok(`every snake_case identifier in the live-claim docs is a real table`); return; }
  // These are CANDIDATES, not findings: the same pattern matches column names, event types and
  // env vars. Saying so is the difference between a useful list and a false alarm.
  out.push(`  note  ${missing.size} snake_case identifier(s) in live-claim docs are not table names`);
  out.push('        (candidates only — columns, event types and env vars match the same shape):');
  for (const [n, citers] of [...missing.entries()].slice(0, 15)) {
    out.push(`          · ${n}  ← ${[...citers].join(', ')}`);
  }
}

// ── 5 · generated documents against live reality ─────────────────────────────────────────────
async function checkGenerated(head, tableCount) {
  const rel = 'docs/SCHEMA_MAP.md';
  if (!existsSync(join(ROOT, rel))) { cant(`${rel} is missing`); return; }
  const src = read(rel);
  const m = src.match(/migration head `([^`]+)`.*?\*\*(\d+) tables\*\*/s);
  if (!m) { cant(`${rel} carries no provenance stamp to check`); return; }
  if (!head) { cant(`${rel} — no database connection to compare against`); return; }
  if (m[1] !== head) {
    no(`${rel} was generated at migration head '${m[1]}' but the database is at '${head}' — `
      + `regenerate: source scripts/sandbox-env.sh && node scripts/schema-map.mjs`);
  } else if (Number(m[2]) !== tableCount) {
    no(`${rel} states ${m[2]} tables; the database has ${tableCount}`);
  } else {
    ok(`${rel} is current — head ${head}, ${tableCount} tables`);
  }
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
console.log('── self-test ──');
selfTest();

let head = null; let tables = null; let tableCount = 0;
const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
let sql = null;
if (url) {
  sql = postgres(url, { max: 2, onnotice: () => {} });
  try {
    const [h] = await sql`SELECT MAX(filename) AS f FROM _migration_history`;
    head = h?.f ?? null;
    const rows = await sql`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
    tables = new Set(rows.map((r) => r.tablename));
    tableCount = tables.size;
  } catch (e) {
    console.error(`  (database unreachable: ${e.message})`);
  }
}

console.log(`\n── ${corpus().length} document(s) ──`);
checkDocRefs();
checkFileRefs();
checkRouteRefs(routesOnDisk());
await checkTableRefs(tables);
await checkGenerated(head, tableCount);

console.log(out.join('\n'));
if (sql) await sql.end({ timeout: 5 });

console.log();
if (unmeasured) console.log(`⚠ ${unmeasured} check(s) could not be earned — uncovered, not passing.`);
if (findings === 0 && unmeasured === 0) {
  console.log('✓ every reference in the documentation resolves.');
  process.exit(0);
}
console.log(`✗ ${findings} finding(s) in the documentation.`);
process.exit(findings ? 1 : 2);
