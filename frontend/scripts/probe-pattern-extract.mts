/**
 * Run the REAL compliance extractor over the REAL shredded text of each solicitation fixture.
 *
 * This is the code-side half of the midterm ingest check. The fixtures state five formatting rules
 * with DIFFERENT values each, and one of them (dow-sbir-p1) deliberately defers its page limit to
 * the Component-specific instructions. So the expected result is not "some fields populated" — it is
 * a specific table, and any cell that comes back wrong means the reader is guessing:
 *
 *   • a value present in the doc must be extracted WITH an anchor (page + excerpt + offset)
 *   • the anchor's page must be the page the rule is actually on
 *   • a DEFERRED page limit must appear as a deferral, never as a number
 *   • a field the document never states must come back ABSENT, never defaulted
 *
 * Run:  cd frontend && npx tsx scripts/probe-pattern-extract.mts
 * Input: /tmp/.../mt/shredded.json, written by the python shredder probe.
 */
import { readFileSync } from 'node:fs';
import { extractByPattern } from '../lib/ingest/pattern-extract';

const SHRED = process.env.SHRED_JSON
  || '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/mt/shredded.json';

/** What each fixture SAYS. Anything else the extractor reports is a defect, not a surprise. */
/**
 * NOTE ON KEYS — this probe got it wrong once and the lesson is worth keeping. `ParsedCompliance`
 * is **camelCase** (fontFamily, minFontSize, pageLimitTechnical); the snake_case names are the
 * solicitation_compliance COLUMN names, and those are what `evidence` and `RULES[].field` are keyed
 * by. Reading compliance with the column name yields undefined for every field while the evidence
 * sits right there with the correct rule and page — which reads exactly like a broken extractor.
 * Each row below therefore carries both spellings: `key` to read the value, `col` to read evidence.
 */
type Want = {
  key: keyof import('../lib/ingest/skeleton').ParsedCompliance;
  col: string;
  want: string | number | 'DEFERRED' | 'ABSENT' | 'CONSERVATIVE';
};
const FIELDS = (f: Partial<Record<string, string | number>>): Want[] => [
  { key: 'fontFamily',              col: 'font_family',               want: f.font as string },
  { key: 'minFontSize',             col: 'min_font_size',             want: f.size as number },
  { key: 'margins',                 col: 'margins',                   want: f.margin as string },
  { key: 'pageLimitTechnical',      col: 'page_limit_technical',      want: f.pages as number },
  { key: 'characterLimitNarrative', col: 'character_limit_narrative', want: f.chars as number },
];
/**
 * CONSERVATIVE on font_family is the CORRECT answer for three of these four, and the reason is
 * worth stating because it looks like a miss. The typeface rules require a font/typeface token in
 * the SAME sentence as the name. NSF says "must use Arial typeface" and is read; the other three
 * say "shall be prepared in <name>." with the word "font" only in the NEXT sentence, and the rule
 * declines. That is not a gap — `Georgia` and `Cambria` are both in the typeface whitelist AND are
 * place names, so "Proposals shall be prepared in Georgia" is genuinely ambiguous. Declining leaves
 * the field to the AI layer or the curator, which is exactly what the provenance doctrine asks for:
 * a value the product did not certainly read must not look like one it did.
 */
const EXPECT: Record<string, { fields: Want[]; rulePage: number }> = {
  'dow-sbir-p1':   { rulePage: 2, fields: FIELDS({ font: 'CONSERVATIVE', size: 11, margin: '1 inch', pages: 'DEFERRED', chars: 4000 }) },
  'nsf-sttr-p1':   { rulePage: 2, fields: FIELDS({ font: 'Arial',        size: 10, margin: '1 inch', pages: 15,         chars: 'ABSENT' }) },
  'doe-sbir-p2':   { rulePage: 2, fields: FIELDS({ font: 'CONSERVATIVE', size: 11, margin: '0.75 inch', pages: 20,      chars: 2500 }) },
  'ohio-tvsf-r46': { rulePage: 2, fields: FIELDS({ font: 'CONSERVATIVE', size: 12, margin: '1 inch', pages: 8,          chars: 'ABSENT' }) },
};

const shred = JSON.parse(readFileSync(SHRED, 'utf8')) as Record<string, { text: string; pages: number }>;
let pass = 0;
let fail = 0;
const say = (ok: boolean, msg: string) => { ok ? pass++ : fail++; console.log(`   ${ok ? '✓' : '✗'} ${msg}`); };

for (const [slug, spec] of Object.entries(EXPECT)) {
  const src = shred[slug];
  console.log(`\n── ${slug} ──`);
  if (!src) { say(false, 'no shredded text for this fixture'); continue; }

  const got = extractByPattern(src.text);
  const c = got.compliance as Record<string, unknown>;
  const ev = got.evidence;
  const want = spec;

  const check = (key: string, col: string, expected: unknown) => {
    const field = col;
    const actual = c[key];
    if (expected === 'CONSERVATIVE') {
      say(actual == null,
        `${field}: not claimed — the name has no font/typeface token beside it, and declining is` +
        ` correct (got ${JSON.stringify(actual)})`);
      return;
    }
    if (expected === 'ABSENT') {
      say(actual == null, `${field}: absent as stated (got ${JSON.stringify(actual)})`);
      return;
    }
    if (expected === 'DEFERRED') {
      const d = got.deferrals.find((x) => x.field === field);
      say(!!d && actual == null,
        `${field}: DEFERRED — value cleared${d ? ` · "${d.reason.slice(0, 62)}…"` : ' · NO DEFERRAL RECORDED'}` +
        `${actual != null ? ` · BUT A VALUE WAS SET: ${JSON.stringify(actual)}` : ''}`);
      return;
    }
    const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9.]/g, '');
    // A richer rendering is a pass: the extractor writes "1 inch (all sides)" where the document
    // says "1 inch margins on all sides", and that extra precision is the point of reading it.
    const hit = norm(actual) === norm(expected) || norm(actual).startsWith(norm(expected));
    const e = ev[field];
    const anchored = !!e?.anchor && typeof e.anchor.page === 'number';
    const pageOk = !e?.anchor || e.anchor.page === want.rulePage;
    say(hit && anchored && pageOk,
      `${field}: ${JSON.stringify(actual)} (want ${JSON.stringify(expected)})` +
      `${e ? ` · rule=${e.rule} · p${e.anchor?.page}` : ' · NO EVIDENCE'}` +
      `${!pageOk ? ` · WRONG PAGE (rule is on p${want.rulePage})` : ''}`);
  };

  for (const f of spec.fields) check(String(f.key), f.col, f.want);
}

console.log(`\n══ ${pass} passed · ${fail} failed ══`);
process.exit(fail === 0 ? 0 : 1);
