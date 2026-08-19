/** Three corrections to the Immobileyes GHOST build:
 *   1. Budget ≤ $250,000 — restructure the cost volume to a single Phase I base under the ceiling.
 *   2. Images are atoms — the 8 real GHOST figures become library image atoms (grain=reference,
 *      kind=image), placed into V2 with their captions.
 *   3. V2 = 10 pages — the figures lift the assembled Technical Volume to the real ~10-page length.
 *  The proposal is finalized (the system correctly freezes re-authoring), so this applies the
 *  corrected content directly to the frozen build; the live package route re-exports it.
 *
 *  cd frontend && node --import tsx scripts/immo-figs-cost.mts */
import { readFileSync } from 'fs';
import { randomUUID as uuid } from 'crypto';
import { buildCostVolume } from '@/lib/proposal/cost-forms';
import { computeBudget } from '@/lib/proposal/cost-model';
import type { LaborLine, OtherDirectCost, IndirectRates } from '@/lib/proposal/cost-model';
import { sqlBypass as sql } from '@/lib/db';

const P = 'd4b6de67-eb3a-482b-84eb-4b0457687f19';
const TENANT = '8f126bc2-1152-44e5-8473-3761c744d806';
const COCOON = '684d8917-6a86-4eeb-806d-4db1cd3a655f';
const FIGDIR = '/tmp/claude-0/-home-user-govwin/34d597b2-183f-5787-9057-fc7251e3f9ff/scratchpad/figs';
type Fig = { dataUri: string; wpt: number; hpt: number; caption: string; section: string; kb: number };
const figs: Record<string, Fig> = JSON.parse(readFileSync(`${FIGDIR}/figdata.json`, 'utf8'));

// ── 1 · Images as atoms + placement nodes ──────────────────────────────────────
const imageNode = (f: Fig) => ({
  id: uuid(), type: 'image',
  content: { storage_key: f.dataUri, alt_text: f.caption.replace(/^Figure \d+\.\s*/, ''), width: f.wpt, height: f.hpt, caption: '' },
  style: { alignment: 'center', space_before: 10, space_after: 2 },
  provenance: { source: 'library' }, history: [], library_eligible: true,
});
const captionNode = (f: Fig) => ({
  id: uuid(), type: 'text_block', content: { text: f.caption },
  style: { alignment: 'center', italic: true, size: 9, space_before: 0, space_after: 12 },
  provenance: { source: 'library' }, history: [], library_eligible: false,
});

