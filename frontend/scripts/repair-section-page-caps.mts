/**
 * Repair `canvas.max_pages` on drafted sections so it carries the VOLUME's page cap.
 *
 * THE NUMBER THIS FIXES. Three different page numbers were being written into one field:
 *
 *   proposal_artifacts.compliance_spec.max_pages  the VOLUME's cap — what the agency announces
 *                                                 ("the Technical Volume shall not exceed 10 pages")
 *   proposal_sections.page_allocation             this ITEM's SHARE of that cap (10 items × 1 page)
 *   CANVAS_PRESETS.letter_sbir_phase1.max_pages   a hard-coded default of 15, neither of the above
 *
 * `canvas.max_pages` is read by the live editor gauge and by the export compliance floor, and both
 * measure the ASSEMBLED VOLUME (assembleArtifactCanvas concatenates a volume's sections into one
 * document and takes the first section's canvas as the envelope). So it must hold the first number.
 *
 * Both wrong values shipped. The preset's 15 let a 14-page volume pass every check in the product
 * and be refused by the agency. The item's share was the opposite error — with the Technical
 * Volume's ten pages correctly split one page per item, the assembled volume reported "6 of 1
 * pages" and the export floor would have refused a compliant document. A one-page share is not a
 * one-page document.
 *
 * The code fix is in lib/provision-proposal.ts (and the two frontend landing paths that rebuilt
 * from the preset). This repairs rows already written: it copies the artifact's
 * `compliance_spec.max_pages` onto each of its sections' canvases, ONLY where they disagree.
 * Sections whose artifact declares no cap, and slide canvases (capped in slides, per deck), are
 * left alone.
 *
 *   cd frontend && node --import tsx scripts/repair-section-page-caps.mts [--apply] [proposalId]
 *
 * Dry-run by default: prints what it would change and touches nothing.
 */
import { sqlBypass as sql } from '@/lib/db';

const apply = process.argv.includes('--apply');
const proposalId = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;

// camelCase field names: lib/db applies postgres.toCamel to every column, so a snake_case
// declaration here compiles and reads undefined at runtime (CLAUDE.md, SOP: Data Layer).
const rows = await sql<Array<{
  id: string; title: string | null; volumeName: string | null;
  volumeCap: number | null; content: unknown;
}>>`
  SELECT s.id, s.title, a.volume_name AS "volumeName",
         (a.compliance_spec ->> 'max_pages')::int AS "volumeCap",
         s.content
  FROM proposal_sections s
  JOIN proposal_artifacts a ON a.id = s.artifact_id
  WHERE (a.compliance_spec ->> 'max_pages') IS NOT NULL
    ${proposalId ? sql`AND s.proposal_id = ${proposalId}::uuid` : sql``}
  ORDER BY a.volume_number NULLS LAST, s.sort_index NULLS LAST
`;

let changed = 0;
for (const r of rows) {
  let doc: { canvas?: { format?: string; max_pages?: number | null } } | null = null;
  try {
    doc = typeof r.content === 'string' ? JSON.parse(r.content) : (r.content as typeof doc);
  } catch { continue; }
  if (!doc?.canvas) continue;
  // A deck is capped in SLIDES, per deck; max_pages is meaningless on it.
  if (/slide/i.test(doc.canvas.format ?? '')) continue;

  const current = doc.canvas.max_pages ?? null;
  if (current === r.volumeCap) continue;

  console.log(`${apply ? 'FIX ' : 'would fix'}  ${(r.volumeName ?? '?').slice(0, 20).padEnd(20)} `
    + `${(r.title ?? '(untitled)').slice(0, 44).padEnd(44)} ${current} → ${r.volumeCap}`);
  changed += 1;
  if (!apply) continue;

  doc.canvas.max_pages = r.volumeCap;
  // jsonb via sql.json — NOT JSON.stringify(...)::jsonb, which reads back as a STRING.
  await sql`
    UPDATE proposal_sections
    SET content = ${sql.json(doc as Parameters<typeof sql.json>[0])}::text, updated_at = now()
    WHERE id = ${r.id}::uuid
  `;
}

console.log(`\n${changed} section(s) ${apply ? 'repaired' : 'would be repaired'} of ${rows.length} under a capped volume.`);
if (!apply && changed > 0) console.log('Re-run with --apply to write.');
await sql.end();
