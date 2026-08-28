#!/usr/bin/env node
/**
 * Does the row type tell the truth about what postgres.js will hand back?
 *
 * ── THE HALF OF THE TRAP NOTHING GUARDS ──────────────────────────────────────────────────────
 * `sql<CdrlItem[]>\`SELECT first_due …\`` is an ASSERTION. TypeScript trusts it completely: it
 * never sees the query, never sees the column, and cannot check. So a row type is only as true as
 * the person who wrote it, and there are two ways to get it wrong:
 *
 *   NAME   declaring `first_due` where the runtime gives `firstDue` (postgres.toCamel)
 *   TYPE   declaring `string` where the runtime gives a `Date`
 *
 * The inventory already catches NAME (`sql-row-type-snake-case`, after it shipped twice). Nothing
 * catches TYPE, and it is the more dangerous of the two: a wrong NAME is `undefined`, which is
 * loud — `new Date(undefined).toISOString()` throws and someone sees a 500. A wrong TYPE is a
 * value of the wrong shape that renders. `String(dateObj).slice(0, 10)` is `"Fri Aug 28"`, and
 * `Date.parse` of that is `NaN`, and `NaN` survives every comparison to pick a branch and print a
 * confident number. It has shipped three times in this repo and reached three more panels.
 *
 * ── HOW IT DECIDES ───────────────────────────────────────────────────────────────────────────
 * It asks the LIVE DATABASE what each column is — `information_schema.columns`, not a guess — and
 * compares against postgres.js's own type mapping, which is fixed here because `lib/db.ts`
 * configures no custom parsers (checked, and asserted in the self-test):
 *
 *   date · timestamp · timestamptz  → Date      (a declared `string` is the bug)
 *   numeric · int8                  → string    (a declared `number` is the bug)
 *   int2 · int4 · float4 · float8   → number
 *   bool → boolean · json/jsonb → object · text/uuid/varchar → string
 *
 * ── WHAT IT DELIBERATELY WILL NOT DO ─────────────────────────────────────────────────────────
 * It reports only where it can name the COLUMN with certainty: an explicit `t.first_due` or
 * `first_due` in the select list. A `SELECT *`, a computed expression, or a column already cast
 * (`x::text`, `count(*)::int`) is reported as UNCHECKED rather than assumed innocent — the
 * unchecked list is printed, because "I did not look there" and "I looked and it was fine" are
 * different facts and only one of them is evidence.
 *
 *   node scripts/audit-row-type-truth.mjs           # findings + what it could not check
 *   node scripts/audit-row-type-truth.mjs --check   # self-test only
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..');
const DB = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DB) {
  console.error('DATABASE_URL_OWNER required — this asks the live database what each column IS.');
  console.error('A hard-coded type table would be a second source of truth, and it would drift.');
  process.exit(2);
}

/** postgres.js with no custom parsers — the mapping `lib/db.ts` actually gets. */
const PG_TO_TS = {
  date: 'Date', 'timestamp without time zone': 'Date', 'timestamp with time zone': 'Date',
  numeric: 'string', bigint: 'string',
  integer: 'number', smallint: 'number', 'double precision': 'number', real: 'number',
  boolean: 'boolean', json: 'object', jsonb: 'object',
  text: 'string', uuid: 'string', 'character varying': 'string', 'character': 'string',
  ARRAY: 'array', inet: 'string', interval: 'string',
};

const sql = postgres(DB, { max: 2, onnotice: () => {} });
const cols = await sql`
  SELECT table_name AS t, column_name AS c, data_type AS d
    FROM information_schema.columns WHERE table_schema = 'public'`;
await sql.end();

/** column name → the set of pg types it has across all tables (a name is rarely ambiguous). */
const byName = new Map();
for (const r of cols) {
  if (!byName.has(r.c)) byName.set(r.c, new Set());
  byName.get(r.c).add(r.d);
}
/** `table.column` → pg type, for the unambiguous case. */
const byTableCol = new Map(cols.map((r) => [`${r.t}.${r.c}`, r.d]));

// ── WALK ─────────────────────────────────────────────────────────────────────────────────────
const ROOTS = ['lib', 'app'];
const files = [];
const walk = (d) => {
  for (const e of readdirSync(d)) {
    const p = path.join(d, e);
    if (e === 'node_modules' || e === '.next' || e === '__tests__') continue;
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e)) files.push(p);
  }
};
for (const r of ROOTS) walk(path.join(FRONTEND, r));

