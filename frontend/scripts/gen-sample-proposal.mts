/**
 * Generate the complete Aerivio Systems SBIR Phase I proposal deliverables via
 * the real exporters (docx / pptx / xlsx / pdf), and persist each canvas
 * document as a reusable example template. Fake company + technology, 100%
 * complete content, fully styled. Writes to docs/sample-proposal/.
 *
 *   cd frontend && npx tsx scripts/gen-sample-proposal.mts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';

// ── node builders ───────────────────────────────────────────────────────────
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
const brk = () => Nn('page_break', null);
const cap = (prefix: string, number: number, text: string) => Nn('caption', { prefix, number, text });
const table = (headers: unknown[], rows: unknown[][], headerBg = '#1e293b') => Nn('table', { headers, rows, header_style: { bg: headerBg, bold: true } });
const fmt = (text: string, sub: string, format: string) => { const s = text.indexOf(sub); return s < 0 ? [] : [{ start: s, length: sub.length, format }]; };
const img = (svg: string, alt: string, w: number, hgt: number, caption?: string) =>
  Nn('image', { storage_key: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), alt_text: alt, width: w, height: hgt, caption });

// ── SVG placeholder generators ──────────────────────────────────────────────
const svgHeadshot = (initials: string, c: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="150" height="150" fill="#f1f5f9"/><circle cx="75" cy="60" r="34" fill="${c}"/><rect x="33" y="100" width="84" height="46" rx="20" fill="${c}"/><text x="75" y="70" text-anchor="middle" font-family="Arial" font-size="26" fill="#fff" font-weight="bold">${initials}</text></svg>`;
const svgFacility = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="190"><rect width="340" height="190" fill="#e0f2fe"/><rect x="30" y="70" width="130" height="100" fill="#0369a1"/><rect x="175" y="40" width="135" height="130" fill="#0284c7"/><rect x="45" y="90" width="20" height="20" fill="#bae6fd"/><rect x="80" y="90" width="20" height="20" fill="#bae6fd"/><rect x="115" y="90" width="20" height="20" fill="#bae6fd"/><rect x="195" y="60" width="22" height="22" fill="#e0f2fe"/><rect x="235" y="60" width="22" height="22" fill="#e0f2fe"/><rect x="275" y="60" width="22" height="22" fill="#e0f2fe"/><text x="170" y="184" text-anchor="middle" font-family="Arial" font-size="12" fill="#0c4a6e">${label}</text></svg>`;
const svgArch = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="210"><rect width="460" height="210" fill="#eef2ff"/>
   <rect x="20" y="80" width="90" height="50" rx="6" fill="#6366f1"/><text x="65" y="110" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">Hydrophone Array</text>
   <rect x="150" y="80" width="110" height="50" rx="6" fill="#4f46e5"/><text x="205" y="102" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">Edge AI Module</text><text x="205" y="118" text-anchor="middle" font-family="Arial" font-size="9" fill="#c7d2fe">(quantized CNN)</text>
   <rect x="300" y="50" width="140" height="45" rx="6" fill="#0ea5e9"/><text x="370" y="77" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">Threat Classifier</text>
   <rect x="300" y="120" width="140" height="45" rx="6" fill="#0284c7"/><text x="370" y="147" text-anchor="middle" font-family="Arial" font-size="11" fill="#fff">USV Autonomy Bus</text>
   <line x1="110" y1="105" x2="150" y2="105" stroke="#334155" stroke-width="2"/><line x1="260" y1="95" x2="300" y2="72" stroke="#334155" stroke-width="2"/><line x1="260" y1="115" x2="300" y2="142" stroke="#334155" stroke-width="2"/></svg>`;
const svgPipeline = () =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="120"><rect width="460" height="120" fill="#f8fafc"/>
   ${['Raw audio', 'STFT', 'Log-mel', 'Quantized CNN', 'Softmax'].map((s, i) => `<rect x="${10 + i * 92}" y="40" width="82" height="40" rx="6" fill="#4f46e5"/><text x="${51 + i * 92}" y="64" text-anchor="middle" font-family="Arial" font-size="10" fill="#fff">${s}</text>${i < 4 ? `<line x1="${92 + i * 92}" y1="60" x2="${102 + i * 92}" y2="60" stroke="#334155" stroke-width="2"/>` : ''}`).join('')}</svg>`;
const svgChart = (title: string, bars: Array<[string, number, string]>) => {
  const max = Math.max(...bars.map((b) => b[1])); const bw = 70, gap = 30, base = 170;
  const rects = bars.map((b, i) => { const bh = Math.round((b[1] / max) * 120); const x = 40 + i * (bw + gap); return `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" fill="${b[2]}"/><text x="${x + bw / 2}" y="${base + 15}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">${b[0]}</text><text x="${x + bw / 2}" y="${base - bh - 5}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">$${b[1]}M</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="200"><rect width="440" height="200" fill="#fff"/><text x="20" y="24" font-family="Arial" font-size="13" font-weight="bold" fill="#1e293b">${title}</text>${rects}</svg>`;
};

const letter = (title: string, footer: string, size = 11, spacing = 1.35): CanvasRules => ({
  format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: `{company_name} — ${title}`, font: { family: 'Arial', size: 10.5 }, height: 22 } as CanvasRules['header'],
  footer: { template: `${footer} · Page {n} of {N}`, font: { family: 'Arial', size: 10.5 }, height: 22 } as CanvasRules['footer'],
  font_default: { family: 'Georgia', size, color: '#111827' }, line_spacing: spacing, max_pages: 15, max_slides: null,
});
const meta = (title: string) => ({ title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const });
const doc = (canvas: CanvasRules, nodes: CanvasNode[], title: string): CanvasDocument =>
  ({ version: 1, document_id: crypto.randomUUID(), canvas, nodes, metadata: meta(title) });

const VARS = { company_name: 'Aerivio Systems', topic_title: 'Autonomous Acoustic Threat Classification at the Tactical Edge', topic_number: 'N251-042' };

// ═══════════════════════════════════════════════════════════════════════════
// 1. TECHNICAL VOLUME — full ~15-page white paper
// ═══════════════════════════════════════════════════════════════════════════
const white = doc(letter('Technical Volume', 'AFWERX SBIR Phase I · Topic N251-042 · Proprietary', 12, 1.55), [
  h(1, 'Volume 2 — Technical Volume', '#3730a3'),
  p('{company_name} — AFWERX SBIR Phase I (CSO)', fmt('{company_name} — AFWERX SBIR Phase I (CSO)', '{company_name}', 'bold')),
  p('Topic {topic_number}: {topic_title}', [], { color: '#475569' }),
  p('Period of Performance: 6 months   ·   Requested Funding: $150,000   ·   Distribution: Proprietary', [], { color: '#475569' }),

  brk(),
  h(2, '1. Identification and Significance of the Problem or Opportunity', '#1e3a8a'),
  P('Unmanned surface vessels (USVs) increasingly operate beyond reliable communications, yet current acoustic-threat detection depends on shore-side processing that introduces prohibitive latency. When a SATCOM link degrades — the norm in contested or high-sea-state environments — classification stalls and the vessel loses the ability to distinguish a biologic from a torpedo. Autonomy is throttled precisely when it matters most.'),
  P('Consider a representative scenario. A USV on a persistent picket mission detects an ambiguous acoustic signature. Under today’s architecture the raw stream is buffered and, if bandwidth permits, relayed to a shore station; the round trip can exceed several seconds. A torpedo closing at 40 knots covers more than 60 meters in that window. The vessel needs a decision at the tactical edge, in tens of milliseconds, with no assumption of connectivity.'),
  P('The threat space is broad and confusable. Table 1 summarizes the principal acoustic classes and why they are hard to distinguish under compression.'),
  table(['Class', 'Signature character', 'Confusable with'], [
    ['Torpedo (running)', 'High-RPM screw, rising tonal', 'High-speed surface craft'],
    ['Submarine (transiting)', 'Low-frequency broadband', 'Distant shipping'],
    ['Surface combatant', 'Multi-blade cavitation', 'Merchant traffic'],
    ['Biologic', 'Click trains / whistles', 'Sonar transients'],
    ['Ambient / clutter', 'Sea-state noise', '(baseline)'],
  ]),
  cap('Table', 1, 'Acoustic threat taxonomy and principal confusions the classifier must resolve.'),
  P('Significance: every autonomous hull the Air Force and Navy field inherits this connectivity dependency. Three hard requirements follow and jointly define the problem: the classifier must (i) achieve high balanced accuracy across confusable classes — a mean that hides a torpedo-versus-fast-craft confusion is useless; (ii) return a decision within a worst-case deadline of tens of milliseconds; and (iii) do so within the fielded 2-watt compute budget. Any approach that satisfies two of the three does not transition. The opportunity is timely: the unmanned fleet is scaling while edge-compute modules have matured to run useful inference within single-digit watts. What is missing is the machine-learning-systems work to compress an accurate maritime classifier without destroying it — precisely the gap {company_name} closes.'),

  brk(),
  h(2, '2. Phase I Technical Objectives', '#1e3a8a'),
  P('The objectives of Phase I are to establish feasibility of the edge classifier against pre-registered, defense-relevant criteria:'),
  ol([
    'Objective 1 — Curate and augment the hydrophone training corpus with documented provenance and class balance.',
    'Objective 2 — Train and quantize the classifier to 4-bit precision with saliency-guided pruning, holding balanced accuracy above 92%.',
    'Objective 3 — Port the runtime to the target 2-watt edge module and benchmark p99 end-to-end latency and sustained power.',
    'Objective 4 — Validate accuracy, latency, and power against relevant threat scenarios and document results, limitations, and the Phase II plan.',
  ]),
  h(3, '2.1 Technical Approach', '#334155'),
  P('The edge module ingests raw hydrophone-array streams, performs on-device feature extraction, and runs a quantized CNN whose outputs feed the USV autonomy bus. Figure 1 shows the architecture; Figure 2 the on-device inference pipeline. All inference occurs on-vessel at a measured 2.0-watt draw.'),
  img(svgArch(), 'System architecture: hydrophone array to edge AI module to threat classifier and autonomy bus', 440, 200),
  cap('Figure', 1, '{company_name} edge acoustic-sensing architecture (on-vessel).'),
  img(svgPipeline(), 'Inference pipeline: raw audio, STFT, log-mel, quantized CNN, softmax', 440, 116),
  cap('Figure', 2, 'On-device inference pipeline (feature extraction through classification).'),
  P('Four co-designed components make edge-native classification feasible under the power ceiling. (a) A fixed-point signal front-end (STFT → log-mel, ~40 bins) with array beamforming that yields a bearing estimate alongside the class label, consuming under 15% of the per-frame budget. (b) Quantization-aware training at 4-bit weights / 8-bit activations via a straight-through estimator, holding accuracy within 1.4 points of full precision versus a 9-point drop for post-training quantization.', fmt('holding accuracy within 1.4 points of full precision versus a 9-point drop for post-training quantization.', 'within 1.4 points', 'bold')),
  p('(c) Saliency-guided structured pruning that scores each channel by its contribution to inter-class separation and removes ~70% of parameters while preserving the discriminative bands — {company_name}’s defensible IP (patent pending). (d) A deterministic, statically scheduled runtime that pins inference to reserved cores and disables frequency scaling, guaranteeing a 99th-percentile latency under 100 ms at 2.0 watts.', fmt('(c) Saliency-guided structured pruning that scores each channel by its contribution to inter-class separation and removes ~70% of parameters while preserving the discriminative bands', 'inter-class separation', 'italic')),
  P('The classifier itself is a compact five-stage residual CNN over the log-mel stream, favoring depth over width and using only operators the target module accelerates natively. Preliminary bench experiments on a representative corpus subset already indicate feasibility (Table 2), and Phase I will formalize and extend them to the full corpus and target hardware.'),
  table(['Metric', 'Full-precision baseline', '{company_name} 4-bit target'], [
    ['Balanced accuracy (F1)', '93.6%', { text: '92%+', style: { bold: true, bg: '#dcfce7' } }],
    ['Parameters', '4.1 M', '1.2 M'],
    ['End-to-end latency (p99)', '310 ms', { text: '<100 ms', style: { bold: true, bg: '#dcfce7' } }],
    ['Sustained power draw', '11 W', { text: '2.0 W', style: { bold: true, bg: '#dcfce7' } }],
  ]),
  cap('Table', 2, 'Preliminary baseline vs. Phase I target (representative corpus subset).'),

  brk(),
  h(2, '3. Phase I Statement of Work', '#1e3a8a'),
  P('The six-month effort is organized into four sequential-but-overlapping tasks. Table 3 gives the schedule and lead; the narrative details scope, methods, effort, and deliverables per task.'),
  table(['Task', 'Description', 'Months', 'Lead', 'Deliverable'], [
    ['1', 'Corpus curation & augmentation', '1–2', 'Nandakumar', 'Labeled dataset + data card'],
    ['2', 'Quantization-aware training + pruning', '2–4', 'Ellison', 'Trained 4-bit model + accuracy report'],
    ['3', 'Edge port & latency benchmark', '4–5', 'Reyes', 'Runtime on target module + benchmark log'],
    ['4', 'Validation & final report', '5–6', 'Ellison', 'Phase I feasibility report'],
  ]),
  cap('Table', 3, 'Phase I statement of work (6-month period of performance).'),
  h(3, 'Task 1 — Corpus Curation and Augmentation (Months 1–2)', '#334155'),
  P('Assemble a labeled corpus from the DARPA hydrophone release, augmented with sea-state noise, Doppler, and multipath models; balance each class by controlled resampling; document provenance and limitations in a data card. Effort: 0.25 FTE ML engineer. Deliverable: labeled dataset + data card.'),
  h(3, 'Task 2 — Quantization-Aware Training and Pruning (Months 2–4)', '#334155'),
  P('Train the classifier with 4-bit quantization and saliency-guided pruning in the loop, iterating the saliency threshold; run ablations attributing accuracy retention to each technique. Effort: 0.30 FTE PI + 0.20 FTE ML engineer. Deliverable: trained 4-bit model + accuracy report on a session-disjoint split.'),
  h(3, 'Task 3 — Edge Port and Latency Benchmark (Months 4–5)', '#334155'),
  P('Port the runtime to the 2-watt module, integrate the deterministic scheduler, and benchmark p99 latency and sustained power under continuous load; apply selective mixed precision to the most confusable layers if required. Effort: 0.40 FTE systems engineer. Deliverable: runtime on target + benchmark log.'),
  h(3, 'Task 4 — Validation and Final Report (Months 5–6)', '#334155'),
  P('Validate accuracy, latency, and power against relevant threat scenarios from held-out sessions; document results, limitations, and the Phase II plan. Effort: 0.20 FTE PI + support. Deliverable: Phase I feasibility report.'),
  h(3, '3.1 Evaluation, Data Management, and Risk', '#334155'),
  P('Feasibility is judged against pre-registered gates, all of which must pass: balanced F1 ≥ 0.92 on a session-disjoint split; end-to-end p99 latency < 100 ms on target; sustained rail draw ≤ 2.0 W. The full confusion matrix is a deliverable, because the operationally important errors are specific confusions rather than average error. All data derives from the Distribution-A DARPA corpus plus synthetic augmentation — no classified or controlled data — versioned and retained for the period of performance plus three years. The principal risks and mitigations are in Table 4.'),
  table(['Risk', 'Likelihood', 'Impact', 'Mitigation'], [
    ['4-bit accuracy shortfall', 'Medium', 'High', 'Mixed-precision fallback on most confusable layers'],
    ['Latency exceeds budget on target', 'Low', 'High', 'Reserve cores + static schedule; profile early in Task 3'],
    ['Corpus class imbalance', 'Medium', 'Medium', 'Targeted augmentation + class-balanced sampling'],
    ['Domain shift (sea state)', 'Medium', 'Medium', 'Sea-state augmentation + robustness ablation'],
  ]),
  cap('Table', 4, 'Principal Phase I risks, likelihood, impact, and mitigation.'),

  brk(),
  h(2, '4. Related Work', '#1e3a8a'),
  P('Prior edge-audio efforts target keyword spotting at low fidelity and small class counts; none address multi-class maritime threat discrimination under a hard power ceiling. Post-training quantization strands accuracy on confusable classes; magnitude pruning is blind to inter-class saliency; unstructured sparsity does not map efficiently onto edge vector units. {company_name}’s contribution is the coupling of quantization-aware training with a saliency-guided, structured pruning metric specific to acoustic threat discrimination, validated in preliminary bench tests and pursued as protected IP. We build on established foundations — integer-arithmetic inference, straight-through estimators, and margin-based feature attribution — and contribute their integration and specialization to this operational problem.'),

  brk(),
  h(2, '5. Relationship with Future Research or Development', '#1e3a8a'),
  P('Phase I establishes feasibility on the target module. Phase II hardens the module, extends the corpus to fielded recordings, and conducts an at-sea demonstration on a DoD USV against the same gates plus a robustness gate across sea states; we will pursue approximately $1.1M over 24 months. In Phase III we target integration with a USV program of record through the relevant program office. Because the classifier fits the existing compute budget, transition requires only a software integration and accreditation effort — not a hardware program — which materially lowers the transition barrier. Background IP (the saliency-pruning method) is protected under standard SBIR data rights; foreground results are delivered to the Government with rights clearly marked, so transition is not encumbered by ambiguous IP claims.'),

  brk(),
  h(2, '6. Commercialization Strategy', '#1e3a8a'),
  P('{company_name} pursues a dual-use commercialization path in which the Air Force / Navy customer and the commercial market reinforce each other. The Phase I classifier is the wedge: defense USV programs of record in Phase III, then allied navies, then commercial maritime security — port monitoring and offshore-energy protection — where the same edge-native, power-efficient classifier applies with minimal modification.'),
  P('Customer discovery is an explicit Phase I activity. We have identified an initial defense end-user (a USV program office) and will conduct structured interviews to validate the operational requirement, the accreditation path, and the sustainment model (a delivered, accredited model plus a maintenance and re-training subscription). On the commercial side, the serviceable market is projected to grow from roughly $8M/yr in 2026 to over $60M/yr by 2030; {company_name}’s position is defensible against shore-side incumbents because on-vessel inference is a capability they structurally cannot match. The dual-use revenue path reduces reliance on any single government program and is detailed in the separate Commercialization volume.', fmt('the serviceable market is projected to grow from roughly $8M/yr in 2026 to over $60M/yr by 2030', 'defensible against shore-side incumbents', 'bold')),

  brk(),
  h(2, '7. Key Personnel', '#1e3a8a'),
  P('Dr. Mara Ellison (Principal Investigator, 0.30 FTE) — 12 years in low-power machine learning for sensing; author of the quantization research underpinning {company_name}’s core IP. Tomas Reyes (Senior Systems Engineer) — 9 years of embedded real-time systems, two fielded maritime autonomy stacks; owns the edge-port and scheduler tasks. Priya Nandakumar (ML Engineer) — model compression and data augmentation; leads corpus curation and quantization-aware training. The team has collaborated on two prior efforts and shares a common toolchain, de-risking the six-month schedule. Full biographies appear in the Key Personnel supporting document.'),

  brk(),
  h(2, '8. Foreign Citizens', '#1e3a8a'),
  P('{company_name} anticipates no foreign nationals performing on this effort. All key personnel are U.S. citizens. Should any individual requiring disclosure be added, {company_name} will notify the Contracting Officer and provide the required country of origin and visa/work-permit status prior to their participation, consistent with the solicitation instructions.'),

  brk(),
  h(2, '9. Facilities and Equipment', '#1e3a8a'),
  P('{company_name} maintains a 3,200 sq ft engineering facility with a dedicated acoustics bench, a custom anechoic test enclosure, six 2-watt edge-compute development kits, an on-premises GPU training cluster, and a calibrated power-measurement bench for rail-level draw. Data collection leverages an existing partnership with a regional marine research station, providing representative acoustic conditions at no additional Phase I cost. All Phase I work can be performed in-house. Facilities are described in full in the Facilities supporting document.'),

  brk(),
  h(2, '10. Subcontractors and Consultants', '#1e3a8a'),
  P('{company_name} will engage one consultant — an acoustics subject-matter expert (40 hours) — to review the corpus curation methodology and the evaluation protocol, budgeted in the Cost Volume. No subcontractors are proposed for Phase I; all development is performed by {company_name} personnel. The consultant will not have access to limited-rights data beyond what is required for the review.'),

  brk(),
  h(2, '11. Prior, Current, or Pending Support', '#1e3a8a'),
  P('The specific work proposed here — edge-deployable, 4-bit maritime acoustic threat classification under a 2-watt ceiling — has not been submitted to, or funded by, any other Federal agency. No prior, current, or pending support duplicates this effort. {company_name}’s background IP (the saliency-pruning method) was developed with internal funds prior to this proposal. Should any overlapping proposal be submitted during the evaluation period, {company_name} will promptly notify the Contracting Officer as required.'),

  brk(),
  h(3, 'References', '#475569'),
  ul([
    '[1] DARPA Hydrophone Corpus, Distribution A, 2024.',
    '[2] Ellison, M. et al., "Saliency-Guided Quantization for Acoustic Edge Inference," 2025 (in prep).',
    '[3] Reyes, T., "Deterministic Scheduling for Sub-Watt Inference," Embedded ML Workshop, 2024.',
    '[4] Jacob, B. et al., "Quantization and Training of Neural Networks for Efficient Integer-Arithmetic Inference," 2018.',
    '[5] Molchanov, P. et al., "Importance Estimation for Neural Network Pruning," 2019.',
  ]),

  h(3, 'Compliance Cross-Reference', '#475569'),
  P('This volume addresses each AFWERX/DoD Phase I required element as below; the full compliance matrix is maintained in the proposal workspace and advances to “satisfied” as each section is accepted and locked.'),
  table(['Required element', 'Section'], [
    ['Problem/opportunity significance', '1'],
    ['Technical objectives', '2'],
    ['Statement of work', '3'],
    ['Related work', '4'],
    ['Future R&D / transition', '5'],
    ['Commercialization', '6'],
    ['Key personnel', '7'],
    ['Foreign citizens', '8'],
    ['Facilities/equipment', '9'],
    ['Subcontractors/consultants', '10'],
    ['Prior/current/pending support', '11'],
  ]),
], 'Aerivio Technical Volume');

// ═══════════════════════════════════════════════════════════════════════════
// 2. COMMERCIALIZATION — complete 5-slide deck
// ═══════════════════════════════════════════════════════════════════════════
const slide: CanvasRules = { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 25 } as CanvasRules;
const deck = doc(slide, [
  h(1, 'Aerivio Systems', '#3730a3'),
  p('Commercialization Plan — SBIR Phase I', [], { color: '#475569' }),
  p('Edge-AI acoustic threat classification for unmanned surface vessels'),
  p('Topic N251-042 · AFWERX SBIR Phase I (CSO) · $150,000 / 6 months', [], { color: '#64748b' }),
  brk(),
  h(1, 'Market Opportunity'),
  ul(['DoD USV fleet (Air Force & Navy) projected to exceed 300 hulls by 2030 — each needs edge acoustic sensing', 'Beachhead: DoD USV programs of record', 'Expansion: allied navies + commercial maritime security (ports, offshore energy)', 'Serviceable market growing ~$8M → $60M+ per year by 2030']),
  img(svgChart('Serviceable market ($M/yr)', [['2026', 8, '#93c5fd'], ['2028', 24, '#3b82f6'], ['2030', 61, '#1d4ed8']]), 'Market growth chart', 440, 200),
  brk(),
  h(1, 'Competition & Differentiation'),
  ul(['Incumbents process acoustics shore-side → latency + comms dependence', 'Aerivio runs fully on-vessel at 2 watts, <100 ms', 'Defensible IP: saliency-guided quantization pipeline (patent pending)', 'Retrofits deployed hulls — no new hardware program required']),
  p('Bottom line: we win where connectivity fails — exactly the contested environment that matters.', fmt('Bottom line: we win where connectivity fails — exactly the contested environment that matters.', 'win where connectivity fails', 'bold')),
  brk(),
  h(1, 'Go-to-Market & Milestones'),
  ol(['Phase I (now): feasibility on the maritime corpus, months 1–6', 'Phase II: hardened module + at-sea demonstration (~$1.1M / 24 mo)', 'Phase III: transition to a DoD USV program of record', 'Commercial: port-security & offshore-energy monitoring (dual-use)']),
  p('Transition is a software integration, not a hardware program — a low-barrier path to a funded home.'),
  brk(),
  h(1, 'Financials & The Ask'),
  p('Phase I budget: $150,000 over 6 months.', fmt('Phase I budget: $150,000 over 6 months.', '$150,000', 'bold')),
  ul(['Team of 3 (PI + systems + ML engineer)', 'Deliverable: validated 4-bit edge classifier meeting all three gates', 'Phase II target: $1.1M for an at-sea demonstration', 'Commercial revenue path reduces single-program reliance']),
  p('Ask: fund Phase I to de-risk the edge classifier and unlock the transition path.', [], { color: '#3730a3' }),
], 'Aerivio Commercialization');

// ═══════════════════════════════════════════════════════════════════════════
// 3. COST VOLUME — complete, detailed $150k budget → xlsx
// ═══════════════════════════════════════════════════════════════════════════
const sheet: CanvasRules = { format: 'spreadsheet', width: 1200, height: 800, margins: { top: 0, right: 0, bottom: 0, left: 0 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1, max_pages: null, max_slides: null } as CanvasRules;
const cur = (v: number, style?: Record<string, unknown>) => ({ text: String(v), cell_type: 'currency', value: v, ...(style ? { style } : {}) });
const num = (v: number, style?: Record<string, unknown>) => ({ text: String(v), cell_type: 'number', value: v, ...(style ? { style } : {}) });
const budget = doc(sheet, [
  Nn('table', {
    sheet_name: 'Direct Labor',
    headers: ['Role / Name', 'Hourly rate', 'Hours', 'Amount'],
    rows: [
      ['Principal Investigator — Dr. Ellison', cur(95), num(360), cur(34200)],
      ['Senior Systems Engineer — Reyes', cur(78), num(440), cur(34320)],
      ['ML Engineer — Nandakumar', cur(62), num(312), cur(19340)],
      [{ text: 'Subtotal — Direct Labor', style: { bold: true } }, '', num(1112, { bold: true }), cur(87860, { bold: true, bg: '#e0e7ff' })],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
  Nn('table', {
    sheet_name: 'Budget Summary',
    headers: ['Cost Category', 'Basis', 'Amount'],
    rows: [
      ['Direct Labor', 'PI + 2 engineers (1,112 hrs)', cur(87860)],
      ['Fringe Benefits', '25% of direct labor', cur(21965)],
      ['Materials & Supplies', 'Edge compute kits (×2), hydrophones', cur(8000)],
      ['Travel', 'Kickoff + Phase I review (2 trips)', cur(4000)],
      ['Consultant', 'Acoustics SME (40 hrs @ $150)', cur(6000)],
      [{ text: 'Subtotal — Direct Costs', style: { bold: true } }, '', cur(127825, { bold: true })],
      ['Indirect (Overhead)', '17.3% of modified total', cur(22175)],
      [{ text: 'TOTAL', style: { bold: true, bg: '#dcfce7' } }, { text: '', style: { bg: '#dcfce7' } }, cur(150000, { bold: true, bg: '#dcfce7' })],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
], 'Aerivio Cost Volume');

// ═══════════════════════════════════════════════════════════════════════════
// 4 & 5. SUPPORTING — Bios + Facilities (PDF)
// ═══════════════════════════════════════════════════════════════════════════
const bios = doc(letter('Key Personnel', 'SBIR Phase I · Supporting Documents · Proprietary'), [
  h(1, 'Key Personnel', '#3730a3'),
  h(2, 'Dr. Mara Ellison — Principal Investigator', '#1e3a8a'),
  img(svgHeadshot('ME', '#6366f1'), 'Headshot placeholder for Dr. Mara Ellison', 150, 150),
  p('Dr. Ellison holds a Ph.D. in Electrical Engineering and has 12 years of experience in low-power machine learning for sensing. She led the quantization research that underpins Aerivio’s core IP and will devote 0.30 FTE to this effort as Principal Investigator.',
    fmt('Dr. Ellison holds a Ph.D. in Electrical Engineering and has 12 years of experience in low-power machine learning for sensing. She led the quantization research that underpins Aerivio’s core IP and will devote 0.30 FTE to this effort as Principal Investigator.', '0.30 FTE', 'bold')),
  h(2, 'Tomas Reyes — Senior Systems Engineer', '#1e3a8a'),
  img(svgHeadshot('TR', '#0ea5e9'), 'Headshot placeholder for Tomas Reyes', 150, 150),
  p('Mr. Reyes brings 9 years of embedded real-time systems experience, including two fielded maritime autonomy stacks. He owns the edge-port and latency-benchmark tasks and the deterministic scheduler design.'),
  h(2, 'Priya Nandakumar — ML Engineer', '#1e3a8a'),
  img(svgHeadshot('PN', '#10b981'), 'Headshot placeholder for Priya Nandakumar', 150, 150),
  p('Ms. Nandakumar specializes in model compression and data augmentation. She will lead corpus curation and quantization-aware training, and maintain the data card and evaluation protocol.'),
], 'Aerivio Key Personnel Bios');

const facilities = doc(letter('Facilities & Equipment', 'SBIR Phase I · Supporting Documents · Proprietary'), [
  h(1, 'Facilities and Equipment', '#3730a3'),
  p('Aerivio Systems maintains a 3,200 sq ft engineering facility with a dedicated acoustics bench and an anechoic test enclosure sufficient to conduct all Phase I bench work in-house.'),
  img(svgFacility('Aerivio HQ — Engineering & Acoustics Lab'), 'Facility illustration placeholder', 340, 190),
  cap('Figure', 1, 'Aerivio headquarters and acoustics laboratory (illustration).'),
  h(2, 'Key Equipment', '#1e3a8a'),
  ul(['4-channel calibrated hydrophone array', 'Anechoic test enclosure (custom)', '2-watt edge compute development kits (×6)', 'On-premises GPU training cluster (8× accelerators)', 'Calibrated power-measurement bench for rail-level draw']),
  h(2, 'Test Environment', '#1e3a8a'),
  p('At-sea data collection is conducted under an existing partnership with a regional marine research station, providing access to representative acoustic conditions without additional Phase I cost.', fmt('At-sea data collection is conducted under an existing partnership with a regional marine research station, providing access to representative acoustic conditions without additional Phase I cost.', 'without additional Phase I cost', 'italic')),
], 'Aerivio Facilities');

// ── generate deliverables + persist canvas JSON (example templates) ──────────
const OUT = '/home/user/govwin/docs/sample-proposal';
const CANVAS = `${OUT}/canvas`;
mkdirSync(CANVAS, { recursive: true });
const results: Array<[string, number]> = [];
async function emit(name: string, buf: Buffer) { writeFileSync(`${OUT}/${name}`, buf); results.push([name, buf.length]); }
function saveCanvas(name: string, d: CanvasDocument) { writeFileSync(`${CANVAS}/${name}.canvas.json`, JSON.stringify(d, null, 2)); }

saveCanvas('technical-volume', white);
saveCanvas('commercialization', deck);
saveCanvas('cost-volume', budget);
saveCanvas('key-personnel-bios', bios);
saveCanvas('facilities', facilities);

await emit('Aerivio_Technical_Volume.docx', await exportToDocx(white, VARS));
await emit('Aerivio_Technical_Volume.pdf', await exportToPdf(white, VARS));
await emit('Aerivio_Commercialization.pptx', await exportToPptx(deck, VARS));
await emit('Aerivio_Cost_Volume.xlsx', await exportToXlsx(budget, VARS));
await emit('Aerivio_Key_Personnel.pdf', await exportToPdf(bios, VARS));
await emit('Aerivio_Facilities.pdf', await exportToPdf(facilities, VARS));

console.log('\n── Deliverables generated ──');
for (const [n, b] of results) console.log(`  ${n.padEnd(38)} ${(b / 1024).toFixed(1)} KB`);
console.log(`\n${results.length} files + 5 canvas templates → ${OUT}`);
