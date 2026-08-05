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
    p('The problem is acute now for two converging reasons. First, the residential-construction trades face a structural skilled-labor shortage that raises cost and lengthens schedule on exactly the manual, weather-exposed work formwork represents. Second, persistent under-supply of entry-level housing has put builders and policymakers under real pressure to take cost and time out of the home. A method that removes ~311 labor hours and a large share of the formwork/material cost from every foundation — without asking the builder to change concrete supplier, code path, or crew skill profile — is therefore both economically compelling and timely.'),
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
    p('The external gate is the technical heart of the product and the reason Foundation can use common concrete. In conventional mortar-extrusion printers, flow is controlled only by the pump, so every start and stop smears material and every layer boundary risks a cold joint — which is why those systems must use an expensive, tightly-specified proprietary mortar to stay printable. Foundation’s gate mechanically opens and closes the material stream at the nozzle independently of the pump, producing clean starts and stops and consistent layer height with ordinary, locally batched ready-mix. That single design choice is what collapses both the cost curve and the supply-chain constraint at the same time, and it is the subject of the licensed patent (Q5).'),
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
    p('Adoption follows a deliberate three-stage path that matches how the market actually buys. Stage one is the MS7 field demonstration plus the two standing letters of intent — a printed, inspector-signed foundation a builder can walk. Stage two is a small number of paid pilots on repeatable production floor plans, where the lease-plus-usage model lets a subcontractor try the printer with no capital outlay. Stage three is fleet expansion with the same builders as printed foundations become the default on their high-volume plans. Because Foundation sells a service rather than a machine, the buyer’s decision is an operating one, not a capital one — the single biggest lever on adoption speed in a conservative trade.'),
  ]},
  { sort: 5, num: '5', type: 'narrative', title: 'IP Position', nodes: [
    h(1, '5. IP Position'),
    p('The technology that is the subject of this TVSF application is protected by a field-of-use exclusive license to a patent owned by the Ohio Institute for Advanced Construction (OIAC), covering the external material-flow gate and layer-control method for cementitious printing (U.S. Patent No. 11,842,516, "Externally-Gated Nozzle and Layer-Control Method for Cementitious Additive Manufacturing," issued March 2024). Foundation has submitted its license application and commercialization plan to OIAC’s Office of Technology Transfer, which has assisted in finalizing terms; a definitive field-of-use exclusive agreement for residential concrete foundations is anticipated within 60 days of award. The willingness-to-license letter accompanying this application (Volume 2) confirms OIAC’s commitment.'),
    p('This IP protects the core differentiator — clean, defect-free layers using common, locally sourced concrete — against the proprietary-mortar and mortar-extrusion approaches every competing printer relies on. A freedom-to-operate review by Foundation’s patent counsel found no blocking claims in the residential-foundation field of use. In addition, Foundation holds two of its own provisional filings — on the runway-rail trolley kinematics and on the build-plan-to-print-path software pipeline — which it will convert to non-provisional applications during the project, building a defensible portfolio around the licensed core.'),
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
    p('The unit economics compound as the fleet matures. A single printer on lease plus per-linear-foot build fees generates recurring revenue from day one and pays back its manufacturing cost within its first full year of utilization; each additional printer added to a subcontractor’s operation raises Foundation’s revenue with little incremental overhead, which is why gross profit turns positive in 2027 and margin expands thereafter. Revenue is intentionally shown as printer-lease-plus-build-fee only — no printer sales and no licensing income — so the pro-forma reflects the recurring core of the business rather than one-time events, and the model reaches sustained net profitability in 2030.'),
  ]},
  { sort: 7, num: '7', type: 'narrative', title: 'Current Financial Stage', nodes: [
    h(1, '7. Current Financial Stage'),
    p('Foundation has raised $650,000 to date — $150,000 from the founders and $500,000 from an Ohio pre-seed fund — and has approximately nine months of operating runway at the current burn. The company is pre-revenue by design: it has deliberately held back commercial installation until the printer is manufacture-ready and independently validated, which is exactly what this TVSF project delivers. Two regional builders have signed non-binding letters of intent to pilot printed foundations once the MS7 field demonstration and MS8 performance data are complete.'),
    p('The funding strategy is to pair the $250,000 TVSF award with a concurrent $1.5M pre-seed round (in diligence with two Ohio funds) to reach the first commercial installations, then raise a seed round on the strength of the third-party field-performance data this project produces. The Q6 pro-forma rests on three assumptions grounded in the discovery interviews: printer lease pricing of $4,500/month, a build fee of $28 per linear foot of printed foundation, and a utilization ramp from one printer in 2026 to a small managed fleet by 2029. TVSF non-dilutive funding is the pivotal input that converts a validated prototype into a leasable, revenue-generating product.'),
  ]},
  { sort: 8, num: '8', type: 'narrative', title: 'Economic Impact on State of Ohio', nodes: [
    h(1, '8. Economic Impact on State of Ohio'),
    p('Foundation is headquartered in the Dayton region and will manufacture and assemble its printers in-state, drawing on Ohio’s advanced-manufacturing supply base for the trolley, runway rails, and gate assembly. Direct employment scales with the fleet: the Q6 model implies roughly 45 skilled Ohio jobs by 2030 — advanced-manufacturing assembly, embedded/controls engineering, and field-service technicians — most of them outside the traditional four-year-degree track and well-matched to Ohio’s workforce.'),
    p('The larger impact is on housing. By cutting foundation labor from ~336 hours to ~25 and formwork/material cost by 47–65%, a printed foundation removes several thousand dollars and days of schedule from every home — a direct contribution to Ohio’s housing-affordability agenda at a moment of acute shortage of entry-level supply. Commercializing the technology in Ohio also anchors a construction-technology cluster around the licensed OIAC IP, keeping the value chain — IP, manufacturing, and the first reference installations — inside the state.'),
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
    p('The team is deliberately weighted toward the two capabilities this stage demands: reducing the invention to a manufacture-ready product, and getting it accepted by a conservative trade. The CEO and CTO have together taken the printer from concept to full-height wall prints, so the technical risk sits with people who have already retired much of it; the commercial lead and the builder/structural-engineer advisors give Foundation a direct line into how foundations are actually bought and inspected. The company will add a manufacturing/operations lead during the project, funded by the pre-seed round, to own the production build and the Ohio assembly line. This combination of a working printer, direct builder relationships, and Ohio manufacturing intent is the core of Foundation’s execution-risk mitigation — the highest-weighted TVSF review criterion.'),
  ]},
  { sort: 10, num: '10', type: 'narrative', title: 'ESP Engagement', nodes: [
    h(1, '10. ESP Engagement'),
    p('Foundation has worked with the Dayton/Miami Valley Entrepreneurs Center (DMVEC) since March 2025 as its Entrepreneurial Services Provider. DMVEC has been substantively involved in three areas that shape this application: it structured and pressure-tested the customer-discovery program with production builders and foundation subcontractors that produced the market evidence in Q1 and Q4; it built and stress-tested the financial model behind the Q6 pro-forma and the Q7 funding plan; and it advised directly on the scope, milestones, and budget of this TVSF project.'),
    p('Foundation’s primary DMVEC contact is its Director of Entrepreneurial Services, who meets with the founding team biweekly and has reviewed this application in full. The engagement is ongoing through award and into commercialization — DMVEC will continue to support the pre-seed raise, the field-demonstration site selection (MS7), and the conversion of discovery-stage relationships into paid pilots. DMVEC’s support letter accompanies this application as Volume 3.'),
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
    p('The plan is sequenced around two go/no-go decision points that protect the award. The first, at the end of MS4, confirms the printer is manufacture-ready before any field commitment; the second, at MS6, requires the independent structural results to meet code minimums before the field demonstration proceeds. Foundation’s service providers (independent structural lab, embedded/PCB house, and machine shop) are contracted on a fixed-price basis against these milestones, so schedule and budget risk are bounded. Each milestone has a written acceptance criterion, and progress is reported to DMVEC and the review committee at the two decision gates.'),
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
    p('$77,000 in purchased services covers independent structural testing (MS6) and embedded/PCB support to optimize gate control; personnel covers the engineering effort across MS1–MS8. The $75,000 cost share (23% of total project cost) is committed and documented: it comprises founder and engineering time already funded by the pre-seed round, in-kind materials and shop access from Foundation’s service providers, and a portion of the equipment build. Because the largest external line items are contracted on a fixed-price basis, the budget carries low overrun risk, and every dollar of TVSF funding is tied to a specific, verifiable milestone deliverable.'),
  ]},
  { sort: 13, num: '13', type: 'narrative', title: 'Next Steps', nodes: [
    h(1, '13. Next Steps'),
    p('Immediately upon award, Foundation will execute the field-of-use license from OIAC — the terms are already negotiated — locking exclusive access to the core IP, and issue fixed-price purchase orders to its service providers for the manufacture-ready build (MS1–MS4). In parallel it will close the concurrent $1.5M pre-seed round and confirm the partner-builder field-demonstration site so MS7 can proceed on schedule.'),
    p('On completion of the 12-month project, Foundation exits with a manufacture-ready printer, an independent structural-test report (MS6), an inspector-signed field demonstration (MS7), and a published labor/cost/quality data package (MS8). Those four assets convert the two standing letters of intent into paid pilots and anchor the seed raise — the path from this TVSF validation to first commercial installation is estimated at 14 months from award.'),
  ]},
  { sort: 14, num: '14', type: 'narrative', title: 'Major Risks and Mitigation', nodes: [
    h(1, '14. Major Risks and Mitigation'),
    p('Foundation has designed the project so that its principal risks are retired early and by evidence rather than assertion. The four highest-consequence risks and their mitigations are:'),
    bullets([
      'Concrete-mix variability across regions — mitigated by MS1 (latitude testing across multiple local ready-mix designs) and the external gate’s tolerance to mix variation.',
      'Code/inspection acceptance — mitigated by MS6 third-party structural testing and MS7 inspector sign-off, plus a licensed structural-engineer advisor.',
      'Adoption inertia among subcontractors — mitigated by the lease-plus-usage model (low barrier) and the MS8 labor/cost data package that quantifies the savings.',
      'Supply-chain/manufacturing scale — mitigated by fixed-price service-provider commitments and Ohio-based assembly.',
      'Financing / dilution — the concurrent $1.5M pre-seed de-risks the plan, and the non-dilutive TVSF award reduces the capital Foundation must raise to reach revenue, protecting the runway through the first commercial installations.',
    ]),
    p('Taken together, the project is structured so that every claim in this application is converted into third-party evidence within twelve months: a manufacture-ready printer, an independent structural-test report, an inspector-signed field demonstration, and a published labor/cost/quality data package. That evidence retires the technical, regulatory, and market-adoption risks in sequence and hands Foundation exactly the assets it needs to convert standing letters of intent into paid pilots and to raise its seed round. Foundation respectfully requests TVSF support to validate a technology that takes cost, labor, and schedule out of every home — built, licensed, and manufactured in Ohio.'),
  ]},
];

