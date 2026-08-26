/**
 * THE CRM HAS NEVER BEEN SWEPT, and the reason is structural: its database is not on this box.
 *
 * Every instrument in this repo — the five lenses, the capability reconciliation, the spine audit,
 * the RLS posture check — measures `govtech_intel`. The CRM (`rfp-crm`) has its own Postgres
 * (`cms-postgres`), its own FastAPI service, and its own Vite console, and none of the three has
 * ever appeared in a coverage number here. `psql -l` on a fresh sandbox lists `govtech_intel` and
 * nothing else, so a sweep that "found no problems" in the CRM had not looked at it.
 *
 * That is the same failure shape as B125 (213 write verbs outside every lens while three greens
 * read like a verified API) and as the capability lens reading a stale inventory: **a lens that
 * cannot see a thing does not report it missing. It reports silence, which reads exactly like a
 * pass.**
 *
 * So this file: stand the database up from `services/cms/db/*.sql`, then join what the schema holds
 * against what the code touches and what a person can reach.
 *
 * ── THE FOUR JOINS ───────────────────────────────────────────────────────────────────────────
 *   1. tables ↔ the code that reads or writes them          → orphan tables, and orphan readers
 *   2. endpoints ↔ the console (or anything) that calls them → unsurfaced API surface
 *   3. tenancy ↔ isolation                                   → which tenant-bearing tables are
 *                                                              protected, and by what
 *   4. the bridge ↔ the platform                             → every seam between the two systems
 *
 * ── THE INSTRUMENT BEFORE THE FINDING ────────────────────────────────────────────────────────
 * Self-tests run FIRST, against answers verified by hand, and any failure prints
 * "the inventory below is not trustworthy" and exits 2. A scanner with a wrong root reports an
 * empty CRM and looks exactly like a clean one.
 *
 *   export CMS_DATABASE_URL=postgresql://…/cms_postgres
 *   node frontend/scripts/inventory-crm.mjs            # → docs/CRM_INVENTORY.md + .json
 *
 * Exit 0 wrote the inventory · 2 the instrument cannot be trusted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CMS = path.join(REPO, 'services', 'cms');
const SRC = path.join(CMS, 'src');
const CONSOLE_SRC = path.join(CMS, 'frontend', 'src');

const CONN = process.env.CMS_DATABASE_URL;

// ── file walking ──────────────────────────────────────────────────────────────────────────────
function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === '__pycache__' || e.name === 'node_modules') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const rel = (p) => p.replace(REPO + '/', '');
const read = (p) => fs.readFileSync(p, 'utf8');

const pyFiles = walk(SRC, ['.py']);
const consoleFiles = walk(CONSOLE_SRC, ['.ts', '.tsx']);
const sqlFiles = walk(path.join(CMS, 'db'), ['.sql']);

// ── 1 · the schema ────────────────────────────────────────────────────────────────────────────
/**
 * Read the tables from the LIVE database when one is reachable, and fall back to parsing the
 * migration files when it is not.
 *
 * The fallback is not equivalent and is labelled as such in the output. A `CREATE TABLE` in a file
 * says what was intended; the catalog says what is there, including everything a later `ALTER`
 * added. The whole reason this instrument exists is that nobody had looked at the catalog.
 */
async function schemaFromDb(sql) {
  const rows = await sql`
    SELECT c.relname AS "table",
           c.relrowsecurity AS "rlsOn",
           (SELECT count(*)::int FROM pg_policies p
             WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS "policies",
           (SELECT count(*)::int FROM information_schema.columns col
             WHERE col.table_schema = 'public' AND col.table_name = c.relname) AS "columns",
           EXISTS (SELECT 1 FROM information_schema.columns col
                    WHERE col.table_schema = 'public' AND col.table_name = c.relname
                      AND col.column_name = 'tenant_id') AS "hasTenantId"
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`;
  return rows.map((r) => ({ ...r, source: 'catalog' }));
}

