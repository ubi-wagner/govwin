/**
 * audit-card-fields — is "declared, documented, and written by nothing" systemic?
 *
 * Three fields in this work were shipped that way: the highlight `excerpt`, the `card_tsv` index,
 * and `tenant_opportunity_documents.pinned_key`. Each was found by hand, one at a time, by running
 * something and noticing. That is not a method — it is luck with good habits, and it does not scale
 * past the field I happened to look at.
 *
 * So this asks the question for EVERY field of the OPP card and every column of the mirror tables,
 * in the only two directions that matter:
 *
 *     IS IT WRITTEN?   does any code path put a value there
 *     IS IT READ?      does any code path take one out
 *
 * and reports the four states separately, because they are four different problems:
 *
 *     LIVE          written and read
 *     WRITE-ONLY    written, read by nothing — cost with no consumer
 *     DRY           declared, written by nothing — the bug class above
 *     ORPHAN        populated in the database, in no interface — schema drift
 *
 * ── TWO RULES IT FOLLOWS, BOTH LEARNED THE HARD WAY ──────────────────────────────────────────
 * Comments are stripped before asking what a file DOES. A naive grep for `card_tsv` counted the
 * comment explaining that nothing reads it as a reader, and reported the column as used.
 *
 * And a field is only DRY if it is declared somewhere. A column nobody declared and nobody writes
 * is not a dry field, it is dead schema, and mixing them makes both numbers useless.
 *
 * Read-only.
 *
 * Usage:  node frontend/scripts/audit-card-fields.mjs
 * Exit:   0 clean · 1 something is dry
 */

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(ROOT, '..');
const sql = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

// ── The corpus of code, with comments removed ──────────────────────────────────────────────────
function stripComments(text, py = false) {
  let s = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (py) s = s.replace(/'''[\s\S]*?'''|"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '');
  return s;
}
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (/\.(ts|tsx|py)$/.test(e.name)) out.push(f);
  }
  return out;
}
const FILES = [
  ...walk(path.join(ROOT, 'lib')), ...walk(path.join(ROOT, 'app')),
  ...walk(path.join(ROOT, 'components')), ...walk(path.join(REPO, 'pipeline/src')),
].map((f) => ({ f, code: stripComments(fs.readFileSync(f, 'utf8'), f.endsWith('.py')) }));

const BRIDGE = fs.readFileSync(path.join(ROOT, 'lib/opportunity-bridge.ts'), 'utf8');
const rel = (f) => path.relative(REPO, f);

/** Files whose CODE mentions the token, excluding the file that merely declares it. */
const mentions = (token, exclude = []) =>
  FILES.filter(({ f, code }) => !exclude.some((x) => f.endsWith(x)) && code.includes(token)).map(({ f }) => rel(f));

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);

console.log('\naudit-card-fields — written? read? and are those the same fields?\n');

// ══ 1 · THE CARD PAYLOAD ═══════════════════════════════════════════════════════════════════════
// Declared fields come from the OppCard interface; written fields from the object literal
// buildCardSnapshot returns. The two being different IS the bug this exists to find.
const ifaceBody = BRIDGE.slice(BRIDGE.indexOf('export interface OppCard {'));
const declared = [...ifaceBody.slice(0, ifaceBody.indexOf('\n}')).matchAll(/^\s{2}(\w+)[?]?:/gm)].map((m) => m[1]);
const ret = BRIDGE.slice(BRIDGE.indexOf('    return {\n      opportunityId,'));
const retBody = ret.slice(0, ret.indexOf('\n    };'));
// BOTH forms. `field: value` and the shorthand `field,` — the first version matched only the
// colon form and duly reported `frozenAt` as declared-and-unwritten when it is written on the very
// line the regex skipped. An audit's first output describes the audit.
const written = new Set([
  ...[...retBody.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]),
  ...[...retBody.matchAll(/^\s{6}(\w+),\s*$/gm)].map((m) => m[1]),
]);

const [live] = await sql`
  SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE archived_at IS NULL`;
const rows = [];
for (const f of declared) {
  const [{ present }] = await sql`
    SELECT count(*)::int AS present FROM tenant_opportunity_cards
    WHERE archived_at IS NULL AND card ? ${f}
      AND card->>${f} IS DISTINCT FROM NULL AND card->>${f} <> ''`;
  /**
   * Who READS this field — deliberately over-inclusive.
   *
   * The first version looked only for `card.field` and a quoted name in four named files, and
   * reported 22 of 44 fields as read by nobody — including `complianceSummary`, which the portal
   * renders. In a usage audit the FALSE NEGATIVE is the dangerous direction: a field wrongly
   * called unused invites someone to delete something the product depends on, and nothing argues
   * back. A false positive just gets checked and dismissed.
   *
   * So: any property access, any bracket or quoted key, anywhere in the tree. Common English
   * names (`title`, `description`) will over-count, and that is the intended error.
   */
  const readers = [
    ...mentions(`.${f}`, ['opportunity-bridge.ts']),
    ...mentions(`'${f}'`, ['opportunity-bridge.ts']),
    ...mentions(`"${f}"`, ['opportunity-bridge.ts']),
  ];
  rows.push({ f, written: written.has(f), present: Number(present), readers: [...new Set(readers)] });
}

console.log(`1 · THE CARD PAYLOAD — ${declared.length} declared fields, ${live.n} live cards\n`);
console.log(`   ${pad('field', 20)} ${pad('written', 8)} ${rpad('on cards', 9)}  ${pad('read by', 7)}  state`);
console.log(`   ${'-'.repeat(66)}`);
const dry = [];
const unresolved = [];
for (const r of rows) {
  const state = !r.written ? 'DRY' : r.readers.length === 0 ? 'write-only' : r.present === 0 ? 'empty' : 'live';
  if (state === 'DRY') dry.push(`card.${r.f}`);
  console.log(`   ${pad(r.f, 20)} ${pad(r.written ? 'yes' : 'NO', 8)} ${rpad(r.present, 9)}  ${pad(r.readers.length, 7)}  ${state}`);
}

