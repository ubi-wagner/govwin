#!/usr/bin/env node
/**
 * audit-producer-consumer — what has a reader and no writer, or a writer and no reader?
 *
 * ── THE DEFECT CLASS THIS EXISTS FOR ─────────────────────────────────────────────────────────
 * Every instrument in this repository asks whether what the product does, it does CORRECTLY. None
 * asks whether the two halves of a thing are actually joined. That gap has produced the same bug
 * over and over, and it is the most expensive class here because nothing else can see it:
 *
 *   · `applications.session_id` — the column existed, the route accepted it, `contacts` carried it,
 *     `/admin/funnel` joined on it, `drive-commercial-path` proved the chain. No form ever sent it.
 *     Every layer correct; the whole capability inert.
 *   · `tenant_profiles` — the bucket form's prefill read it, the Profile page wrote it, and the
 *     accept route never did, so a new customer's prefill button always found nothing.
 *   · the domain audit trail wrote to a table dropped 74 migrations earlier — 45 call sites, silent.
 *   · `billableHours` never once ran; the invoicing page said there was nothing to bill.
 *
 * Each was found by accident, months apart. They are one shape: **a producer with no consumer, or
 * a consumer with no producer.** A correctness lens cannot see it — the code is correct. A coverage
 * lens cannot see it — the code is covered. Only asking "is the other half there" finds it.
 *
 * ── WHAT IT CHECKS ───────────────────────────────────────────────────────────────────────────
 *   1. every table column, classified WRITTEN / READ from source, crossed with whether it holds
 *      data in the live database. The interesting cells are the asymmetric ones.
 *   2. environment variables read by code, against what the deploy documentation provides.
 *
 * ── WHAT IT WILL NOT CLAIM ───────────────────────────────────────────────────────────────────
 * "Read but never written" is a QUESTION, not a defect. A column written only by a migration
 * backfill, or by the pipeline in Python while the reader is TypeScript, is legitimately in that
 * cell. So the report separates what it could see from what it concludes, and every cell says which
 * evidence produced it. An instrument that called all 1,193 columns findings would be ignored by
 * lunchtime, which is the real failure mode.
 *
 *   node frontend/scripts/audit-producer-consumer.mjs
 * Exit 0 always — a report, not a gate.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import postgres from 'postgres';

const FE = process.cwd().endsWith('/frontend') ? process.cwd() : join(process.cwd(), 'frontend');
const ROOT = dirname(FE);

// ── source corpus: all three services ─────────────────────────────────────────────────────────
const SKIP = new Set(['node_modules', '.next', '.git', '__pycache__', 'e2e-artifacts', 'coverage', 'public']);
function walk(dir, out = []) {
  let es; try { es = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of es) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(tsx?|mjs|mts|jsx?|py)$/.test(e.name)) out.push(full);
  }
  return out;
}
const SOURCE_DIRS = ['frontend/app', 'frontend/lib', 'frontend/components', 'frontend/scripts',
  'pipeline/src', 'pipeline/scripts', 'services/cms/src'];

/**
 * THE SCANNER MUST NOT READ ITSELF, and the self-test below is what caught that it was.
 *
 * This file names `zzz_not_a_real_column` in its own control case, and lives under
 * `frontend/scripts` — so the corpus contained the invented column, the "reads as neither" check
 * failed, and every classification would have been contaminated by whatever this file mentions.
 *
 * The exclusion is the meta-instruments generally, not just this one: `audit-*`, `reconcile-*`,
 * `inventory-*`, `catalog-*` and `check-*` exist to TALK about identifiers rather than to use them,
 * so a column named in one of them is evidence about the audit, not about the product. Ordinary
 * drives and seeds stay in — a seed script that INSERTs a column is a real producer, and dropping
 * those would manufacture "written by nothing" findings.
 */
