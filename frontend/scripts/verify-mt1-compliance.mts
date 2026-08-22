/**
 * MT-1, machine half: assert the LANDED compliance values and their provenance.
 *
 * The Playwright drive asserts what the Assist route returns — provenance and the landing
 * decision. It cannot assert the values, because Assist stages them into
 * solicitation_compliance_drafts and lands them separately. This reads the landed row and holds
 * it to the exact table each fixture states:
 *
 *   • the value equals what the document says (a default that happens to be right still fails,
 *     because its provenance will not be pattern_match)
 *   • field_provenance records HOW it was obtained, and for a stated rule that must be
 *     pattern_match — cited, not asserted
 *   • the DEFERRED page limit carries NO number, and is not quietly wearing a default
 *
 * Run: cd frontend && npx tsx scripts/verify-mt1-compliance.mts
 */
import { readFileSync } from 'node:fs';
import postgres from 'postgres';

const MT = process.env.MT_DIR || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt';
const DSN = process.env.DATABASE_URL_OWNER || process.env.DATABASE_URL;
if (!DSN) { console.error('DATABASE_URL_OWNER not set — source scripts/sandbox-env.sh'); process.exit(2); }

const sql = postgres(DSN, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } } });

interface Row {
  slug: string; solicitationId: string; title: string;
  expect: { minFont: number; margins: string; pageLimit: number | 'DEFERRED'; charLimit: number | null };
}

const manifest: Row[] = JSON.parse(readFileSync(`${MT}/mt1-solicitations.json`, 'utf8'));
let pass = 0, fail = 0;
const say = (ok: boolean, m: string) => { ok ? pass++ : fail++; console.log(`   ${ok ? '✓' : '✗'} ${m}`); };

for (const r of manifest) {
  console.log(`\n── ${r.slug} — ${r.title.slice(0, 62)}`);
  // camelCase off toCamel: the COLUMNS are snake_case, the ROWS come back camelCase.
  const rows = await sql<Array<{
    pageLimitTechnical: number | null; characterLimitNarrative: number | null;
    fontFamily: string | null; minFontSize: string | number | null; margins: string | null;
    fieldProvenance: Record<string, { source?: string; excerpt?: string; page?: number } | string>;
  }>>`
    SELECT page_limit_technical, character_limit_narrative, font_family, min_font_size, margins,
           field_provenance
    FROM solicitation_compliance WHERE solicitation_id = ${r.solicitationId}::uuid LIMIT 1`;
  if (!rows.length) { say(false, 'no solicitation_compliance row — Assist never landed the matrix'); continue; }
  const c = rows[0];
  const prov = c.fieldProvenance ?? {};
  const srcOf = (f: string) => {
    const v = prov[f];
    return typeof v === 'string' ? v : (v?.source ?? null);
  };
  const citeOf = (f: string) => {
    const v = prov[f];
    return typeof v === 'object' && v ? `p${v.page ?? '?'} "${String(v.excerpt ?? '').slice(0, 48)}…"` : '';
  };

  const num = (v: string | number | null) => (v == null ? null : Number(v));
  say(num(c.minFontSize) === r.expect.minFont && srcOf('min_font_size') === 'pattern_match',
    `min_font_size = ${num(c.minFontSize)} (want ${r.expect.minFont}) · ${srcOf('min_font_size')} ${citeOf('min_font_size')}`);
  say(c.margins === r.expect.margins && srcOf('margins') === 'pattern_match',
    `margins = ${JSON.stringify(c.margins)} (want ${JSON.stringify(r.expect.margins)}) · ${srcOf('margins')} ${citeOf('margins')}`);

  if (r.expect.pageLimit === 'DEFERRED') {
    // The whole doctrine in one assertion: a deferred rule must not carry a number, and must not
    // be sitting there sourced 'default' pretending it was read.
    say(c.pageLimitTechnical == null,
      `page_limit_technical is EMPTY for a deferred rule (got ${c.pageLimitTechnical}) · ${srcOf('page_limit_technical')}`);
  } else {
    say(c.pageLimitTechnical === r.expect.pageLimit && srcOf('page_limit_technical') === 'pattern_match',
      `page_limit_technical = ${c.pageLimitTechnical} (want ${r.expect.pageLimit}) · ${srcOf('page_limit_technical')} ${citeOf('page_limit_technical')}`);
  }

  if (r.expect.charLimit === null) {
    say(c.characterLimitNarrative == null || srcOf('character_limit_narrative') !== 'pattern_match',
      `character_limit_narrative not claimed as read (value=${c.characterLimitNarrative} · ${srcOf('character_limit_narrative')})`);
  } else {
    say(c.characterLimitNarrative === r.expect.charLimit && srcOf('character_limit_narrative') === 'pattern_match',
      `character_limit_narrative = ${c.characterLimitNarrative} (want ${r.expect.charLimit}) · ${srcOf('character_limit_narrative')}`);
  }

  // font_family is the conservative case: not read from "prepared in <name>." So it must NOT
  // claim pattern_match. A 'default' here is honest — it will wear the red badge in the UI.
  say(srcOf('font_family') !== 'pattern_match',
    `font_family = ${JSON.stringify(c.fontFamily)} · ${srcOf('font_family')} (must not claim to be read)`);
}

console.log(`\n══ ${pass} passed · ${fail} failed ══`);
await sql.end();
process.exit(fail === 0 ? 0 : 1);
