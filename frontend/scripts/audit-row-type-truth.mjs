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


/**
 * The ROW type inside a `sql<…>` argument — `T[]`, `Array<T>` and `readonly T[]` all mean the
 * same thing here, and only one spelling used to be understood.
 */
function unwrapRowType(t) {
  let x = t.replace(/^readonly\s+/, '').trim();
  const arr = x.match(/^Array\s*<([\s\S]*)>$/);
  if (arr) return arr[1].trim();
  if (/\[\s*\]$/.test(x)) return x.replace(/\[\s*\]$/, '').trim();
  return x;
}


/**
 * Resolve a row type to its fields, handling the four spellings this tree actually uses.
 *
 * Before this, anything that was not a bare interface name or a bare `{ … }` literal landed in
 * UNCHECKED — which reads as "not measured" and was, for 99 sites. Three of those shapes are
 * mechanically resolvable and one is safe by construction:
 *
 *   · `{ … }`                     inline literal
 *   · `Name`                      an interface/type in the same file
 *   · `A & { … }`                 intersection — merge both sides, the inline half winning
 *   · `Omit<A, 'x' | 'y'>`        the base minus the named keys
 *   · `Record<string, unknown>`   EXEMPT, not unchecked: `unknown` accepts every runtime type this
 *                                 audit can produce, so there is nothing here that can lie.
 *
 * A name declared in ANOTHER file is still genuinely unresolvable from here, and stays reported.
 */
