/**
 * Generate the complete Aerivio Systems → US Navy STTR Phase I proposal
 * deliverables via the real exporters (docx / pptx / xlsx / pdf), and persist
 * each canvas document as a reusable example template.
 *
 * Fictional. Same small business (Aerivio) as the AFWERX CSO sample — so its
 * library reuses across pursuits — now teamed with a Research Institution
 * (Cascadia State University) as an STTR requires. Deliverables:
 *   • Technical Volume        — 10 pages (docx + pdf)
 *   • Statement of Work       — 5 pages  (docx + pdf), separate volume
 *   • Cost Volume             — 18-mo $250k base + 6-mo $150k option (xlsx)
 *   • Company Overview deck   — 10 slides (pptx), Volume 5 supporting document
 *
 *   cd frontend && npx tsx scripts/gen-navy-sttr-proposal.mts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import { createSection, createGroup } from '@/lib/types/canvas-document';
import type { CanvasDocument, CanvasNode, CanvasRules, CanvasSection, CanvasGroup } from '@/lib/types/canvas-document';

// ── node builders (shared with gen-sample-proposal.mts) ──────────────────────
const Nn = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: crypto.randomUUID(), type, content: content as CanvasNode['content'], style: style as CanvasNode['style'],
  provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const h = (level: 1 | 2 | 3, text: string, color?: string) => Nn('heading', { level, text }, color ? { color } : {});
const p = (text: string, formats: Array<{ start: number; length: number; format: string }> = [], style: Record<string, unknown> = {}) =>
  Nn('text_block', { text, inline_formats: formats }, style);
const P = (t: string) => p(t);
const ul = (items: string[]) => Nn('bulleted_list', { items: items.map((t) => ({ text: t })) });
const ol = (items: string[]) => Nn('numbered_list', { items: items.map((t) => ({ text: t })) });
const cap = (prefix: string, number: number, text: string) => Nn('caption', { prefix, number, text });
const table = (headers: unknown[], rows: unknown[][], headerBg = '#0f2942') => Nn('table', { headers, rows, header_style: { bg: headerBg, bold: true } });
const fmt = (text: string, sub: string, format: string) => { const s = text.indexOf(sub); return s < 0 ? [] : [{ start: s, length: sub.length, format }]; };
const img = (svg: string, alt: string, w: number, hgt: number, caption?: string) =>
  Nn('image', { storage_key: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), alt_text: alt, width: w, height: hgt, caption });

// ── SVG placeholder generators ──────────────────────────────────────────────
const svgHeadshot = (initials: string, c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#f1f5f9"/><circle cx="75" cy="60" r="34" fill="${c}"/><rect x="33" y="100" width="84" height="46" rx="20" fill="${c}"/><text x="75" y="70" text-anchor="middle" font-family="Arial" font-size="26" fill="#fff" font-weight="bold">${initials}</text></svg>`;
const svgFacility = (label: string, c1 = '#0369a1', c2 = '#0284c7', bg = '#e0f2fe') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="190"><rect width="340" height="190" fill="${bg}"/><rect x="30" y="70" width="130" height="100" fill="${c1}"/><rect x="175" y="40" width="135" height="130" fill="${c2}"/><rect x="45" y="90" width="20" height="20" fill="#bae6fd"/><rect x="80" y="90" width="20" height="20" fill="#bae6fd"/><rect x="115" y="90" width="20" height="20" fill="#bae6fd"/><rect x="195" y="60" width="22" height="22" fill="#f0f9ff"/><rect x="235" y="60" width="22" height="22" fill="#f0f9ff"/><rect x="275" y="60" width="22" height="22" fill="#f0f9ff"/><text x="170" y="184" text-anchor="middle" font-family="Arial" font-size="12" fill="#0c4a6e">${label}</text></svg>`;
// Distributed undersea sensing mesh → fusion → undersea picture (the Navy STTR architecture)
const svgMesh = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="220"><rect width="460" height="220" fill="#ecfeff"/>
   ${[[60, 60], [60, 150], [130, 105], [40, 105]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="16" fill="#0e7490"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-family="Arial" font-size="9" fill="#fff">node</text>`).join('')}
   ${[[60, 60, 130, 105], [60, 150, 130, 105], [40, 105, 130, 105], [60, 60, 40, 105], [60, 150, 40, 105]].map(([a, b, c, d]) => `<line x1="${a}" y1="${b}" x2="${c}" y2="${d}" stroke="#67e8f9" stroke-width="2"/>`).join('')}
   <rect x="180" y="80" width="120" height="52" rx="6" fill="#0891b2"/><text x="240" y="102" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">Edge Fusion</text><text x="240" y="118" text-anchor="middle" font-family="Arial" font-size="9" fill="#cffafe">(on-node CNN + consensus)</text>
   <rect x="330" y="50" width="110" height="45" rx="6" fill="#0284c7"/><text x="385" y="77" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">Undersea Picture</text>
   <rect x="330" y="120" width="110" height="45" rx="6" fill="#0369a1"/><text x="385" y="147" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">USV / Autonomy</text>
   <line x1="130" y1="105" x2="180" y2="106" stroke="#334155" stroke-width="2"/><line x1="300" y1="98" x2="330" y2="74" stroke="#334155" stroke-width="2"/><line x1="300" y1="112" x2="330" y2="140" stroke="#334155" stroke-width="2"/></svg>`;
const svgChart = (title: string, bars: Array<[string, number, string]>) => {
  const max = Math.max(...bars.map((b) => b[1])); const bw = 70, gap = 30, base = 170;
  const rects = bars.map((b, i) => { const bh = Math.round((b[1] / max) * 120); const x = 40 + i * (bw + gap); return `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" fill="${b[2]}"/><text x="${x + bw / 2}" y="${base + 15}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">${b[0]}</text><text x="${x + bw / 2}" y="${base - bh - 5}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">$${b[1]}M</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="200"><rect width="440" height="200" fill="#fff"/><text x="20" y="24" font-family="Arial" font-size="13" font-weight="bold" fill="#0f2942">${title}</text>${rects}</svg>`;
};

// ── canvas rules ─────────────────────────────────────────────────────────────
const letter = (title: string, footer: string, size = 11, spacing = 1.35, maxPages = 20): CanvasRules => ({
  format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: `{company_name} — ${title}`, font: { family: 'Arial', size: 10.5 }, height: 22 } as CanvasRules['header'],
  footer: { template: `${footer} · Page {n} of {N}`, font: { family: 'Arial', size: 10.5 }, height: 22 } as CanvasRules['footer'],
  font_default: { family: 'Georgia', size, color: '#111827' }, line_spacing: spacing, max_pages: maxPages, max_slides: null,
});
const meta = (title: string) => ({ title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const });
const doc = (canvas: CanvasRules, nodes: CanvasNode[], title: string): CanvasDocument =>
  ({ version: 1, document_id: crypto.randomUUID(), canvas, nodes, metadata: meta(title) });

// ── v2 section builders — sections FLOW; figures/tables are keep-together ─────
// G() = a flowing group of nodes; K() = a keep-together group (a figure+caption
// or table+caption that must not split across a page). S() = a flow section.
// No forced page breaks: the paginator reports the emergent page count, and
// content runs continuously across page boundaries (no bottom-of-page gaps).
const G = (...nodes: CanvasNode[]): CanvasGroup => createGroup(nodes);
const K = (label: string, ...nodes: CanvasNode[]): CanvasGroup => createGroup(nodes, { keepTogether: true, label });
const S = (title: string | undefined, ...groups: CanvasGroup[]): CanvasSection =>
  createSection({ title, groups, layout: { mode: 'flow' } });
const docV2 = (canvas: CanvasRules, sections: CanvasSection[], title: string): CanvasDocument =>
  ({ version: 2, document_id: crypto.randomUUID(), canvas, nodes: [], sections, metadata: meta(title) });

const VARS = {
  company_name: 'Aerivio Systems',
  ri_name: 'Cascadia State University',
  ri_lab: 'Applied Ocean Acoustics Laboratory',
  topic_number: 'N25B-T042',
  topic_title: 'Distributed Edge Acoustic Sensing for Contested Undersea Environments',
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. TECHNICAL VOLUME — 10 pages
// ═══════════════════════════════════════════════════════════════════════════
const tv = docV2(letter('Technical Volume', 'Navy STTR Phase I · Topic N25B-T042 · Proprietary', 11.5, 1.5, 10), [
  S('Volume 2 — Technical Volume',
    G(
      h(1, 'Volume 2 — Technical Volume', '#0f2942'),
      p('{company_name} (Small Business) with {ri_name}, {ri_lab} (Research Institution)', fmt('{company_name} (Small Business) with {ri_name}, {ri_lab} (Research Institution)', '{company_name}', 'bold')),
      p('US Navy STTR Phase I · Topic {topic_number}: {topic_title}', [], { color: '#475569' }),
      p('Base Period: 18 months / $250,000   ·   Option: 6 months / $150,000   ·   Distribution: Proprietary', [], { color: '#475569' }),
    ),
  ),
  S('1. Identification and Significance of the Problem',
    G(
      h(2, '1. Identification and Significance of the Problem', '#0e7490'),
      P('The Navy is fielding distributed unmanned maritime systems — unmanned surface vessels and unattended undersea nodes — to hold contested waters at scale. Their value depends on classifying acoustic contacts (submarines, torpedoes, surface combatants, biologics) reliably, yet the undersea channel denies the connectivity those systems assume. Nodes cannot relay raw acoustics to a shore or ship-borne processor in real time: acoustic backhaul is low-rate, RF is unavailable underwater, and a surfacing node is a detectable node. Classification must therefore happen at the edge, on each node, within a severe power and compute budget — and, crucially, the nodes must agree, fusing weak local evidence into one undersea picture without a central processor.'),
      P('Aerivio’s AFWERX Phase I effort proved that a maritime acoustic classifier can be compressed to 4-bit precision and run on a single 2-watt vessel module while holding balanced accuracy above 92%. That result is the point of departure here. The unsolved problem this STTR addresses is distribution: propagation-aware classification across a mesh of independent, power-starved nodes, where each node hears a different, degraded slice of the same event and the network must reach consensus at the tactical edge. Solving it requires two capabilities Aerivio does not hold alone — rigorous underwater-acoustic propagation science and access to representative range data — which is precisely why this is proposed as an STTR with a research institution.'),
    ),
  ),
  S('2. Phase I Technical Objectives',
    G(
      h(2, '2. Phase I Technical Objectives', '#0e7490'),
      P('Phase I establishes feasibility of propagation-aware, distributed edge classification against pre-registered, defense-relevant criteria:'),
      ol([
        'Objective 1 — With the Research Institution, characterize the undersea acoustic channel for the target environments and assemble a propagation-labeled multi-node corpus with documented provenance.',
        'Objective 2 — Extend Aerivio’s 4-bit edge classifier to consume propagation features and emit calibrated per-node class posteriors within the 2-watt node budget.',
        'Objective 3 — Design and simulate a lightweight consensus protocol that fuses per-node posteriors over a low-rate acoustic link into a single classification with quantified confidence.',
        'Objective 4 — Validate accuracy, latency, power, and fusion gain against multi-node scenarios; document results, limitations, and the Phase II at-sea plan.',
      ]),
      h(3, '2.1 Technical Approach', '#155e75'),
      P('Each node runs on-device feature extraction and a quantized CNN, then exchanges compact posteriors with neighbors over the acoustic link; an on-node consensus step fuses them into an undersea picture that feeds the autonomy bus. Figure 1 shows the distributed architecture. All inference and fusion occur on-node at a measured 2.0-watt draw — no central processor, no assumption of backhaul.'),
    ),
    K('Figure 1 — distributed architecture',
      img(svgMesh(), 'Distributed sensing mesh: acoustic nodes exchanging posteriors into an edge-fusion step feeding the undersea picture and USV autonomy', 440, 210),
      cap('Figure', 1, 'Distributed edge acoustic-sensing architecture (per-node inference + consensus fusion).'),
    ),
    G(
      P('Two co-designed advances make this feasible. First, propagation-aware features: the Research Institution’s channel models supply per-node context (multipath, absorption, sound-speed profile) that Aerivio folds into the classifier as auxiliary inputs, so a node discounts evidence its own geometry makes unreliable. Second, posterior consensus: rather than sharing raw audio, nodes exchange low-rate calibrated posteriors and reach agreement through a bandwidth-frugal fusion rule, turning several weak, partial observations into one confident classification.', fmt('Two co-designed advances make this feasible. First, propagation-aware features: the Research Institution’s channel models supply per-node context (multipath, absorption, sound-speed profile) that Aerivio folds into the classifier as auxiliary inputs, so a node discounts evidence its own geometry makes unreliable. Second, posterior consensus', 'propagation-aware features', 'bold')),
      P('The classifier reuses Aerivio’s validated quantization-aware training and saliency-guided pruning (patent pending) so the added propagation inputs and fusion logic still fit the 2-watt budget. Preliminary single-node results from the prior effort (Table 1) anchor the Phase I targets; the Phase I novelty is the propagation coupling and the multi-node fusion gain.'),
    ),
    K('Table 1 — prior vs. Phase I targets',
      table(['Metric', 'Single-node baseline (prior)', 'Phase I distributed target'], [
        ['Balanced accuracy (F1), per node', '92%', '92%+'],
        ['Balanced accuracy, 4-node fused', '—', { text: '96%+', style: { bold: true, bg: '#dcfce7' } }],
        ['End-to-end latency (p99), on node', '<100 ms', '<150 ms incl. fusion'],
        ['Sustained power draw, per node', '2.0 W', { text: '2.0 W', style: { bold: true, bg: '#dcfce7' } }],
      ]),
      cap('Table', 1, 'Prior single-node result vs. Phase I distributed targets (fusion gain is the objective).'),
    ),
  ),
  S('3. Research Institution Partnership and Cooperative Arrangement',
    G(
      h(2, '3. Research Institution Partnership and Cooperative Arrangement', '#0e7490'),
      P('This effort is a cooperative research partnership between {company_name} (the Small Business Concern and prime) and the {ri_lab} at {ri_name} (the Research Institution). It satisfies the STTR requirement for a formal SBC–RI collaboration and the statutory work-split: the SBC performs not less than 40% and the RI not less than 30% of the work, measured by cost.', fmt('It satisfies the STTR requirement for a formal SBC–RI collaboration and the statutory work-split: the SBC performs not less than 40% and the RI not less than 30% of the work, measured by cost.', 'not less than 40%', 'bold')),
    ),
    K('Table 2 — work allocation',
      table(['Party', 'Role', 'Share of effort', 'Primary responsibility'], [
        ['{company_name} (SBC, prime)', 'Edge AI & integration', { text: '56%', style: { bold: true } }, 'Classifier, quantization, on-node runtime, fusion implementation'],
        ['{ri_name} (RI)', 'Ocean acoustics research', { text: '35%', style: { bold: true } }, 'Channel characterization, propagation models, corpus, evaluation'],
        ['Consultant & shared costs (other)', 'Independent review + shared travel', '9%', 'Evaluation-protocol and data-management review; at-sea coordination'],
      ]),
      cap('Table', 2, 'Program (base + option) work allocation — SBC ≥ 40%, RI ≥ 30% (satisfied at 56% / 35%; see Cost Volume Summary).'),
    ),
    G(
      P('Principal Investigator. Dr. Mara Ellison is the single PI for the effort and is primarily employed (>50%) by {company_name}, consistent with STTR rules permitting the PI at either party. Dr. Ligia Okonkwo (Cascadia State) serves as RI Co-Investigator and technical lead for the ocean-acoustics tasks.'),
      P('Allocation of rights. An Allocation of Rights Agreement between {company_name} and {ri_name} is executed prior to award (attached to the Cost Volume). It assigns background IP to its owner, grants the SBC an exclusive option to foreground IP for commercialization, and gives the RI retained rights for internal research and publication subject to a pre-publication review period. This structure keeps the transition path unencumbered while protecting the RI’s academic mission.', fmt('Allocation of rights. An Allocation of Rights Agreement between {company_name} and {ri_name} is executed prior to award (attached to the Cost Volume).', 'Allocation of rights.', 'bold')),
    ),
  ),
  S('4. Related Work',
    G(
      h(2, '4. Related Work', '#0e7490'),
      P('Distributed acoustic sensing has been studied for seismic and pipeline monitoring, but those systems assume power and backhaul that undersea nodes lack. Edge-audio classification work targets keyword spotting at low class counts, not multi-class maritime threat discrimination under a hard power ceiling. Decentralized sensor-fusion literature offers consensus algorithms, but typically assumes rich inter-node bandwidth rather than a low-rate acoustic link. Aerivio’s contribution — validated in the prior single-node effort — is compressing an accurate maritime classifier to a 2-watt budget; the Research Institution’s contribution is rigorous, range-validated propagation modeling. The novel coupling proposed here, propagation-aware features feeding a bandwidth-frugal posterior-consensus rule, has not, to our knowledge, been demonstrated for undersea threat classification.'),
    ),
  ),
  S('5. Key Personnel',
    G(
      h(2, '5. Key Personnel', '#0e7490'),
      P('Dr. Mara Ellison (PI, {company_name}) — 12 years in low-power machine learning for sensing; author of the quantization research underpinning Aerivio’s core IP; led the AFWERX Phase I classifier. Tomas Reyes (Senior Systems Engineer, {company_name}) — 9 years of embedded real-time systems and two fielded maritime autonomy stacks; owns the on-node runtime and fusion implementation. Priya Nandakumar (ML Engineer, {company_name}) — model compression and data augmentation; leads corpus integration and quantization-aware training.'),
      P('Dr. Ligia Okonkwo (RI Co-Investigator, {ri_name}) — 15 years in underwater acoustic propagation and array processing; directs the Applied Ocean Acoustics Laboratory and its range-test program. Two graduate researchers support channel characterization and corpus labeling. Full biographies for all key personnel appear in the Volume 5 supporting documents.', fmt('Dr. Ligia Okonkwo (RI Co-Investigator, {ri_name}) — 15 years in underwater acoustic propagation and array processing; directs the Applied Ocean Acoustics Laboratory and its range-test program.', 'Dr. Ligia Okonkwo', 'bold')),
    ),
  ),
  S('6. Facilities and Equipment',
    G(
      h(2, '6. Facilities and Equipment', '#0e7490'),
      P('Small Business ({company_name}). A 3,200 sq ft engineering facility with a dedicated acoustics bench, a custom anechoic test enclosure, six 2-watt edge-compute development kits, an on-premises GPU training cluster, and a calibrated power-measurement bench for rail-level draw. All Phase I edge-AI development and benchmarking is performed in-house.'),
    ),
    K('Figure 2 — Aerivio facility',
      img(svgFacility('Aerivio HQ — Edge AI & Acoustics Lab'), 'Aerivio facility illustration', 320, 178),
      cap('Figure', 2, 'Aerivio engineering and acoustics laboratory (illustration).'),
    ),
    G(
      P('Research Institution ({ri_name}). The {ri_lab} operates a calibrated acoustic test tank, a multi-element hydrophone array, a coastal test range with documented environmental characterization, and high-performance computing for propagation modeling. This provides representative undersea acoustic conditions and range data no small business could economically replicate — the core rationale for the STTR teaming.', fmt('This provides representative undersea acoustic conditions and range data no small business could economically replicate — the core rationale for the STTR teaming.', 'the core rationale for the STTR teaming', 'italic')),
    ),
    K('Figure 3 — Cascadia facility',
      img(svgFacility('Cascadia State — Applied Ocean Acoustics Lab', '#155e75', '#0e7490', '#cffafe'), 'Cascadia State ocean acoustics laboratory illustration', 320, 178),
      cap('Figure', 3, 'Cascadia State Applied Ocean Acoustics Laboratory (illustration).'),
    ),
  ),
  S('7. Relationship with Future R&D and Commercialization',
    G(
      h(2, '7. Relationship with Future R&D and Commercialization', '#0e7490'),
      P('Phase I establishes feasibility in simulation and tank/range tests. Phase II hardens the node software, extends the corpus to fielded recordings, and conducts an at-sea multi-node demonstration against the same gates plus a robustness gate across sea states; we anticipate pursuing approximately $1.6M over 24 months. Phase III targets integration with a Navy undersea or USV program of record through the relevant program office. Because classification and fusion run within the existing node power budget, transition is a software integration and accreditation effort rather than a hardware program — materially lowering the transition barrier.'),
      P('Commercialization follows a dual-use path: Navy undersea and USV programs first, then allied navies, then commercial maritime domain awareness — port and offshore-energy protection — where the same propagation-aware, power-efficient distributed classifier applies with minimal modification. The RI partnership additionally seeds a talent and follow-on-research pipeline. Full commercialization detail is provided in the Volume 5 company overview.'),
    ),
  ),
  S('8. Foreign Nationals, Prior Support, and Certifications',
    G(
      h(2, '8. Foreign Nationals, Prior Support, and Certifications', '#0e7490'),
      P('Foreign nationals. {company_name} anticipates no foreign nationals performing on the SBC scope. Any RI personnel requiring disclosure will be identified to the Contracting Officer with country of origin and visa/work-permit status prior to participation, consistent with the solicitation.'),
      P('Prior, current, or pending support. The specific work proposed — propagation-aware, 4-bit distributed undersea acoustic classification under a 2-watt per-node ceiling — has not been submitted to or funded by another Federal agency. Aerivio’s background IP (saliency-guided quantization) was developed under internal funds and matured under the prior AFWERX Phase I; the distributed and propagation-coupling work is new to this effort. Any overlapping proposal submitted during evaluation will be promptly disclosed to the Contracting Officer.'),
      P('Human/animal subjects, hazardous materials: none. All data derives from Distribution-A corpora plus synthetic augmentation and the RI’s range collections under its existing environmental authorizations — no classified or controlled data in Phase I.'),
      h(3, 'References', '#155e75'),
      ul([
        '[1] Ellison, M. et al., "Saliency-Guided Quantization for Acoustic Edge Inference," 2025 (in prep).',
        '[2] Okonkwo, L. et al., "Range-Validated Propagation Models for Shallow-Water Classification," J. Acoust. 2024.',
        '[3] Reyes, T., "Deterministic Scheduling for Sub-Watt Inference," Embedded ML Workshop, 2024.',
        '[4] Jacob, B. et al., "Quantization and Training of Neural Networks for Efficient Integer-Arithmetic Inference," 2018.',
      ]),
      h(3, 'Compliance Cross-Reference', '#155e75'),
      P('This volume addresses each Navy STTR Phase I required element; the full compliance matrix is maintained in the proposal workspace and advances to “satisfied” as each section is accepted and locked.'),
    ),
    K('Compliance cross-reference table',
      table(['Required element', 'Section'], [
        ['Significance of the problem', '1'],
        ['Technical objectives', '2'],
        ['Research Institution & cooperative arrangement', '3'],
        ['Related work', '4'],
        ['Key personnel (SBC + RI)', '5'],
        ['Facilities/equipment (SBC + RI)', '6'],
        ['Future R&D / commercialization', '7'],
        ['Foreign nationals / prior support / certs', '8'],
        ['Statement of work', 'Volume 3 (separate)'],
        ['Cost', 'Volume 4 (separate)'],
      ]),
    ),
  ),
], 'Aerivio Navy STTR Technical Volume');

// ═══════════════════════════════════════════════════════════════════════════
// 2. STATEMENT OF WORK — 5 pages (separate volume)
// ═══════════════════════════════════════════════════════════════════════════
const sow = docV2(letter('Statement of Work', 'Navy STTR Phase I · Topic N25B-T042 · Proprietary', 11, 1.4, 5), [
  S('Volume 3 — Statement of Work',
    G(
      h(1, 'Volume 3 — Statement of Work', '#0f2942'),
      p('{company_name} (SBC) with {ri_name} (RI) · Navy STTR Phase I · Topic {topic_number}', [], { color: '#475569' }),
      p('Base Period: 18 months / $250,000   ·   Option Period: 6 months / $150,000', [], { color: '#475569' }),
      P('This Statement of Work defines the tasks, responsibilities, deliverables, and schedule for the Phase I base period and the priced option. Responsibility is marked SBC ({company_name}), RI ({ri_name}), or Joint. The task structure preserves the STTR work-split (SBC ≥ 40%, RI ≥ 30%); the cost realization of that split is in the Cost Volume.'),
      P('The base period is a single 18-month period of performance decomposed into five tasks. Two run largely in parallel — the RI-led channel and corpus track (Task 1) and the SBC-led classifier track (Task 2) — and converge in the joint fusion and validation tasks (Tasks 4–5). The priced option adds a hardware-in-the-loop prototype and a tank/at-sea pre-demonstration that carry the effort to a Phase II readiness decision. Each task below states scope, the responsible party and level of effort, and a concrete deliverable; all levels of effort are consistent with the Cost Volume.'),
    ),
  ),
  S('Base Period Tasks (Months 1–18)',
    G(h(2, 'Base Period Tasks (Months 1–18)', '#0e7490')),
    K('Table 1 — base task summary',
      table(['Task', 'Title', 'Lead', 'Months', 'Deliverable'], [
        ['1', 'Channel characterization & corpus', 'RI', '1–6', 'Propagation-labeled multi-node corpus + data card'],
        ['2', 'Propagation-aware classifier', 'SBC', '3–9', 'Extended 4-bit model + accuracy report'],
        ['3', 'On-node runtime & power', 'SBC', '7–12', 'Node runtime + power/latency benchmark log'],
        ['4', 'Consensus fusion design & simulation', 'Joint', '9–15', 'Fusion protocol + simulated fusion-gain report'],
        ['5', 'Integrated validation & Phase II plan', 'Joint', '14–18', 'Phase I feasibility report + Phase II at-sea plan'],
      ]),
      cap('Table', 1, 'Base period task summary (18-month period of performance).'),
    ),
    G(
      h(3, 'Task 1 — Channel Characterization and Corpus (RI, Months 1–6)', '#155e75'),
      P('The Research Institution characterizes the undersea acoustic channel for the target shallow-water environments — multipath structure, absorption, and sound-speed profiles — and assembles a propagation-labeled, multi-node corpus from range collections and Distribution-A sources, balanced across threat classes and documented in a data card. Effort: RI Co-I 0.20 FTE + one graduate researcher. Deliverable: propagation-labeled multi-node corpus + data card.'),
      h(3, 'Task 2 — Propagation-Aware Classifier (SBC, Months 3–9)', '#155e75'),
      P('Aerivio extends its 4-bit classifier to consume the RI’s propagation features as auxiliary inputs and emit calibrated per-node posteriors, retraining with quantization-aware training and saliency-guided pruning so the added inputs still fit the 2-watt budget. Effort: PI 0.25 FTE + ML engineer 0.20 FTE. Deliverable: extended 4-bit model + accuracy report on a session-disjoint split.'),
      h(3, 'Task 3 — On-Node Runtime and Power (SBC, Months 7–12)', '#155e75'),
      P('Port the extended classifier to the 2-watt node, integrate the deterministic scheduler, and benchmark p99 latency and sustained rail power under continuous load. Effort: systems engineer 0.35 FTE. Deliverable: node runtime + power/latency benchmark log.'),
      h(3, 'Task 4 — Consensus Fusion Design and Simulation (Joint, Months 9–15)', '#155e75'),
      P('Jointly design a bandwidth-frugal posterior-consensus rule for the low-rate acoustic link and quantify fusion gain in a multi-node simulator driven by the Task 1 corpus and channel models. SBC owns the on-node implementation; RI owns the channel-accurate simulation. Deliverable: fusion protocol specification + simulated fusion-gain report.'),
      h(3, 'Task 5 — Integrated Validation and Phase II Plan (Joint, Months 14–18)', '#155e75'),
      P('Validate accuracy, per-node latency and power, and multi-node fusion gain against pre-registered gates (per-node balanced F1 ≥ 0.92; 4-node fused F1 ≥ 0.96; per-node p99 ≤ 150 ms; sustained ≤ 2.0 W). Document results, limitations, and the Phase II at-sea demonstration plan. Deliverable: Phase I feasibility report + Phase II plan.'),
    ),
  ),
  S('Option Period Tasks (Months 19–24, if exercised)',
    G(h(2, 'Option Period Tasks (Months 19–24, if exercised)', '#0e7490')),
    K('Table 2 — option task summary',
      table(['Task', 'Title', 'Lead', 'Months', 'Deliverable'], [
        ['6', 'Hardware-in-the-loop node prototype', 'SBC', '19–22', 'Multi-node HIL bench + test report'],
        ['7', 'Tank/at-sea pre-demonstration', 'Joint', '21–24', 'Range pre-demo results + Phase II readiness memo'],
      ]),
      cap('Table', 2, 'Priced option task summary (6-month period of performance).'),
    ),
    G(
      h(3, 'Task 6 — Hardware-in-the-Loop Node Prototype (SBC, Months 19–22)', '#155e75'),
      P('Assemble a multi-node hardware-in-the-loop bench and exercise the fusion protocol across physical nodes under injected channel conditions. Effort: systems engineer 0.30 FTE + PI 0.10 FTE. Deliverable: HIL bench + test report.'),
      h(3, 'Task 7 — Tank/At-Sea Pre-Demonstration (Joint, Months 21–24)', '#155e75'),
      P('Conduct a controlled tank and short at-sea pre-demonstration at the RI range to confirm fusion gain under real propagation, de-risking the Phase II demonstration. Deliverable: range pre-demo results + Phase II readiness memo.'),
    ),
  ),
  S('Risk Management',
    G(
      h(2, 'Risk Management', '#0e7490'),
      P('Feasibility is judged against pre-registered gates, all of which must pass. The principal technical risks and their mitigations are tracked from kickoff and reviewed at each monthly status memo; the mid-base review (Month 9) is the decision point for the Task 3 latency budget and the Task 4 fusion approach.'),
    ),
    K('Table 3 — risk register',
      table(['Risk', 'Likelihood', 'Impact', 'Mitigation'], [
        ['Propagation features do not improve accuracy', 'Medium', 'High', 'Ablate auxiliary inputs early (Task 2); fall back to per-node calibration only'],
        ['Fusion gain below target on low-rate link', 'Medium', 'High', 'Bandwidth-frugal posterior sharing; simulate link budget in Task 4 before commit'],
        ['On-node latency exceeds 150 ms with fusion', 'Low', 'High', 'Reserve cores + static schedule; profile fusion cost early in Task 3'],
        ['RI corpus/range schedule slips', 'Low', 'Medium', 'Task 1 front-loaded; Distribution-A sources bridge until range data lands'],
        ['SBC/RI interface churn', 'Low', 'Medium', 'Shared data card + interface control memo at Month 3'],
      ]),
      cap('Table', 3, 'Principal Phase I risks, likelihood, impact, and mitigation.'),
    ),
    G(
      P('Cross-cutting mitigations: the effort is structured so that the SBC edge-AI track and the RI ocean-acoustics track can proceed in parallel with a small number of well-defined interfaces (the propagation feature schema and the posterior format), limiting the blast radius of any single slip.'),
    ),
  ),
  S('Deliverables and Schedule',
    G(h(2, 'Deliverables and Schedule', '#0e7490')),
    K('Table 4 — milestone schedule',
      table(['Milestone', 'Month', 'Responsible'], [
        ['Kickoff + Allocation of Rights confirmed', '1', 'Joint'],
        ['Corpus + data card', '6', 'RI'],
        ['Extended classifier accuracy report', '9', 'SBC'],
        ['Node runtime + benchmark log', '12', 'SBC'],
        ['Fusion-gain simulation report', '15', 'Joint'],
        ['Phase I final report + Phase II plan', '18', 'Joint'],
        ['Option: range pre-demo results', '24', 'Joint'],
      ]),
      cap('Table', 3, 'Milestone schedule across base and option periods.'),
    ),
    G(
      P('Reporting: monthly technical status memos and financial reporting, a mid-base review at Month 9, and a Phase I final review at Month 18. All deliverables are furnished with clearly marked data rights consistent with the Allocation of Rights Agreement.'),
    ),
  ),
  S('Data Management and Rights',
    G(
      h(2, 'Data Management and Rights', '#0e7490'),
      P('All Phase I data derives from Distribution-A corpora plus synthetic augmentation and the RI’s range collections gathered under its existing environmental authorizations — no classified or controlled data. The corpus, channel models, and trained artifacts are versioned and retained for the period of performance plus three years, with a shared data card documenting provenance, class balance, and known limitations. Foreground results are delivered to the Government with rights clearly marked; background IP (the SBC’s saliency-guided quantization and the RI’s propagation models) is retained by its owner under the Allocation of Rights Agreement, which grants the SBC an exclusive commercialization option and the RI retained rights for internal research and publication subject to a pre-publication review period. This keeps the Phase III transition path unencumbered while protecting the RI’s academic mission.', fmt('Foreground results are delivered to the Government with rights clearly marked; background IP (the SBC’s saliency-guided quantization and the RI’s propagation models) is retained by its owner under the Allocation of Rights Agreement', 'clearly marked', 'bold')),
    ),
  ),
], 'Aerivio Navy STTR Statement of Work');

// ═══════════════════════════════════════════════════════════════════════════
// 3. COST VOLUME — 18-mo $250k base + 6-mo $150k option → xlsx (3 tabs)
// ═══════════════════════════════════════════════════════════════════════════
const sheet: CanvasRules = { format: 'spreadsheet', width: 1200, height: 800, margins: { top: 0, right: 0, bottom: 0, left: 0 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1, max_pages: null, max_slides: null } as CanvasRules;
const cur = (v: number, style?: Record<string, unknown>) => ({ text: String(v), cell_type: 'currency', value: v, ...(style ? { style } : {}) });
const num = (v: number, style?: Record<string, unknown>) => ({ text: String(v), cell_type: 'number', value: v, ...(style ? { style } : {}) });
const cost = doc(sheet, [
  Nn('table', {
    sheet_name: 'Base 18mo $250k',
    headers: ['Cost Category', 'Basis', 'Performer', 'Amount'],
    rows: [
      ['Direct Labor — PI (Ellison)', '0.25 FTE × 18 mo', 'SBC', cur(43200)],
      ['Direct Labor — Systems Engineer (Reyes)', '0.35 FTE × 18 mo', 'SBC', cur(34800)],
      ['Direct Labor — ML Engineer (Nandakumar)', '0.20 FTE × 18 mo', 'SBC', cur(14000)],
      [{ text: 'SBC Fringe', style: {} }, '25% of SBC labor', 'SBC', cur(23000)],
      [{ text: 'SBC Materials & Travel', style: {} }, 'Edge kits, hydrophones, 2 trips', 'SBC', cur(18000)],
      [{ text: 'SBC Indirect (Overhead)', style: {} }, '17.3% of SBC modified base', 'SBC', cur(20500)],
      [{ text: 'Subtotal — SBC (Aerivio)', style: { bold: true } }, '52.6% of total', 'SBC', cur(153500, { bold: true, bg: '#e0e7ff' })],
      ['RI Subaward — Co-I (Okonkwo) + grad researchers', 'Labor + fringe', 'RI', cur(62000)],
      ['RI Subaward — Range/tank use & materials', 'Facility + supplies', 'RI', cur(15500)],
      ['RI Subaward — Indirect', 'RI negotiated rate', 'RI', cur(10000)],
      [{ text: 'Subtotal — RI (Cascadia State)', style: { bold: true } }, '35.0% of total', 'RI', cur(87500, { bold: true, bg: '#cffafe' })],
      ['Consultant — Acoustics SME', '60 hrs @ $150', 'Other', cur(9000)],
      [{ text: 'BASE TOTAL', style: { bold: true, bg: '#dcfce7' } }, { text: '18-month base', style: { bg: '#dcfce7' } }, { text: '', style: { bg: '#dcfce7' } }, cur(250000, { bold: true, bg: '#dcfce7' })],
    ],
    header_style: { bg: '#0f2942', bold: true },
  }),
  Nn('table', {
    sheet_name: 'Option 6mo $150k',
    headers: ['Cost Category', 'Basis', 'Performer', 'Amount'],
    rows: [
      ['Direct Labor — PI + Systems Engineer', 'HIL + pre-demo, 6 mo', 'SBC', cur(46000)],
      [{ text: 'SBC Fringe', style: {} }, '25% of SBC labor', 'SBC', cur(11500)],
      [{ text: 'SBC Indirect', style: {} }, '17.3% of SBC modified base', 'SBC', cur(11750)],
      [{ text: 'Subtotal — SBC (Aerivio)', style: { bold: true } }, '46.2% of option', 'SBC', cur(69250, { bold: true, bg: '#e0e7ff' })],
      ['RI Subaward — Range pre-demonstration', 'Co-I + range time', 'RI', cur(52500)],
      [{ text: 'Subtotal — RI (Cascadia State)', style: { bold: true } }, '35.0% of option', 'RI', cur(52500, { bold: true, bg: '#cffafe' })],
      ['SBC/RI Travel — at-sea pre-demo', '2 trips + shipping', 'Joint', cur(28250)],
      [{ text: 'OPTION TOTAL', style: { bold: true, bg: '#dcfce7' } }, { text: '6-month option', style: { bg: '#dcfce7' } }, { text: '', style: { bg: '#dcfce7' } }, cur(150000, { bold: true, bg: '#dcfce7' })],
    ],
    header_style: { bg: '#0f2942', bold: true },
  }),
  Nn('table', {
    sheet_name: 'Summary',
    headers: ['Period', 'Duration', 'SBC share', 'RI share', 'Total'],
    rows: [
      ['Base', '18 months', cur(153500), cur(87500), cur(250000)],
      ['Option', '6 months', cur(69250), cur(52500), cur(150000)],
      [{ text: 'Program (Base + Option)', style: { bold: true } }, '24 months', cur(222750, { bold: true }), cur(140000, { bold: true }), cur(400000, { bold: true, bg: '#dcfce7' })],
      [{ text: 'STTR work-split check', style: { bold: true } }, 'SBC ≥ 40%, RI ≥ 30%', { text: 'SBC 56%', style: { bold: true, bg: '#dcfce7' } }, { text: 'RI 35%', style: { bold: true, bg: '#dcfce7' } }, { text: 'COMPLIANT', style: { bold: true, bg: '#dcfce7' } }],
    ],
    header_style: { bg: '#0f2942', bold: true },
  }),
], 'Aerivio Navy STTR Cost Volume');

// ═══════════════════════════════════════════════════════════════════════════
// 4. COMPANY OVERVIEW — 10 slides (pptx), Volume 5 supporting document
// ═══════════════════════════════════════════════════════════════════════════
const slide: CanvasRules = { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 25 } as CanvasRules;
// Company Overview deck — v2: one SECTION per slide (break is implicit).
const overview = docV2(slide, [
  S('Title',
    G(
      h(1, 'Aerivio Systems', '#0f2942'),
      p('Company Overview', [], { color: '#0e7490' }),
      p('Edge AI for distributed maritime autonomy'),
      p('Volume 5 Supporting Document · Navy STTR Phase I · Topic N25B-T042', [], { color: '#64748b' }),
    ),
  ),
  S('Who We Are',
    G(
      h(1, 'Who We Are'),
      ul(['Small business building power-efficient, on-device AI for defense maritime autonomy', 'Founded by low-power ML and embedded-systems engineers', 'Core competency: compressing accurate acoustic classifiers to single-digit-watt edge modules', 'Mission: put reliable classification where connectivity fails — the contested edge']),
    ),
  ),
  S('The Team',
    G(
      h(1, 'The Team'),
      ul(['Dr. Mara Ellison — PI · 12 yrs low-power ML for sensing; author of core quantization IP', 'Tomas Reyes — Systems · 9 yrs embedded real-time; two fielded maritime autonomy stacks', 'Priya Nandakumar — ML · model compression & data augmentation', 'Advisory: acoustics SME + transition advisor (former program office)']),
      p('Teamed with Cascadia State University for undersea acoustics research (STTR RI).', fmt('Teamed with Cascadia State University for undersea acoustics research (STTR RI).', 'Cascadia State University', 'bold')),
    ),
  ),
  S('Core Technology & IP',
    G(
      h(1, 'Core Technology & IP'),
      ul(['Quantization-aware training to 4-bit weights with <1.5-point accuracy loss', 'Saliency-guided structured pruning — removes ~70% of parameters (patent pending)', 'Deterministic sub-watt runtime — guaranteed p99 latency at a fixed power budget', 'Result: an accurate maritime classifier in a 2-watt envelope']),
      img(svgMesh(), 'Distributed edge-AI architecture', 440, 210, 'On-node inference + consensus fusion — classification at the distributed edge.'),
    ),
  ),
  S('Past Performance',
    G(
      h(1, 'Past Performance'),
      ul(['AFWERX SBIR Phase I (CSO) — single-vessel 4-bit acoustic classifier, 92%+ balanced accuracy at 2 W', 'Two prior fielded maritime autonomy stacks (systems team)', 'Peer-reviewed quantization and edge-scheduling publications', 'Reusable, meta-tagged content library carried pursuit-to-pursuit']),
      p('This STTR builds directly on the AFWERX result — distribution and propagation are the new science.', [], { color: '#0e7490' }),
    ),
  ),
  S('The STTR Partnership',
    G(
      h(1, 'The STTR Partnership'),
      ul(['Aerivio (SBC, prime) — edge AI, quantization, on-node runtime, fusion implementation (56%)', 'Cascadia State (RI) — channel characterization, propagation models, corpus, range validation (35%)', 'Single PI at the SBC; RI Co-Investigator leads ocean-acoustics tasks', 'Allocation of Rights executed pre-award — transition path kept unencumbered']),
    ),
  ),
  S('Facilities & Capabilities',
    G(
      h(1, 'Facilities & Capabilities'),
      ul(['Aerivio: acoustics bench, anechoic enclosure, 2-watt edge kits, GPU cluster, power-measurement bench', 'Cascadia State: calibrated test tank, hydrophone array, coastal test range, HPC for propagation modeling', 'Combined stack spans lab bench to at-sea range — no single party could replicate it']),
    ),
  ),
  S('Why Aerivio',
    G(
      h(1, 'Why Aerivio'),
      ul(['On-node inference where incumbents depend on backhaul that undersea denies', 'Validated 2-watt classifier — not a research prototype', 'Propagation-aware + consensus fusion — weak partial observations become confident classification', 'Software transition into existing node power budgets — no new hardware program']),
      img(svgChart('Serviceable market ($M/yr)', [['2026', 9, '#67e8f9'], ['2028', 28, '#22d3ee'], ['2030', 68, '#0891b2']]), 'Market growth chart', 420, 190),
    ),
  ),
  S('Transition & Commercialization',
    G(
      h(1, 'Transition & Commercialization'),
      ol(['Phase I: feasibility in simulation + tank/range (now)', 'Phase II: hardened nodes + at-sea multi-node demo (~$1.6M / 24 mo)', 'Phase III: Navy undersea / USV program of record', 'Commercial: port & offshore-energy maritime domain awareness (dual-use)']),
    ),
  ),
  S('Summary',
    G(
      h(1, 'Summary'),
      ul(['Proven edge-AI small business + a leading ocean-acoustics research lab', 'A validated 2-watt classifier extended to distributed, propagation-aware, contested undersea sensing', 'Compliant STTR teaming, clear transition, dual-use market']),
      p('Aerivio Systems · contact@aerivio.example · Proprietary', [], { color: '#64748b' }),
    ),
  ),
], 'Aerivio Company Overview');

// ── generate deliverables + persist canvas JSON (example templates) ──────────
const OUT = '/home/user/govwin/docs/sample-proposal-navy-sttr';
const CANVAS = `${OUT}/canvas`;
mkdirSync(CANVAS, { recursive: true });
const results: Array<[string, number]> = [];
async function emit(name: string, buf: Buffer) { writeFileSync(`${OUT}/${name}`, buf); results.push([name, buf.length]); }
function saveCanvas(name: string, d: CanvasDocument) { writeFileSync(`${CANVAS}/${name}.canvas.json`, JSON.stringify(d, null, 2)); }

saveCanvas('technical-volume', tv);
saveCanvas('statement-of-work', sow);
saveCanvas('cost-volume', cost);
saveCanvas('company-overview', overview);

await emit('Aerivio_Navy_STTR_Technical_Volume.docx', await exportToDocx(tv, VARS));
await emit('Aerivio_Navy_STTR_Technical_Volume.pdf', await exportToPdf(tv, VARS));
await emit('Aerivio_Navy_STTR_Statement_of_Work.docx', await exportToDocx(sow, VARS));
await emit('Aerivio_Navy_STTR_Statement_of_Work.pdf', await exportToPdf(sow, VARS));
await emit('Aerivio_Navy_STTR_Cost_Volume.xlsx', await exportToXlsx(cost, VARS));
await emit('Aerivio_Navy_STTR_Company_Overview.pptx', await exportToPptx(overview, VARS));

console.log('\n── Navy STTR deliverables generated ──');
for (const [n, b] of results) console.log(`  ${n.padEnd(46)} ${(b / 1024).toFixed(1)} KB`);
console.log(`\n${results.length} files + 4 canvas templates → ${OUT}`);
