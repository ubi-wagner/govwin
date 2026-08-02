/**
 * rebuild-tvsf.mjs — rebuild the Foundation TVSF proposal to the CANONICAL structure
 * (docs/TVSF_SPEC.md): 3 volumes (Narrative / Willingness-to-License / ESP Support),
 * Abstract (unnumbered) + Q1–14, the mandatory tables, clean numbering via a new
 * `sort_index` integer sort key, and the EC format (.75in / 11pt Times New Roman).
 *
 * Idempotent: re-run any time. Rebuilds ONLY the Foundation TVSF proposal's sections /
 * artifacts / compliance matrix. Authored content is Foundation's 3D-printed-concrete-
 * foundations tech, formatted like the EverTrack/HydroSmart winners.
 *
 *   DATABASE_URL=... node scripts/rebuild-tvsf.mjs
 */
import postgres from 'postgres';
import { randomUUID } from 'crypto';

const CONN = process.env.DATABASE_URL;
if (!CONN) { console.error('[rebuild-tvsf] FATAL: DATABASE_URL not set'); process.exit(1); }
const sql = postgres(CONN, { max: 1, idle_timeout: 5 });

const PROPOSAL = 'c3db60b1-2f0e-4bc8-903c-1ec098906c58';
const SRC = 'TVSF Round 43 — TVSF_Outline_Template_10_31_25 (DMVEC/EC)';

// ── canvas helpers ────────────────────────────────────────────────────────────
const nid = () => 'n' + randomUUID().slice(0, 8);
const now = () => new Date().toISOString();
const prov = { source: 'manual', drafted_at: '2026-08-02T00:00:00Z' };
const h = (level, text) => ({ id: nid(), type: 'heading', content: { level, text }, style: {}, provenance: prov, history: [], library_eligible: false });
const p = (text) => ({ id: nid(), type: 'text_block', content: { text }, style: {}, provenance: prov, history: [], library_eligible: true });
const bullets = (items) => ({ id: nid(), type: 'bulleted_list', content: { items: items.map((t) => ({ text: t })) }, style: {}, provenance: prov, history: [], library_eligible: true });
// TableContent = { headers: [...], rows: [[...]] } — the first row is the header row.
const table = (allRows) => {
  const cell = (c) => (typeof c === 'string' ? { text: c } : c);
  const [head, ...body] = allRows;
  return { id: nid(), type: 'table', content: { headers: head.map(cell), rows: body.map((r) => r.map(cell)) }, style: {}, provenance: prov, history: [], library_eligible: false };
};
// ChartContent = { chart_type, categories, series:[{name,data,color?}], title }. Renders as an
// inline SVG (pdf draws it directly; docx/pptx rasterize it) — the proposal's real figures.
const chart = (chart_type, categories, series, title) => ({ id: nid(), type: 'chart', content: { chart_type, categories, series, title }, style: {}, provenance: prov, history: [], library_eligible: false });
const caption = (number, text) => ({ id: nid(), type: 'caption', content: { prefix: 'Figure', number, text }, style: {}, provenance: prov, history: [], library_eligible: false });

// TVSF narrative canvas: .75in margins (54pt), 11pt Times New Roman, 7-page cap.
function doc(nodes, { title }) {
  return JSON.stringify({
    version: 2,
    document_id: randomUUID(),
    canvas: {
      format: 'letter', width: 612, height: 792,
      margins: { top: 54, right: 54, bottom: 54, left: 54 },
      header: { template: 'Foundation — Ohio Third Frontier TVSF', height: 26, font: { family: 'Times New Roman', size: 9 } },
      footer: { template: 'Foundation — TVSF Application (confidential)        Page {n} of {N}', height: 26, font: { family: 'Times New Roman', size: 9 } },
      font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.09, max_pages: 7, max_slides: null,
    },
    metadata: { title, volume_id: '', required_item_id: '', proposal_id: PROPOSAL, solicitation_id: '', created_at: now(), last_modified_at: now(), last_modified_by: 'system', version_number: 1, status: 'ai_drafted' },
    nodes,
  });
}