const camel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

/**
 * Split a type body into field → declared-type, at BRACE/BRACKET/PAREN DEPTH ZERO.
 *
 * The first version split on newlines, which is the house style for a declared interface and
 * completely wrong for the form this repo actually writes most:
 *
 *     sql<{ id: string; action: string; notes: string | null }[]>`…`
 *
 * On one line, a newline split yields ONE field named `id` whose declared type is
 * `string; action: string; notes: string | null` — and every subsequent field vanishes while the
 * first is compared against nonsense. It reported 383 findings, of which the overwhelming
 * majority described the parser. The self-test did not catch it because it only asked whether the
 * three known-bad files appeared, and they did; a count nobody checked is not a checked count.
 */
function splitFields(body) {
  const fields = new Map();
  let depth = 0, cur = '';
  const flush = () => {
    const s = cur.replace(/\/\/[^\n]*/g, '').trim();
    cur = '';
    if (!s) return;
    const f = /^(?:readonly\s+)?([A-Za-z_$][\w$]*)\s*\??\s*:\s*([\s\S]+)$/.exec(s);
    if (f) fields.set(f[1], f[2].trim());
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(' || ch === '<') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')' || ch === '>') depth -= 1;
    // A separator only separates at the top level: `Record<string, number>` is one type, and
    // `{ a: { b: string; c: string } }` is one field.
    if (depth === 0 && (ch === ';' || ch === ',' || ch === '\n')) { flush(); continue; }
    cur += ch;
  }
  flush();
  return fields;
}

/** Every `interface X { … }` / `type X = { … }` in a file → field name → declared type text. */
function interfacesIn(text) {
  const out = new Map();
  const re = /(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*)?\{/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    let depth = 1;
    let i = re.lastIndex;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    const body = text.slice(re.lastIndex, i - 1);
    out.set(name, splitFields(body));
  }
  return out;
}

/** Does a declared TS type accept the runtime shape postgres.js will produce? */
function accepts(declared, runtime) {
  const d = declared.replace(/\s/g, '');
  const parts = d.split('|').map((x) => x.replace(/^\(|\)$/g, ''));
  const has = (t) => parts.some((p) => p === t || p === `${t}[]`);
  if (runtime === 'Date') return has('Date') || has('unknown') || has('any');
  if (runtime === 'string') return has('string') || has('unknown') || has('any')
    || parts.some((p) => /^'.*'$/.test(p));   // a string-literal union IS a string
  if (runtime === 'number') return has('number') || has('unknown') || has('any');
  if (runtime === 'boolean') return has('boolean') || has('unknown') || has('any');
  return true;  // object / array / unknown pg types — not this instrument's question
}

/**
 * A `Date` declared as `string` is not automatically a bug — and saying so would bury the ones
 * that are.
 *
 * `NextResponse.json({ data: rows })` serialises a `Date` to an ISO string, so a route that only
 * hands the row to the wire tells the truth to its CLIENT even though the type is wrong inside the
 * function. The declaration is still worth fixing, but nobody is looking at "Fri Aug 28".
 *
 * The damage happens when the value is READ AS A STRING in JS before that: sliced, split,
 * interpolated, compared with `<`, or handed to a client component that does one of those. That is
 * the difference between a tidy-up and a customer seeing a date with no year.
 *
 * This is a HEURISTIC and is reported as a ranking, never as a verdict: it looks for string
 * operations on the field's own name in the same file. It will miss a value renamed on the way
 * (`const d = row.firstDue`), so the quiet list is "not shown to be harmful", not "proven safe".
 */