function schemaFromFiles() {
  const tables = new Map();
  for (const f of sqlFiles) {
    const src = read(f);
    for (const m of src.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\)/gi)) {
      const name = m[1];
      const cols = m[2].split('\n').filter((l) => /^\s{2,}\w+\s+\w/.test(l)).length;
      tables.set(name, {
        table: name, rlsOn: false, policies: 0, columns: cols,
        hasTenantId: /\btenant_id\b/.test(m[2]), source: 'migration file',
      });
    }
  }
  return [...tables.values()].sort((a, b) => a.table.localeCompare(b.table));
}

// ── 2 · code ↔ table ──────────────────────────────────────────────────────────────────────────
/**
 * Which module reads or writes each table.
 *
 * A read and a write are counted separately, because they answer different questions. A table with
 * writers and no readers is data nobody looks at; a table with readers and no writers is a query
 * against something that never fills.
 */
const WRITE_RE = (t) => new RegExp(`(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${t}\\b`, 'i');
const READ_RE = (t) => new RegExp(`(FROM|JOIN)\\s+${t}\\b`, 'i');

function codeUsage(tables) {
  const usage = Object.fromEntries(tables.map((t) => [t.table, { readers: [], writers: [] }]));
  for (const f of pyFiles) {
    const src = read(f);
    for (const t of tables) {
      if (WRITE_RE(t.table).test(src)) usage[t.table].writers.push(rel(f));
      else if (READ_RE(t.table).test(src)) usage[t.table].readers.push(rel(f));
    }
  }
  return usage;
}

// ── 3 · endpoints ↔ callers ───────────────────────────────────────────────────────────────────
/**
 * FastAPI routes, assembled from the `include_router(prefix=…)` in main.py and the decorators in
 * each router — the prefix is where the real path comes from, and a decorator read alone gives
 * `@router.get('')`, which is not an address.
 */
