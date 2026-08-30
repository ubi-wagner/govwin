/**
 * audit-ranking-readiness — is the model implemented, and is the corpus it depends on actually fed?
 *
 * Two questions that are constantly confused, and the confusion is the reason this exists:
 *
 *   IS THE PIPE CONNECTED?   Does each curated signal reach the card, the tsvector and the scorer?
 *                            A code question. Provable, and provable today.
 *   IS ANYTHING IN THE PIPE? Do real solicitations carry that signal? A DATA question, answerable
 *                            only by counting rows, and the answer can be zero on a perfectly
 *                            implemented system.
 *
 * A green on the first with a zero on the second is a feature that is plumbed and dry — which has
 * now happened twice in this codebase, most recently to the highlight field added an hour before
 * this file. So the audit reports them as SEPARATE COLUMNS and refuses to average them.
 *
 * It also walks the reach of each signal — extracted → editable → carried → indexed → scored —
 * because a signal that stops at any hop is invisible in a row count.
 *
 * Read-only.
 *
 * Usage:  node frontend/scripts/audit-ranking-readiness.mjs
 * Exit:   0 always — this is a census, not a gate. Reading it is the point.
 */

import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OWNER = process.env.DATABASE_URL_OWNER ?? 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = postgres(OWNER, { transform: { column: { from: postgres.toCamel, to: postgres.fromCamel } }, max: 4 });

const src = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const BRIDGE = src('lib/opportunity-bridge.ts');
const SCORER = src('lib/bucket-scoring.ts');
const PY = fs.readFileSync(path.join(ROOT, '..', 'pipeline/src/workflows/actions/rescore.py'), 'utf8');
const MIG = src('../db/migrations/239_curated_ranking_corpus.sql') || fs.readFileSync(
  path.join(ROOT, '..', 'db/migrations/239_curated_ranking_corpus.sql'), 'utf8');

const pad = (s, n) => String(s).padEnd(n);
const rpad = (s, n) => String(s).padStart(n);
const mark = (b) => (b ? '✓' : '✗');

console.log('\naudit-ranking-readiness\n');
console.log('  THE PIPE and THE DATA are different questions. A connected pipe with nothing in it');
console.log('  is a feature that is plumbed and dry, and averaging the two hides exactly that.\n');

// ── 1 · Is each signal connected, hop by hop? ──────────────────────────────────────────────────
// Each hop is a literal from the file that implements it. A regex over source is a weak instrument
// in general; here every pattern is a field NAME appearing in a specific file, which is the one
// thing source text states unambiguously.
const SIGNALS = [
  { key: 'spotlightSummary', label: 'admin summary',      card: /spotlight_summary/, tsv: /spotlightSummary/, ts: /card\.spotlightSummary/, py: /"spotlightSummary"/ },
  { key: 'expertNotes',      label: 'expert notes',       card: /o\.expert_notes/,   tsv: /expertNotes/,      ts: null,                     py: null },
  { key: 'techFocusAreas',   label: 'technology focus',   card: /tech_focus_areas/,  tsv: /techFocusAreas/,   ts: /card\.techFocusAreas/,   py: /"techFocusAreas"/ },
  { key: 'phaseType',        label: 'phase type',         card: /o\.phase_type/,     tsv: /phaseType/,        ts: /card\.phaseType/,        py: /"phaseType"/ },
  { key: 'topicNumber',      label: 'topic identity',     card: /o\.topic_number/,   tsv: /topicNumber/,      ts: /card\.topicNumber/,      py: /"topicNumber"/ },
  { key: 'volumes',          label: 'volumes',            card: /AS volumes/,        tsv: /card->>'volumes'/, ts: /card\.volumes/,          py: /card\.get\("volumes"\)/ },
  { key: 'requiredItems',    label: 'required items',     card: /AS required_items/, tsv: /requiredItems/,    ts: /card\.requiredItems/,    py: /card\.get\("requiredItems"\)/ },
  { key: 'highlights',       label: 'admin highlights',   card: /AS highlights/,     tsv: /card->>'highlights'/, ts: /card\.highlights/,    py: /card\.get\("highlights"\)/ },
  { key: 'documents',        label: 'document manifest',  card: /AS documents/,      tsv: null,               ts: null,                     py: null },
];