// Volume 2 + 3 letters (required, template examples)
const V2 = { sort: 100, num: null, type: 'letter', title: 'Willingness-to-License Letter', nodes: [
  h(1, 'Ohio Institute for Advanced Construction'),
  p('Office of Technology Transfer  ·  Dayton, Ohio'),
  p('February 10, 2026'),
  p('Ohio Third Frontier — Technology Validation and Startup Fund, Review Committee'),
  p('Re: Willingness to License U.S. Patent No. 11,842,516 to Foundation, Inc.'),
  p('Dear Members of the Review Committee:'),
  p('The Ohio Institute for Advanced Construction (OIAC) is the owner of U.S. Patent No. 11,842,516, "Externally-Gated Nozzle and Layer-Control Method for Cementitious Additive Manufacturing" (issued March 2024), which covers the external material-flow gate and layer-control method at the core of Foundation’s residential 3D-printing system. This letter confirms OIAC’s willingness to license that technology to Foundation, Inc.'),
  p('Through our Office of Technology Transfer we have negotiated, and are prepared to execute, a field-of-use exclusive license to Foundation for the residential concrete-foundation market. Foundation submitted a complete license application and commercialization plan, which our office reviewed and helped finalize; definitive terms are agreed in principle, and we anticipate executing the license within sixty (60) days of a TVSF award. The license grants Foundation exclusivity in the residential-foundation field of use, with diligence, reporting, and royalty provisions consistent with our office’s standard practice.'),
  p('We support this application for two reasons. First, Foundation’s team has demonstrated genuine technical command of the invention — printing full-height wall segments with the externally-gated nozzle using standard ready-mix concrete — which gives us confidence the technology will be validated and reduced to practice at production scale. Second, commercializing this patent through an Ohio company, with printers manufactured in Ohio, advances precisely the technology-to-market mission that our institute and the Ohio Third Frontier share.'),
  p('OIAC endorses Foundation’s TVSF application without reservation and stands ready to execute the field-of-use license upon award. Please contact our Office of Technology Transfer with any questions.'),
  p('Sincerely,'),
  p('Director, Office of Technology Transfer'),
  p('Ohio Institute for Advanced Construction'),
]};
const V3 = { sort: 200, num: null, type: 'letter', title: 'ESP Support Letter', nodes: [
  h(1, 'Dayton/Miami Valley Entrepreneurs Center'),
  p('Entrepreneurial Services Provider  ·  Dayton, Ohio'),
  p('February 10, 2026'),
  p('Ohio Third Frontier — Technology Validation and Startup Fund, Review Committee'),
  p('Re: Entrepreneurial Services Provider Support for Foundation, Inc.'),
  p('Dear Members of the Review Committee:'),
  p('The Dayton/Miami Valley Entrepreneurs Center (DMVEC) is Foundation’s Entrepreneurial Services Provider and has worked closely with the company since March 2025. We write in strong support of Foundation’s Technology Validation and Startup Fund application.'),
  p('Our engagement has been substantive, not advisory in name only. DMVEC helped Foundation design and run the customer-discovery program with production homebuilders and foundation subcontractors that produced the market evidence in this application; we built and stress-tested the financial model behind the company’s pro-forma and funding plan; and we advised directly on the scope, milestones, and budget of the proposed TVSF project. We meet with the founding team on a biweekly basis and have reviewed this application in full.'),
  p('On that basis we can speak to both the opportunity and the team. Foundation’s 3D-printed-foundation technology addresses a real, quantified, and timely market need — the labor-intensive formwork cycle that adds hundreds of hours and thousands of dollars to every home. The founding team pairs a working printer with direct builder relationships and a credible Ohio-manufacturing plan, and it has been disciplined about validating before it scales. In our assessment the team is well-positioned to execute the proposed validation project and to commercialize the result in Ohio.'),
  p('DMVEC endorses this application and will continue to support Foundation through award and into commercialization — including the pre-seed raise, field-demonstration site selection, and the conversion of discovery-stage relationships into paid pilots. We would be glad to answer any questions the committee may have.'),
  p('Sincerely,'),
  p('Director of Entrepreneurial Services'),
  p('Dayton/Miami Valley Entrepreneurs Center'),
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
