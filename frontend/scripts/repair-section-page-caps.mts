/**
 * Repair `canvas.max_pages` where an AI draft overwrote the PROVISIONED page cap (B22).
 *
 * `provision-proposal.ts` stamps the solicitation's real per-item limit onto each section's canvas.
 * Two frontend landing paths then rebuilt the document from `CANVAS_PRESETS.letter_sbir_phase1`,
 * whose `max_pages` is hard-coded 15 — so after drafting, a section that the solicitation caps at
 * 10 pages claimed 15. The editor gauge and the export compliance floor both read that number, so
 * a 14-page volume passed every check in the product and would be refused by the agency.
 *
 * The code fix is in those two components. This repairs the rows they already wrote: it copies
 * `proposal_sections.page_allocation` (the authority — set at provision from the solicitation's
 * `volume_required_items.page_limit`) back onto the canvas, ONLY where the two disagree.
 *
 *   cd frontend && node --import tsx scripts/repair-section-page-caps.mts [--apply] [proposalId]
 *
 * Dry-run by default: prints what it would change and touches nothing.
 */
import { sqlBypass as sql } from '@/lib/db';

const apply = process.argv.includes('--apply');
const proposalId = process.argv.find((a) => /^[0-9a-f-]{36}$/i.test(a)) ?? null;

const rows = await sql<Array<{
  id: string; proposalId: string; title: string | null;
  pageAllocation: number | null; content: unknown;
}>>`
  SELECT id, proposal_id, title, page_allocation, content
  FROM proposal_sections
  WHERE page_allocation IS NOT NULL AND page_allocation > 0
    ${proposalId ? sql`AND proposal_id = ${proposalId}::uuid` : sql``}
`;

let changed = 0;
for (const r of rows) {
  let doc: { canvas?: { max_pages?: number | null } } | null = null;
  try {
    doc = typeof r.content === 'string' ? JSON.parse(r.content) : (r.content as typeof doc);
  } catch { continue; }
  const current = doc?.canvas?.max_pages ?? null;
  if (!doc?.canvas || current === r.pageAllocation) continue;

  console.log(`${apply ? 'FIX ' : 'would fix'}  ${(r.title ?? '(untitled)').slice(0, 58).padEnd(58)} ${current} → ${r.pageAllocation}`);
  changed += 1;
  if (!apply) continue;

  doc.canvas.max_pages = r.pageAllocation;
  // jsonb via sql.json — NOT JSON.stringify(...)::jsonb, which reads back as a STRING.
  await sql`
    UPDATE proposal_sections
    SET content = ${sql.json(doc as Parameters<typeof sql.json>[0])}::text, updated_at = now()
    WHERE id = ${r.id}::uuid
  `;
}

console.log(`\n${changed} section(s) ${apply ? 'repaired' : 'would be repaired'} of ${rows.length} with a page allocation.`);
if (!apply && changed > 0) console.log('Re-run with --apply to write.');
await sql.end();
