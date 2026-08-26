/**
 * Which canvas node types does the product actually DEMAND?
 *
 * The canvas vocabulary is 22 node types. Extending it is not free: each type costs roughly one
 * unit of parser work and five of writer-plus-ruler work (docx · pptx · xlsx · pdf · the page
 * ruler), and the ruler is a compliance gate — a type whose height it does not know is a silent
 * hole, not a cosmetic gap. So the order of extension should follow demand, not the Office ribbon
 * layout, which asks for a great deal no solicitation has ever required.
 *
 * This measures demand from four independent places rather than from judgement:
 *
 *   1. MOLDS        — `document_templates.canvas_document`: what the shipped templates are built
 *                     from. The strongest signal: a type used by a mold is required to render a
 *                     document the product already ships.
 *   2. AUTHORED     — `proposal_sections.content`: what has actually been written into real
 *                     proposals, by anyone, ever.
 *   3. LIBRARY      — `library_atoms.canvas_nodes`: what the reusable corpus can supply.
 *   4. CONSTRAINED  — `proposal_artifacts.compliance_spec` / `format_spec` and
 *                     `solicitation_compliance`: what agencies impose rules ABOUT. A type nobody
 *                     draws but every agency constrains (page furniture, for instance) is demand
 *                     the content tables cannot see.
 *
 * The output is a ranked list plus, more usefully, the list of types NOTHING has ever asked for —
 * which is where the extension budget should not go.
 *
 *   cd frontend && node scripts/analyze-node-demand.mjs
 * Read-only. Touches nothing.
 */
import postgres from 'postgres';

const DB = process.env.GUIDE_DB || 'postgresql://govtech:changeme@localhost:5432/govtech_intel';
const sql = postgres(DB, { max: 2, transform: { column: { from: (c) => c } } });

/** The union, from lib/types/canvas-document.ts. Kept literal so a drift is visible here. */
const VOCABULARY = [
  'heading', 'text_block', 'bulleted_list', 'numbered_list', 'image', 'table', 'caption',
  'footnote', 'toc', 'page_break', 'url', 'spacer', 'shape', 'text_box', 'callout',
  'code_block', 'blockquote', 'chart', 'equation', 'divider', 'video', 'signature',
];

const pad = (s, n) => String(s).padEnd(n);
const bar = (n, max, w = 22) => '█'.repeat(Math.max(0, Math.round((n / (max || 1)) * w)));

console.log(`· reading ${DB.replace(/:[^:@/]*@/, ':***@')} · read-only\n`);

try {
  // ── 1 · molds ────────────────────────────────────────────────────────────
  const molds = await sql`
    SELECT n->>'type' AS t, count(*)::int AS nodes, count(DISTINCT dt.id)::int AS in_molds
    FROM document_templates dt,
    LATERAL jsonb_array_elements(COALESCE(dt.canvas_document->'nodes', '[]'::jsonb)) n
    GROUP BY 1`;
  const [{ n: moldCount }] = await sql`SELECT count(*)::int AS n FROM document_templates`;

  // ── 2 · authored proposal content ────────────────────────────────────────
  const authored = await sql`
    SELECT n->>'type' AS t, count(*)::int AS nodes, count(DISTINCT ps.id)::int AS in_sections
    FROM proposal_sections ps,
    LATERAL jsonb_array_elements(COALESCE((ps.content::jsonb)->'nodes', '[]'::jsonb)) n
    GROUP BY 1`;

  // ── 3 · library atoms ────────────────────────────────────────────────────
  const lib = await sql`
    SELECT n->>'type' AS t, count(*)::int AS nodes
    FROM library_atoms la,
    LATERAL jsonb_array_elements(COALESCE(la.canvas_nodes, '[]'::jsonb)) n
    WHERE la.archived_at IS NULL GROUP BY 1`;

  const idx = (rows) => Object.fromEntries(rows.map((r) => [r.t, r]));
  const M = idx(molds); const A = idx(authored); const L = idx(lib);
  const maxN = Math.max(...molds.map((r) => r.nodes), ...authored.map((r) => r.nodes), 1);

  console.log(`══ demand by node type ══  (${moldCount} molds)\n`);
  console.log(`  ${pad('node type', 14)} ${pad('molds', 12)} ${pad('authored', 12)} ${pad('library', 9)}  weight`);
  const scored = VOCABULARY.map((t) => {
    const inMolds = M[t]?.in_molds ?? 0;
    const inSections = A[t]?.in_sections ?? 0;
    const inLib = L[t]?.nodes ?? 0;
    // A mold using a type is the strongest signal — it is required to render something we ship.
    return { t, inMolds, inSections, inLib, score: inMolds * 100 + inSections + (inLib ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);

  for (const r of scored) {
    const flag = r.score === 0 ? '  ← never asked for' : '';
    console.log(`  ${pad(r.t, 14)} ${pad(r.inMolds ? `${r.inMolds} mold(s)` : '—', 12)} `
      + `${pad(r.inSections ? `${r.inSections} sect` : '—', 12)} ${pad(r.inLib || '—', 9)} `
      + `${bar(A[r.t]?.nodes ?? M[r.t]?.nodes ?? 0, maxN)}${flag}`);
  }

  const unused = scored.filter((r) => r.score === 0).map((r) => r.t);
  console.log(`\n  ${VOCABULARY.length - unused.length}/${VOCABULARY.length} types have demand · `
    + `${unused.length} have none`);

  // ── 4 · what agencies CONSTRAIN ──────────────────────────────────────────
  // Demand the content tables cannot see: a type nobody draws but every solicitation regulates.
  console.log('\n══ what agencies impose rules about ══\n');
  const specKeys = await sql`
    SELECT k AS key, count(*)::int AS n FROM proposal_artifacts pa,
    LATERAL jsonb_object_keys(COALESCE(pa.compliance_spec,'{}'::jsonb) || COALESCE(pa.format_spec,'{}'::jsonb)) k
    GROUP BY 1 ORDER BY 2 DESC`;
  if (!specKeys.length) console.log('  (no compliance_spec / format_spec keys stored)');
  for (const r of specKeys) console.log(`  ${pad(r.key, 26)} ${r.n} artifact(s)`);

  const solFmt = await sql`
    SELECT count(*) FILTER (WHERE header_format IS NOT NULL)::int AS header,
           count(*) FILTER (WHERE footer_format IS NOT NULL)::int AS footer,
           count(*) FILTER (WHERE submission_format IS NOT NULL)::int AS submission,
           count(*) FILTER (WHERE cost_volume_format IS NOT NULL)::int AS cost_volume,
           count(*)::int AS total
    FROM solicitation_compliance`;
  const s = solFmt[0];
  if (s) {
    console.log(`\n  solicitation_compliance (${s.total} row(s)): header=${s.header} footer=${s.footer} `
      + `submission=${s.submission} cost_volume=${s.cost_volume}`);
  }

  console.log('\n══ read ══\n');
  console.log('  Extend toward what is demanded and constrained; spend nothing on the tail above');
  console.log('  marked "never asked for" until something actually asks. Note that page FURNITURE');
  console.log('  (header/footer) is constrained by agencies without being a node type at all —');
  console.log('  demand that the content tables structurally cannot show.');
} finally {
  await sql.end();
}
