/**
 * Generate docs/SCHEMA_MAP.md from the LIVE database.
 *
 *   source scripts/sandbox-env.sh && node scripts/schema-map.mjs
 *
 * WHY THIS EXISTS, and why it is generated rather than written.
 *
 * CLAUDE.md says "Before writing SQL, verify column names in CLAUDE_CLIFFNOTES.md section 1", and
 * §1 says "Do NOT guess column names. Look them up here." Measured on 2026-08-22, §1 described
 * **72 tables frozen at migration 067** against a live schema of **115 tables at migration 202** —
 * 135 migrations and 43 tables stale. It would have MISLED anyone who followed the instruction.
 *
 * That is not a documentation lapse to scold; it is the predictable end state of a hand-maintained
 * mirror of something that changes every week. The schema is the body of this system and it grows;
 * an anatomy chart drawn once does not.
 *
 * The six schema mistakes that produced this file, all in one session, all costing a full
 * ingest→shred→curate cycle to rediscover:
 *
 *   opportunities.status                  does not exist (topic_status does)
 *   tenant_opportunity_cards.status       does not exist (lifecycle_status / pursuit_status)
 *   proposal_sections.status = 'locked'   'locked' is not in the vocabulary; locking is locked_at
 *   opportunities.solicitation_id         exists but is the OTHER direction of the link (B46)
 *   system_events type 'finder.rfp.x'     namespace and type are separate columns
 *   the package envelope                  is { data: … }, not the payload at top level
 *
 * Note the shape of those: only two are "column does not exist". The rest are a column that exists
 * but means something else, a value that is not in the vocabulary, or a link written in the other
 * direction. A plain column list would have caught two of six. So this map carries four things:
 *
 *   1. COLUMNS      name, type, nullability, default
 *   2. VOCABULARY   the actual distinct values of every low-cardinality text column, and the CHECK
 *                   constraint if there is one. This is what catches status = 'locked'.
 *   3. LINKS        every foreign key, in BOTH directions, and — crucially — how many rows on each
 *                   side actually populate it. This is what catches B46.
 *   4. ISOLATION    tenant_id presence, RLS enabled/forced. This is what keeps a query from
 *                   quietly crossing a tenant boundary.
 *
 * Regenerate after every migration. The header carries the migration head and row counts it was
 * generated against, so a stale copy announces itself instead of lying quietly.
 */
import postgres from 'postgres';
import { writeFileSync } from 'fs';

const sql = postgres(process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL, { max: 4 });
const OUT = 'docs/SCHEMA_MAP.md';

/** Low-cardinality text columns are enums in all but name — and the place assumptions go to die. */
const VOCAB_MAX_DISTINCT = 12;
const VOCAB_SAMPLE_TABLES_MAX_ROWS = 500_000;

const [{ head }] = await sql`
  SELECT coalesce(max(filename), '(unknown)') AS head FROM _migration_history`;