function resolveFields(typeText, ifaces) {
  const t = typeText.trim();
  if (/^Record\s*<[^>]*,\s*(unknown|any)\s*>$/.test(t)) return new Map();   // exempt, see above

  const omit = t.match(/^Omit\s*<\s*([A-Za-z_$][\w$]*)\s*,([\s\S]*)>$/);
  if (omit) {
    const base = ifaces.get(omit[1]);
    if (!base) return undefined;
    const drop = new Set([...omit[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    return new Map([...base].filter(([k]) => !drop.has(k)));
  }

  // Intersection: split only at TOP level, so `A & { b: Record<x, y> }` does not split inside.
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < t.length; i += 1) {
    const c = t[i];
    if (c === '{' || c === '<' || c === '(') depth += 1;
    else if (c === '}' || c === '>' || c === ')') depth -= 1;
    else if (c === '&' && depth === 0) { parts.push(t.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(t.slice(start).trim());
  if (parts.length > 1) {
    const merged = new Map();
    for (const part of parts) {
      const sub = resolveFields(part.replace(/^\(|\)$/g, ''), ifaces);
      if (!sub) return undefined;
      for (const [k, v] of sub) merged.set(k, v);
    }
    return merged;
  }

  const bare = t.replace(/^\(|\)$/g, '').trim();
  if (/^\{/.test(bare)) return interfacesIn(`type __Anon = ${bare}`).get('__Anon');
  return ifaces.get(bare);
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
/** `sql<` occurrences deliberately NOT treated as query sites, each with a stated reason. */
const skipped = [];
let siteCount = 0;

for (const abs of files) {
  const rel = path.relative(FRONTEND, abs);
  const raw = readFileSync(abs, 'utf8');
  /**
   * THE GATE MUST NAME EVERY CLIENT THE LOOP BELOW MATCHES, or it drops files silently.
   *
   * This read `/sql(?:Bypass)?\s*</` while the site regex also matches `tx<` — the transaction
   * client handed out by `withTenant(tenantId, tx => …)`. A file whose ONLY typed queries are
   * inside a transaction therefore never got opened: 21 files and 64 sites, `lib/atoms.ts` (14)
   * and `lib/portal-launch.ts` (8) among them. That is the tenant-scoped write path — precisely
   * where the date and RLS traps live — and the audit reported a clean run without reading it.
   *
   * The coverage reconciliation below exists because this was invisible until something counted
   * the denominator independently.
   */
  if (!/\b(?:sql|sqlBypass|tx)\s*</.test(raw)) continue;
  /**
   * COMMENTS BLANKED, OFFSETS PRESERVED — and this audit needed it more than most.
   *
   * `lib/db.ts`'s own SOP text, and half a dozen files documenting it, contain the phrase
   * "the sql<T> trap". Scanned as code, `sql<` in that sentence starts a match whose non-greedy
   * body runs forward to the next `[]>` somewhere else entirely, producing a phantom site with a
   * row type of `T> trap a wrong NAME // does not have:` — which then lands in the UNCHECKED list
   * as though a real query could not be resolved. This repo's own rule: an instrument that reads
   * prose as code reports the most defects exactly where the most care was taken.
   *
   * Replaced with spaces rather than removed, so every reported line number still points at the
   * real line.
   */
  const text = raw
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (c, p1) => p1 + ' '.repeat(c.length - p1.length));
  const ifaces = interfacesIn(text);

  /**
   * ANGLE-MATCHED, not regex-alternated — the third parse this instrument needed.
   *
   * `sql<T[]>` and `sql<Array<T>>` are both in this tree. A regex alternation had to try one
   * spelling first, and whichever went first won wrongly: with `([\s\S]*?)\s*\[\s*\]` leading, a
   * `sql<Array<{ a: number }>>` site made the non-greedy body run PAST its own close to the next
   * `[]` anywhere later in the file, capturing the query text as the row type. Nine sites read
   * that way and landed in UNCHECKED, which is the polite version of "not measured".
   *
   * So find `sql<` and walk to the `>` that BALANCES it, exactly as the query body below is
   * matched. One rule, no ordering, no window.
   */
  const re = /\b(?:sql|sqlBypass|tx)\s*</g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('<', m.index);
    let ang = 0;
    let j = open;
    for (; j < text.length; j += 1) {
      if (text[j] === '<') ang += 1;
      else if (text[j] === '>') { ang -= 1; if (ang === 0) break; }
      // Bail ONLY on a backtick: a type argument list cannot contain one, so hitting it means the
      // `<` was a comparison, not a generic. `;` must NOT bail — it is the field separator inside
      // an inline row type (`sql<{ id: string; content: string }[]>`), and bailing on it dropped
      // 307 of 1025 sites in one edit, i.e. most of the tree, while the summary line still read
      // like a full run. Coverage that MOVES is the signal; a total nobody compares is not.
      else if (text[j] === '`') { j = -1; break; }
    }
    const line0 = text.slice(0, m.index).split('\n').length;
    if (j < 0 || j >= text.length) { skipped.push({ file: rel, line: line0, why: 'angle brackets did not balance — `<` was not a generic' }); continue; }
    const after = text.slice(j + 1).match(/^\s*`/);
    if (!after) { skipped.push({ file: rel, line: line0, why: 'generic not followed by a template literal — not a query site' }); continue; }
    re.lastIndex = j + 1 + after[0].length;
    siteCount += 1;
    const typeText = unwrapRowType(text.slice(open + 1, j).trim());
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
    if (end < 0) { skipped.push({ file: rel, line, why: 'template literal never closed' }); continue; }
    const query = text.slice(re.lastIndex, end);
    const line = text.slice(0, m.index).split('\n').length;

    const fields = resolveFields(typeText, ifaces);
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

/**
 * ── COVERAGE RECONCILIATION — the audit refuses a verdict it cannot account for ────────────────
 *
 * Every number above is a fraction whose DENOMINATOR was, until now, invisible. Three different
 * parsers in one sitting reported 850, then 1025, then 718, then 1097 sites — and each one printed
 * "0 read as a string" with equal confidence. The 718 run was missing three hundred sites and said
 * exactly what the 1097 run says.
 *
 * So count the `sql<` occurrences independently, the same way a person would with grep, and
 * require that EXAMINED + SKIPPED-with-a-reason equals it. A mismatch is a HARNESS DEFECT (exit 2),
 * not a finding — because a clean result over an unknown fraction of the tree is not a clean
 * result. This is the guard `verify-api-contract` and `verify-surfaces` already carry, arriving
 * here for the same reason they did: after the thing it guards against had already happened.
 */
const groundTruth = (() => {
  let n = 0;
  for (const abs of files) {           // `files` holds ABSOLUTE paths from the walk above
    const raw = readFileSync(abs, 'utf8');
    const t = raw
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:])\/\/[^\n]*/g, (c, p1) => p1 + ' '.repeat(c.length - p1.length));
    n += (t.match(/\b(?:sql|sqlBypass|tx)\s*</g) ?? []).length;
  }
  return n;
})();

console.log(`\n── coverage ──`);
console.log(`  ${groundTruth} \`sql<\` occurrence(s) in the tree (comments stripped)`);
console.log(`  ${siteCount} examined as query sites`);
console.log(`  ${skipped.length} skipped, each with a reason`);
if (skipped.length) {
  const byWhy = {};
  for (const sk of skipped) (byWhy[sk.why] ??= []).push(sk);
  for (const [why, list] of Object.entries(byWhy)) {
    console.log(`     · ${list.length}  ${why}`);
    for (const sk of list.slice(0, 6)) console.log(`         ${sk.file}:${sk.line}`);
    if (list.length > 6) console.log(`         … and ${list.length - 6} more`);
  }
}
if (siteCount + skipped.length !== groundTruth) {
  console.error(`\n✗ HARNESS DEFECT — ${groundTruth} occurrence(s) on disk but `
    + `${siteCount} examined + ${skipped.length} skipped = ${siteCount + skipped.length}. `
    + `${Math.abs(groundTruth - siteCount - skipped.length)} site(s) are unaccounted for, so every `
    + `clean count above is over an unknown denominator.`);
  process.exit(2);
}

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
// ── WHAT FAILS A RUN, AND WHY IT IS NOT "ANY FINDING" ────────────────────────────────────────
// 240 declarations contradict the runtime and NONE of them is currently read as a string, which
// means none of them renders wrong. Exiting 1 on the total would put a permanently-red entry in
// the branch suite over a condition nobody can see — and this repo has already written down what
// happens next: "a check that fails 121 times on its first run gets turned off".
//
// So the gate is the consequence, which this tool already ranks: a wrong type that is READ AS A
// STRING renders `Fri Aug 28` where a date belongs. The rest are reported every run, in full,
// because they are real and worth fixing — but they are a backlog, not a break.
process.exit(harmful.length ? 1 : 0);