function endpoints() {
  const mainSrc = read(path.join(SRC, 'main.py'));
  const prefixes = new Map();
  // BOTH shapes: `include_router(x.router, prefix="/api/…")` and `include_router(health.router,
  // tags=[…])` with no prefix at all. Matching only the first left `health` on the `/api/{name}`
  // fallback and produced `/api/health/health` — an address that exists nowhere, reported as an
  // uncalled endpoint.
  for (const m of mainSrc.matchAll(/include_router\(\s*([\w.]+)\s*(?:,\s*prefix=['"]([^'"]*)['"])?/g)) {
    const key = m[1].split('.').pop().replace(/_router$/, '');
    // `health.router` → key `router`; fall back to the module segment when that happens.
    const name = key === 'router' ? m[1].split('.')[0] : key;
    prefixes.set(name, m[2] ?? '');
  }
  // `from .routers import auth, content, …` then `include_router(auth.router, …)`
  const out = [];
  for (const f of walk(path.join(SRC, 'routers'), ['.py'])) {
    const name = path.basename(f, '.py');
    if (name === '__init__') continue;
    const src = read(f);
    // A router's real path is the mount prefix from main.py PLUS any prefix the router declares
    // for itself. `page_blocks` is mounted at `/api` and declares
    // `APIRouter(prefix="/page-blocks")`, so reading only one of the two produced `/api/add-blank`
    // for a route the console calls as `/api/page-blocks/add-blank` — twelve endpoints reported
    // uncalled because their addresses were wrong, not because nothing calls them.
    const selfPrefix = (src.match(/APIRouter\(\s*prefix=['"]([^'"]*)['"]/) ?? [, ''])[1];
    const prefix = (prefixes.get(name) ?? prefixes.get(`${name}.router`) ?? `/api/${name}`) + selfPrefix;
    for (const m of src.matchAll(/@router\.(get|post|patch|put|delete)\(\s*['"]([^'"]*)['"]/g)) {
      out.push({
        method: m[1].toUpperCase(),
        path: (prefix + m[2]).replace(/\/+$/, '') || prefix,
        router: name,
        file: rel(f),
      });
    }
  }
  return out.sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/**
 * Every path the CRM console fetches, plus anything the platform frontend calls.
 *
 * ── THE TRAP THIS FUNCTION EXISTS TO AVOID ───────────────────────────────────────────────────
 * The console's helper prepends the prefix ITSELF:
 *
 *     const BASE = '/api'
 *     const res = await fetch(`${BASE}${path}`, …)
 *     api.get<SocialPost[]>('/social/posts')
 *
 * so the literal in the page is `/social/posts`, not `/api/social/posts`. The first version of this
 * scanner matched only `/api/…` literals and reported **84 of 88 endpoints as having no caller** —
 * a number that would have read as a devastating finding and was entirely the harness. It is the
 * exact failure docs/CAPABILITY_RECONCILIATION.md records: *a source-literal scan against a
 * dynamically-assembled path cannot pass.*
 *
 * So both shapes are collected: `/api/…` literals (direct `fetch`, and the platform frontend), and
 * bare `/…` literals inside an `api.get|post|patch|delete(…)` call, prefixed with `/api`.
 */
function callers() {
  const calls = new Set();
  const add = (p) => { const c = p.replace(/\$\{[^}]*\}/g, '*').replace(/\/+$/, ''); if (c) calls.add(c); };

  for (const f of [...consoleFiles, ...walk(path.join(REPO, 'frontend', 'app'), ['.ts', '.tsx']),
    ...walk(path.join(REPO, 'frontend', 'lib'), ['.ts'])]) {
    const src = read(f);
    for (const m of src.matchAll(/['"`](\/api\/[^'"`\s?)]*)/g)) add(m[1]);
    for (const m of src.matchAll(/`(\/api\/[^`?]*)`/g)) add(m[1]);
    // …and the helper form, where the prefix lives in the helper rather than at the call site.
    for (const m of src.matchAll(/\bapi\.(?:get|post|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*['"`]([^'"`?]*)/g)) {
      add('/api' + m[1]);
    }
  }
  return calls;
}

/** A route matches a call literally, or with its `{param}` segments treated as wildcards. */
function isCalled(routePath, calls) {
  if (calls.has(routePath)) return true;
  const re = new RegExp('^' + routePath.replace(/\{[^}]+\}/g, '[^/]+').replace(/\*/g, '[^/]+') + '$');
  for (const c of calls) if (re.test(c)) return true;
  return false;
}

// ── 4 · the bridge ────────────────────────────────────────────────────────────────────────────
/**
 * Every seam between the CRM and the platform, found rather than listed.
 *
 * A hand-written list of integration points is the thing that drifts; the whole point of the sweep
 * is that nobody has looked in a long time.
 */
function bridge() {
  const seams = [];
  for (const f of pyFiles) {
    const src = read(f);
    if (/SHARED_DATABASE_URL|get_event_pool/.test(src)) {
      const tables = [...new Set([...src.matchAll(/(?:FROM|INTO|UPDATE|JOIN)\s+(system_events|automation_rules|users|tenants|tasks|process_instances|email_send_ledger|email_suppressions)\b/gi)].map((m) => m[1].toLowerCase()))];
      if (tables.length) seams.push({ kind: 'shared-database', file: rel(f), tables });
    }
    if (/REVALIDATE_SECRET/.test(src)) seams.push({ kind: 'http-callback', file: rel(f), detail: 'frontend /api/cms/revalidate' });
    if (/emit_system_event/.test(src)) seams.push({ kind: 'event-emit', file: rel(f), detail: 'writes system_events on the main DB' });
  }
  // The other direction: what the platform frontend does with the CRM.
  for (const f of [...walk(path.join(REPO, 'frontend', 'app'), ['.ts', '.tsx']), ...walk(path.join(REPO, 'frontend', 'lib'), ['.ts'])]) {
    const src = read(f);
    if (/CMS_PUBLIC_URL|CMS_API_KEY/.test(src)) seams.push({ kind: 'platform→crm', file: rel(f), detail: 'reads a CRM env var' });
  }
  return seams;
}

// ── self-tests ────────────────────────────────────────────────────────────────────────────────
function selfTest(tables, eps, calls) {
  const checks = [];
  const t = (name, pass, why) => checks.push({ name, pass, why });

  t('the CRM source tree was found', pyFiles.length > 20, `${pyFiles.length} .py files`);
  t('the console source tree was found', consoleFiles.length > 5, `${consoleFiles.length} console files`);
  t('the schema is non-empty', tables.length > 10, `${tables.length} tables`);
  // Hand-verified: these three exist and are unmistakable.
  t('a known table is present', tables.some((x) => x.table === 'email_sends'), 'email_sends');
  t('a known content table is present', tables.some((x) => x.table === 'cms_posts'), 'cms_posts');
  t('endpoints were parsed with real prefixes', eps.some((e) => e.path.startsWith('/api/')), `${eps.length} endpoints`);
  t('the console caller scan found something', calls.size > 3, `${calls.size} distinct paths`);
  // A route the console definitely calls, and one it definitely does not.
  t('a definitely-called endpoint is matched', isCalled('/api/page-blocks', calls), '/api/page-blocks');
  // The mount prefix and the router's OWN prefix must both be applied. Reading either alone
  // produces an address nothing calls, and twelve endpoints then read as unsurfaced.
  t('a router with its own prefix resolves to its real path',
    eps.some((e) => e.path === '/api/page-blocks/add-blank'),
    'page_blocks is mounted at /api and declares prefix=/page-blocks');
  // A router mounted with NO prefix must resolve to its bare path, not to the /api/{name} fallback.
  t('a router mounted without a prefix resolves bare',
    eps.some((e) => e.path === '/health') && !eps.some((e) => e.path === '/api/health/health'),
    'health is mounted with tags only');
  t('a definitely-uncalled path is NOT matched', !isCalled('/api/definitely-not-a-route-xyz', calls), 'negative control');
  return checks;
}

// ── main ──────────────────────────────────────────────────────────────────────────────────────
const sql = CONN ? postgres(CONN, { max: 1, onnotice: () => {} }) : null;
let tables;
let schemaSource;
try {
  tables = sql ? await schemaFromDb(sql) : schemaFromFiles();
  schemaSource = sql ? 'live catalog' : 'migration files (NOT equivalent — see the header)';
} catch (err) {
  console.error(`could not read the CRM schema from the database (${String(err.message).slice(0, 120)});`);
  console.error('falling back to the migration files, which say what was INTENDED, not what is there.');
  tables = schemaFromFiles();
  schemaSource = 'migration files (fallback after a connection failure)';
}

const usage = codeUsage(tables);
const eps = endpoints();
const calls = callers();
const seams = bridge();

const checks = selfTest(tables, eps, calls);
const failed = checks.filter((c) => !c.pass);
console.log('── self-test ──');
for (const c of checks) console.log(`  ${c.pass ? '✓' : '✗'} ${c.name}${c.why ? ` (${c.why})` : ''}`);
if (failed.length) {
  console.error('\n✗ the inventory below is not trustworthy — the instrument could not see what it measures.');
  if (sql) await sql.end();
  process.exit(2);
}

// ── classification ────────────────────────────────────────────────────────────────────────────
/**
 * SUPERSEDED, with the reason. CLAUDE.md is explicit that front-facing content moved to the
 * frontend's `content_pages` in the main DB and that the CRM's content/page-block routers are
 * superseded — so these tables are not "unused pending investigation", they are a decision already
 * taken whose cleanup has not happened. Naming them here keeps that visible instead of letting them
 * read as live CRM capability.
 */
const SUPERSEDED = {
  cms_posts: 'front-facing content moved to the frontend content_pages store (CLAUDE.md §Services)',
  cms_media: 'ditto — media now lives under the frontend/R2 path',
  cms_reviews: 'ditto — the content review queue moved with it',
  cms_generations: 'ditto — content generation is frontend-owned',
  cms_events: 'ditto — content events go to system_events',
  cms_config: 'ditto',
};

const tableRows = tables.map((t) => {
  const u = usage[t.table] ?? { readers: [], writers: [] };
  const touched = u.readers.length + u.writers.length;
  let verdict;
  if (SUPERSEDED[t.table]) verdict = 'superseded';
  else if (touched === 0) verdict = 'ORPHAN — no code reads or writes it';
  else if (u.writers.length === 0) verdict = 'read-only — nothing writes it';
  else if (u.readers.length === 0 && u.writers.length > 0) verdict = 'write-only — nothing reads it';
  else verdict = 'live';
  return { ...t, ...u, verdict };
});

const epRows = eps.map((e) => ({ ...e, called: isCalled(e.path, calls) }));

const tenantBearing = tableRows.filter((t) => t.hasTenantId);
const unprotected = tenantBearing.filter((t) => !t.rlsOn || t.policies === 0);

// ── output ────────────────────────────────────────────────────────────────────────────────────
const fmt = (n, w) => String(n).padEnd(w);
const lines = [];
const P = (s = '') => lines.push(s);

P('# CRM inventory — generated');
P('');
P(`Regenerate: \`CMS_DATABASE_URL=… node frontend/scripts/inventory-crm.mjs\``);
P('');
P(`Schema read from: **${schemaSource}**`);
P('');
P('> This is the first time any instrument in this repo has looked at the CRM. Every lens, audit and');
P('> reconciliation measures `govtech_intel`; the CRM has its own service, its own console and its');
P('> own database, and none of the three has ever appeared in a coverage number here.');
P('');
P('---');
P('');
P('## Isolation posture');
P('');
P(`${tables.length} tables · **${tenantBearing.length} carry \`tenant_id\`** · **${unprotected.length} of those have no RLS and no policy**`);
P('');
if (unprotected.length) {
  P('| table | columns | rls | policies |');
  P('|---|---|---|---|');
  for (const t of unprotected) P(`| \`${t.table}\` | ${t.columns} | ${t.rlsOn ? 'on' : '**off**'} | ${t.policies} |`);
  P('');
}
P('## Tables');
P('');
P('| table | cols | tenancy | verdict | writers | readers |');
P('|---|---|---|---|---|---|');
for (const t of tableRows) {
  P(`| \`${t.table}\` | ${t.columns} | ${t.hasTenantId ? '`tenant_id`' : '—'} | ${t.verdict} | ${t.writers.length} | ${t.readers.length} |`);
}
P('');
P('### Superseded, with the reason');
P('');
for (const [name, why] of Object.entries(SUPERSEDED)) {
  if (tables.some((t) => t.table === name)) P(`- \`${name}\` — ${why}`);
}
P('');
P('## API surface');
P('');
const called = epRows.filter((e) => e.called);
P(`${epRows.length} endpoints · ${called.length} reached by the console or the platform · ${epRows.length - called.length} with no caller found`);
P('');
P('| method | path | router | caller |');
P('|---|---|---|---|');
for (const e of epRows) P(`| ${fmt(e.method, 6)} | \`${e.path}\` | ${e.router} | ${e.called ? 'called' : '**none found**'} |`);
P('');
P('## The bridge to the platform');
P('');
P('| seam | file | detail |');
P('|---|---|---|');
for (const s of seams) P(`| ${s.kind} | \`${s.file}\` | ${s.tables ? s.tables.join(', ') : s.detail} |`);
P('');

fs.writeFileSync(path.join(REPO, 'docs', 'CRM_INVENTORY.md'), lines.join('\n'));
fs.writeFileSync(
  path.join(REPO, 'docs', 'crm-inventory.json'),
  JSON.stringify({ schemaSource, tables: tableRows, endpoints: epRows, seams }, null, 2),
);

console.log('');
console.log(`  ${tables.length} tables · ${tenantBearing.length} tenant-bearing · ${unprotected.length} of those unprotected`);
console.log(`  ${epRows.length} endpoints · ${epRows.length - called.length} with no caller found`);
console.log(`  ${seams.length} bridge seam(s)`);
console.log(`  ${tableRows.filter((t) => t.verdict.startsWith('ORPHAN')).length} orphan table(s) · `
  + `${tableRows.filter((t) => t.verdict === 'superseded').length} superseded`);
console.log('');
console.log('wrote docs/CRM_INVENTORY.md + docs/crm-inventory.json');

if (sql) await sql.end();