const META = /\/(audit|reconcile|inventory|catalog|check)-[a-z-]+\.(mjs|mts|js)$/;
const files = SOURCE_DIRS.flatMap((d) => walk(join(ROOT, d))).filter((f) => !META.test(f));
const src = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
/** Migrations are a WRITER too — a backfill is a real producer, just a one-time one. */
const migrations = walk(join(ROOT, 'db', 'migrations'), []).concat(
  (() => { try { return readdirSync(join(ROOT, 'db/migrations')).filter((f) => f.endsWith('.sql')).map((f) => join(ROOT, 'db/migrations', f)); } catch { return []; } })());
const migSrc = [...new Set(migrations)].map((f) => { try { return readFileSync(f, 'utf8'); } catch { return ''; } }).join('\n');

const ALL_TS = files.filter((f) => /\.(tsx?|mjs|mts|jsx?)$/.test(f)).map((f) => src.get(f)).join('\n');
const ALL_PY = files.filter((f) => f.endsWith('.py')).map((f) => src.get(f)).join('\n');
const ALL = ALL_TS + '\n' + ALL_PY;

/** snake_case → camelCase, because postgres.js hands every row back camelCased. */
const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Columns whose name is too common to attribute. `id`, `status` and `created_at` appear in every
 * file; a hit on one says nothing about the column it came from. Excluding them is not a blind
 * spot — it is a refusal to report a coin flip as evidence.
 */
const AMBIGUOUS = new Set(['id', 'name', 'status', 'created_at', 'updated_at', 'tenant_id', 'title',
  'type', 'data', 'metadata', 'description', 'content', 'value', 'key', 'email', 'role', 'slug',
  'notes', 'position', 'label', 'source', 'kind', 'version', 'payload', 'error', 'url', 'path',
  'summary', 'user_id', 'started_at', 'completed_at', 'deleted_at', 'archived_at', 'count', 'order',
  'text', 'body', 'html', 'state', 'result', 'input', 'output', 'config', 'settings', 'options']);

// ── classify one column ───────────────────────────────────────────────────────────────────────
/**
 * WRITE evidence: the column name inside an INSERT column list, an UPDATE SET, an ON CONFLICT SET,
 * or a python dict/kwargs assignment. READ evidence: a SELECT list, a WHERE/ORDER/GROUP clause, or
 * a camelCase property read in JS.
 *
 * Deliberately generous on both sides. The goal is to find columns with evidence on exactly ONE
 * side; a false "both" is a quiet miss, but a false "one-sided" is a wrong accusation, and the
 * second is the one that gets an instrument switched off.
 */
function classify(col) {
  const c = col.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cam = camel(col);
  const camRe = new RegExp(`\\b${cam}\\b`);

  const written =
    new RegExp(`(INSERT\\s+INTO[\\s\\S]{0,600}?\\b${c}\\b)`, 'i').test(ALL) ||
    new RegExp(`(UPDATE[\\s\\S]{0,400}?SET[\\s\\S]{0,600}?\\b${c}\\b)`, 'i').test(ALL) ||
    new RegExp(`(DO\\s+UPDATE[\\s\\S]{0,600}?\\b${c}\\b)`, 'i').test(ALL) ||
    new RegExp(`\\b${c}\\s*=\\s*\\$?\\{?`, 'i').test(ALL) ||        // `col = ${x}` / python kwarg
    new RegExp(`INSERT\\s+INTO[\\s\\S]{0,600}?\\b${c}\\b`, 'i').test(migSrc) ||
    new RegExp(`UPDATE[\\s\\S]{0,400}?SET[\\s\\S]{0,600}?\\b${c}\\b`, 'i').test(migSrc);

  const read =
    new RegExp(`SELECT[\\s\\S]{0,800}?\\b${c}\\b`, 'i').test(ALL) ||
    new RegExp(`(WHERE|AND|OR|ORDER\\s+BY|GROUP\\s+BY|JOIN|COALESCE|ON)[\\s\\S]{0,120}?\\b${c}\\b`, 'i').test(ALL) ||
    camRe.test(ALL_TS) ||                                            // r.sessionId
    new RegExp(`\\brow\\[["']${c}["']\\]|\\bget\\(["']${c}["']\\)`, 'i').test(ALL_PY);

  return { written, read };
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
const url = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!url) { console.error('CANNOT EARN A VERDICT: set DATABASE_URL_OWNER.'); process.exit(2); }
const sql = postgres(url, { max: 3, onnotice: () => {} });

