/**
 * Check a file's SQL against the LIVE schema before you run it.
 *
 *   source scripts/sandbox-env.sh && node scripts/schema-check.mjs <file> [file…]
 *   node scripts/schema-check.mjs --changed        # everything git says you touched
 *
 * WHY. A generated map only helps if something reads it. Six schema mistakes in one session each
 * cost a full ingest→shred→curate cycle to rediscover — minutes of compute and a broken run, to
 * learn a fact a query answers in milliseconds. This is that query, run ahead of time.
 *
 * WHAT IT CATCHES — the two classes that are mechanically decidable:
 *
 *   1. a column that does not exist on the table it is qualified against
 *   2. a literal compared to a low-cardinality column that is not in that column's live vocabulary
 *      — `status = 'locked'` when the values are ai_drafted|approved|in_progress
 *
 * WHAT IT DELIBERATELY DOES NOT DO. It does not parse SQL. A real parser would be the right answer
 * for a linter that must never be wrong, but this one is advisory and runs on files a human is
 * about to execute, so a regex over `alias.column` and `column = 'literal'` finds the mistakes that
 * actually happen here while staying small enough to trust. It reports what it checked, so a thin
 * pass cannot be mistaken for a thorough one.
 *
 * FALSE POSITIVES ARE EXPECTED and are printed separately from findings: `p.ok`, `res.status`,
 * `u.pathname` are JavaScript property accesses that look exactly like qualified columns. The rule
 * is that an alias is only checked when it maps to a real table — anything else is reported as
 * "unresolved" rather than guessed at. A checker that cries wolf gets ignored, which is worse than
 * no checker.
 */