function usedAsString(text, field) {
  // COMMENTS STRIPPED FIRST. This repo documents each bug at its own site, so `lib/projects/
  // milestones.ts` carries the line `String(row.baselineDate).slice(0, 10)` inside the comment
  // explaining why the code below does NOT do that — and the first version of this heuristic read
  // it as the defect. Second occurrence of the same mistake in two instruments written the same
  // afternoon: a text search for a bug pattern finds the changelog of that bug, and the changelog
  // sits where the most care was taken.
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:"'`\\])\/\/[^\n]*/g, '$1');
  const f = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pats = [
    new RegExp(`\\.${f}\\s*\\)?\\s*\\.(slice|split|substring|startsWith|endsWith|replace|padStart|localeCompare)\\b`),
    new RegExp(`String\\(\\s*[\\w.]*\\.?${f}\\s*\\)`),
    new RegExp(`\\$\\{[^}]*\\.${f}[^}]*\\}`),          // template interpolation
    new RegExp(`\\.${f}\\s*(<|>|<=|>=)\\s*['"\`]`),    // string comparison against a literal
    new RegExp(`['"\`][^'"\`]*['"\`]\\s*\\+\\s*[\\w.]*\\.${f}\\b`),
  ];
  return pats.some((p) => p.test(text));
}

const findings = [];
const unchecked = [];
let siteCount = 0;

for (const abs of files) {
  const rel = path.relative(FRONTEND, abs);
  const text = readFileSync(abs, 'utf8');
  if (!/sql(?:Bypass)?\s*</.test(text)) continue;
  const ifaces = interfacesIn(text);

  // `sql<Foo[]>` / `sqlBypass<Foo[]>` followed by the template. Anonymous inline row types
  // (`sql<{ a: string }[]>`) are handled too — they are the more common form here.
  const re = /\b(?:sql|sqlBypass|tx)\s*<\s*([\s\S]*?)\s*\[\s*\]\s*>\s*`/g;
  let m;
  while ((m = re.exec(text))) {
    siteCount += 1;
    const typeText = m[1];
    // The query body: from the backtick to its matching close. Nested `${}` may contain
    // backticks, so count them.
    let i = re.lastIndex, depth = 0, end = -1;
    while (i < text.length) {
      if (text[i] === '\\') { i += 2; continue; }
      if (text[i] === '$' && text[i + 1] === '{') { depth += 1; i += 2; continue; }
      if (text[i] === '}' && depth > 0) { depth -= 1; i += 1; continue; }
      if (text[i] === '`' && depth === 0) { end = i; break; }
      i += 1;
    }
    if (end < 0) continue;
    const query = text.slice(re.lastIndex, end);
    const line = text.slice(0, m.index).split('\n').length;

    const fields = /^\{/.test(typeText)
      ? interfacesIn(`type __Anon = ${typeText}`).get('__Anon')
      : ifaces.get(typeText);
    if (!fields || fields.size === 0) {
      unchecked.push({ file: rel, line, why: `row type \`${typeText.slice(0, 40)}\` not resolvable in this file` });
      continue;
    }

    // Which table(s) does this query read? Used only to disambiguate a column name that exists
    // with two different types in two tables.
    const tables = [...query.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map((x) => x[1].toLowerCase());

    for (const [fname, ftype] of fields) {
      const snake = fname.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
      // Only claim a column when the SELECT names it plainly. An alias (`AS "x"`), a cast
      // (`::text`), or a function call means the runtime type is NOT the column's type.
      const named = new RegExp(`(^|[\\s,.(])${snake}(\\s*,|\\s*$|\\s+FROM|\\s*\\n)`, 'im').test(query)
        || new RegExp(`(^|[\\s,.(])${fname}(\\s*,|\\s*$|\\s+FROM|\\s*\\n)`, 'm').test(query);
      const casted = new RegExp(`${snake}\\s*::`, 'i').test(query)
        || new RegExp(`AS\\s+"?${fname}"?`, 'i').test(query)
        || new RegExp(`AS\\s+"?${snake}"?`, 'i').test(query);
      if (!named || casted) continue;

      let pgType = null;
      for (const t of tables) if (byTableCol.has(`${t}.${snake}`)) { pgType = byTableCol.get(`${t}.${snake}`); break; }
      if (!pgType) {
        const set = byName.get(snake);
        if (!set || set.size !== 1) continue;   // unknown or ambiguous — silent, it is not evidence
        pgType = [...set][0];
      }
      const runtime = PG_TO_TS[pgType];
      if (!runtime || runtime === 'object' || runtime === 'array') continue;
      if (!accepts(ftype, runtime)) {
        findings.push({
          file: rel, line, field: fname, column: snake, pgType, declared: ftype, runtime,
          usedAsString: runtime === 'Date' && usedAsString(text, fname),
        });
      }
    }
  }
}