// ── self-test: the instrument before the finding ──────────────────────────────────────────────
console.log('── self-test ──');
const st = [];
const chk = (l, g) => st.push([l, g]);
chk('the corpus spans all three services', files.length > 1200);
chk('migrations are loaded as a writer', migSrc.length > 100000);
// A column we KNOW is both written and read, right now, by code in this tree.
chk('a fully-wired column reads as both', (() => { const r = classify('first_session_id'); return r.written && r.read; })());
// A column that exists only in the schema and nowhere in source must read as neither.
chk('an invented column reads as neither', (() => { const r = classify('zzz_not_a_real_column'); return !r.written && !r.read; })());
chk('camelCase conversion is right', camel('first_session_id') === 'firstSessionId');
chk('ambiguous names are excluded, not guessed at', AMBIGUOUS.has('status') && !AMBIGUOUS.has('first_session_id'));
// The self-exclusion, both ways: meta-instruments out, ordinary drives and seeds in.
chk('the scanner excludes itself and its siblings',
  META.test('/x/frontend/scripts/audit-producer-consumer.mjs') && META.test('/x/scripts/reconcile-capability.mjs'));
chk('an ordinary drive or seed is still in the corpus',
  !META.test('/x/frontend/scripts/drive-commercial-path.mts') && !META.test('/x/frontend/scripts/seed-sheet-doc.mts'));
for (const [l, g] of st) console.log(`  ${g ? '✓' : '✗'} ${l}`);
if (st.some(([, g]) => !g)) {
  console.error('\n✗ self-test failed — every cell below would be about the scanner.');
  await sql.end(); process.exit(2);
}

const cols = await sql`
  SELECT c.table_name AS t, c.column_name AS c
    FROM information_schema.columns c
    JOIN pg_tables p ON p.tablename = c.table_name AND p.schemaname = 'public'
   WHERE c.table_schema = 'public'
   ORDER BY 1, 2`;

const consumerNoProducer = [];   // read, never written — THE BUG SHAPE
const producerNoConsumer = [];   // written, never read — work for nobody
const neither = [];              // in the schema, touched by no code at all

/**
 * Tables and columns whose PRODUCER is not our source code, so a source scan can never see it.
 * Each is a named reason, not a pattern, because "it looked like a false positive" is how a real
 * one gets suppressed.
 */
const FOREIGN_WRITER = {
  sessions: 'NextAuth adapter — the library writes these, no application code does',
  accounts: 'NextAuth adapter',
  verification_tokens: 'NextAuth adapter',
  _migration_history: 'written by the migration runner itself',
};
/** Generated / trigger-maintained columns: Postgres is the writer. */
const DB_WRITTEN = /_tsv$/;

for (const { t, c } of cols) {
  if (AMBIGUOUS.has(c) || c.length <= 6) continue;
  if (FOREIGN_WRITER[t] || DB_WRITTEN.test(c)) continue;
  const { written, read } = classify(c);
  if (read && !written) consumerNoProducer.push(`${t}.${c}`);
  else if (written && !read) producerNoConsumer.push(`${t}.${c}`);
  else if (!written && !read) neither.push(`${t}.${c}`);
}

/** Does the column actually hold anything? A populated column with no writer in source was filled
 *  by something outside it (a migration backfill, a hand fix, another service) — which is a
 *  different situation from an empty one nobody has ever filled. */