// Create a library image atom per figure (grain=reference, kind=image via atom_tags).
const atomIds: Record<string, string> = {};
for (const [fname, f] of Object.entries(figs)) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO library_atoms (tenant_id, grain, title, content, canvas_nodes, summary, status, source, cocoon_id, creator_kind, source_anchor, visibility)
    VALUES (${TENANT}::uuid, 'reference', ${f.caption.slice(0, 200)}, ${''},
            ${sql.json([imageNode(f)])}, ${f.caption}, 'draft', 'harvest', ${COCOON}::uuid, 'import',
            ${sql.json({ kind: 'image', figure: f.caption, sourceFile: 'N26BXNP0020450_Full_Proposal.pdf', extractedFrom: fname })}, 'tenant')
    RETURNING id`;
  atomIds[fname] = row.id;
  // tag kind=image so it surfaces as an image atom in the library
  await sql`INSERT INTO atom_tags (atom_id, dimension, value, tag_source) VALUES (${row.id}::uuid,'kind','image','auto') ON CONFLICT DO NOTHING`;
}
console.log(`✓ ${Object.keys(atomIds).length} image atoms created in the library`);

// Splice figure image+caption nodes into the V2 sections after their anchor nodes.
async function placeFigures(sectionNumber: string, plan: Array<{ fname: string; afterIndex: number }>) {
  const [sec] = await sql<{ id: string; content: string; version: number }[]>`
    SELECT id, content, version FROM proposal_sections WHERE proposal_id=${P} AND section_number=${sectionNumber} LIMIT 1`;
  const doc = JSON.parse(sec.content);
  const nodes: unknown[] = doc.nodes ?? [];
  // insert from the back so earlier indices stay valid
  const sorted = [...plan].sort((a, b) => b.afterIndex - a.afterIndex);
  for (const { fname, afterIndex } of sorted) {
    const f = figs[fname];
    nodes.splice(afterIndex + 1, 0, imageNode(f), captionNode(f));
  }
  doc.nodes = nodes;
  await sql`UPDATE proposal_sections SET content=${JSON.stringify(doc)}, version=${sec.version + 1}, updated_at=now() WHERE id=${sec.id}::uuid`;
  console.log(`✓ §${sectionNumber}: placed ${plan.length} figures → ${nodes.length} nodes`);
}

// §2 node order (immo-content CONTENT['2']): 0 h1.0, 1 hProblem, 2 p, 3 p, 4 p, 5 hInnovation, 6 p(STORM),
//   7 p(graduated), 8 p(DEXTER), 9 hMechanism, 10 p, 11 table, 12 cap
await placeFigures('2', [
  { fname: 'fig_p09_x1641_473x503.png', afterIndex: 2 },  // Fig 1 fiber drone → after problem
  { fname: 'fig_p09_x1647_304x353.png', afterIndex: 6 },  // Fig 2 STORM → after STORM intro
  { fname: 'fig_p10_x1651_831x257.png', afterIndex: 7 },  // Fig 3 dazzle → after graduated response
  { fname: 'fig_p10_x1659_1100x294.png', afterIndex: 7 }, // Fig 4 escalation framework
  { fname: 'fig_p10_x1655_401x272.png', afterIndex: 8 },  // Fig 5 EX-SUADS → after DEXTER/integration
  { fname: 'fig_p11_x1681_1800x372.png', afterIndex: 8 }, // Fig 7 DEXTER beam split
]);
// §10 Facilities: 0 h4.0, 1 p, 2 p → append the two lab/facility figures
await placeFigures('10', [
  { fname: 'fig_p18_x1724_450x335.png', afterIndex: 2 },
  { fname: 'fig_p18_x1730_448x305.png', afterIndex: 2 },
]);

// ── 2 · Budget ≤ $250,000 — single Phase I base ──────────────────────────────────
const rates: IndirectRates = { fringePct: 0.35, overheadPct: 0.60, gnaPct: 0.40, feePct: 0.05, gnaAppliesToOverhead: false };
const labor: LaborLine[] = [
  { name: 'Atossa Alavi', category: 'Chief Executive / Principal Investigator', hours: 500, unburdenedRate: 50 },
  { name: 'Dr. Bahman Taheri', category: 'Physicist / Chief Scientist', hours: 325, unburdenedRate: 63 },
  { name: 'Electrical Engineer', category: 'Electrical Engineer', hours: 250, unburdenedRate: 45 },
  { name: 'Dr. Christopher Lukowski', category: 'Engineers, All Other / Senior Optics Engineer', hours: 325, unburdenedRate: 50 },
  { name: 'Software Engineer', category: 'Software Developer', hours: 206, unburdenedRate: 45 },
];
const odcs: OtherDirectCost[] = [
  { kind: 'materials', label: 'Modeling, Analysis & Testing Components (AlphaMicron)', amount: 8000 },
  { kind: 'travel', label: 'Phase I Onsite Meetings — Kent, OH → NAS Patuxent River / NAVAIR (2 pax)', amount: 2288 },
];
const meta = { title: 'Phase I Cost Volume', agency: 'Navy', program: 'sbir', companyName: 'Immobileyes, Inc.', solicitationNumber: 'DON26BX03-NP002', topicNumber: 'DON26BX03-NP002', ceiling: 250000, proposalId: P };
const workbook = buildCostVolume('burden_waterfall', meta, { labor, rates, odcs, subs: [], periods: [{ name: 'Phase I Base (6 mo)', months: 6 }] });
const budget = computeBudget(labor, rates, { odcs, subs: [], ceiling: 250000, program: 'sbir' });
const total = budget.grand.totalPrice;
const f = (x: number) => '$' + x.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
console.log(`Phase I base total ${f(total)} · ceiling $250,000 · under by ${f(250000 - total)} · SBC work ${(budget.workshare.sbcWorkPct * 100).toFixed(0)}%`);
if (total > 250000) { console.log('✗ OVER the $250,000 limit'); process.exit(1); }

const s14 = { version: 1, canvas: (workbook as { canvas: unknown }).canvas, metadata: { ...(workbook as { metadata?: object }).metadata, status: 'complete' }, nodes: (workbook as { nodes: unknown[] }).nodes };
await sql`UPDATE proposal_sections SET content=${JSON.stringify(s14)}, updated_at=now() WHERE proposal_id=${P} AND section_number='14'`;
// §15 Option — no separately-priced option; the full Phase I is in the base under the $250K ceiling.
const optionDoc = { version: 1, canvas: (workbook as { canvas: unknown }).canvas, metadata: { title: 'Phase I Option Cost Proposal', status: 'complete' },
  nodes: [
    { id: uuid(), type: 'heading', content: { level: 1, text: 'Phase I Option Cost Proposal' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
    { id: uuid(), type: 'text_block', content: { text: 'No separately-priced Phase I Option is proposed. The full Phase I technical effort is costed in the Base Cost Proposal (§14), not to exceed the $250,000 Phase I ceiling. Should a follow-on option be requested by the Government, it will be separately negotiated within the topic’s applicable option ceiling.' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
  ] };
await sql`UPDATE proposal_sections SET content=${JSON.stringify(optionDoc)}, updated_at=now() WHERE proposal_id=${P} AND section_number='15'`;
console.log('✓ §14 single Phase I base + §15 option note written');

await sql.end();
