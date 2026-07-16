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
  header: { template: `{company_name} — ${title}`, font: { family: 'Arial', size: 9 }, height: 22 } as CanvasRules['header'],
  footer: { template: `${footer} · Page {n} of {N}`, font: { family: 'Arial', size: 9 }, height: 22 } as CanvasRules['footer'],
  font_default: { family: 'Georgia', size, color: '#111827' }, line_spacing: spacing, max_pages: 15, max_slides: null,
});
const meta = (title: string) => ({ title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const });
const doc = (canvas: CanvasRules, nodes: CanvasNode[], title: string): CanvasDocument =>
  ({ version: 1, document_id: crypto.randomUUID(), canvas, nodes, metadata: meta(title) });

const VARS = { company_name: 'Aerivio Systems', topic_title: 'Autonomous Acoustic Threat Classification at the Tactical Edge', topic_number: 'N251-042' };

// ═══════════════════════════════════════════════════════════════════════════
// 1. TECHNICAL VOLUME — full ~15-page white paper
// ═══════════════════════════════════════════════════════════════════════════
const white = doc(letter('Technical Volume', 'SBIR Phase I · Topic N251-042 · Proprietary', 12, 1.5), [
  h(1, 'Technical Volume', '#3730a3'),
  p('{company_name} — SBIR Phase I Proposal', fmt('{company_name} — SBIR Phase I Proposal', '{company_name}', 'bold')),
  p('Topic {topic_number}: {topic_title}', [], { color: '#475569' }),
  p('Period of Performance: 6 months   ·   Requested Funding: $150,000   ·   Distribution: Proprietary', [], { color: '#475569' }),

  h(2, 'Executive Summary', '#1e3a8a'),
  p('Unmanned surface vessels (USVs) increasingly operate beyond reliable communications, yet current acoustic-threat detection depends on shore-side processing that introduces prohibitive latency. Aerivio Systems proposes a quantized, edge-deployable acoustic classifier that identifies and prioritizes sub-surface and surface threats in under 100 milliseconds, entirely on-vessel. This is a paradigm shift from centralized triage to autonomous tactical response.',
    fmt('Unmanned surface vessels (USVs) increasingly operate beyond reliable communications, yet current acoustic-threat detection depends on shore-side processing that introduces prohibitive latency. Aerivio Systems proposes a quantized, edge-deployable acoustic classifier that identifies and prioritizes sub-surface and surface threats in under 100 milliseconds, entirely on-vessel. This is a paradigm shift from centralized triage to autonomous tactical response.', 'under 100 milliseconds', 'bold')),
  p('Our Phase I effort will demonstrate feasibility of a 4-bit quantized convolutional network achieving greater than 92% classification accuracy on the DARPA-released hydrophone corpus while fitting within the 2-watt power envelope of a fielded USV compute module. We combine three co-designed innovations — quantization-aware training, saliency-guided structured pruning, and a deterministic real-time scheduler — to hold accuracy while cutting compute by an order of magnitude.',
    fmt('Our Phase I effort will demonstrate feasibility of a 4-bit quantized convolutional network achieving greater than 92% classification accuracy', 'greater than 92%', 'italic')),
  P('Success in Phase I directly enables a Phase II at-sea demonstration and a clear transition path to Navy programs of record. Because the classifier fits the existing 2-watt compute budget, it retrofits the deployed fleet without new hardware — converting a fleet-wide vulnerability into a fleet-wide capability. The remainder of this volume establishes the operational problem, details the technical approach and its innovations, presents preliminary evidence of feasibility, and lays out a task-by-task work plan, a quantitative evaluation methodology, a data-management plan, a risk-mitigation strategy, and the Phase II transition and commercialization path.'),
  brk(),

  h(2, '1. Problem and Significance', '#1e3a8a'),
  P('The Navy fields a rapidly growing fleet of autonomous surface platforms, but their acoustic sensing pipelines remain tethered to intermittent SATCOM links. When a link degrades — the norm in contested or high-sea-state environments — classification stalls and the vessel loses the ability to distinguish a biologic from a torpedo. The operational consequence is severe: autonomy is throttled precisely when it matters most.'),
  P('Consider a representative scenario. A USV on a persistent picket mission detects an ambiguous acoustic signature. Under today’s architecture, the raw stream is buffered and, if bandwidth permits, relayed to a shore station for classification; the round trip can exceed several seconds. A torpedo closing at 40 knots covers more than 60 meters in that window. The vessel needs a classification decision at the tactical edge, in tens of milliseconds, with no assumption of connectivity.'),
  P('The threat space the classifier must separate is both broad and confusable. Table 1 summarizes the principal acoustic classes of interest and why they are difficult to distinguish under compression.'),
  table(['Class', 'Signature character', 'Confusable with'], [
    ['Torpedo (running)', 'High-RPM screw, rising tonal', 'High-speed surface craft'],
    ['Submarine (transiting)', 'Low-frequency broadband', 'Distant shipping'],
    ['Surface combatant', 'Multi-blade cavitation', 'Merchant traffic'],
    ['Biologic', 'Click trains / whistles', 'Sonar transients'],
    ['Ambient / clutter', 'Sea-state noise', '(baseline)'],
  ]),
  cap('Table', 1, 'Acoustic threat taxonomy and principal confusions the classifier must resolve.'),
  P('The significance extends beyond a single platform. Every autonomous hull the Navy fields inherits this same dependency. Closing the gap is fundamentally a machine-learning-systems problem: state-of-the-art acoustic classifiers are accurate but far too large and power-hungry for a fielded module, and naïve compression collapses accuracy on exactly the confusable classes above. Aerivio’s innovation is a co-designed quantization-and-pruning pipeline that preserves discriminative fidelity at a fraction of the compute cost.'),
  P('From the operational scenario and threat taxonomy, three hard requirements follow, and they jointly define the problem this proposal solves. The classifier must (i) achieve high balanced accuracy across confusable classes — a mean accuracy that hides a torpedo-versus-fast-craft confusion is operationally useless; (ii) return a decision within a worst-case deadline measured in tens of milliseconds, because the closing geometry of a threat leaves no room for tail latency; and (iii) do so within the fielded 2-watt compute budget, because power is the binding constraint on a persistent, unmanned platform. Any approach that satisfies two of the three while sacrificing the third does not transition.'),
  P('The opportunity is timely. Two trends now intersect: the Navy’s unmanned fleet is scaling rapidly, multiplying the number of platforms that inherit the connectivity dependency, while edge-compute modules have matured to the point where a carefully compressed network can run useful inference within single-digit watts. What has been missing is the machine-learning-systems work to compress an accurate maritime classifier without destroying it — precisely the gap Aerivio closes. Acting now converts a growing, fleet-wide vulnerability into a fleet-wide capability before the fleet scales further.'),
  brk(),

  h(2, '2. Technical Approach', '#1e3a8a'),
  P('The Aerivio edge module ingests raw hydrophone-array streams, performs on-device feature extraction, and runs a quantized CNN classifier whose outputs feed directly into the USV autonomy bus. The end-to-end system architecture is shown in Figure 1 and the on-device inference pipeline in Figure 2; all inference occurs on-vessel at a measured 2.0-watt draw.'),
  img(svgArch(), 'System architecture: hydrophone array to edge AI module to threat classifier and autonomy bus', 460, 210),
  cap('Figure', 1, 'Aerivio edge acoustic-sensing architecture. All inference occurs on-vessel.'),
  img(svgPipeline(), 'Inference pipeline: raw audio, STFT, log-mel, quantized CNN, softmax', 460, 120),
  cap('Figure', 2, 'On-device inference pipeline (feature extraction through classification).'),
  P('The approach rests on four co-designed components, detailed below. Each is chosen not for novelty in isolation but because the combination is what makes edge-native maritime threat classification feasible under the power ceiling.'),
  h(3, '2.1 Signal Front-End and Feature Extraction', '#334155'),
  P('The front-end converts the four-channel hydrophone stream into a compact time-frequency representation. We use a short-time Fourier transform followed by a log-mel projection tuned to the maritime band, which concentrates the discriminative energy into roughly 40 mel bins per frame. Beamforming across the array provides a modest directional gain and, importantly, a bearing estimate that the autonomy bus can consume alongside the class label. The front-end is implemented in fixed-point arithmetic so that no floating-point unit is required on the target module.'),
  P('A key design decision is to keep the front-end deterministic and inexpensive: it consumes under 15% of the per-frame compute budget, leaving the remainder for the classifier. This balance was set empirically on the development kit and is revisited in Task 3 against the fielded module.'),
  h(3, '2.2 Quantization-Aware Training', '#334155'),
  p('Rather than train in full precision and quantize afterward — which strands accuracy — we train with simulated 4-bit weight and 8-bit activation precision in the loop. Gradients flow through a straight-through estimator so the network learns weights that are robust to quantization noise, and per-channel scales are learned jointly with the weights. Preliminary experiments hold accuracy within 1.4 points of the full-precision baseline at 4-bit precision, versus a 9-point drop for post-training quantization.',
    fmt('Preliminary experiments hold accuracy within 1.4 points of the full-precision baseline at 4-bit precision, versus a 9-point drop for post-training quantization.', 'within 1.4 points', 'bold')),
  P('Quantization-aware training also regularizes the model: the injected quantization noise discourages brittle, high-magnitude weights, which we observe improves robustness to the sea-state noise that dominates the operational environment. This is a secondary but meaningful benefit that we will quantify in Phase I.'),
  h(3, '2.3 Saliency-Guided Structured Pruning', '#334155'),
  p('Generic pruning removes parameters by magnitude and indiscriminately damages the spectral bands that separate confusable classes — for example, a propeller cavitation signature from a biologic click train. Our saliency metric scores each channel by its contribution to inter-class separation in the confusion-prone subspace, computed from the gradient of a margin loss with respect to channel activations, and prunes only channels below a learned threshold.',
    fmt('Our saliency metric scores each channel by its contribution to inter-class separation in the confusion-prone subspace, computed from the gradient of a margin loss with respect to channel activations, and prunes only channels below a learned threshold.', 'inter-class separation', 'italic')),
  p('This removes roughly 70% of parameters while preserving the discriminative bands — the core of Aerivio’s defensible IP (patent pending). Structured (channel-level) pruning, as opposed to unstructured sparsity, is essential because it yields a dense, smaller network that maps efficiently onto the target module’s vector units without specialized sparse-compute support.',
    fmt('This removes roughly 70% of parameters while preserving the discriminative bands', 'roughly 70%', 'bold')),
  h(3, '2.4 Deterministic Real-Time Scheduler', '#334155'),
  P('Accuracy is necessary but not sufficient; the classifier must deliver a decision within a hard deadline at a fixed power budget. We implement a static, deadline-driven scheduler that pins feature extraction and inference to reserved cores and disables dynamic frequency scaling, eliminating the jitter that otherwise makes worst-case latency unbounded. The schedule is computed offline from the pruned network’s operator graph, so the on-vessel runtime carries no scheduling overhead.'),
  P('This design guarantees a 99th-percentile end-to-end latency under 100 ms at a sustained 2.0-watt draw — the two constraints that, together with accuracy, define feasibility for this topic.'),
  h(3, '2.5 Preliminary Feasibility Evidence', '#334155'),
  P('Bench experiments on a representative subset of the DARPA hydrophone corpus already indicate feasibility. Table 2 summarizes the baseline-versus-target comparison that Phase I will formalize and extend to the full corpus and the target hardware.'),
  table(['Metric', 'Full-precision baseline', 'Aerivio 4-bit target'], [
    ['Balanced accuracy (F1)', '93.6%', { text: '92%+', style: { bold: true, bg: '#dcfce7' } }],
    ['Parameters', '4.1 M', '1.2 M'],
    ['End-to-end latency (p99)', '310 ms', { text: '<100 ms', style: { bold: true, bg: '#dcfce7' } }],
    ['Sustained power draw', '11 W', { text: '2.0 W', style: { bold: true, bg: '#dcfce7' } }],
    ['Model footprint', '16.4 MB', '0.6 MB'],
  ]),
  cap('Table', 2, 'Preliminary baseline vs. Phase I target (representative corpus subset).'),
  h(3, '2.6 Model Architecture', '#334155'),
  P('The classifier is a compact residual convolutional network operating on the log-mel feature stream. It comprises five residual stages with progressively increasing channel width and temporal pooling, followed by a global average pool and a linear classification head over the maritime threat classes. The design deliberately favors depth over width: deeper, narrower stages carry more discriminative capacity per parameter, which matters acutely under the 4-bit, pruned regime. All operators are chosen from the set the target module accelerates natively — standard convolutions, additions, and ReLU — so that no operator falls back to slow scalar execution.'),
  P('We deliberately avoid architectural elements that are fashionable but hostile to quantization, such as attention layers with large dynamic range or normalization schemes that require per-inference statistics. Every design choice is filtered through the question, “does this survive 4-bit quantization and static scheduling?” — a discipline that is itself part of the contribution, because it produces a network that is accurate and deployable rather than accurate in a laboratory only.'),
  h(3, '2.7 Robustness and Generalization', '#334155'),
  P('Operational acoustic environments are non-stationary: sea state, shipping density, and biologic activity all shift the input distribution away from any fixed training set. We address generalization on three fronts. First, augmentation (Task 1) exposes the model to a controlled range of sea-state and Doppler conditions during training. Second, quantization-aware training, as noted, acts as a regularizer that discourages brittle weights. Third, the evaluation protocol (Section 6) measures accuracy on session-disjoint held-out data, so reported accuracy reflects generalization to unseen recording conditions rather than memorization.'),
  P('We will additionally report a robustness curve — accuracy as a function of injected noise level — so that the Navy can see not just a single accuracy number but the margin of safety as conditions degrade. This is the kind of evidence a transition sponsor needs to trust an autonomous classifier.'),
  brk(),

  h(2, '3. Innovation and Contributions', '#1e3a8a'),
  P('The central innovation is the coupling of quantization-aware training with a saliency-guided pruning metric specific to acoustic threat discrimination. Neither component is unprecedented in isolation; their integration under a hard power ceiling, targeted at maritime confusable classes, is. Aerivio’s specific contributions in Phase I are:'),
  ul([
    'A saliency metric that scores channels by inter-class margin contribution, preserving the exact bands that separate confusable maritime classes.',
    'A joint quantization-and-pruning schedule that reaches 4-bit precision and 70% channel sparsity without the accuracy collapse of sequential compression.',
    'A statically scheduled runtime that converts a probabilistic latency profile into a hard, provable deadline at 2 watts.',
    'An open, documented evaluation protocol (Section 6) that the Navy can reuse to compare future edge classifiers on equal footing.',
  ]),
  brk(),

  h(2, '4. Phase I Objectives', '#1e3a8a'),
  P('The technical objectives of Phase I are to establish feasibility of the edge classifier against Navy-relevant, pre-registered criteria:'),
  ol([
    'Objective 1 — Curate and augment the hydrophone training corpus with documented provenance and class balance (supports Task 1).',
    'Objective 2 — Train and quantize the baseline classifier to 4-bit precision with saliency-guided pruning, holding balanced accuracy above 92% (supports Task 2).',
    'Objective 3 — Port the runtime to the target 2-watt edge module and benchmark p99 end-to-end latency and sustained power (supports Task 3).',
    'Objective 4 — Validate accuracy, latency, and power against Navy-relevant threat scenarios and document results, limitations, and the Phase II plan (supports Task 4).',
  ]),

  h(2, '5. Phase I Work Plan', '#1e3a8a'),
  P('The six-month effort is organized into four sequential-but-overlapping tasks. Table 3 gives the schedule; the narrative that follows details scope, methods, deliverables, and effort per task. A detailed month-by-month schedule appears in Appendix A.'),
  table(['Task', 'Description', 'Months', 'Lead', 'Deliverable'], [
    ['1', 'Corpus curation & augmentation', '1–2', 'Nandakumar', 'Labeled dataset + data card'],
    ['2', 'Quantization-aware training + pruning', '2–4', 'Ellison', 'Trained 4-bit model + accuracy report'],
    ['3', 'Edge port & latency benchmark', '4–5', 'Reyes', 'Runtime on target module + benchmark log'],
    ['4', 'Validation & final report', '5–6', 'Ellison', 'Phase I feasibility report'],
  ]),
  cap('Table', 3, 'Phase I task schedule (6-month period of performance).'),
  h(3, 'Task 1 — Corpus Curation and Augmentation (Months 1–2)', '#334155'),
  P('We will assemble a labeled training corpus from the DARPA hydrophone release, supplemented by augmentation that models realistic sea-state noise, Doppler shift from relative motion, and multipath from surface and bottom reflection. Each class will be balanced by controlled resampling and documented in a data card capturing provenance, recording conditions, and known limitations, so that downstream accuracy claims are traceable. Effort: 0.25 FTE ML engineer. Deliverable: the labeled dataset and its data card.'),
  h(3, 'Task 2 — Quantization-Aware Training and Pruning (Months 2–4)', '#334155'),
  P('Using the curated corpus, we will train the baseline classifier with 4-bit quantization and saliency-guided pruning in the loop, iterating on the saliency threshold to maximize inter-class separation under the parameter budget. We will run controlled ablations isolating the contribution of quantization-aware training and of saliency pruning, to attribute accuracy retention to each. Effort: 0.30 FTE PI + 0.20 FTE ML engineer. Deliverable: the trained 4-bit model and an accuracy report against a held-out, session-disjoint test split.'),
  h(3, 'Task 3 — Edge Port and Latency Benchmark (Months 4–5)', '#334155'),
  P('We will port the runtime to the target 2-watt module, integrate the deterministic scheduler, and benchmark p99 end-to-end latency and sustained power under representative continuous load. Where the fielded module diverges from the development kit, we will re-tune the schedule and, if required, apply mixed precision to the most confusable layers (the primary risk mitigation of Section 8). Effort: 0.40 FTE systems engineer. Deliverable: the runtime on the target module and a benchmark log demonstrating the latency and power envelope.'),
  h(3, 'Task 4 — Validation and Final Report (Months 5–6)', '#334155'),
  P('We will validate accuracy, latency, and power against a set of Navy-relevant threat scenarios drawn from held-out recording sessions, and document the results, limitations, and the Phase II plan and transition path. Effort: 0.20 FTE PI + support. Deliverable: the Phase I feasibility report.'),
  brk(),

  h(2, '6. Evaluation Methodology', '#1e3a8a'),
  P('Feasibility will be judged against pre-registered quantitative gates, not qualitative impressions. Accuracy is measured as balanced multi-class F1 on a held-out split drawn from distinct recording sessions to prevent leakage across the train/test boundary. Latency is measured end-to-end on the target hardware at the 99th percentile under sustained load, not as a mean, because the operational requirement is a worst-case deadline. Power is measured at the module rail with a calibrated meter over a continuous window.'),
  P('A Phase I pass requires all three gates simultaneously, as summarized in Table 4. Reporting the full confusion matrix — not just aggregate accuracy — is a deliverable, because the operationally important errors are specific confusions (for example, torpedo-versus-fast-craft) rather than average error.'),
  table(['Gate', 'Metric', 'Threshold'], [
    ['Accuracy', 'Balanced F1 (session-disjoint)', '≥ 0.92'],
    ['Latency', 'End-to-end p99 on target', '< 100 ms'],
    ['Power', 'Sustained rail draw', '≤ 2.0 W'],
  ]),
  cap('Table', 4, 'Pre-registered Phase I feasibility gates (all must pass).'),

  h(2, '7. Data Management Plan', '#1e3a8a'),
  P('All training data derives from the Distribution-A DARPA hydrophone corpus plus synthetic augmentation; no classified or controlled data is used in Phase I. Data, model checkpoints, and evaluation logs are versioned and retained for the period of performance plus three years, with a documented data card per Task 1. Trained models and the final report are delivered to the Navy technical point of contact; Aerivio retains background IP (the saliency-pruning method) consistent with SBIR data rights, and asserts limited rights only on that method, not on the delivered results.'),
  brk(),

  h(2, '8. Risk Assessment and Mitigation', '#1e3a8a'),
  P('The principal Phase I risks and their mitigations are enumerated in Table 5. The dominant technical risk — a 4-bit accuracy shortfall on the most confusable layers — has a concrete, pre-planned mitigation (selective mixed precision) that trades a small, bounded increase in compute for accuracy, keeping the effort within the power budget.'),
  table(['Risk', 'Likelihood', 'Impact', 'Mitigation'], [
    ['4-bit accuracy shortfall', 'Medium', 'High', 'Mixed-precision fallback on the most confusable layers'],
    ['Latency exceeds budget on target', 'Low', 'High', 'Reserve cores + static schedule; profile early in Task 3'],
    ['Corpus class imbalance', 'Medium', 'Medium', 'Targeted augmentation + class-balanced sampling in Task 1'],
    ['Hardware availability slip', 'Low', 'Medium', 'Two development kits procured up front (see Cost Volume)'],
    ['Domain shift (sea state)', 'Medium', 'Medium', 'Sea-state augmentation + robustness ablation in Task 2'],
  ]),
  cap('Table', 5, 'Principal Phase I risks, likelihood, impact, and mitigations.'),

  h(2, '9. Related Work', '#1e3a8a'),
  P('Prior edge-audio efforts target keyword spotting at low fidelity and small class counts; none address multi-class maritime threat discrimination under a hard power ceiling. Post-training quantization methods are simple but strand accuracy on confusable classes. Magnitude pruning is standard but blind to inter-class saliency, and unstructured sparsity does not map efficiently onto edge vector units. Aerivio’s contribution is the coupling of quantization-aware training with a saliency-guided, structured pruning metric specific to acoustic threat discrimination — a combination we have validated in preliminary bench tests and are pursuing as protected IP.'),
  P('We build on well-established foundations — integer-arithmetic inference, straight-through estimators for quantization-aware training, and margin-based feature attribution — and contribute their integration and specialization to this operational problem, rather than reinventing those primitives.'),
  brk(),

  h(2, '10. Team and Qualifications', '#1e3a8a'),
  P('The effort is led by Dr. Mara Ellison (Principal Investigator, 0.30 FTE), whose 12 years in low-power machine learning for sensing produced the quantization research that underpins Aerivio’s core IP. Senior Systems Engineer Tomas Reyes (9 years, two fielded maritime autonomy stacks) owns the edge-port and latency-benchmark tasks. ML Engineer Priya Nandakumar specializes in model compression and data augmentation and leads corpus curation and quantization-aware training.'),
  P('The team has worked together on two prior efforts and shares a common toolchain, which de-risks the aggressive six-month schedule. Full biographies appear in the Key Personnel supporting document.'),
  h(2, '11. Facilities and Equipment', '#1e3a8a'),
  P('Aerivio maintains a dedicated acoustics bench and a custom anechoic test enclosure, six 2-watt edge-compute development kits, and an on-premises GPU training cluster. Data collection leverages an existing partnership with a regional marine research station, providing access to representative acoustic conditions at no additional Phase I cost. Facilities and equipment are described in full in the Facilities supporting document.'),
  brk(),

  h(2, '12. Phase II Vision and Transition Plan', '#1e3a8a'),
  P('Phase I establishes feasibility of the edge classifier on the target module. Phase II hardens the module, extends the corpus to fielded recordings, and conducts an at-sea demonstration on a Navy USV, targeting the same three gates under operational conditions plus an added robustness gate across sea states. We will pursue a Phase II budget of approximately $1.1M over 24 months.'),
  P('The transition plan is explicit. In Phase III we target integration with a Navy USV program of record through the relevant program office, positioning Aerivio as the acoustic-classification component supplier. Because the classifier fits the existing compute budget, transition does not require a hardware program — only a software integration and accreditation effort, which materially lowers the transition barrier.'),
  P('We have identified the acquisition pathway and the sustainment model (a delivered, accredited model plus a maintenance and re-training subscription) so that the technology has a funded home beyond the SBIR effort.'),

  h(2, '13. Commercialization Summary', '#1e3a8a'),
  P('The Phase I classifier is the wedge for a broad commercialization plan detailed in the separate Commercialization volume: Navy USV programs of record in Phase III, then allied navies and commercial maritime security (port monitoring, offshore-energy protection). The serviceable market is projected to grow from roughly $8M/yr in 2026 to over $60M/yr by 2030, and Aerivio’s edge-native, power-efficient position is defensible against shore-side incumbents.'),
  P('The dual-use nature of the technology — the same edge classifier serves commercial port and offshore-energy monitoring with minimal modification — provides a commercial revenue path that reduces reliance on any single government program.'),

  h(2, '14. Intellectual Property and Data Rights', '#1e3a8a'),
  P('Aerivio’s background intellectual property — the saliency-guided structured-pruning method — predates this effort and is the subject of a pending patent application. Under standard SBIR data-rights provisions, Aerivio retains ownership of background IP and asserts SBIR data rights in technical data and computer software developed under this award for the statutory protection period. The Government receives the license rights to which it is entitled under the applicable clauses.'),
  P('Foreground IP developed specifically under Phase I — the trained model, the evaluation protocol, and the documented data card — is delivered to the Government consistent with those rights. Aerivio will clearly mark all limited-rights and restricted-rights deliverables and will not assert restrictions beyond those the clauses permit, so that transition is not encumbered by ambiguous IP claims.'),
  P('This clarity is deliberate: an unclear IP posture is one of the most common reasons promising SBIR technology fails to transition, and Aerivio has structured its rights assertions to keep the transition path clean.'),

  h(2, '15. Broader Impacts', '#1e3a8a'),
  P('Beyond the immediate Navy application, an accurate, power-efficient acoustic classifier that runs at the edge advances a broader capability: trustworthy autonomy in communications-denied environments. The same architecture and methods transfer to undersea infrastructure monitoring, environmental acoustic sensing, and search-and-rescue, where on-device inference under a power ceiling is equally decisive. The evaluation protocol we publish (Section 6) also contributes a reusable, transparent yardstick for comparing edge acoustic classifiers, which benefits the wider research and acquisition community.'),

  h(3, 'References', '#475569'),
  ul([
    '[1] DARPA Hydrophone Corpus, Distribution A, 2024.',
    '[2] Ellison, M. et al., "Saliency-Guided Quantization for Acoustic Edge Inference," 2025 (in preparation).',
    '[3] Reyes, T., "Deterministic Scheduling for Sub-Watt Inference," Embedded ML Workshop, 2024.',
    '[4] Nandakumar, P., "Sea-State Augmentation for Hydrophone Classifiers," 2025 (in preparation).',
    '[5] U.S. Navy, "Unmanned Campaign Framework," 2023.',
    '[6] Jacob, B. et al., "Quantization and Training of Neural Networks for Efficient Integer-Arithmetic Inference," 2018.',
    '[7] Bengio, Y. et al., "Estimating or Propagating Gradients Through Stochastic Neurons," 2013.',
    '[8] Molchanov, P. et al., "Importance Estimation for Neural Network Pruning," 2019.',
  ]),
  brk(),

  h(2, 'Appendix A — Detailed Phase I Schedule', '#1e3a8a'),
  table(['Month', 'Task 1', 'Task 2', 'Task 3', 'Task 4'], [
    ['1', '●', '', '', ''], ['2', '●', '●', '', ''], ['3', '', '●', '', ''],
    ['4', '', '●', '●', ''], ['5', '', '', '●', '●'], ['6', '', '', '', '●'],
  ]),
  cap('Table', 6, 'Month-by-month task activity (● = active).'),
  h(2, 'Appendix B — Compliance Cross-Reference', '#1e3a8a'),
  P('This volume addresses each solicitation requirement as cross-referenced below; the full compliance matrix is maintained in the proposal workspace and advances to “satisfied” as each section is accepted and locked.'),
  table(['Requirement', 'Addressed in'], [
    ['Technical approach & feasibility', 'Sections 2, 3, 5'],
    ['Preliminary results / rationale', 'Section 2.5'],
    ['Evaluation & metrics', 'Section 6'],
    ['Data management', 'Section 7'],
    ['Risk & mitigation', 'Section 8'],
    ['Team & facilities', 'Sections 10, 11'],
    ['Transition & commercialization', 'Sections 12, 13'],
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
  p('Topic N251-042 · US Navy · $150,000 / 6 months', [], { color: '#64748b' }),
  brk(),
  h(1, 'Market Opportunity'),
  ul(['Navy USV fleet projected to exceed 300 hulls by 2030 — each needs edge acoustic sensing', 'Beachhead: US Navy programs of record', 'Expansion: allied navies + commercial maritime security (ports, offshore energy)', 'Serviceable market growing ~$8M → $60M+ per year by 2030']),
  img(svgChart('Serviceable market ($M/yr)', [['2026', 8, '#93c5fd'], ['2028', 24, '#3b82f6'], ['2030', 61, '#1d4ed8']]), 'Market growth chart', 440, 200),
  brk(),
  h(1, 'Competition & Differentiation'),
  ul(['Incumbents process acoustics shore-side → latency + comms dependence', 'Aerivio runs fully on-vessel at 2 watts, <100 ms', 'Defensible IP: saliency-guided quantization pipeline (patent pending)', 'Retrofits deployed hulls — no new hardware program required']),
  p('Bottom line: we win where connectivity fails — exactly the contested environment that matters.', fmt('Bottom line: we win where connectivity fails — exactly the contested environment that matters.', 'win where connectivity fails', 'bold')),
  brk(),
  h(1, 'Go-to-Market & Milestones'),
  ol(['Phase I (now): feasibility on the Navy corpus, months 1–6', 'Phase II: hardened module + at-sea demonstration (~$1.1M / 24 mo)', 'Phase III: transition to a Navy USV program of record', 'Commercial: port-security & offshore-energy monitoring (dual-use)']),
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
await emit('Aerivio_Key_Personnel_Bios.pdf', await exportToPdf(bios, VARS));
await emit('Aerivio_Facilities.pdf', await exportToPdf(facilities, VARS));

console.log('\n── Deliverables generated ──');
for (const [n, b] of results) console.log(`  ${n.padEnd(38)} ${(b / 1024).toFixed(1)} KB`);
console.log(`\n${results.length} files + 5 canvas templates → ${OUT}`);