import postgres from 'postgres';
import { readFileSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

const sql = postgres(process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL, { max: 4 });

let files = process.argv.slice(2);
// Unqualified checking is OPT-IN. It raises coverage 5.5x (622 -> 3406 references) but its
// false-positive rate is unacceptable as a default: identifying which text in a .ts file is
// actually SQL needs a parser, and a stray backtick anywhere makes the block extractor swallow a
// docblock, at which point English prose ("this", "every", "needs", "wrap") gets reported as
// missing columns. Five rounds of fixes did not get it clean.
//
// Shipping it on by default would be the exact failure this whole tool exists to prevent — a check
// that produces confident output it has not earned. Qualified checking IS trustworthy: mutation
// tested 8/8, zero false positives across 245 files. That is the default.
const UNQUALIFIED = process.argv.includes('--unqualified');
files = files.filter((f) => f !== '--unqualified');

if (files[0] === '--changed') {
  files = execSync('git diff --name-only HEAD; git diff --cached --name-only', { encoding: 'utf8' })
    .split('\n').map((f) => f.trim())
    .filter((f) => f && /\.(ts|tsx|mjs|mts|js)$/.test(f));
  files = [...new Set(files)];
}
if (!files.length) { console.log('usage: schema-check.mjs <file…> | --changed'); process.exit(0); }

// ── is the "live truth" actually live? ─────────────────────────────────────
//
// This tool compares code against a database, and says so with confidence. If that database is
// behind the repo's migrations, every column a recent migration added reads as MISSING — and the
// output is a list of confident accusations against correct code. Measured, not hypothetical: a
// sandbox sitting at migration 163 against a repo at 205 produced 24 findings, all of them
// phantom (`curated_solicitations.build_complete` from mig 182, `opportunities.update_watch` from
// mig 181, the whole promo-code issuance set from mig 200). After migrating, the same sweep over
// the same 683 files returned ZERO.
//
// A wrong accusation is the one failure this tool cannot survive, so the premise gets checked
// before the conclusions do.
try {
  const applied = new Set((await sql`SELECT filename FROM _migration_history`).map((r) => r.filename));
  const onDisk = readdirSync(new URL('../db/migrations/', import.meta.url))
    .filter((f) => /^\d{3}_.*\.sql$/.test(f) && !f.startsWith('000_'));
  const behind = onDisk.filter((f) => !applied.has(f)).sort();
  if (behind.length) {
    console.log(`⚠ THE DATABASE IS ${behind.length} MIGRATION(S) BEHIND THE REPO — findings below may be phantom.`);
    console.log(`  first missing: ${behind[0]}   latest missing: ${behind[behind.length - 1]}`);
    console.log('  run: node db/migrations/migrate.mjs   (then re-run this)\n');
  }
} catch {
  // No _migration_history (a bare or non-project database). Not fatal — but say so, because
  // "checked against the live schema" means less when nobody knows which schema that is.
  console.log('⚠ could not read _migration_history — cannot tell whether this database matches the repo.\n');
}

// ── live truth ─────────────────────────────────────────────────────────────
const colRows = await sql`
  SELECT table_name AS t, column_name AS c, data_type AS ty
    FROM information_schema.columns WHERE table_schema = 'public'`;
const columnsOf = new Map();
for (const r of colRows) {
  if (!columnsOf.has(r.t)) columnsOf.set(r.t, new Set());
  columnsOf.get(r.t).add(r.c);
}

/** A CHECK constraint is the AUTHORITY on what a column may hold. Sampled data is not: it cannot
 *  tell an invalid value from a valid one that has simply never been written. The first sweep
 *  flagged `proposals.stage = 'archived'` and `user_memberships.source = 'partner_manager'` — both
 *  legal, both listed in their CHECK, neither present in this sandbox because nothing had archived
 *  a tenant yet. Two false alarms out of six findings.
 *
 *  So: if a CHECK enumerates the values, that is the vocabulary and a violation is a real finding.
 *  Without one, sampled data yields a WEAKER claim, reported separately as a hint. */
const checkVocab = new Map();
for (const r of await sql`
  SELECT rel.relname AS t, pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
   WHERE con.contype = 'c' AND n.nspname = 'public'`) {
  // CHECK ((col = ANY (ARRAY['a'::text, 'b'::text])))
  const m = r.def.match(/\(\s*([a-z_]+)\s*=\s*ANY\s*\(\s*ARRAY\[([^\]]+)\]/i);
  if (!m) continue;
  const vals = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (vals.length) checkVocab.set(`${r.t}.${m[1]}`, new Set(vals));
}

/** Vocabularies for the columns people compare to literals. Same selection as schema-map.mjs. */
const vocab = new Map();
const candidates = colRows.filter(
  (r) => ['text', 'character varying'].includes(r.ty)
      && /status|state|stage|type|kind|role|phase|source|format|disposition|scope|namespace/.test(r.c));
for (const r of candidates) {
  try {
    const vals = await sql`
      SELECT DISTINCT ${sql(r.c)} AS v FROM ${sql(r.t)}
       WHERE ${sql(r.c)} IS NOT NULL LIMIT 13`;
    if (vals.length && vals.length <= 12) {
      vocab.set(`${r.t}.${r.c}`, new Set(vals.map((x) => String(x.v))));
    }
  } catch { /* unsampleable — simply not checked */ }
}

// ── scan ───────────────────────────────────────────────────────────────────
let findings = 0, checked = 0, unresolved = 0, hintCount = 0, ambiguous = 0;
const hints = [];
/** Files this run READ NOTHING in — reported, because a silent skip is what let a bad column pass. */
const silent = [];
for (const file of files) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { continue; }
  const hits = [];

  // Scan ONLY inside sql`…` template literals, with comments stripped first.
  //
  // The first version scanned the whole file. Once `u` was aliased to `users` by any query, every
  // `u.something` in the file was checked — so `new URL(x).pathname` became "users.pathname does
  // not exist", `p.plane` on a JS array became "proposals.plane", and one finding came from a
  // COMMENT that said opportunities has no status column. Seven false positives against three real
  // ones on the same file.
  //
  // That is the cry-wolf failure this file's own header warns about: a checker with a 70% false
  // positive rate gets ignored, which is strictly worse than no checker, because it also consumes
  // the attention that would have found the real thing.
  // Each sql`…` is scanned with ITS OWN alias map. Sharing one map across a file let `t` mean
  // `tenants` in one query and leak into a later `FROM atom_tags t`, reporting tenants.dimension —
  // a third false alarm. An alias is scoped to the query that declares it, so the checker must be
  // too.
  //
  // THE TAG CAN CARRY A TYPE ARGUMENT, AND IT USUALLY DOES.
  //
  // This matched `sql\`` and `sqlBypass\`` and nothing else, so the dominant style in this
  // codebase — `sql<Array<{ id: string }>>\`…\``, the form CLAUDE.md's own SOP writes — never
  // matched, and neither did the `tx\`` inside every `sql.begin` transaction. Measured across
  // frontend/{lib,app,scripts}: 767 of 2,174 SQL blocks were visible. 213 files containing SQL
  // were skipped ENTIRELY and still reported as clean.
  //
  // That is this tool's own failure mode, aimed at itself: `schema-check` cleared
  // `pa.sort_index` — a column `proposal_artifacts` does not have — with the line "nothing
  // contradicts the live schema", because it had read none of the file's three queries. A checker
  // that says nothing is wrong after checking nothing is worse than no checker.
  //
  // `<[^`]*?>` is lazy and cannot cross a backtick, so it expands only as far as the type argument
  // (`<Array<{ n: number }>>` needs three tries) and never swallows a template literal.
  //
  // COMMENTS COME OUT FIRST, because prose in this repo is full of backticks. The extractor used
  // to strip comments INSIDE a matched block, which is too late: a docblock reading "the legitimate
  // `sqlBypass` uses" opens a backtick in the comment, and `[^`]*` then runs from there to the next
  // backtick in the file — swallowing the comment tail and the code after it, and reporting English
  // prose as a query. That is the failure this file's own header warns about, and the fixed
  // extractor walked straight into it on its first run.
  //
  // `//` is only a comment when it is not `://`, so a URL in a string survives.
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const sqlBlocks = [...code.matchAll(/\b(?:sql|sqlBypass|tx)\s*(?:<[^`]*?>)?\s*`([^`]*)`/g)]
    .map((m) => m[1].replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' '))
    .filter((b) => b.trim());
  if (!sqlBlocks.length) { silent.push(file); continue; }

  const before = checked;
  for (const src of sqlBlocks) {
    // Aliases declared in THIS query only.
    // An alias bound to MORE THAN ONE table inside a single statement is AMBIGUOUS and is not
    // checked. A subquery legitimately shadows an outer alias:
    //
    //     SELECT (SELECT array_agg(t.dimension) FROM atom_tags t WHERE t.atom_id = a.id)
    //       FROM library_atoms a JOIN tenants t ON t.id = a.tenant_id WHERE t.slug = 'foundation'
    //
    // Both bindings of `t` are correct; resolving which one a given reference means requires
    // parsing scope, which this tool deliberately does not do. Taking the last binding reported
    // three real columns as missing. Refusing to check is the only honest option — the tool's
    // value is that a finding is worth reading, and that survives a gap in coverage but not a
    // wrong accusation.
    const bindings = new Map();
    const bind = (a, t) => { if (!bindings.has(a)) bindings.set(a, new Set()); bindings.get(a).add(t); };
    for (const m of src.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)\s+(?:AS\s+)?([a-z][a-z0-9_]{0,3})\b/gi)) {
      if (columnsOf.has(m[1])) bind(m[2], m[1]);
    }
    for (const m of src.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z0-9_]*)/gi)) {
      if (columnsOf.has(m[1])) bind(m[1], m[1]);
    }
    const alias = new Map();
    for (const [a, tabs] of bindings) {
      if (tabs.size === 1) alias.set(a, [...tabs][0]);
      else ambiguous += 1;   // shadowed — counted, never guessed
    }

    // 1 · qualified column references
    for (const m of src.matchAll(/\b([a-z][a-z0-9_]{0,20})\.([a-z_][a-z0-9_]*)\b/g)) {
      const [, a, col] = m;
      const table = alias.get(a);
      if (!table) { unresolved += 1; continue; }
      checked += 1;
      if (!columnsOf.get(table).has(col)) {
        const near = [...columnsOf.get(table)].filter((c) => c.includes(col) || col.includes(c)).slice(0, 3);
        hits.push(`  ✗ ${file}: ${table}.${col} does not exist`
                + (near.length ? `  — did you mean ${near.map((n) => `${table}.${n}`).join(' / ')}?` : ''));
      }
    }

    // 1b · UNQUALIFIED columns, when the statement names exactly ONE table.
    //
    // This was missing, and its absence made the first sweep's "0 findings / the product's SQL is
    // clean" a false reassurance. Most postgres.js code in this repo does not alias:
    //
    //     sql`SELECT id, stage, title FROM proposals WHERE id = ${id}`
    //
    // so ~47% of all column references were never examined. A mutation test proved it: three real
    // product files, an invented column injected into each, ZERO references verified and nothing
    // caught. A checker that skips half the code and reports "0 findings" is worse than none,
    // because the number reads as a clean bill of health.
    //
    // Single-table statements are unambiguous, so bare identifiers resolve safely. Multi-table
    // statements are skipped here — the column could belong to either side, and this tool does not
    // guess.
    const tablesInStmt = new Set(alias.values());
    if (UNQUALIFIED && tablesInStmt.size === 1) {
      const only = [...tablesInStmt][0];
      const known = columnsOf.get(only);
      // Identifiers in column position: after SELECT/WHERE/SET/AND/OR/,/( — not values, not
      // keywords, not the table name itself.
      // Strip literals, interpolations, AND `AS alias` output names. An alias is a name being
      // DEFINED, not a column being read: `SELECT template AS snapshot FROM template_bridge` was
      // reported as "template_bridge.snapshot does not exist". Third false-positive class in this
      // tool, and like the other two it was only found by running it against real code rather than
      // reasoning about it.
      const body = src
        .replace(/'[^']*'/g, "''")
        .replace(/\$\{[^}]*\}/g, '?')
        .replace(/\bAS\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?/gi, ' ')
        .replace(/::\s*[a-zA-Z_][a-zA-Z0-9_]*(\s*\[\s*\])?/g, ' ')   // ::uuid ::vector ::int[]
        .replace(/\b(?:COUNT|SUM|MAX|MIN|AVG|ROUND|LENGTH|COALESCE|GREATEST|LEAST)\s*\(/gi, '(');
      const KEYWORDS = new Set(['select','from','where','and','or','not','null','is','as','on','join','left','right','inner','outer','order','by','group','having','limit','offset','insert','into','values','update','set','delete','returning','distinct','case','when','then','else','end','count','coalesce','sum','max','min','avg','now','true','false','asc','desc','exists','in','any','all','union','with','cast','interval','filter','over','partition','nulls','first','last','conflict','do','nothing','default','array','jsonb','text','uuid','int','boolean','timestamptz','lateral','using','string_agg','array_agg','length','round']);
      for (const m of body.matchAll(/(?<![.\w])([a-z_][a-z0-9_]{2,})(?![\w.(])/g)) {
        const id = m[1];
        if (KEYWORDS.has(id) || id === only) continue;
        if (columnsOf.has(id)) continue;            // another table name
        if (known.has(id)) { checked += 1; continue; }
        // Only report when it LOOKS like a column reference — i.e. the statement is a plain
        // single-table query. Anything else is left unresolved rather than accused.
        checked += 1;
        const near = [...known].filter((c) => c.includes(id) || id.includes(c)).slice(0, 3);
        hits.push(`  ✗ ${file}: ${only}.${id} does not exist (unqualified)`
                + (near.length ? `  — did you mean ${near.join(' / ')}?` : ''));
      }
    }

    // 2 · literals — CHECK is authoritative, sampled data is only a hint
    for (const m of src.matchAll(/\b([a-z][a-z0-9_]{0,20})\.([a-z_][a-z0-9_]*)\s*=\s*'([^']{1,40})'/g)) {
      const [, a, col, lit] = m;
      const table = alias.get(a);
      if (!table) continue;
      const key = `${table}.${col}`;
      const ck = checkVocab.get(key);
      if (ck) {
        checked += 1;
        if (!ck.has(lit)) {
          hits.push(`  ✗ ${file}: ${table}.${col} = '${lit}' — violates CHECK. Allowed: ${[...ck].join(' | ')}`);
        }
        continue;
      }
      const v = vocab.get(key);
      if (v && !v.has(lit)) {
        hintCount += 1;
        hints.push(`  ? ${file}: ${table}.${col} = '${lit}' — no CHECK; not present in live data `
                 + `(${[...v].slice(0, 6).join(' | ')}). Legal if newly introduced.`);
      }
    }
  }

  const checkedHere = checked - before;
  if (hits.length) { findings += hits.length; console.log(hits.join('\n')); }
  if (!checkedHere) silent.push(file);
}

console.log(`\nschema-check: ${files.length} file(s) · ${checked} reference(s) verified · `
          + `${unresolved} unresolved · ${ambiguous} ambiguous alias(es) skipped · `
          + `${findings} finding(s)`);
if (hints.length) {
  console.log(`\n${hintCount} hint(s) — no CHECK constraint, value absent from live data. Not findings:`);
  console.log(hints.slice(0, 10).join('\n'));
}
// SILENCE IS NOT A PASS. Say which files this run verified nothing in, so "clean" cannot be read
// as "checked" — the exact confusion that let a nonexistent column through with a green line.
if (silent.length) {
  console.log(`\n${silent.length} file(s) had NO reference this run could verify — not evidence they are correct:`);
  console.log(silent.slice(0, 12).map((f) => `  · ${f}`).join('\n')
    + (silent.length > 12 ? `\n  … and ${silent.length - 12} more` : ''));
}
if (!findings) {
  console.log(checked > 0
    ? `\nnothing contradicts the live schema, across ${checked} verified reference(s).`
    : '\nNOTHING WAS VERIFIED — this run checked no references at all. Not a pass.');
}
await sql.end();
process.exit(findings ? 1 : 0);