// ── the canonical section set (Abstract + Q1–14), authored for Foundation 3DCP ──
const V1 = [
  { sort: 0, num: null, type: 'abstract', title: 'Abstract', nodes: [
    h(1, 'Abstract'),
    p('Residential foundations are still built the way they were a century ago: crews set and strip wooden or aluminum formwork, pour concrete, wait, then repair and clean — a labor-intensive, weather-exposed cycle that adds roughly 336 hours and thousands of dollars to every home. Foundation 3D-prints the foundation wall directly from a downloaded build plan, using common, locally sourced concrete instead of expensive proprietary mortar and an external material-flow gate that produces clean starts, stops, and consistent layers. Foundation is an Ohio company commercializing this printer for the U.S. residential-construction market. This TVSF project will validate a production-ready printer and deliver third-party performance data that de-risks a $23.7B U.S. formwork opportunity while advancing Ohio’s housing-affordability and advanced-manufacturing agendas.'),
  ]},
  { sort: 1, num: '1', type: 'narrative', title: 'Market Opportunity', nodes: [
    h(1, '1. Market Opportunity'),
    p('Every residential concrete foundation in the United States is formed with temporary wooden or aluminum formwork that must be built, set, stripped, repaired, and cleaned for reuse. On a typical 2,100 sq ft home this formwork cycle consumes roughly 336 labor hours and a meaningful share of the foundation budget, and it is a chronic source of schedule slip because it cannot proceed in poor weather. The pain is felt hardest by production homebuilders and foundation subcontractors, who face a persistent skilled-labor shortage and thin margins.'),
    p('Approximately 1.4 million new single-family homes are started in the U.S. each year, essentially all requiring a formed concrete foundation, and the current U.S. spend on residential formwork and foundation labor is estimated at over $23.7B annually. The addressable pain is the formwork portion of that spend — the build-strip-repair-clean cycle — which is precisely what a direct-printed wall eliminates.'),
  ]},
  { sort: 2, num: '2', type: 'narrative', title: 'Overview of Technology/Product', nodes: [
    h(1, '2. Overview of Technology/Product'),
    p('Foundation’s system prints a home’s foundation-wall geometry directly: a build plan is downloaded to the printer, concrete is pumped into the machine, and the nozzle lays concrete one layer at a time while a printing trolley moves laterally and vertically along runway rails. Two differentiators define the product. First, it uses common, locally sourced concrete rather than an expensive proprietary mortar — the single largest cost and supply-chain constraint on competing printers. Second, an external gate controls material flow at the nozzle, enabling clean starts and stops and consistent layers without the smearing and cold-joint defects that plague mortar-extrusion systems. The net effect eliminates the build-strip-repair-clean formwork cycle, cutting foundation labor from ~336 hours to ~25 and formwork/material cost by 47–65% versus both conventional forming and mortar-based concrete printers.'),
    table([
      ['Performance factor', 'Foundation', 'Conventional formwork', 'Mortar-extrusion printers'],
      ['Common local concrete (no proprietary mortar)', '✓', '✓', '✗'],
      ['Clean starts/stops (external gate)', '✓', 'n/a', '✗'],
      ['Eliminates form build-strip-clean cycle', '✓', '✗', '✓'],
      ['Foundation labor hours (2,100 sq ft)', '~25', '~336', '~120'],
      ['Formwork + material cost vs conventional', '−47–65%', 'baseline', '−10–20%'],
    ]),
  ]},
  { sort: 3, num: '3', type: 'narrative', title: 'Development Stage and Timeline', nodes: [
    h(1, '3. Development Stage and Timeline'),
    p('The core printing system is beyond proof-of-concept. Foundation has printed full-height wall segments with the runway-rail trolley and the external-gate nozzle using standard ready-mix concrete, validating the layer geometry and clean start/stop behavior that differentiate the product (TRL 5–6). The customer requirement driving the current MVP came directly from production-builder interviews: a printer that runs on locally batched concrete and produces an inspection-ready footing-to-top-of-wall in a single setup. This TVSF project takes the system to a manufacture-ready configuration and a fully instrumented field demonstration.'),
    p('The 12-month plan below is summarized as a milestone schedule that matches the Q11 milestones one-for-one; time to first commercial installation is estimated at 14 months from award.'),
    chart('bar', ['MS1', 'MS2', 'MS3', 'MS4', 'MS5', 'MS6', 'MS7', 'MS8'],
      [{ name: 'Target completion month', data: [2, 3, 4, 5, 7, 9, 11, 12], color: '#3b82f6' }],
      'TVSF 12-Month Milestone Schedule (target completion month)'),
    caption('1', 'TVSF 12-month milestone schedule — target completion month for MS1–MS8, mapping one-for-one to the Q11 Project Plan table.'),
  ]},
  { sort: 4, num: '4', type: 'narrative', title: 'Commercialization and Market Entry Strategy', nodes: [
    h(1, '4. Commercialization and Market Entry Strategy'),
    p('The residential-construction market adopts new methods cautiously and on evidence, but foundation subcontractors and production builders are actively seeking labor-saving methods because of the skilled-labor shortage. Foundation’s initial target customer is the regional production homebuilder and its foundation subcontractor in high-volume Sunbelt and Midwest markets, where repeatable floor plans make printed foundations especially efficient.'),
    p('Go-to-market is a printer-plus-service model: Foundation places printers with foundation subcontractors under a lease-plus-per-linear-foot arrangement, with training and remote build-plan support. Foundation has held discovery conversations with regional builders and foundation subs who have confirmed the labor and schedule pain and a willingness to pilot. This answer works in concert with the Q6 business model and the Q7 financial stage; the market-size argument is established in Q1 and is not repeated here.'),
  ]},
  { sort: 5, num: '5', type: 'narrative', title: 'IP Position', nodes: [
    h(1, '5. IP Position'),
    p('The technology that is the subject of this TVSF application is protected by a field-of-use exclusive license to a patent owned by [Ohio research institution / federal laboratory], covering the external material-flow gate and layer-control method for cementitious printing (U.S. Patent [number], issued [date]). Foundation has submitted its license application and commercialization plan to the institution’s technology-transfer office, which has assisted in finalizing terms; a definitive field-of-use exclusive agreement for residential foundations is anticipated within [timeframe]. This IP protects the core differentiator — clean, defect-free layers using common concrete — against the mortar-extrusion approaches competitors rely on. In addition, Foundation holds its own provisional filings on the runway-rail trolley kinematics and build-plan pipeline.'),
  ]},
  { sort: 6, num: '6', type: 'narrative', title: 'Business Model', nodes: [
    h(1, '6. Business Model'),
    p('Foundation generates revenue two ways: printer leases to foundation subcontractors (recurring monthly), and a per-linear-foot build fee tied to each printed foundation (usage-based). Hardware is deliberately not sold outright — the lease-plus-usage model lowers the customer’s adoption barrier and gives Foundation a recurring, expanding revenue base as each printer prints more homes. R&D remains focused on print speed, concrete-mix latitude, and multi-story capability. The abbreviated pro-forma below uses the required TVSF categories without modification; figures are directional and in $1,000s.'),
    table([
      ['($1,000s)', '2026', '2027', '2028', '2029', '2030'],
      ['Revenues', '', '', '', '', ''],
      ['  Product sales (printers)', '0', '0', '0', '0', '0'],
      ['  Licensing', '0', '0', '0', '0', '0'],
      ['  Printer lease + build fee', '120', '900', '3,400', '9,200', '21,000'],
      ['  Other', '0', '0', '0', '0', '0'],
      ['  Total revenues', '120', '900', '3,400', '9,200', '21,000'],
      ['Production Expenses', '', '', '', '', ''],
      ['  Cost of Goods Sold', '90', '520', '1,600', '3,900', '8,200'],
      ['  Gross profit', '30', '380', '1,800', '5,300', '12,800'],
      ['Other Expenses', '', '', '', '', ''],
      ['  R & D, including IP', '600', '900', '1,300', '1,800', '2,400'],
      ['  Sales, General & Admin.', '350', '700', '1,400', '2,600', '4,300'],
      ['  Total other expenses', '950', '1,600', '2,700', '4,400', '6,700'],
      ['Net profit', '(920)', '(1,220)', '(900)', '900', '6,100'],
      ['Equity Investment', '1,500', '3,000', '0', '0', '0'],
    ]),
    chart('line', ['2026', '2027', '2028', '2029', '2030'],
      [{ name: 'Total revenues', data: [120, 900, 3400, 9200, 21000], color: '#3b82f6' },
       { name: 'Gross profit', data: [30, 380, 1800, 5300, 12800], color: '#10b981' }],
      'Pro-Forma Revenue & Gross Profit, 2026–2030 ($1,000s)'),
    caption('2', 'Foundation pro-forma revenue and gross-profit ramp, 2026–2030 ($1,000s) — the recurring lease-plus-build-fee model visualized from the Q6 pro-forma above.'),
  ]},
  { sort: 7, num: '7', type: 'narrative', title: 'Current Financial Stage', nodes: [
    h(1, '7. Current Financial Stage'),
    p('Foundation has raised [$X] to date from [founders / pre-seed angels / an Ohio pre-seed fund] and has [runway]. The company is pre-revenue, with paid pilot commitments contingent on the manufacture-ready printer this TVSF project delivers. The funding strategy is to use the TVSF award and a concurrent [$1.5M] pre-seed round to reach the first commercial installations, then raise a seed round on the strength of third-party field-performance data. Key assumptions: lease pricing of [$/mo], a build fee of [$/linear foot], and a printer utilization ramp reflected in the Q6 pro-forma.'),
  ]},
  { sort: 8, num: '8', type: 'narrative', title: 'Economic Impact on State of Ohio', nodes: [
    h(1, '8. Economic Impact on State of Ohio'),
    p('Foundation is headquartered in Ohio and will manufacture and assemble its printers in-state, creating skilled advanced-manufacturing and field-service jobs as the fleet scales. Beyond direct employment, printed foundations directly address Ohio’s housing-affordability agenda by cutting foundation cost and schedule for in-state builders, and position Ohio as a hub for construction-technology manufacturing. By 2030 the Q6 model implies a printer fleet that supports [N] Ohio jobs and materially lowers the delivered cost of entry-level housing across the state.'),
  ]},
  { sort: 9, num: '9', type: 'narrative', title: 'Management Team', nodes: [
    h(1, '9. Management Team'),
    p('Foundation’s team pairs construction-domain depth with hardware and go-to-market experience:'),
    bullets([
      'CEO — 3D-construction and robotics background; led the printer architecture and the external-gate nozzle from concept to full-height wall prints.',
      'CTO / Engineering — cementitious materials and motion-control expertise; owns the concrete-mix latitude and runway-rail kinematics.',
      'Commercial lead — residential-construction and building-products go-to-market; running the builder/subcontractor discovery and pilot pipeline.',
      'Advisors — an Ohio production homebuilder and a licensed structural engineer, ensuring code-path and inspection readiness.',
    ]),
    p('The team’s combination of a working printer, direct builder relationships, and Ohio manufacturing intent is the foundation of execution risk mitigation — the highest-weighted TVSF review criterion.'),
  ]},
  { sort: 10, num: '10', type: 'narrative', title: 'ESP Engagement', nodes: [
    h(1, '10. ESP Engagement'),
    p('Foundation has worked with [EC / Entrepreneurial Center] since [date] as its Entrepreneurial Services Provider. The EC has advised on customer discovery with production builders, the financial model behind the Q6 pro-forma, and the structuring of this TVSF application. Foundation’s primary EC contact is [name]; the engagement is ongoing and the EC’s support letter accompanies this proposal (Volume 3).'),
  ]},
  { sort: 11, num: '11', type: 'narrative', title: 'Project Plan', nodes: [
    h(1, '11. Project Plan'),
    p('The 12-month TVSF effort takes the printer to a manufacture-ready configuration and delivers an instrumented, inspection-ready field demonstration with third-party performance data. Milestones are measurable and map one-for-one to the Q3 Gantt.'),
    table([
      ['Milestone', 'Description / Success Criteria'],
      ['MS1 — Concrete-mix latitude', 'Validate printing across 3 locally batched ready-mix designs; layer adhesion meets spec.'],
      ['MS2 — Manufacture-ready nozzle/gate', 'Externally-gated nozzle finalized for production; clean start/stop verified over 200 cycles.'],
      ['MS3 — Trolley/runway production build', 'Production runway-rail trolley assembled and calibrated to ±3mm placement.'],
      ['MS4 — Build-plan pipeline', 'Foundation-plan → print-path software validated on 5 production floor plans.'],
      ['MS5 — Full foundation print (lab)', 'Print a complete footing-to-top-of-wall foundation in a single setup.'],
      ['MS6 — Third-party structural testing', 'Independent lab confirms compressive/flexural performance vs code minimums.'],
      ['MS7 — Field demonstration', 'Print an inspection-ready foundation at a partner builder site; local inspector sign-off.'],
      ['MS8 — Performance data package', 'Publish labor-hour, cost, and quality data package for commercialization.'],
    ]),
  ]},
  { sort: 12, num: '12', type: 'narrative', title: 'Budget: Table and Narrative', nodes: [
    h(1, '12. Budget: Table and Narrative'),
    p('The budget has been vetted with Foundation’s service providers, who have committed to executing on a fixed-price basis to de-risk the TVSF project. Funds are concentrated on manufacture-ready hardware and independent validation.'),
    table([
      ['Spend type', 'OTF (TVSF) funds', 'Cost share', 'Total'],
      ['Personnel', '$95,000', '$40,000', '$135,000'],
      ['Equipment (printer/nozzle/trolley)', '$60,000', '$20,000', '$80,000'],
      ['Supplies (concrete, materials)', '$18,000', '$7,000', '$25,000'],
      ['Purchased services (structural testing, PCB/embedded)', '$77,000', '$8,000', '$85,000'],
      ['Total', '$250,000', '$75,000', '$325,000'],
    ]),
    p('$77,000 in purchased services covers independent structural testing (MS6) and embedded/PCB support to optimize gate control; personnel covers the engineering effort across MS1–MS8.'),
  ]},
  { sort: 13, num: '13', type: 'narrative', title: 'Next Steps', nodes: [
    h(1, '13. Next Steps'),
    p('Immediately upon award, Foundation will execute the field-of-use license from [institution], locking access to the core IP, and issue fixed-price purchase orders to its service providers for the manufacture-ready build. In parallel it will close the concurrent pre-seed round and confirm the partner-builder field-demonstration site so MS7 can proceed on schedule. On completion, Foundation will convert its discovery-stage builder relationships into paid pilots using the MS8 performance-data package.'),
  ]},
  { sort: 14, num: '14', type: 'narrative', title: 'Major Risks and Mitigation', nodes: [
    h(1, '14. Major Risks and Mitigation'),
    bullets([
      'Concrete-mix variability across regions — mitigated by MS1 (latitude testing across multiple local ready-mix designs) and the external gate’s tolerance to mix variation.',
      'Code/inspection acceptance — mitigated by MS6 third-party structural testing and MS7 inspector sign-off, plus a licensed structural-engineer advisor.',
      'Adoption inertia among subcontractors — mitigated by the lease-plus-usage model (low barrier) and the MS8 labor/cost data package that quantifies the savings.',
      'Supply-chain/manufacturing scale — mitigated by fixed-price service-provider commitments and Ohio-based assembly.',
    ]),
  ]},
];

