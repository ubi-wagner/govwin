#!/usr/bin/env node
/**
 * audit-empty-not-null — every SQL predicate that mistakes an EMPTY container for a missing one.
 *
 * ── THE CLASS, AND THE MEASUREMENT THAT NAMED IT ─────────────────────────────────────────────
 * `opportunities.naics_codes` is NOT NULL on 22 of 22 rows and NON-EMPTY on ZERO. Every row holds
 * `'{}'` — a real, present, empty array. So:
 *
 *     count(naics_codes)              → 22     "every opportunity has NAICS codes"
 *     WHERE naics_codes IS NOT NULL   → 22     "all of them"
 *     array_length(naics_codes,1) > 0 →  0     the truth
 *
 * The first two are the ones people write. They do not error, they do not warn, and they answer a
 * different question than the one asked — which is how a bucket criterion weighted at 29% of a
 * customer's ranking reached exactly nothing while the page reported it as present.
 *
 * Same shape for jsonb: `'{}'::jsonb` and `'[]'::jsonb` are non-null. `card->'highlights'` returns
 * a jsonb NULL for an absent key and `'null'::jsonb` for a JSON null, and `IS NOT NULL` is true for
 * the second — three states where the author was thinking of two.
 *
 * ── WHAT IT DOES ─────────────────────────────────────────────────────────────────────────────
 * Reads the LIVE schema for which columns are ARRAY or jsonb (146 of them), then scans every SQL
 * string in the tree for a null-test or a count over one of those columns. It reports file, line,
 * the column, its type, and the form that answers the intended question.
 *
 * ── AND IT VALIDATES ITSELF FIRST ────────────────────────────────────────────────────────────
 * The instrument before the finding: a new harness's first output describes the HARNESS. Six
 * hand-verified cases run before any file is read — three that must be flagged and three that must
 * not — and a mismatch exits 2 as a HARNESS DEFECT, because every clean below would be unearned.
 *
 * ⚠️ Read-only. Needs DATABASE_URL_OWNER for the column types.
 *
 * Usage:  node frontend/scripts/audit-empty-not-null.mjs [--all]
 *           --all   also list the LOW-confidence hits (a bare column name that matches an
 *                   array/jsonb column on some table, with no table qualifier to confirm it)
 */

import postgres from 'postgres';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const SHOW_ALL = process.argv.includes('--all');

const SCAN_DIRS = [
  'frontend/lib', 'frontend/app', 'frontend/components', 'frontend/scripts',
  'pipeline/src', 'services/cms/src', 'db/migrations',
];
const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'coverage', '__pycache__', '.venv']);
const EXTS = /\.(ts|tsx|mts|mjs|js|py|sql)$/;

/**
 * The suggested fix per type. Stated as the QUESTION each form answers, because the bug is never a
 * typo — it is someone asking "is it present" when they meant "does it contain anything".
 */
const FIX = {
  ARRAY: 'COALESCE(array_length(col, 1), 0) > 0',
  jsonb: "jsonb_typeof(col) = 'array' AND jsonb_array_length(col) > 0   (or col <> '{}'::jsonb)",
};

