#!/usr/bin/env node
/**
 * classify-migrations — can this migration ship to a LIVE system, or does it need a window?
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────────────────────
 * The rule "promote only what does not require excessive migration or downtime" is an intention
 * until something answers it. Judged by eye at the moment of shipping, it is judged by whoever is
 * shipping, on the day, under time pressure — and the sandbox gives no signal at all, because every
 * lock is instant on a table with forty rows. This turns the question into a tool output.
 *
 * ── THE TWO FACTS THAT MAKE IT MATTER HERE ─────────────────────────────────────────────────────
 * 1. MIGRATIONS RUN AGAINST LIVE OLD CODE. `frontend/entrypoint.sh` runs the migrations, then
 *    starts the server; Railway holds traffic on the OLD container until the new one's
 *    `/api/health` passes (railway.json). So between "migration applied" and "traffic switched",
 *    the PREVIOUS release is serving against the NEW schema. Anything the old code reads must
 *    still be there.
 * 2. EVERY FILE RUNS INSIDE ONE TRANSACTION (`migrate.mjs`, `sql.begin` → `tx.unsafe(content)`).
 *    Good for atomicity, and it makes `CREATE INDEX CONCURRENTLY` impossible — Postgres refuses it
 *    inside a transaction block. Which is why this repo has 377 `CREATE INDEX` statements and zero
 *    concurrent ones: not an oversight, a consequence. See `--explain` for the way out.
 *
 * ── THE CLASSES ────────────────────────────────────────────────────────────────────────────────
 *   A · code-only   no DDL. Ship any time.
 *   B · additive    new objects only; no lock on existing rows. Ship any time.
 *   C · locking     locks an existing table for a duration that scales with ROW COUNT. Instant on
 *                   a small table, a write outage on a large one — so it is a size question, and
 *                   the size is production's, not the sandbox's.
 *   D · breaking    removes or renames something the currently-running code may still read. Needs
 *                   expand/contract across two deploys, never one.
 *   E · rewrite     rewrites the table under an exclusive lock. Needs a window.
 *
 * A file's class is the WORST statement in it.
 *
 *   node scripts/classify-migrations.mjs                 # every migration, with a distribution
 *   node scripts/classify-migrations.mjs 238_foo.sql     # just these
 *   node scripts/classify-migrations.mjs --since 230     # everything from 230 on
 *   node scripts/classify-migrations.mjs --explain       # the reasoning and the remedies
 *   node scripts/classify-migrations.mjs --check         # self-test only
 *
 * Exit 0 when nothing is worse than B · 1 when something needs care · 2 on a harness defect.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, '..', '..', 'db', 'migrations');

const RANK = { A: 0, B: 1, C: 2, D: 3, E: 4 };
const NAME = {
  A: 'code-only', B: 'additive', C: 'locking', D: 'breaking', E: 'rewrite',
};

/**
 * Strip comments and string literals BEFORE matching.
 *
 * These files carry more prose than DDL — the repo documents each decision at its own site — so a
 * scanner that reads prose as code finds the sentence explaining why a migration does NOT drop a
 * column and reports a drop. Three instruments in this repo were wrong that exact way in one
 * sitting; the rule since is to strip first and match second.
 */
function strip(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')     // block comments
    .replace(/--[^\n]*/g, ' ')             // line comments
    .replace(/\$\$[\s\S]*?\$\$/g, ' $BODY$ ')  // function bodies: not table DDL
    .replace(/'(?:[^']|'')*'/g, "''");     // string literals
}