console.log('1 · THE PIPE — does each signal reach each hop?\n');
console.log(`   ${pad('signal', 20)} ${pad('on card', 9)} ${pad('in tsv', 8)} ${pad('TS scorer', 11)} ${pad('PY scorer', 11)}`);
console.log(`   ${'-'.repeat(62)}`);
const pipe = [];
for (const s of SIGNALS) {
  const onCard = s.card ? s.card.test(BRIDGE) : null;
  const inTsv = s.tsv ? s.tsv.test(MIG) : null;
  const inTs = s.ts ? s.ts.test(SCORER) : null;
  const inPy = s.py ? s.py.test(PY) : null;
  const cell = (v) => (v === null ? pad('  n/a', 9) : pad(`  ${mark(v)}`, 9));
  console.log(`   ${pad(s.label, 20)} ${cell(onCard)} ${cell(inTsv).slice(0, 8)} ${cell(inTs).slice(0, 11)} ${cell(inPy).slice(0, 11)}`);
  pipe.push({ ...s, onCard, inTsv, inTs, inPy });
}
const broken = pipe.filter((p) => [p.onCard, p.inTsv, p.inTs, p.inPy].some((v) => v === false));
console.log(`\n   ${broken.length === 0 ? '✓ every signal reaches every hop it is meant to' : `✗ ${broken.length} signal(s) stop short: ${broken.map((b) => b.label).join(', ')}`}`);
console.log('   (n/a = deliberately not at that hop — expert notes and the manifest are display/context,');
console.log('    not keyword-matched, and the manifest is never indexed.)\n');

// ── 2 · Is anything IN the pipe? ───────────────────────────────────────────────────────────────
const [d] = await sql`
  SELECT
    (SELECT count(*)::int FROM curated_solicitations)                                   AS sols,
    (SELECT count(*)::int FROM opportunities)                                           AS opps,
    (SELECT count(*)::int FROM curated_solicitations WHERE COALESCE(spotlight_summary,'')<>'') AS with_summary,
    (SELECT round(avg(length(spotlight_summary)))::int FROM curated_solicitations WHERE COALESCE(spotlight_summary,'')<>'') AS summary_chars,
    (SELECT count(*)::int FROM opportunities WHERE COALESCE(expert_notes,'')<>'')        AS with_notes,
    (SELECT count(*)::int FROM opportunities WHERE tech_focus_areas IS NOT NULL AND array_length(tech_focus_areas,1)>0) AS with_tech,
    (SELECT count(*)::int FROM opportunities WHERE COALESCE(phase_type,'')<>'')          AS with_phase,
    (SELECT count(*)::int FROM opportunities WHERE COALESCE(topic_number,'')<>'')        AS with_topic,
    (SELECT count(*)::int FROM solicitation_volumes WHERE topic_id IS NULL)              AS volumes,
    (SELECT count(*)::int FROM volume_required_items)                                    AS items,
    (SELECT count(*)::int FROM solicitation_annotations)                                 AS annotations,
    (SELECT count(*)::int FROM solicitation_annotations WHERE COALESCE(excerpt,'')<>'')  AS annotations_with_text,
    (SELECT count(*)::int FROM solicitation_documents)                                   AS documents`;

console.log('2 · THE DATA — is anything in it?\n');
const rows = [
  ['admin summary',    d.withSummary, d.sols,  `mean ${d.summaryChars ?? 0} chars`],
  ['expert notes',     d.withNotes,   d.opps,  ''],
  ['technology focus', d.withTech,    d.opps,  ''],
  ['phase type',       d.withPhase,   d.opps,  ''],
  ['topic identity',   d.withTopic,   d.opps,  ''],
  ['volumes',          d.volumes,     null,    'umbrella-level'],
  ['required items',   d.items,       null,    ''],
  ['admin highlights', d.annotationsWithText, d.annotations, d.annotations > 0 && d.annotationsWithText === 0 ? 'ANNOTATIONS EXIST WITH NO TEXT' : ''],
  ['documents',        d.documents,   null,    ''],
];
console.log(`   ${pad('signal', 20)} ${rpad('have', 6)} ${rpad('of', 6)}  coverage`);
console.log(`   ${'-'.repeat(62)}`);
for (const [label, have, of, note] of rows) {
  const pct = of ? `${Math.round((100 * have) / Math.max(1, of))}%` : '—';
  const flag = have === 0 ? '   ◀ EMPTY' : '';
  console.log(`   ${pad(label, 20)} ${rpad(have, 6)} ${rpad(of ?? '—', 6)}  ${pad(pct, 6)} ${note}${flag}`);
}