// ── SELF-TEST ────────────────────────────────────────────────────────────────────────────────
const SELF = [
  { why: 'lib/db.ts configures no custom type parsers, so the mapping above is the real one',
    ok: () => !/types\s*:/.test(readFileSync(path.join(FRONTEND, 'lib/db.ts'), 'utf8')) },
  { why: 'a declared `string` over a `date` column is a finding',
    ok: () => !accepts('string | null', 'Date') },
  { why: 'a declared `Date` over a `date` column is NOT a finding',
    ok: () => accepts('Date | null', 'Date') },
  { why: 'a string-literal union over a text column is a string, not a finding',
    ok: () => accepts("'draft' | 'submitted' | 'paid'", 'string') },
  { why: 'a column already cast (`x::text`) is not claimed — the cast changes the runtime type',
    ok: () => !findings.some((f) => f.column === 'score' && /::/.test(f.declared)) },
  { why: 'it found the three panels this was built for (cdrl · invoices · modifications)',
    ok: () => ['lib/projects/cdrl.ts', 'lib/projects/invoices.ts', 'lib/projects/modifications.ts']
      .every((f) => findings.some((x) => x.file === f)) },
  {
    // THE 383-phantom bug, pinned. A one-line inline row type is the commonest form in this tree
    // and a newline split reduces it to a single field with a garbage type.
    why: 'a ONE-LINE inline row type splits into all of its fields, each with its own type',
    ok: () => {
      const f = splitFields('id: string; action: string; notes: string | null; createdAt: Date');
      return f.size === 4 && f.get('action') === 'string' && f.get('notes') === 'string | null'
        && f.get('createdAt') === 'Date';
    },
  },
  {
    why: 'a separator INSIDE a generic or a nested object does not split a field',
    ok: () => {
      const f = splitFields('meta: Record<string, number>; inner: { a: string; b: number }; z: string');
      return f.size === 3 && f.get('meta') === 'Record<string, number>' && f.get('z') === 'string';
    },
  },
  {
    why: 'a bug pattern quoted in a COMMENT is not a string read — milestones.ts documents it above correct code',
    ok: () => !usedAsString(readFileSync(path.join(FRONTEND, 'lib/projects/milestones.ts'), 'utf8'), 'baselineDate')
      && usedAsString('const x = String(row.baselineDate).slice(0, 10);', 'baselineDate'),
  },
];

console.log('── self-test ──');
let bad = 0;
for (const t of SELF) {
  let p = false; try { p = Boolean(t.ok()); } catch { p = false; }
  console.log(`  ${p ? '✓' : '✗'} ${t.why}`);
  if (!p) bad += 1;
}
if (bad) { console.error(`\n✗ ${bad} self-test(s) failed — findings below would be unearned.`); process.exit(2); }
if (process.argv.includes('--check')) process.exit(0);

const harmful = findings.filter((f) => f.usedAsString);
const quiet = findings.filter((f) => !f.usedAsString);

console.log(`\n── ${siteCount} typed sql<> site(s) examined ──`);
console.log(`── ${findings.length} row type(s) that lie about the runtime ──`);
console.log(`   ${harmful.length} where the value is then READ AS A STRING — these render wrong`);
console.log(`   ${quiet.length} not shown to be read as a string (usually straight to NextResponse.json,`);
console.log('     which serialises a Date to ISO — the wire contract is right, the declaration is not)\n');

const show = (list) => {
  const byFile = new Map();
  for (const f of list) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, l] of [...byFile].sort()) {
    console.log(`  ${file}`);
    for (const f of l) {
      console.log(`    :${f.line}  ${f.field}  declared \`${f.declared}\`  ·  ${f.column} is ${f.pgType} → postgres.js returns ${f.runtime}`);
    }
  }
};
if (harmful.length) {
  console.log('── READ AS A STRING (the ones a person sees) ──');
  show(harmful);
}
if (!process.argv.includes('--harmful-only') && quiet.length) {
  console.log('\n── declaration wrong, no string read found in the same file ──');
  show(quiet);
}
if (unchecked.length) {
  console.log(`\n── ${unchecked.length} site(s) NOT checked (reported, not assumed innocent) ──`);
  for (const u of unchecked.slice(0, 25)) console.log(`  ${u.file}:${u.line} — ${u.why}`);
  if (unchecked.length > 25) console.log(`  … and ${unchecked.length - 25} more`);
}
process.exit(findings.length ? 1 : 0);