async function populated(list) {
  const out = new Map();
  for (const q of list) {
    const [t, c] = q.split('.');
    try {
      const [r] = await sql.unsafe(`SELECT COUNT(*)::int AS n FROM "${t}" WHERE "${c}" IS NOT NULL`);
      out.set(q, r.n);
    } catch { out.set(q, -1); }
  }
  return out;
}

const cnpData = await populated(consumerNoProducer);

console.log(`\n══ 1 · READ BY CODE, WRITTEN BY NOTHING — ${consumerNoProducer.length} column(s) ══`);
console.log('   A consumer with no producer. This is the shape that made the whole attribution');
console.log('   chain inert while every layer of it was correct and tested.');
const empty = consumerNoProducer.filter((q) => cnpData.get(q) === 0);
const filled = consumerNoProducer.filter((q) => (cnpData.get(q) ?? 0) > 0);
console.log(`\n   ⚠ EMPTY as well as unwritten — nothing has ever filled these (${empty.length}):`);
for (const q of empty) console.log(`      ${q}`);
if (!empty.length) console.log('      none');
console.log(`\n   · unwritten in source but POPULATED (${filled.length}) — filled by a migration,`);
console.log('     another service, or by hand. Not a finding; listed so the asymmetry is visible:');
for (const q of filled.slice(0, 20)) console.log(`      ${q}  (${cnpData.get(q)} rows)`);
if (filled.length > 20) console.log(`      … and ${filled.length - 20} more`);

console.log(`\n══ 2 · WRITTEN BY CODE, READ BY NOTHING — ${producerNoConsumer.length} column(s) ══`);
console.log('   Work the system does for nobody. Each is either a missing surface or a dead write.');
for (const q of producerNoConsumer) console.log(`      ${q}`);
if (!producerNoConsumer.length) console.log('      none');

console.log(`\n══ 3 · in the schema, touched by no code at all — ${neither.length} column(s) ══`);
for (const q of neither.slice(0, 30)) console.log(`      ${q}`);
if (neither.length > 30) console.log(`      … and ${neither.length - 30} more`);
if (!neither.length) console.log('      none');

// ── 4 · environment variables read but never provided ─────────────────────────────────────────
const envRead = new Set();
for (const s of src.values()) {
  for (const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]{3,})/g)) envRead.add(m[1]);
  for (const m of s.matchAll(/process\.env\[['"]([A-Z][A-Z0-9_]{3,})['"]\]/g)) envRead.add(m[1]);
  for (const m of s.matchAll(/os\.getenv\(\s*["']([A-Z][A-Z0-9_]{3,})["']/g)) envRead.add(m[1]);
  for (const m of s.matchAll(/os\.environ(?:\.get)?[.[(]\s*["']([A-Z][A-Z0-9_]{3,})["']/g)) envRead.add(m[1]);
}
let documented = '';
for (const d of ['docs/RAILWAY_ENV_VARS.md', 'docs/SECRETS_INVENTORY.md', 'docs/EXTERNAL_SERVICES_SETUP.md',
  'docs/STAGING_ENVIRONMENT.md', 'scripts/sandbox-env.sh', 'frontend/scripts/sandbox-heartbeat.sh']) {
  try { documented += readFileSync(join(ROOT, d), 'utf8'); } catch { /* absent */ }
}
const undocumented = [...envRead].filter((v) => !documented.includes(v)).sort();
console.log(`\n══ 4 · env vars READ by code, named in no deploy doc — ${undocumented.length} of ${envRead.size} ══`);
console.log('   A variable nobody documents is a variable nobody sets, and code that reads one');
console.log('   takes its fallback silently — the same shape as an unwritten column.');
for (const v of undocumented) console.log(`      ${v}`);
if (!undocumented.length) console.log('      none');

await sql.end();
console.log(`\n── ${cols.length} columns · ${files.length} source files · ${envRead.size} env vars ──`);