/** Rules, worst first. Each returns the matched statement text for the report. */
const RULES = [
  { cls: 'E', why: 'rewrites the table under an exclusive lock',
    re: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[\w."]+\s+ALTER\s+(?:COLUMN\s+)?[\w"]+\s+(?:SET\s+DATA\s+)?TYPE\b/gi },
  // ANCHORED TO STATEMENT POSITION, and that is not fussiness.
  //
  // `CLUSTER` is an ordinary English word. As a bare `\bCLUSTER\b` this rule classified
  // 191_seed_immobileyes_proposals.sql as a table REWRITE on six matches, every one of them prose
  // inside seeded proposal content — "a cluster of low-divergence laser beams". strip() had
  // already removed 1.5 MB of that file's string literals and six still got through, because
  // literal-stripping is best-effort on 2.6 MB of embedded JSON with escaped quotes.
  //
  // So the lesson is not "strip harder". A keyword that is also English needs a SYNTACTIC anchor
  // as well as a clean input: strip() is the belt, statement position is the brace. Real usage is
  // always statement-initial — `CLUSTER [VERBOSE] table [USING index]`.
  { cls: 'E', why: 'VACUUM FULL / CLUSTER rewrites the whole table, exclusively locked',
    re: /(?:^|;)\s*(?:VACUUM\s+FULL|CLUSTER\s+(?:VERBOSE\s+)?[\w."]+)/gi },
  { cls: 'E', why: 'NOT NULL with no DEFAULT on an existing table fails unless the table is empty, and scans it if not',
    re: /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w"]+\s+[\w\s()\[\]]*?\bNOT\s+NULL\b(?![^;]*\bDEFAULT\b)/gi },

  { cls: 'D', why: 'DROP COLUMN — the release still serving may read it during the deploy window',
    re: /\bDROP\s+COLUMN\b/gi },
  { cls: 'D', why: 'DROP TABLE — same, one object larger',
    re: /\bDROP\s+TABLE\b/gi },
  { cls: 'D', why: 'RENAME — the old name disappears for the release still serving',
    re: /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?[\w."]+\s+RENAME\b/gi },
  { cls: 'D', why: 'DROP a constraint or index the running code may depend on',
    re: /\bDROP\s+(?:CONSTRAINT|INDEX)\b/gi },

  { cls: 'C', why: 'CREATE INDEX without CONCURRENTLY takes a SHARE lock — reads continue, WRITES BLOCK for the build',
    re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!\s+CONCURRENTLY)/gi },
  { cls: 'C', why: 'SET NOT NULL scans the table holding ACCESS EXCLUSIVE',
    re: /\bSET\s+NOT\s+NULL\b/gi },
  { cls: 'C', why: 'FOREIGN KEY without NOT VALID validates every existing row under a lock on BOTH tables',
    re: /\bADD\s+(?:CONSTRAINT\s+[\w"]+\s+)?FOREIGN\s+KEY\b(?![^;]*\bNOT\s+VALID\b)/gi },
  { cls: 'C', why: 'CHECK without NOT VALID scans every existing row under ACCESS EXCLUSIVE',
    re: /\bADD\s+(?:CONSTRAINT\s+[\w"]+\s+)?CHECK\b(?![^;]*\bNOT\s+VALID\b)/gi },

  { cls: 'B', why: 'creates a new table',        re: /\bCREATE\s+TABLE\b/gi },
  { cls: 'B', why: 'adds a column',              re: /\bADD\s+COLUMN\b/gi },
  { cls: 'B', why: 'index built concurrently — no write lock',
    re: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/gi },
  { cls: 'B', why: 'constraint added NOT VALID — no scan',   re: /\bNOT\s+VALID\b/gi },
  { cls: 'B', why: 'function / trigger / view / policy definition',
    re: /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TRIGGER|VIEW|POLICY|TYPE|EXTENSION|ROLE|SEQUENCE)\b/gi },
  { cls: 'B', why: 'grants, comments, RLS toggles',
    re: /\b(?:GRANT|REVOKE|COMMENT\s+ON|ENABLE\s+ROW\s+LEVEL\s+SECURITY|FORCE\s+ROW\s+LEVEL\s+SECURITY)\b/gi },
];

export function classify(sqlText) {
  const s = strip(sqlText);
  const hits = [];
  for (const r of RULES) {
    const m = s.match(r.re);
    if (m) hits.push({ cls: r.cls, why: r.why, count: m.length });
  }
  if (!hits.length) return { cls: 'A', hits: [] };
  const worst = hits.reduce((a, h) => (RANK[h.cls] > RANK[a] ? h.cls : a), 'A');
  // Report every hit at the worst class, plus a count of the rest.
  return { cls: worst, hits: hits.sort((a, b) => RANK[b.cls] - RANK[a.cls]) };
}

// ── self-test: known answers before any real file ───────────────────────────────────────────────
function selfTest() {
  const cases = [
    ['A', "INSERT INTO tenants (id) VALUES ('x');"],
    ['B', 'CREATE TABLE foo (id uuid PRIMARY KEY);'],
    ['B', 'ALTER TABLE foo ADD COLUMN bar text;'],
    ['B', 'ALTER TABLE foo ADD COLUMN bar text NOT NULL DEFAULT \'x\';'],
    ['B', 'CREATE INDEX CONCURRENTLY idx ON foo (bar);'],
    ['B', 'ALTER TABLE foo ADD CONSTRAINT c CHECK (bar > 0) NOT VALID;'],
    ['C', 'CREATE INDEX idx ON foo (bar);'],
    ['C', 'ALTER TABLE foo ALTER COLUMN bar SET NOT NULL;'],
    ['C', 'ALTER TABLE foo ADD CONSTRAINT fk FOREIGN KEY (a) REFERENCES bar(id);'],
    ['D', 'ALTER TABLE foo DROP COLUMN bar;'],
    ['D', 'DROP TABLE foo;'],
    ['D', 'ALTER TABLE foo RENAME TO baz;'],
    ['E', 'ALTER TABLE foo ALTER COLUMN bar TYPE bigint;'],
    ['E', 'ALTER TABLE foo ADD COLUMN bar text NOT NULL;'],
    // The prose trap, which is the whole reason strip() runs first.
    ['B', '-- We deliberately do NOT drop column legacy_id here; see mig 154.\nCREATE TABLE foo (id uuid);'],
    ['B', "/* DROP TABLE foo was considered and rejected */ ALTER TABLE foo ADD COLUMN b text;"],
    ['A', "INSERT INTO notes (body) VALUES ('run CREATE INDEX later');"],
    // THE ENGLISH-WORD TRAP, pinned. This exact text (from seeded proposal content) made the
    // classifier call a seed migration a table rewrite. Prose survives literal-stripping at scale;
    // the statement anchor is what actually holds.
    ['A', "INSERT INTO s (t) VALUES ('switching from a single laser to a cluster of beamlets');"],
    ['A', 'CREATE TABLE metrics (cluster text);'.replace('CREATE TABLE', 'INSERT INTO x SELECT')],
    ['E', 'CLUSTER foo USING foo_pkey;'],
    ['E', 'ALTER TABLE a ADD COLUMN b int;\nVACUUM FULL a;'],
    // A file is its WORST statement, not its first or last.
    ['D', 'CREATE TABLE a (id int);\nALTER TABLE b DROP COLUMN c;\nCREATE INDEX i ON a (id);'],
  ];
  let bad = 0;
  for (const [want, sql] of cases) {
    const got = classify(sql).cls;
    const ok = got === want;
    if (!ok) { console.log(`  ✗ expected ${want}, got ${got}  ${sql.split('\n')[0].slice(0, 62)}`); bad++; }
  }
  console.log(`  ${bad ? '✗' : '✓'} ${cases.length - bad}/${cases.length} classification cases`);
  return bad;
}

const EXPLAIN = `
WHY EACH CLASS IS WHAT IT IS, AND WHAT TO DO ABOUT IT

  A · code-only   No DDL. The deploy is a container swap. Ship any time.

  B · additive    New objects only. Nothing existing is locked or scanned, so the duration does
                  not scale with your data. Ship any time.

  C · locking     The one that looks safe in the sandbox and is not in production, because the
                  lock's DURATION SCALES WITH ROW COUNT and the sandbox has forty rows.
                  CREATE INDEX without CONCURRENTLY holds a SHARE lock: reads continue, writes
                  block, for as long as the build takes.
                  REMEDY — and it needs a runner change first. Postgres refuses
                  CREATE INDEX CONCURRENTLY inside a transaction block, and migrate.mjs wraps
                  every file in one (sql.begin → tx.unsafe). So concurrent builds are currently
                  impossible, which is why 377 of 377 indexes in this repo are non-concurrent.
                  The standard fix is a per-file opt-out marker — a header line the runner reads,
                  e.g. \`-- migrate:no-transaction\` — applied only to files that need it. The
                  trade is real: such a file is no longer atomic, and a failed CONCURRENTLY build
                  leaves an INVALID index you drop and retry. That is a known, recoverable state,
                  and it is a better one than a write outage.
                  For FK and CHECK: add NOT VALID, then VALIDATE CONSTRAINT in a later migration.
                  Validation takes a weaker lock and does not block writes.

  D · breaking    Removes or renames something the running code may read. This is not about locks
                  — it is about the DEPLOY WINDOW. Migrations run in the frontend entrypoint
                  before the new server listens, and Railway holds traffic on the old container
                  until /api/health passes. So the PREVIOUS release serves against the NEW schema
                  for the length of a boot. A dropped column is a 500 for every request that
                  reads it, in that window.
                  REMEDY — expand/contract, across two deploys:
                    deploy 1  add the new thing; write to both; read the old
                    deploy 2  read the new; stop writing the old
                    deploy 3  drop the old
                  Never one deploy. There is no down-migration in this runner — it is
                  forward-only — so a bad contract step is fixed by rolling forward.

  E · rewrite     Rewrites the table under ACCESS EXCLUSIVE: no reads, no writes, for the
                  duration. Needs an announced window, or the expand/contract dance with a
                  backfill in between.
                  ALTER COLUMN TYPE is the usual cause. Some type changes are binary-coercible
                  and cheap (varchar(n) → text); this classifier does not try to tell them apart,
                  because guessing wrong in the cheap direction is how a window gets skipped.
`;

// ── main ────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes('--explain')) { console.log(EXPLAIN); process.exit(0); }

console.log('\nSELF-TEST\n');
if (selfTest()) {
  console.error('\n⛔ HARNESS DEFECT — classification is wrong on a known answer. Every verdict below would be unearned.\n');
  process.exit(2);
}
console.log('');
if (argv.includes('--check')) process.exit(0);

const sinceIdx = argv.indexOf('--since');
const since = sinceIdx >= 0 ? Number(argv[sinceIdx + 1]) : null;
const named = argv.filter((a) => !a.startsWith('--') && a !== String(since));

let files = named.length ? named.map((f) => basename(f))
                         : readdirSync(MIGRATIONS).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
if (since != null) files = files.filter((f) => Number(f.slice(0, 3)) >= since);
if (!files.length) { console.error('no migration files matched.'); process.exit(2); }

const results = files.map((f) => {
  let text;
  try { text = readFileSync(join(MIGRATIONS, f), 'utf8'); }
  catch (e) { return { file: f, cls: null, error: e.message }; }
  return { file: f, ...classify(text) };
});

const dist = { A: 0, B: 0, C: 0, D: 0, E: 0 };
for (const r of results) if (r.cls) dist[r.cls]++;

const notable = results.filter((r) => r.cls && RANK[r.cls] >= RANK.C);
if (notable.length) {
  console.log(`NEEDS CARE — ${notable.length} of ${results.length} file(s)\n`);
  for (const r of notable) {
    const top = r.hits.filter((h) => h.cls === r.cls);
    console.log(`  ${r.cls} · ${NAME[r.cls].padEnd(9)} ${r.file}`);
    for (const h of top) console.log(`               ${h.count}× ${h.why}`);
  }
  console.log('');
}

console.log('DISTRIBUTION');
for (const c of ['A', 'B', 'C', 'D', 'E']) {
  const n = dist[c];
  const bar = '█'.repeat(Math.round((n / Math.max(1, results.length)) * 46));
  console.log(`  ${c} · ${NAME[c].padEnd(9)} ${String(n).padStart(4)}  ${bar}`);
}
console.log(`  ${'total'.padStart(15)} ${String(results.length).padStart(4)}\n`);
console.log('`--explain` gives the reasoning and the remedy for each class.\n');

process.exit(notable.length ? 1 : 0);