// Volume 2 + 3 letters (required, template examples)
const V2 = { sort: 100, num: null, type: 'letter', title: 'Willingness-to-License Letter', nodes: [
  h(1, 'Willingness-to-License Letter'),
  p('[Institution letterhead]        [Date]'),
  p('To the Ohio Third Frontier / TVSF Review Committee:'),
  p('[Institution] owns U.S. Patent [number] ("[title]"), covering the external material-flow gate and layer-control method for cementitious printing. [Institution], through its Office of Technology Transfer, confirms that it is willing to license this technology to Foundation on a field-of-use exclusive basis for residential concrete foundations. A license application and commercialization plan have been submitted and are in final negotiation; we anticipate executing a definitive agreement within [timeframe].'),
  p('We support Foundation’s TVSF application to validate and commercialize this technology.'),
  p('Sincerely,  [Name, Title]  —  [Institution], Office of Technology Transfer'),
  p('[This is the required Willingness-to-License letter from the IP-owning institution — replace bracketed fields and attach on institution letterhead, ≤ 1 page.]'),
]};
const V3 = { sort: 200, num: null, type: 'letter', title: 'ESP Support Letter', nodes: [
  h(1, 'ESP Support Letter'),
  p('[EC / Entrepreneurial Center letterhead]        [Date]'),
  p('To the TVSF Review Committee:'),
  p('[EC name] has been working with Foundation since [date] as its Entrepreneurial Services Provider. Over this engagement we have advised the company on customer discovery with production homebuilders, the financial model underlying its pro-forma, and the preparation of this TVSF proposal. Foundation’s 3D-printed-foundation technology addresses a real, quantified market need, and the team is well-positioned to execute the proposed validation project.'),
  p('We endorse this TVSF application and will continue to support the project through award and commercialization.'),
  p('Sincerely,  [Name, Title]  —  [EC name]'),
  p('[This is the required ESP support letter from the Entrepreneurial Services Provider — replace bracketed fields and attach on EC letterhead, ≤ 1 page.]'),
]};