const [{ n: tableCount }] = await sql`
  SELECT count(*)::int AS n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;

const tables = await sql`
  SELECT c.relname AS table,
         c.relrowsecurity  AS rls_enabled,
         c.relforcerowsecurity AS rls_forced,
         coalesce(s.n_live_tup, 0)::bigint AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
   WHERE n.nspname = 'public' AND c.relkind = 'r'
   ORDER BY c.relname`;

const columns = await sql`
  SELECT table_name AS table, column_name AS column, data_type AS type,
         is_nullable AS nullable, column_default AS default
    FROM information_schema.columns
   WHERE table_schema = 'public'
   ORDER BY table_name, ordinal_position`;

const fks = await sql`
  SELECT tc.table_name AS from_table, kcu.column_name AS from_col,
         ccu.table_name AS to_table,  ccu.column_name AS to_col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
   WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
   ORDER BY 1, 2`;

const checks = await sql`
  SELECT rel.relname AS table, con.conname AS name, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE con.contype = 'c' AND n.nspname = 'public'
   ORDER BY 1, 2`;

const byTable = (rows) => rows.reduce((m, r) => ((m[r.table] ??= []).push(r), m), {});
const cols = byTable(columns);
const chk = byTable(checks);
const rowsOf = Object.fromEntries(tables.map((t) => [t.table, Number(t.rows)]));

// ── VOCABULARY ─────────────────────────────────────────────────────────────
// Sample every text column that plausibly holds a controlled value. Cheap enough to run over a
// sandbox; skipped on tables too large to scan so a regeneration never hangs.
const vocab = {};
for (const t of tables) {
  if (rowsOf[t.table] > VOCAB_SAMPLE_TABLES_MAX_ROWS || rowsOf[t.table] === 0) continue;
  const textCols = (cols[t.table] ?? []).filter(
    (c) => ['text', 'character varying'].includes(c.type)
        && /status|state|stage|type|kind|role|phase|source|tier|mode|format|disposition|visibility|scope|action|namespace|severity|outcome|verdict|driver/.test(c.column));
  for (const c of textCols) {
    try {
      const vals = await sql`
        SELECT ${sql(c.column)} AS v, count(*)::int AS n
          FROM ${sql(t.table)}
         WHERE ${sql(c.column)} IS NOT NULL
         GROUP BY 1 ORDER BY 2 DESC LIMIT ${VOCAB_MAX_DISTINCT + 1}`;
      if (vals.length && vals.length <= VOCAB_MAX_DISTINCT) {
        vocab[`${t.table}.${c.column}`] = vals.map((r) => `${r.v}(${r.n})`);
      }
    } catch { /* a column we cannot sample is simply not documented as a vocabulary */ }
  }
}

// ── LINK POPULATION ────────────────────────────────────────────────────────
// The B46 lesson: a foreign key that EXISTS tells you nothing about whether it is WRITTEN. Count
// both, so a one-way link is visible as a number rather than discovered in a failing drive.
const linkFill = {};
for (const f of fks) {
  if (rowsOf[f.from_table] === 0) continue;
  try {
    const [{ set, total }] = await sql`
      SELECT count(*) FILTER (WHERE ${sql(f.from_col)} IS NOT NULL)::int AS set,
             count(*)::int AS total FROM ${sql(f.from_table)}`;
    linkFill[`${f.from_table}.${f.from_col}`] = { set, total };
  } catch { /* skip */ }
}

// ── render ─────────────────────────────────────────────────────────────────
const pct = (s, t) => (t === 0 ? '—' : `${Math.round((100 * s) / t)}%`);
const L = [];
L.push('# Schema map — generated from the live database');
L.push('');
L.push('> **\u26a0 ROW COUNTS AND "% populated" DESCRIBE THE DATABASE THIS WAS GENERATED AGAINST**,');
  L.push('> not the product. A column reading 0% means nothing in THAT database populates it \u2014 which on');
  L.push('> a sandbox rebuilt by a drive is a statement about the drive, not about the code. Treat them as a');
  L.push('> strong hint about FK DIRECTION and a weak one about anything else. The STRUCTURE \u2014 tables,');
  L.push('> columns, types, constraints, foreign keys \u2014 is exact.');
  L.push('>');
  L.push('> **DO NOT EDIT.** Regenerate: `source scripts/sandbox-env.sh && node scripts/schema-map.mjs`');
L.push('> Run it after every migration. A hand-maintained copy of a schema that changes weekly');
L.push('> becomes wrong silently — which is exactly what happened to CLAUDE_CLIFFNOTES §1, frozen at');
L.push('> migration 067 while the body grew to 202.');
L.push('');
L.push(`**Generated against** migration head \`${head}\` · **${tableCount} tables** · ${columns.length} columns · ${fks.length} foreign keys`);
L.push('');
L.push('## How to use this before writing SQL');
L.push('');
L.push('| If you are about to… | Read |');
L.push('|---|---|');
L.push('| name a column | §2 Tables |');
L.push('| compare a status/type/stage to a literal | **§3 Vocabularies** — a value not listed does not exist |');
L.push('| join two tables | **§4 Links** — check which DIRECTION is actually written |');
L.push('| query anything tenant-scoped | §5 Isolation |');
L.push('');
L.push('---');
L.push('');
L.push('## 1. Six mistakes this map exists to prevent');
L.push('');
L.push('All made in a single session, each costing a full ingest→shred→curate cycle to rediscover.');
L.push('Only two are "column does not exist" — which is why a plain column list is not enough.');
L.push('');
L.push('| Assumption | Reality | Caught by |');
L.push('|---|---|---|');
L.push('| `opportunities.status` | no such column (`topic_status`) | §2 |');
L.push('| `tenant_opportunity_cards.status` | `lifecycle_status` / `pursuit_status` | §2 |');
L.push('| `proposal_sections.status = \'locked\'` | vocabulary is `ai_drafted\\|approved\\|in_progress`; locking is `locked_at` | **§3** |');
L.push('| join on `opportunities.solicitation_id` | written the other way (`curated_solicitations.opportunity_id`) — B46 | **§4** |');
L.push('| `system_events.type = \'finder.rfp.x\'` | `namespace` and `type` are separate columns | §2 + §3 |');
L.push('| package JSON at top level | envelope is `{ data: … }` | not schema — API contract |');
L.push('');
L.push('---');
L.push('');
L.push('## 2. Tables');
L.push('');
for (const t of tables) {
  const c = cols[t.table] ?? [];
  const flags = [];
  if (t.rls_forced) flags.push('RLS FORCED');
  else if (t.rls_enabled) flags.push('RLS on');
  if (c.some((x) => x.column === 'tenant_id')) flags.push('tenant-scoped');
  if (c.some((x) => x.column === 'archived_at')) flags.push('archivable');
  L.push(`### \`${t.table}\`  · ${Number(t.rows).toLocaleString()} rows${flags.length ? ` · _${flags.join(' · ')}_` : ''}`);
  L.push('');
  L.push('| column | type | null | default |');
  L.push('|---|---|---|---|');
  for (const x of c) {
    const d = x.default ? `\`${String(x.default).slice(0, 40)}\`` : '';
    L.push(`| \`${x.column}\` | ${x.type} | ${x.nullable === 'YES' ? 'yes' : '**no**'} | ${d} |`);
  }
  const ck = (chk[t.table] ?? []).filter((k) => !/_not_null$/.test(k.name));
  if (ck.length) {
    L.push('');
    for (const k of ck) L.push(`- CHECK \`${k.name}\`: \`${k.def.slice(0, 160)}\``);
  }
  L.push('');
}
L.push('---');
L.push('');
L.push('## 3. Vocabularies — the actual values, not the plausible ones');
L.push('');
L.push('Every low-cardinality text column, with live counts. **A value not listed here does not**');
L.push('**exist in this database.** `proposal_sections.status = \'locked\'` matched nothing all night');
L.push('because `locked` is not a member — the lock is `locked_at IS NOT NULL`.');
L.push('');
L.push('| column | values (count) |');
L.push('|---|---|');
for (const [k, v] of Object.entries(vocab).sort()) {
  L.push(`| \`${k}\` | ${v.map((x) => `\`${x}\``).join(' · ')} |`);
}
L.push('');
L.push('---');
L.push('');
L.push('## 4. Links — and which direction is actually written');
L.push('');
L.push('A foreign key that EXISTS tells you nothing about whether it is POPULATED. B46: the push');
L.push('writes `curated_solicitations.opportunity_id` and leaves `opportunities.solicitation_id`');
L.push('NULL, so a join on the back-link found nothing and two separate drive scripts reported');
L.push('"nothing reached a tenant card" against a push that had fanned seventeen.');
L.push('');
L.push('**Read the fill column before joining.** Anything below ~90% is a link you cannot rely on.');
L.push('');
L.push('| from | → to | filled |');
L.push('|---|---|---|');
for (const f of fks) {
  const key = `${f.from_table}.${f.from_col}`;
  const fill = linkFill[key];
  const cell = fill ? `${pct(fill.set, fill.total)} (${fill.set}/${fill.total})` : '—';
  const warn = fill && fill.total > 0 && fill.set / fill.total < 0.9 ? ' ⚠️' : '';
  L.push(`| \`${key}\` | \`${f.to_table}.${f.to_col}\` | ${cell}${warn} |`);
}
L.push('');
L.push('---');
L.push('');
L.push('## 5. Isolation');
L.push('');
L.push('RLS is live and two-layer (docs/RLS_CUTOVER.md). The app runs as `govtech_app`');
L.push('(`NOBYPASSRLS`); `sqlBypass` is the owner connection for migrations and the few legitimate');
L.push('cross-tenant admin reads. **PLATFORM SCOPE = `tenant_id IS NULL`** — and because the');
L.push('policies are tenant-EQUALITY and NULL never equals anything, such a row is invisible AND');
L.push('un-writable through the context-aware `sql`.');
L.push('');
L.push('| table | tenant_id | RLS | forced |');
L.push('|---|---|---|---|');
for (const t of tables) {
  const hasTenant = (cols[t.table] ?? []).some((x) => x.column === 'tenant_id');
  if (!hasTenant && !t.rls_enabled) continue;
  L.push(`| \`${t.table}\` | ${hasTenant ? 'yes' : '—'} | ${t.rls_enabled ? 'yes' : '—'} | ${t.rls_forced ? '**yes**' : '—'} |`);
}
L.push('');

writeFileSync(OUT, L.join('\n'));
console.log(`${OUT} — ${tableCount} tables · ${columns.length} columns · ${fks.length} FKs · `
          + `${Object.keys(vocab).length} vocabularies · head ${head}`);
const weak = Object.entries(linkFill).filter(([, v]) => v.total > 0 && v.set / v.total < 0.9);
if (weak.length) {
  console.log(`\npartially-written links (join with care):`);
  for (const [k, v] of weak.slice(0, 12)) console.log(`   ${k.padEnd(48)} ${pct(v.set, v.total)} (${v.set}/${v.total})`);
}
await sql.end();