/** Every null-test / count shape worth flagging, with the capture group holding the column ref. */
const PATTERNS = [
  { re: /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL/gi, qualified: true, kind: 'IS NOT NULL' },
  { re: /(?<![.\w])([a-z_][a-z0-9_]*)\s+IS\s+NOT\s+NULL/gi, qualified: false, kind: 'IS NOT NULL' },
  { re: /\bcount\(\s*([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s*\)/gi, qualified: true, kind: 'count(col)' },
  { re: /\bcount\(\s*(?!\*)([a-z_][a-z0-9_]*)\s*\)/gi, qualified: false, kind: 'count(col)' },
  { re: /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\s+IS\s+NULL\b/gi, qualified: true, kind: 'IS NULL' },
];

/**
 * A line that already guards correctly, or that cannot be the bug.
 *
 * The `IS NOT NULL` inside a `COALESCE(array_length(...))` line is the CORRECT form, and flagging it
 * would train people to ignore this tool — which is the only way a lens like this actually fails.
 */
const ALREADY_CORRECT = new RegExp([
  "array_length", "jsonb_array_length", "jsonb_typeof", "cardinality\\s*\\(",
  "<>\\s*'\\{\\}'", "<>\\s*'\\[\\]'", "!=\\s*'\\{\\}'", "@>", "\\?\\s*'",
  // The long-hand guard, which is correct and was being flagged:
  //   ai_extracted IS NOT NULL AND ai_extracted::text NOT IN ('null', '{}', '[]', '\"\"')
  "NOT\\s+IN\\s*\\([^)]*'\\{\\}'",
  "::text\\s*(!=|<>)\\s*'(null|\\{\\}|\\[\\])'",
].join("|"), "i");

/**
 * A PROSE line, not a query.
 *
 * The first clean run flagged `* ... No \`card IS NOT NULL\` ...` — a comment in this repo's own
 * house style, explaining why that predicate was deliberately omitted. A lens that reports the
 * documentation of a decision as an instance of the defect is a lens people learn to ignore.
 */
const IS_COMMENT = /^\s*(\/\/|\*|#(?!\s*\{)|--\s*[A-Z])/;

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st; try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/** Flag one line against the type map. Pure, so the self-test can drive it directly. */
export function scanLine(line, byTable, byName, byNameAll = new Map()) {
  if (ALREADY_CORRECT.test(line) || IS_COMMENT.test(line)) return [];
  const hits = [];
  for (const { re, qualified, kind } of PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      const col = qualified ? m[2] : m[1];
      const label = qualified ? `${m[1]}.${m[2]}` : col;
      const types = byName.get(col);
      if (!types) continue;
      /*
       * ⚠️ AN ALIAS IS NOT A TABLE, AND A COLUMN NAME IS NOT A TYPE.
       *
       * The first version resolved a qualified hit by COLUMN NAME and reported the type it found as
       * fact. Its first run confidently flagged nine `s.content IS NOT NULL` sites as jsonb —
       * `content` IS jsonb, on `canvas_versions`. On `proposal_sections`, `library_atoms`,
       * `episodic_memories`, `proposal_comments` and `semantic_memories` it is TEXT, and every one
       * of those nine was a text column where `IS NOT NULL` is exactly right.
       *
       * The self-test passed anyway, because both cases I hand-verified (`naics_codes`, `card`)
       * happen to be unique names. A shared name is the case that breaks it, and `content` is the
       * most-reused column name in the tree — so the instrument's first output was a description of
       * the instrument, as the rule says it would be.
       *
       * A name that is array/jsonb on EVERY table carrying it is a sound finding. A name that is
       * jsonb here and text there cannot be resolved without parsing the FROM clause, so it is
       * reported as ambiguous rather than asserted.
       */
      const all = [...types];
      const container = all.filter((t) => t === 'ARRAY' || t === 'jsonb');
      // Confidence follows the NAME, not the syntax. A qualifier looks reassuring and tells us
      // nothing — `s.` could be any of six tables — while a name that is a container on every table
      // carrying it is sound whether or not it was written with one. `naics_codes` is only ever an
      // array, so `count(naics_codes)` is as solid a finding as `o.naics_codes IS NOT NULL`.
      const ambiguous = (byNameAll.get(col)?.size ?? 0) > types.size;
      if (container.length > 0 && !ambiguous) {
        hits.push({ col: label, type: all.join('|'), kind, confidence: 'high' });
      } else {
        hits.push({
          col: label,
          type: ambiguous ? `${all.join('|')} — but also ${[...byNameAll.get(col)].filter((t) => !types.has(t)).join('/')} elsewhere` : all.join('|'),
          kind,
          confidence: ambiguous ? 'ambiguous' : 'low',
        });
      }
    }
  }
  // De-duplicate: the qualified and unqualified patterns both match `o.naics_codes IS NOT NULL`.
  const seen = new Set();
  return hits.filter((h) => {
    const key = h.col.split('.').pop() + h.kind;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Hand-verified answers. If these do not hold, nothing below them is worth reading. */
function selfTest(byTable, byName, byNameAll) {
  const cases = [
    // [line, mustFlag, why]
    ["WHERE o.naics_codes IS NOT NULL", true, 'the exact defect that motivated this tool'],
    ["SELECT count(naics_codes) FROM opportunities", true, 'count(col) skips NULL, not empty'],
    ["AND c.card IS NOT NULL", true, 'jsonb: {} and [] are both non-null'],
    ["WHERE COALESCE(array_length(naics_codes,1),0) > 0", false, 'the correct form must not be flagged'],
    ["WHERE o.close_date IS NOT NULL", false, 'a scalar column is not this class'],
    ["SELECT count(*) FROM opportunities", false, 'count(*) counts rows, not values'],
    // The case that broke the first version: `content` is jsonb on canvas_versions and TEXT on five
    // other tables, so a qualified hit on it must NOT be asserted as a container finding.
    ["AND s.content IS NOT NULL", false, 'a name that is jsonb here and text there is not a finding'],
  ];
  const bad = [];
  for (const [line, mustFlag, why] of cases) {
    const flagged = scanLine(line, byTable, byName, byNameAll)
      .filter((h) => h.confidence === 'high').length > 0;
    if (flagged !== mustFlag) bad.push(`  ${flagged ? 'FLAGGED' : 'missed '}  ${line}\n            expected ${mustFlag ? 'a flag' : 'silence'} — ${why}`);
  }
  return bad;
}

async function main() {
  const sql = postgres(OWNER, { max: 2 });
  let cols;
  try {
    cols = await sql`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type IN ('ARRAY', 'jsonb')`;
  } catch (e) {
    console.error('\nHARNESS CANNOT RUN: could not read the live schema — the column types are the\n' +
      'whole basis of this audit, and guessing them would manufacture findings.\n', e.message);
    process.exit(2);
  } finally {
    await sql.end();
  }

  const byTable = new Map();   // "table.column" → type
  const byName = new Map();    // "column" → Set(type), CONTAINER types only
  for (const c of cols) {
    byTable.set(`${c.table_name}.${c.column_name}`, c.data_type);
    if (!byName.has(c.column_name)) byName.set(c.column_name, new Set());
    byName.get(c.column_name).add(c.data_type);
  }
  // Every type each NAME carries anywhere in the schema — the map that catches `content`, which is
  // jsonb on canvas_versions and text on five other tables. Without it a name collision is reported
  // as a confident finding about a column of a different type entirely.
  let byNameAll = new Map();
  try {
    const sql2 = postgres(OWNER, { max: 2 });
    const allCols = await sql2`
      SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`;
    await sql2.end();
    for (const c of allCols) {
      if (!byNameAll.has(c.column_name)) byNameAll.set(c.column_name, new Set());
      byNameAll.get(c.column_name).add(c.data_type);
    }
  } catch {
    console.error('HARNESS CANNOT RUN: could not read the full column list — without it a shared\n' +
      'column name is reported as a confident finding about a different table.');
    process.exit(2);
  }

  console.log(`\naudit-empty-not-null — ${cols.length} array/jsonb columns, ${byName.size} distinct names\n`);

  const bad = selfTest(byTable, byName, byNameAll);
  if (bad.length > 0) {
    console.error('HARNESS DEFECT — the self-test does not hold, so every clean below would be unearned:\n');
    console.error(bad.join('\n'));
    process.exit(2);
  }
  console.log('  ✓ self-test: 7 hand-verified cases hold (3 flagged, 4 silent)\n');

  const files = SCAN_DIRS.flatMap((d) => walk(join(ROOT, d)));
  const findings = [];
  for (const file of files) {
    // This file's own fixtures ARE the defect, deliberately — flagging them would be the tool
    // reporting on its own test data as if it were product code.
    if (file.endsWith('audit-empty-not-null.mjs')) continue;
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    text.split('\n').forEach((line, i) => {
      for (const hit of scanLine(line, byTable, byName, byNameAll)) {
        findings.push({ file: relative(ROOT, file), line: i + 1, text: line.trim(), ...hit });
      }
    });
  }

  /*
   * APPLIED MIGRATIONS ARE A SEPARATE CATEGORY, NOT A SILENT SKIP.
   *
   * A migration is a one-time data patch that already ran; its `IS NOT NULL` usually MEANT "every
   * row where this column was ever set", which is the right question, and editing the file now
   * would change a checksum to alter SQL that will never execute again. But dropping them from the
   * output entirely would hide a real instance if one ever mattered — so they are counted and
   * listed under their own heading, and left out of the actionable total.
   */
  const migrations = findings.filter((f) => f.confidence === 'high' && f.file.startsWith('db/migrations/'));
  const high = findings.filter((f) => f.confidence === 'high' && !f.file.startsWith('db/migrations/'));
  const low = findings.filter((f) => f.confidence === 'low');
  const ambiguous = findings.filter((f) => f.confidence === 'ambiguous');
  const show = SHOW_ALL ? findings : high;
  if (high.length === 0) console.log('  ✓ no live query mistakes an empty container for a missing one\n');

  const byFile = new Map();
  for (const f of show) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`${file}`);
    for (const f of list) {
      console.log(`  ${String(f.line).padStart(5)}  ${f.kind.padEnd(12)} ${f.col}  [${f.type}]`);
      console.log(`         ${f.text.slice(0, 110)}`);
    }
    console.log('');
  }

  console.log(`${files.length} file(s) scanned`);
  console.log(`${high.length} actionable hit(s) in live code`);
  console.log(`${migrations.length} in APPLIED MIGRATIONS — one-time patches that already ran; listed for the record,`);
  console.log(`               not editable (${[...new Set(migrations.map((m) => m.file.split('/').pop()))].join(', ') || 'none'})`);
  console.log(`${ambiguous.length} ambiguous — the column name is a container on one table and a scalar on another,`);
  console.log(`               which cannot be resolved without parsing the FROM clause`);
  console.log(`${low.length} unqualified hit(s) — a bare name matching an array/jsonb column somewhere` +
    `${SHOW_ALL ? '' : ' (--all to list)'}`);
  if (high.length > 0) {
    console.log(`\nThe form that answers the intended question:`);
    console.log(`  ARRAY  ${FIX.ARRAY}`);
    console.log(`  jsonb  ${FIX.jsonb}`);
    console.log(`\nNot every hit is a bug: testing whether a jsonb column was EVER SET is a legitimate`);
    console.log(`question, and IS NOT NULL is the right way to ask it. The hits worth fixing are the`);
    console.log(`ones where the author meant "does it contain anything".`);
  }
  // Advisory by design: this reports a shape, and only a person can say which reading was meant.
  process.exit(0);
}

main().catch((e) => { console.error('\nAUDIT ERROR:', e); process.exit(2); });