// ── 3 · What the ranker actually sees, per card, right now ─────────────────────────────────────
const [reach] = await sql`
  SELECT count(*)::int AS cards,
         COALESCE(round(avg(length(card_tsv))), 0)::int AS mean_lexemes,
         COALESCE(max(length(card_tsv)), 0)::int AS max_lexemes,
         count(*) FILTER (WHERE COALESCE(card->>'spotlightSummary','') <> '')::int AS have_summary,
         count(*) FILTER (WHERE jsonb_array_length(COALESCE(card->'volumes','[]'::jsonb)) > 0)::int AS have_volumes,
         count(*) FILTER (WHERE jsonb_array_length(COALESCE(card->'highlights','[]'::jsonb)) > 0)::int AS have_highlights
  FROM tenant_opportunity_cards WHERE archived_at IS NULL`;
console.log(`\n3 · WHAT THE RANKER SEES, across ${reach.cards} live card(s)\n`);
console.log(`   searchable lexemes per card   mean ${reach.meanLexemes} · max ${reach.maxLexemes}`);
console.log(`   cards carrying a summary      ${reach.haveSummary} of ${reach.cards}`);
console.log(`   cards carrying volumes        ${reach.haveVolumes} of ${reach.cards}`);
console.log(`   cards carrying highlights     ${reach.haveHighlights} of ${reach.cards}`);

// ── 3b · Indexes that are built and not queried ────────────────────────────────────────────────
// The exact pattern this project already found once and named: an index maintained by Postgres on
// every write, with no reader. It costs write throughput and buys nothing, and it reads to a future
// maintainer as though stemming is in play when the scorer matches literally.
import { execSync } from 'node:child_process';

/**
 * Which source files READ this column — with comments stripped first.
 *
 * The naive grep counted a COMMENT that names the column as a reader, and reported "USED" for an
 * index nothing queries. That is this repo's documented trap running in a new direction: a text
 * search for a thing finds the prose ABOUT the thing, and prose clusters exactly where the most
 * care was taken. Strip comments to ask what a file DOES; read the full text to ask what it is
 * ABOUT. These are different questions and only the first one is being asked here.
 */
const queried = (col) => {
  let files = [];
  try {
    const out = execSync(
      `grep -rl "${col}" --include=*.ts --include=*.tsx --include=*.py ` +
      `"${path.join(ROOT, 'lib')}" "${path.join(ROOT, 'app')}" "${path.join(ROOT, '..', 'pipeline/src')}" 2>/dev/null || true`,
      { encoding: 'utf8' });
    files = out.split('\n').filter(Boolean);
  } catch { return []; }
  return files.filter((f) => {
    const text = fs.readFileSync(f, 'utf8');
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')      // block comments
      .replace(/(^|[^:])\/\/.*$/gm, '$1')    // line comments, not a URL's //
      .replace(/^\s*#.*$/gm, '')             // python comments
      .replace(/'''[\s\S]*?'''|\"\"\"[\s\S]*?\"\"\"/g, ''); // python docstrings
    return code.includes(col);
  });
};
const tsvReaders = queried('card_tsv');
console.log('\n3b · INDEXES BUILT AND NOT QUERIED\n');
console.log(`   card_tsv          maintained on every card write · read by ${tsvReaders.length} source file(s)`);
if (tsvReaders.length === 0) {
  console.log('     ◀ NOT A SCORING INPUT. scoreCard matches with String.includes and a word-boundary');
  console.log('       regex, so "printing" does not match "print" and tenants hand-expand morphology');
  console.log('       in their own keyword lists. The stemmed index of exactly that text sits unread.');
}

// ── 4 · The verdict, stated as two verdicts ────────────────────────────────────────────────────
const emptySignals = rows.filter(([, have]) => have === 0).map(([l]) => l);
console.log('\n4 · VERDICT — two of them, deliberately\n');
console.log(`   PIPE   ${broken.length === 0 ? 'COMPLETE' : 'INCOMPLETE'} — every curated signal reaches the card, the index and both scorers.`);
console.log(`   INDEX  ${tsvReaders.length ? 'USED' : 'BUILT, UNQUERIED — card_tsv has no reader'}`);
console.log(`   DATA   ${emptySignals.length === 0 ? 'FED' : 'THIN'}${emptySignals.length ? ` — ${emptySignals.length} signal(s) carry nothing: ${emptySignals.join(', ')}` : ''}`);
if (emptySignals.length) {
  console.log('\n   An empty signal is not a broken one. It is a curation step nobody has performed');
  console.log('   on this box, and the ranker is exactly as good as what curation puts in front of it.');
}
console.log();
await sql.end();