// ══ 2 · THE MIRROR COLUMNS ═════════════════════════════════════════════════════════════════════
console.log('\n2 · THE MIRROR TABLES — every column, written? read?\n');
for (const table of ['tenant_opportunity_cards', 'tenant_opportunity_documents']) {
  const cols = await sql`
    SELECT column_name AS c, is_generated AS gen FROM information_schema.columns
    WHERE table_name = ${table} ORDER BY ordinal_position`;
  console.log(`   ${table}`);
  for (const { c, gen } of cols) {
    if (['id', 'tenant_id', 'created_at', 'updated_at'].includes(c)) continue;
    const [{ filled }] = await sql`
      SELECT count(*)::int AS filled FROM ${sql(table)} WHERE ${sql(c)} IS NOT NULL`;
    const [{ total }] = await sql`SELECT count(*)::int AS total FROM ${sql(table)}`;
    const users = mentions(c);
    /**
     * DRY is a CODE state, not a data state — and the first version of this conflated them.
     *
     * It called `archived_at` DRY because no row has one, on a box where nothing has been
     * archived. Thirty-nine files reference it and several write it: the column is fine, the box
     * simply has no archived cards. That is exactly the pipe-vs-data confusion the readiness audit
     * was built to keep apart, reproduced inside the audit written to find its cousin.
     *
     * So: DRY means nothing in the code WRITES it. An unpopulated column whose writers exist is
     * reported as `unused here`, which is a fact about this database and not about the product.
     */
    const isGen = gen === 'ALWAYS';
    // `SET a = 1, b = 2` puts b after a COMMA, not after SET — the first version only matched the
    // first assignment in a statement, so `docs_copied_at` came out with zero writers.
    const writers = FILES.filter(({ f, code }) =>
      new RegExp(`(\\b${c}\\s*=|${c}\\s*=\\s*EXCLUDED|INSERT INTO[^;]{0,600}\\b${c}\\b)`, 'is').test(code)
      && !f.endsWith('audit-card-fields.mjs')).map(({ f }) => rel(f));
    /**
     * A column with ROWS and no writer is a contradiction — something put the values there.
     *
     * Report that as the DETECTOR failing, not as a finding. A scanner that silently converts
     * "I could not find the writer" into "there is no writer" produces confident, wrong work, and
     * the wrongness looks exactly like the real bug this audit exists to catch.
     */
    const contradiction = writers.length === 0 && Number(filled) > 0;
    const state = isGen
      ? (users.length === 0 ? 'BUILT, UNREAD' : 'live')
      : users.length === 0 ? 'DEAD'
      : contradiction ? 'UNRESOLVED — has rows, writer not found'
      : writers.length === 0 ? 'DRY'
      : Number(filled) === 0 && Number(total) > 0 ? 'unused here'
      : 'live';
    if (state === 'DRY') dry.push(`${table}.${c}`);
    if (state.startsWith('UNRESOLVED')) unresolved.push(`${table}.${c}`);
    const flag = state === 'live' ? '' : `   ◀ ${state}`;
    console.log(`     ${pad(c, 24)} ${rpad(`${filled}/${total}`, 9)}  ${rpad(users.length, 3)} ref · ${rpad(writers.length, 2)} write${flag}`);
  }
  console.log();
}

// ══ 3 · WHAT INGEST HOLDS AND THE CARD DOES NOT CARRY ══════════════════════════════════════════
console.log('3 · SIGNALS THE MASTER HOLDS THAT THE CARD DOES NOT CARRY\n');
const oppCols = await sql`
  SELECT column_name AS c FROM information_schema.columns WHERE table_name = 'opportunities'`;
const snakeToCamel = (s) => s.replace(/_([a-z])/g, (_, x) => x.toUpperCase());
const notCarried = [];
for (const { c } of oppCols) {
  const camel = snakeToCamel(c);
  if (declared.includes(camel)) continue;
  const [{ filled, total }] = await sql`
    SELECT count(*) FILTER (WHERE ${sql(c)} IS NOT NULL)::int AS filled, count(*)::int AS total
    FROM opportunities`;
  if (Number(filled) > 0) notCarried.push({ c, filled: Number(filled), total: Number(total) });
}
notCarried.sort((a, b) => b.filled - a.filled);
for (const x of notCarried) {
  console.log(`     ${pad(x.c, 24)} ${rpad(`${x.filled}/${x.total}`, 9)} populated on the master, absent from the card`);
}
if (notCarried.length === 0) console.log('     (none — every populated master column reaches the card)');

// ══ VERDICT ════════════════════════════════════════════════════════════════════════════════════
console.log('\nVERDICT\n');
if (unresolved.length) {
  console.log(`   ⚠ ${unresolved.length} column(s) the detector could not resolve — rows exist, writer not found:`);
  for (const u of unresolved) console.log(`       ${u}`);
  console.log('     Not reported as findings. An unresolved check is uncovered, not passing.\n');
}
if (dry.length === 0) {
  console.log('   ✓ nothing is declared-and-unwritten. The three found by hand were not a pattern');
  console.log('     that continues past them.');
} else {
  console.log(`   ✗ ${dry.length} field(s) declared and never written:`);
  for (const d of dry) console.log(`       ${d}`);
}
console.log();
await sql.end();
process.exit(dry.length === 0 ? 0 : 1);
