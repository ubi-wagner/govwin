/**
 * Generate the complete Aerivio Systems SBIR Phase I proposal deliverables via
 * the real exporters (docx / pptx / xlsx / pdf). Fake company + technology, 100%
 * complete content, styled (bold/italic/color, headers/footers, sections,
 * generated SVG placeholders). Writes to docs/sample-proposal/.
 */
import { mkdirSync, writeFileSync } from 'fs';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { exportToXlsx } from '@/lib/export/xlsx-exporter';
import { exportToPdf } from '@/lib/export/pdf-exporter';
import type { CanvasDocument, CanvasNode, CanvasRules } from '@/lib/types/canvas-document';

// ── node builders ───────────────────────────────────────────────────────────
const N = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: crypto.randomUUID(), type, content: content as CanvasNode['content'], style: style as CanvasNode['style'],
  provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const h = (level: 1 | 2 | 3, text: string, color?: string) => N('heading', { level, text }, color ? { color } : {});
const p = (text: string, formats: Array<{ start: number; length: number; format: string }> = [], style: Record<string, unknown> = {}) =>
  N('text_block', { text, inline_formats: formats }, style);
const ul = (items: string[]) => N('bulleted_list', { items: items.map((t) => ({ text: t })) });
const ol = (items: string[]) => N('numbered_list', { items: items.map((t) => ({ text: t })) });
const brk = () => N('page_break', null);
const cap = (prefix: string, number: number, text: string) => N('caption', { prefix, number, text });
// bold/italic helpers: find substring and mark it
const fmt = (text: string, sub: string, format: string) => { const s = text.indexOf(sub); return s < 0 ? [] : [{ start: s, length: sub.length, format }]; };
const img = (svg: string, alt: string, w: number, hgt: number, caption?: string) =>
  N('image', { storage_key: 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'), alt_text: alt, width: w, height: hgt, caption });

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
const svgChart = (title: string, bars: Array<[string, number, string]>) => {
  const max = Math.max(...bars.map((b) => b[1]));
  const bw = 70, gap = 30, base = 170;
  const rects = bars.map((b, i) => { const bh = Math.round((b[1] / max) * 120); const x = 40 + i * (bw + gap); return `<rect x="${x}" y="${base - bh}" width="${bw}" height="${bh}" fill="${b[2]}"/><text x="${x + bw / 2}" y="${base + 15}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">${b[0]}</text><text x="${x + bw / 2}" y="${base - bh - 5}" text-anchor="middle" font-family="Arial" font-size="10" fill="#334155">$${b[1]}M</text>`; }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="200"><rect width="440" height="200" fill="#fff"/><text x="20" y="24" font-family="Arial" font-size="13" font-weight="bold" fill="#1e293b">${title}</text>${rects}</svg>`;
};

const letter = (title: string, footer: string): CanvasRules => ({
  format: 'letter', width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: `{company_name} — ${title}`, font: { family: 'Arial', size: 9 }, height: 22 } as CanvasRules['header'],
  footer: { template: `${footer} · Page {n} of {N}`, font: { family: 'Arial', size: 9 }, height: 22 } as CanvasRules['footer'],
  font_default: { family: 'Georgia', size: 11, color: '#111827' }, line_spacing: 1.3, max_pages: 15, max_slides: null,
});
const meta = (title: string) => ({ title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const });
const doc = (canvas: CanvasRules, nodes: CanvasNode[], title: string): CanvasDocument =>
  ({ version: 1, document_id: crypto.randomUUID(), canvas, nodes, metadata: meta(title) });

const VARS = { company_name: 'Aerivio Systems', topic_title: 'Autonomous Acoustic Threat Classification at the Tactical Edge', topic_number: 'N251-042' };

// ═══ 1. TECHNICAL VOLUME (white paper) ═══════════════════════════════════════
const P = (t: string) => p(t); // convenience for plain paragraphs
const white = doc(letter('Technical Volume', 'SBIR Phase I · Topic N251-042 · Proprietary'), [
  h(1, 'Technical Volume', '#3730a3'),
  p('{company_name} — SBIR Phase I Proposal', fmt('{company_name} — SBIR Phase I Proposal', '{company_name}', 'bold')),
  p('Topic {topic_number}: {topic_title}', [], { color: '#475569' }),
  p('Period of Performance: 6 months  ·  Requested Funding: $150,000  ·  Distribution: Proprietary', [], { color: '#475569' }),

  h(2, 'Executive Summary', '#1e3a8a'),
  p('Unmanned surface vessels (USVs) increasingly operate beyond reliable communications, yet current acoustic-threat detection depends on shore-side processing that introduces prohibitive latency. Aerivio Systems proposes a quantized, edge-deployable acoustic classifier that identifies and prioritizes sub-surface and surface threats in under 100 milliseconds, entirely on-vessel. This is a paradigm shift from centralized triage to autonomous tactical response.',
    fmt('Unmanned surface vessels (USVs) increasingly operate beyond reliable communications, yet current acoustic-threat detection depends on shore-side processing that introduces prohibitive latency. Aerivio Systems proposes a quantized, edge-deployable acoustic classifier that identifies and prioritizes sub-surface and surface threats in under 100 milliseconds, entirely on-vessel. This is a paradigm shift from centralized triage to autonomous tactical response.', 'under 100 milliseconds', 'bold')),
  p('Our Phase I effort will demonstrate feasibility of a 4-bit quantized convolutional network achieving greater than 92% classification accuracy on the DARPA-released hydrophone corpus while fitting within the 2-watt power envelope of a fielded USV compute module. Success in Phase I directly enables a Phase II at-sea demonstration and a clear transition path to Navy programs of record.',
    fmt('Our Phase I effort will demonstrate feasibility of a 4-bit quantized convolutional network achieving greater than 92% classification accuracy', 'greater than 92%', 'italic')),
  P('The remainder of this volume establishes the operational problem, details the technical approach and its three innovations, presents preliminary evidence of feasibility, and lays out a task-by-task work plan, a quantitative evaluation methodology, and a risk-mitigation strategy for the six-month period of performance.'),

  h(2, '1. Problem and Significance', '#1e3a8a'),
  P('The Navy fields a rapidly growing fleet of autonomous surface platforms, but their acoustic sensing pipelines remain tethered to intermittent SATCOM links. When a link degrades — the norm in contested or high-sea-state environments — classification stalls and the vessel loses the ability to distinguish a biologic from a torpedo. The operational consequence is severe: autonomy is throttled precisely when it matters most.'),
  P('Consider a representative scenario. A USV on a persistent picket mission detects an ambiguous acoustic signature. Under today’s architecture, the raw stream is buffered and, if bandwidth permits, relayed to a shore station for classification; the round trip can exceed several seconds. A torpedo closing at 40 knots covers more than 60 meters in that window. The vessel needs a classification decision at the tactical edge, in tens of milliseconds, with no assumption of connectivity.'),
  P('The significance extends beyond a single platform. Every autonomous hull the Navy fields inherits this same dependency. An edge-native classifier that fits the existing 2-watt compute budget would retrofit the deployed fleet without new hardware, converting a fleet-wide vulnerability into a fleet-wide capability.'),
  P('Closing this gap is fundamentally a machine-learning-systems problem. State-of-the-art acoustic classifiers are accurate but far too large and power-hungry for a fielded module. Naïve compression collapses accuracy on exactly the confusable classes that matter. Aerivio’s innovation is a co-designed quantization-and-pruning pipeline that preserves discriminative fidelity at a fraction of the compute cost.'),

  h(2, '2. Technical Approach', '#1e3a8a'),
  P('The Aerivio edge module ingests raw hydrophone-array streams, performs on-device feature extraction, and runs a quantized CNN classifier whose outputs feed directly into the USV autonomy bus. The end-to-end architecture is shown in Figure 1; all inference occurs on-vessel.'),
  img(svgArch(), 'System architecture: hydrophone array to edge AI module to threat classifier and autonomy bus', 460, 210),
  cap('Figure', 1, 'Aerivio edge acoustic-sensing architecture. All inference occurs on-vessel at 2 watts.'),
  P('The approach rests on three co-designed innovations, detailed below.'),
  h(3, '2.1 Quantization-Aware Training', '#334155'),
  P('Rather than train in full precision and quantize afterward — which strands accuracy — we train with simulated 4-bit weight and 8-bit activation precision in the loop. Gradients flow through a straight-through estimator so the network learns weights that are robust to quantization noise. Preliminary experiments hold accuracy within 1.4 points of the full-precision baseline at 4-bit precision, versus a 9-point drop for post-training quantization.'),
  h(3, '2.2 Saliency-Guided Structured Pruning', '#334155'),
  P('Generic pruning removes parameters by magnitude and indiscriminately damages the spectral bands that separate confusable classes (for example, a propeller cavitation signature from a biologic click train). Our saliency metric scores each channel by its contribution to inter-class separation in the confusion-prone subspace, and prunes only channels below a learned threshold. This removes roughly 70% of parameters while preserving the discriminative bands — the core of Aerivio’s defensible IP (patent pending).',
    fmt('This removes roughly 70% of parameters while preserving the discriminative bands', 'roughly 70%', 'bold')),
  h(3, '2.3 Deterministic Real-Time Scheduler', '#334155'),
  P('Accuracy is necessary but not sufficient; the classifier must deliver a decision within a hard deadline at a fixed power budget. We implement a static, deadline-driven scheduler that pins feature extraction and inference to reserved cores, eliminating jitter from dynamic frequency scaling. This guarantees sub-100ms end-to-end latency at a measured 2.0-watt draw.'),
  h(3, '2.4 Preliminary Feasibility Evidence', '#334155'),
  P('Bench experiments on a representative subset of the DARPA hydrophone corpus already indicate feasibility. Table 1 summarizes the baseline-versus-target comparison that Phase I will formalize and extend to the full corpus and the target hardware.'),
  N('table', {
    headers: ['Metric', 'Full-precision baseline', 'Aerivio 4-bit target'],
    rows: [
      ['Classification accuracy', '93.6%', { text: '92%+', style: { bold: true, bg: '#dcfce7' } }],
      ['Parameters', '4.1 M', '1.2 M'],
      ['End-to-end latency', '310 ms', { text: '<100 ms', style: { bold: true, bg: '#dcfce7' } }],
      ['Power draw', '11 W', { text: '2.0 W', style: { bold: true, bg: '#dcfce7' } }],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
  cap('Table', 1, 'Preliminary baseline vs. Phase I target (representative corpus subset).'),

  h(2, '3. Phase I Objectives', '#1e3a8a'),
  P('The technical objectives of Phase I are to establish feasibility of the edge classifier against Navy-relevant criteria:'),
  ol([
    'Objective 1 — Curate and augment the hydrophone training corpus with documented provenance and class balance (supports Task 1).',
    'Objective 2 — Train and quantize the baseline classifier to 4-bit precision, holding accuracy above 92% (supports Task 2).',
    'Objective 3 — Port the runtime to the target 2-watt edge module and benchmark end-to-end latency (supports Task 3).',
    'Objective 4 — Validate accuracy, latency, and power against Navy-relevant threat scenarios and document results (supports Task 4).',
  ]),

  h(2, '4. Phase I Work Plan', '#1e3a8a'),
  P('The six-month effort is organized into four sequential-but-overlapping tasks. Table 2 gives the schedule; the narrative that follows details scope, methods, and deliverables per task.'),
  N('table', {
    headers: ['Task', 'Description', 'Months', 'Deliverable'],
    rows: [
      ['1', 'Corpus curation & augmentation', '1–2', 'Labeled dataset + data card'],
      ['2', 'Quantization-aware training', '2–4', 'Trained 4-bit model + accuracy report'],
      ['3', 'Edge port & latency benchmark', '4–5', 'Runtime on target module + benchmark log'],
      ['4', 'Validation & final report', '5–6', 'Phase I feasibility report'],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
  cap('Table', 2, 'Phase I task schedule (6-month period of performance).'),
  h(3, 'Task 1 — Corpus Curation and Augmentation (Months 1–2)', '#334155'),
  P('We will assemble a labeled training corpus from the DARPA hydrophone release, supplemented by augmentation that models realistic sea-state noise, Doppler shift, and multipath. Each class will be balanced and every record documented in a data card capturing provenance and known limitations. Deliverable: the labeled dataset and its data card.'),
  h(3, 'Task 2 — Quantization-Aware Training (Months 2–4)', '#334155'),
  P('Using the curated corpus, we will train the baseline classifier with 4-bit quantization and saliency-guided pruning in the loop, iterating on the saliency threshold to maximize inter-class separation under the parameter budget. Deliverable: the trained 4-bit model and an accuracy report against a held-out test split.'),
  h(3, 'Task 3 — Edge Port and Latency Benchmark (Months 4–5)', '#334155'),
  P('We will port the runtime to the target 2-watt module, integrate the deterministic scheduler, and benchmark end-to-end latency and power under sustained load. Deliverable: the runtime on the target module and a benchmark log demonstrating the latency and power envelope.'),
  h(3, 'Task 4 — Validation and Final Report (Months 5–6)', '#334155'),
  P('We will validate accuracy, latency, and power against a set of Navy-relevant threat scenarios and document the results, limitations, and the Phase II plan. Deliverable: the Phase I feasibility report.'),

  h(2, '5. Evaluation Methodology', '#1e3a8a'),
  P('Feasibility will be judged against pre-registered quantitative gates, not qualitative impressions. Accuracy is measured as balanced multi-class F1 on a held-out split drawn from distinct recording sessions to prevent leakage. Latency is measured end-to-end on the target hardware at the 99th percentile under sustained load, not as a mean. Power is measured at the module rail with a calibrated meter. A pass requires F1 ≥ 0.92, p99 latency < 100 ms, and sustained draw ≤ 2.0 W simultaneously.'),

  h(2, '6. Risk Assessment and Mitigation', '#1e3a8a'),
  N('table', {
    headers: ['Risk', 'Likelihood', 'Mitigation'],
    rows: [
      ['4-bit accuracy shortfall', 'Medium', 'Mixed-precision fallback on the most confusable layers'],
      ['Latency exceeds budget on target', 'Low', 'Reserve cores + static schedule; profile early in Task 3'],
      ['Corpus class imbalance', 'Medium', 'Targeted augmentation + class-balanced sampling in Task 1'],
      ['Hardware availability slip', 'Low', 'Two development kits procured up front (see Cost Volume)'],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
  cap('Table', 3, 'Principal Phase I risks and mitigations.'),

  h(2, '7. Related Work and Innovation', '#1e3a8a'),
  P('Prior edge-audio efforts target keyword spotting at low fidelity and small class counts; none address multi-class maritime threat discrimination under a hard power ceiling. Post-training quantization methods are simple but strand accuracy on confusable classes. Magnitude pruning is standard but blind to inter-class saliency. Aerivio’s contribution is the coupling of quantization-aware training with a saliency-guided pruning metric specific to acoustic threat discrimination — a combination we have validated in preliminary bench tests and are pursuing as protected IP.'),

  h(2, '8. Team and Facilities', '#1e3a8a'),
  P('The effort is led by Dr. Mara Ellison (Principal Investigator, 0.30 FTE), with Senior Systems Engineer Tomas Reyes and ML Engineer Priya Nandakumar. Full biographies appear in the Key Personnel supporting document. Aerivio maintains a dedicated acoustics bench and anechoic enclosure; facilities and equipment are described in the Facilities supporting document. Data collection leverages an existing marine-research-station partnership at no additional Phase I cost.'),

  h(2, '9. Commercialization Summary', '#1e3a8a'),
  P('The Phase I classifier is the wedge for a broad commercialization plan detailed in the Commercialization volume: Navy USV programs of record in Phase III, then allied navies and commercial maritime security (port monitoring, offshore-energy protection). The serviceable market is projected to grow from roughly $8M/yr in 2026 to over $60M/yr by 2030.'),

  h(3, 'References', '#475569'),
  ul([
    '[1] DARPA Hydrophone Corpus, Distribution A, 2024.',
    '[2] Ellison, M. et al., "Saliency-Guided Quantization for Acoustic Edge Inference," 2025 (in preparation).',
    '[3] Reyes, T., "Deterministic Scheduling for Sub-Watt Inference," Embedded ML Workshop, 2024.',
    '[4] Nandakumar, P., "Sea-State Augmentation for Hydrophone Classifiers," 2025 (in preparation).',
    '[5] U.S. Navy, "Unmanned Campaign Framework," 2023.',
    '[6] Jacob, B. et al., "Quantization and Training of Neural Networks for Efficient Integer-Arithmetic Inference," 2018.',
  ]),
], 'Aerivio Technical Volume');

// ═══ 2. COMMERCIALIZATION (5-slide deck) ═════════════════════════════════════
const slide: CanvasRules = { format: 'slide_16_9', width: 960, height: 540, margins: { top: 40, right: 40, bottom: 40, left: 40 }, header: null, footer: null, font_default: { family: 'Arial', size: 18 }, line_spacing: 1.2, max_pages: null, max_slides: 25 } as CanvasRules;
const deck = doc(slide, [
  h(1, 'Aerivio Systems', '#3730a3'), p('Commercialization Plan — SBIR Phase I', [], { color: '#475569' }), p('Edge-AI acoustic threat classification for unmanned surface vessels'), brk(),
  h(1, 'Market Opportunity'), ul(['Navy USV fleet projected to exceed 300 hulls by 2030', 'Every autonomous hull needs edge acoustic sensing', 'Beachhead: Navy; expansion: allied navies + commercial maritime security']),
  img(svgChart('Serviceable market ($M/yr)', [['2026', 8, '#93c5fd'], ['2028', 24, '#3b82f6'], ['2030', 61, '#1d4ed8']]), 'Market growth chart', 440, 200), brk(),
  h(1, 'Competition & Differentiation'), ul(['Incumbents process acoustics shore-side (latency, comms-dependent)', 'Aerivio runs fully on-vessel at 2 watts', 'Defensible IP: saliency-guided quantization pipeline (patent pending)']), brk(),
  h(1, 'Go-to-Market & Milestones'), ol(['Phase I: feasibility on Navy corpus (months 1–6)', 'Phase II: hardened module + at-sea trials', 'Phase III: transition to PEO USC program of record', 'Commercial: port-security & offshore-energy monitoring']), brk(),
  h(1, 'Financials & Ask'), p('Phase I budget: $150,000 over 6 months.', fmt('Phase I budget: $150,000 over 6 months.', '$150,000', 'bold')), ul(['Team of 3 (PI + 2 engineers)', 'Deliverable: validated 4-bit edge classifier', 'Phase II target: $1.1M for at-sea demonstration']),
], 'Aerivio Commercialization');

// ═══ 3. COST VOLUME ($150k budget) ═══════════════════════════════════════════
const sheet: CanvasRules = { format: 'spreadsheet', width: 1200, height: 800, margins: { top: 0, right: 0, bottom: 0, left: 0 }, header: null, footer: null, font_default: { family: 'Calibri', size: 11 }, line_spacing: 1, max_pages: null, max_slides: null } as CanvasRules;
const budget = doc(sheet, [
  N('table', {
    sheet_name: 'Phase I Budget',
    headers: ['Cost Category', 'Basis', 'Amount'],
    rows: [
      ['Direct Labor', 'PI 0.30 FTE + 2 engineers', { text: '88000', cell_type: 'currency', value: 88000 }],
      ['Fringe Benefits', '25% of direct labor', { text: '22000', cell_type: 'currency', value: 22000 }],
      ['Materials & Supplies', 'Edge compute modules, hydrophones', { text: '8000', cell_type: 'currency', value: 8000 }],
      ['Travel', 'Kickoff + Phase I review (2 trips)', { text: '4000', cell_type: 'currency', value: 4000 }],
      ['Consultant', 'Acoustics SME (40 hrs)', { text: '12000', cell_type: 'currency', value: 12000 }],
      ['Indirect (Overhead)', '18% modified total', { text: '16000', cell_type: 'currency', value: 16000 }],
      [{ text: 'TOTAL', style: { bold: true, bg: '#dcfce7' } }, { text: '', style: { bg: '#dcfce7' } }, { text: '150000', cell_type: 'currency', value: 150000, style: { bold: true, bg: '#dcfce7' } }],
    ],
    header_style: { bg: '#1e293b', bold: true },
  }),
], 'Aerivio Cost Volume');

// ═══ 4. SUPPORTING — Key Personnel Bios (PDF) ════════════════════════════════
const bios = doc(letter('Key Personnel', 'SBIR Phase I · Supporting Documents · Proprietary'), [
  h(1, 'Key Personnel', '#3730a3'),
  h(2, 'Dr. Mara Ellison — Principal Investigator', '#1e3a8a'),
  img(svgHeadshot('ME', '#6366f1'), 'Headshot placeholder for Dr. Mara Ellison', 150, 150),
  p('Dr. Ellison holds a Ph.D. in Electrical Engineering and has 12 years of experience in low-power machine learning for sensing. She led the quantization research that underpins Aerivio’s core IP and will devote 0.30 FTE to this effort.',
    fmt('Dr. Ellison holds a Ph.D. in Electrical Engineering and has 12 years of experience in low-power machine learning for sensing. She led the quantization research that underpins Aerivio’s core IP and will devote 0.30 FTE to this effort.', '0.30 FTE', 'bold')),
  h(2, 'Tomas Reyes — Senior Systems Engineer', '#1e3a8a'),
  img(svgHeadshot('TR', '#0ea5e9'), 'Headshot placeholder for Tomas Reyes', 150, 150),
  p('Mr. Reyes brings 9 years of embedded real-time systems experience, including two fielded maritime autonomy stacks. He owns the edge-port and latency-benchmark tasks.'),
  h(2, 'Priya Nandakumar — ML Engineer', '#1e3a8a'),
  img(svgHeadshot('PN', '#10b981'), 'Headshot placeholder for Priya Nandakumar', 150, 150),
  p('Ms. Nandakumar specializes in model compression and data augmentation. She will lead corpus curation and quantization-aware training.'),
], 'Aerivio Key Personnel Bios');

// ═══ 5. SUPPORTING — Facilities (PDF) ════════════════════════════════════════
const facilities = doc(letter('Facilities & Equipment', 'SBIR Phase I · Supporting Documents · Proprietary'), [
  h(1, 'Facilities and Equipment', '#3730a3'),
  p('Aerivio Systems maintains a 3,200 sq ft engineering facility with a dedicated acoustics bench and an anechoic test enclosure.'),
  img(svgFacility('Aerivio HQ — Engineering & Acoustics Lab'), 'Facility illustration placeholder', 340, 190),
  cap('Figure', 1, 'Aerivio headquarters and acoustics laboratory (illustration).'),
  h(2, 'Key Equipment', '#1e3a8a'),
  ul(['4-channel calibrated hydrophone array', 'Anechoic test enclosure (custom)', '2-watt edge compute development kits (x6)', 'GPU training cluster (on-prem, 8x)']),
  h(2, 'Test Environment', '#1e3a8a'),
  p('At-sea data collection is conducted under an existing partnership with a regional marine research station, providing access to representative acoustic conditions without additional Phase I cost.', fmt('...', 'without additional Phase I cost', 'italic')),
], 'Aerivio Facilities');

// ── generate ────────────────────────────────────────────────────────────────
const OUT = '/home/user/govwin/docs/sample-proposal';
mkdirSync(OUT, { recursive: true });
const results: Array<[string, number]> = [];
async function emit(name: string, buf: Buffer) { writeFileSync(`${OUT}/${name}`, buf); results.push([name, buf.length]); }

await emit('Aerivio_Technical_Volume.docx', await exportToDocx(white, VARS));
await emit('Aerivio_Technical_Volume.pdf', await exportToPdf(white, VARS));
await emit('Aerivio_Commercialization.pptx', await exportToPptx(deck, VARS));
await emit('Aerivio_Cost_Volume.xlsx', await exportToXlsx(budget, VARS));
await emit('Aerivio_Key_Personnel_Bios.pdf', await exportToPdf(bios, VARS));
await emit('Aerivio_Facilities.pdf', await exportToPdf(facilities, VARS));

console.log('\n── Deliverables generated ──');
for (const [n, b] of results) console.log(`  ${n.padEnd(38)} ${(b / 1024).toFixed(1)} KB`);
console.log(`\n${results.length} files → ${OUT}`);