async function main() {
  // 0) numbering root fix — a real integer sort key
  await sql`ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS sort_index integer`;

  const [{ tenantId }] = await sql`SELECT tenant_id AS "tenantId" FROM proposals WHERE id = ${PROPOSAL}`;
  console.log('[rebuild-tvsf] proposal', PROPOSAL, 'tenant', tenantId);

  await sql.begin(async (tx) => {
    // wipe the old (scrambled) structure — clear FK dependents on sections first
    const inSecs = tx`section_id IN (SELECT id FROM proposal_sections WHERE proposal_id = ${PROPOSAL})`;
    await tx`DELETE FROM proposal_comments      WHERE ${inSecs}`;
    await tx`DELETE FROM agent_task_log         WHERE ${inSecs}`;
    await tx`DELETE FROM agent_task_queue       WHERE ${inSecs}`;
    await tx`DELETE FROM canvas_versions        WHERE ${inSecs}`;
    await tx`DELETE FROM proposal_activity_log  WHERE ${inSecs}`;
    await tx`DELETE FROM proposal_compliance_matrix WHERE proposal_id = ${PROPOSAL}`;
    await tx`DELETE FROM proposal_sections WHERE proposal_id = ${PROPOSAL}`;
    await tx`DELETE FROM proposal_artifacts WHERE proposal_id = ${PROPOSAL}`;

    // 3 volumes
    const vols = [
      { n: 1, type: 'narrative', name: 'Narrative' },
      { n: 2, type: 'form', name: 'Willingness-to-License Letter' },   // 'form' = required letter/attachment (CHECK: narrative|cost|form|matrix|other); exports docx
      { n: 3, type: 'form', name: 'ESP Support Letter' },
    ];
    const artByVol = {};
    for (const v of vols) {
      const [{ id }] = await tx`
        INSERT INTO proposal_artifacts (proposal_id, volume_number, volume_name, artifact_type, is_required, status)
        VALUES (${PROPOSAL}, ${v.n}, ${v.name}, ${v.type}, true, 'in_progress') RETURNING id`;
      artByVol[v.n] = id;
    }

    // sections — DETERMINISTIC ids keyed by sort_index, so re-running this script is stable
    // (no id churn → fixtures/screenshots/tests stay valid). Format: valid UUID, sort in the tail.
    const sid = (sort) => `c3db6000-0000-4000-8000-${String(sort).padStart(12, '0')}`;
    const mk = async (s, volNum) => {
      const [{ id }] = await tx`
        INSERT INTO proposal_sections
          (id, proposal_id, artifact_id, section_number, sort_index, title, content, status, volume_name, volume_number, section_type, meta)
        VALUES (${sid(s.sort)}::uuid, ${PROPOSAL}, ${artByVol[volNum]}, ${s.num ?? ''}, ${s.sort}, ${s.title},
                ${doc(s.nodes, { title: s.title })}, 'ai_drafted',
                ${vols.find((v) => v.n === volNum).name}, ${volNum}, ${s.type},
                ${tx.json({ itemType: s.type, canonical: 'TVSF_SPEC' })})
        RETURNING id`;
      return id;
    };
    for (const s of V1) { const sid = await mk(s, 1);
      await tx`INSERT INTO proposal_compliance_matrix (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
               VALUES (${PROPOSAL}, ${s.num ? `Q${s.num}. ${s.title}` : s.title}, ${SRC}, true, 'partial', ${sid})`;
    }
    const wtl = await mk(V2, 2);
    await tx`INSERT INTO proposal_compliance_matrix (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
             VALUES (${PROPOSAL}, ${'Willingness-to-License letter (from IP owner, ≤1 page)'}, ${SRC}, true, 'partial', ${wtl})`;
    const esp = await mk(V3, 3);
    await tx`INSERT INTO proposal_compliance_matrix (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
             VALUES (${PROPOSAL}, ${'ESP support letter (from the EC, ≤1 page)'}, ${SRC}, true, 'partial', ${esp})`;
    await tx`INSERT INTO proposal_compliance_matrix (proposal_id, requirement_text, requirement_source, is_mandatory, status, section_id)
             VALUES (${PROPOSAL}, ${'Format: 7-page narrative; .75in margins; 11pt Times New Roman; 12pt line spacing'}, ${SRC}, true, 'partial', ${null})`;
  });

  const rows = await sql`SELECT section_number, sort_index, volume_number, title FROM proposal_sections WHERE proposal_id = ${PROPOSAL} ORDER BY volume_number, sort_index`;
  console.log('[rebuild-tvsf] rebuilt', rows.length, 'sections:');
  for (const r of rows) console.log(`  vol${r.volume_number}  sort=${String(r.sort_index).padStart(3)}  num=${r.section_number ?? '—'}  ${r.title}`);
  const [{ c }] = await sql`SELECT count(*)::int AS c FROM proposal_compliance_matrix WHERE proposal_id = ${PROPOSAL}`;
  console.log('[rebuild-tvsf] compliance matrix rows:', c);
  await sql.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
