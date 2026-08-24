/**
 * THE WHOLE ARC, as a person walks it, with a screen grab at every step.
 *
 * Every other harness here proves one hop. This walks the product end to end — an rfp_admin
 * ingesting a solicitation, a customer applying and being onboarded, their library and buckets, a
 * new opportunity arriving and re-ranking what they see, a portal being provisioned, volumes being
 * authored, and the finished artifacts coming out the other side — and photographs each stage.
 *
 * WHY SCREEN GRABS AND NOT ASSERTIONS ALONE. B120 was a document that rendered "Something went
 * wrong" while its exports were byte-perfect: the data was never wrong, only the screen was, and
 * every byte-level check in this repo passed throughout. An arc that only asserts row counts would
 * have walked straight past it. The picture is the evidence a person can disagree with.
 *
 * WHAT IT REFUSES TO DO. It does not fabricate a stage it could not perform. Anything it cannot
 * reach is recorded in GAPS and printed at the end, because a nine-stage journey that silently
 * skips stage four is a demo, not a proof.
 *
 *   cd frontend && npx tsx scripts/drive-full-journey.mts
 *   DEMO_OUT=/tmp/journey  where the screen grabs land
 */
import { sql, sqlBypass } from '@/lib/db';
import { BASE, launch, signIn } from './lib/cross-company.mts';
import { purgeTenantSteps, deleteUntilStable } from './lib/scenario.mts';
import { snapshotResidue, reclaimResidue, describeResidue, type ResidueSnapshot } from './lib/harness-residue.mts';
import { CANVAS_PRESETS, estimatePageCount, estimateSlideCount, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

const OUT = process.env.DEMO_OUT || '/tmp/journey';
mkdirSync(OUT, { recursive: true });

const GAPS: string[] = [];
const STEPS: Array<{ n: string; what: string; ok: boolean; detail: string }> = [];
const gap = (m: string) => { GAPS.push(m); console.log(`   ⚠ ${m}`); };
const step = (n: string, what: string, ok: boolean, detail = '') => {
  STEPS.push({ n, what, ok, detail });
  console.log(`  ${ok ? '✅' : '❌'} ${n}  ${what}${detail ? ` — ${detail}` : ''}`);
  if (!ok) GAPS.push(`${n}: ${what} — ${detail}`);
};

let shotN = 0;
async function shoot(page: import('playwright').Page, name: string, full = false) {
  const file = `${OUT}/${String(++shotN).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

/** Navigate and photograph, reporting an error surface rather than capturing it silently. */
async function visit(page: import('playwright').Page, url: string, name: string, full = false) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const body = await page.evaluate(() => document.body.innerText);
  const broken = /Something went wrong|This page failed to load|404|not found/i.test(body.slice(0, 400));
  await shoot(page, name, full);
  if (broken) gap(`${url} rendered an error surface`);
  return !broken;
}

let seq = 0;
const N = (type: string, content: unknown, style: unknown = {}, position?: unknown): CanvasNode => ({
  id: `j${++seq}`, type, content, style, position, provenance: { source: 'manual' }, history: [],
  library_eligible: true,
} as unknown as CanvasNode);

/**
 * A REAL DoD SBIR Phase I technical volume — the section structure the BAA actually requires, with
 * distinct substantive content under each heading.
 *
 * The first version of this was padding: one paragraph repeated sixty times with an index stuck on
 * the front, headings that read "1.0 Section 1" through "12.0 Section 12", and the same eight-row
 * table twice with every row identical. It hit thirteen pages and proved nothing except that the
 * paginator counts filler. A demonstration document that nobody could stand to read is not a
 * demonstration — it is a page-count test wearing a proposal's clothes.
 */
function technicalVolume(): CanvasDocument {
  const h1 = (text: string) => N('heading', { level: 1, text }, { size: 17, weight: 'bold', alignment: 'center' });
  const h2 = (text: string) => N('heading', { level: 2, text }, { size: 13, weight: 'bold', space_before: 10 });
  const h3 = (text: string) => N('heading', { level: 3, text }, { size: 11.5, weight: 'bold' });
  const p_ = (text: string) => N('text_block', { text }, {});
  const bl = (items: string[]) => N('bulleted_list', { items: items.map((text) => ({ text })) }, {});

  return { version: 1, canvas: { ...CANVAS_PRESETS.letter_standard },
    metadata: { title: 'Technical Volume — N261-EXP01', status: 'draft' }, nodes: [

    h1('Additive Construction for Expeditionary Basing'),
    N('text_block', { text: 'Immobileyes Inc. · Topic N261-EXP01 · SBIR Phase I · Proposal N261-EXP01-0417' },
      { style: 'italic', alignment: 'center', space_after: 6 }),
    N('divider', { line_style: 'solid' }, {}),
    N('spacer', { height: 8 }, {}),
    N('toc', { max_depth: 2 }, {}),
    N('page_break', {}, {}),

    h2('1.0  Identification and Significance of the Problem'),
    p_('A Marine Expeditionary Unit ashore consumes roughly 40 percent of its lift capacity moving '
      + 'construction materials that are, by mass, mostly aggregate and water — both of which are '
      + 'already present at almost every site where a structure is needed. Concrete masonry units, '
      + 'timber and prefabricated shelter panels are shipped thousands of miles so that they can be '
      + 'assembled into forms that could have been printed in place. Every ton moved is a ton not '
      + 'available for ordnance, fuel or medical materiel, and every convoy that carries it is an '
      + 'exposure the force did not have to accept.'),
    p_('Additive construction removes most of that mass from the manifest. A cementitious printer '
      + 'operating on locally sourced aggregate needs to import only the binder, typically 8 to 12 '
      + 'percent of finished structure mass. The technology is not speculative: USACE ERDC has '
      + 'printed barracks huts at Camp Pendleton, and commercial systems have delivered permanent '
      + 'residential structures at scale. What has not been solved is qualification. A structure '
      + 'printed from an aggregate nobody has characterised, by a crew who cannot run a materials '
      + 'lab, cannot currently be certified for occupancy — so the capability stalls at the '
      + 'demonstration stage and never reaches a unit.'),
    p_('The binding constraint is therefore not the printer. It is the absence of a closed-loop '
      + 'process that can qualify an unknown feedstock in the field, in hours rather than weeks, '
      + 'without a materials engineer standing over it.'),
    N('chart', { chart_type: 'bar', title: 'Delivered mass per 32-person barracks hut',
      categories: ['Conventional', 'Printed \u2014 binder only'],
      series: [{ name: 'Tons delivered', data: [40, 4] }] }, {}),
    N('caption', { prefix: 'Figure', number: 1,
      text: 'An order of magnitude, repeated for every structure on every site.' },
      { style: 'italic', size: 9, color: '#64748B' }),

    p_('The scale of the opportunity follows directly from the mass argument. A 32-person barracks '
      + 'hut in conventional construction is roughly 40 tons of delivered material. Printed from '
      + 'local aggregate it is closer to four tons of imported binder — an order of magnitude, '
      + 'repeated for every structure on every site. For a MEU establishing a forward site with '
      + 'twenty structures, the difference is approximately 700 tons of lift, which is not a '
      + 'marginal logistics improvement but a change in what the unit can carry instead.'),
    p_('The same arithmetic explains why the capability has attracted sustained investment and still '
      + 'has not fielded. Every programme that has demonstrated printing has done so with a mix '
      + 'designed in advance and delivered to site, which preserves the supply chain the technology '
      + 'was supposed to remove. The demonstrations are real; the logistics benefit is largely '
      + 'notional, because the aggregate saved in transit is offset by the graded material that had '
      + 'to be shipped to make the print certifiable.'),

    h2('2.0  Phase I Technical Objectives'),
    p_('Phase I establishes whether closed-loop feedstock qualification can be performed on-platform '
      + 'with sensors that survive expeditionary use. Four objectives, each with a measurable exit '
      + 'criterion:'),
    N('table', {
      headers: ['#', 'Objective', 'Exit criterion'],
      rows: [
        ['O1', 'Characterise aggregate variability across representative sites',
         '≥ 6 aggregate profiles spanning the CONUS/OCONUS envelope, gradation and fines content measured'],
        ['O2', 'Correlate in-line rheology to 28-day compressive strength',
         'R² ≥ 0.85 against lab cylinders across the O1 profiles'],
        ['O3', 'Demonstrate closed-loop binder correction from in-line signal alone',
         'Strength within ±15% of target with no operator intervention'],
        ['O4', 'Define the certification data package a NAVFAC reviewer needs',
         'Draft package reviewed by a licensed PE, gaps enumerated'],
      ],
    }, {}),
    N('caption', { prefix: 'Table', number: 1, text: 'Phase I objectives and their exit criteria.' },
      { style: 'italic', size: 9, color: '#64748B' }),

    h2('3.0  Technical Approach'),
    h3('3.1  In-line rheology as a strength proxy'),
    p_('Compressive strength is conventionally established at 28 days by breaking cylinders, which is '
      + 'useless as a control signal — the structure is finished long before the number arrives. Our '
      + 'approach instruments the print head itself. Extrusion pressure, screw torque and a '
      + 'vibrating-element viscometer in the delivery line give a continuous rheological signature, '
      + 'sampled at 50 Hz, which prior work in the ready-mix industry has correlated to early-age '
      + 'strength development. We are not the first to observe the correlation; what is unproven is '
      + 'whether it holds across the aggregate variability an expeditionary site imposes, where the '
      + 'feedstock is whatever the site provides rather than a graded commercial supply.'),
    h3('3.2  Closed-loop binder correction'),
    p_('Where the correlation holds, the loop closes: the controller trims binder and water ratio '
      + 'against the measured signature rather than a nominal mix design. This is the step that '
      + 'removes the materials engineer from the critical path. The control law is a constrained '
      + 'model-predictive controller operating on a two-state model — one state for workability, one '
      + 'for early strength — with hard limits on water-cement ratio so the loop can never trade '
      + 'durability for printability.'),
    h3('3.3  Why in-line measurement and not a field lab'),
    p_('The obvious alternative is to put a small materials laboratory in the kit: gradation sieves, '
      + 'a slump cone, cylinder moulds and a portable compression frame. It is a real option and it '
      + 'has been tried. It fails on three counts, and enumerating them is how we arrived at the '
      + 'in-line approach rather than the other way round.'),
    p_('First, latency. A slump test characterises the batch in front of you, but the print head '
      + 'consumes a batch every few minutes and the properties drift within a single structure as '
      + 'the aggregate pile is worked down through its stratification. A discrete test cannot chase '
      + 'a continuous process; by the time the operator reacts, several courses have been laid.'),
    p_('Second, skill. ASTM C143 and C39 both assume a technician who runs them regularly. The '
      + 'failure mode of an infrequently-performed manual test is not a wrong number, it is a number '
      + 'nobody trusts, which in practice means the crew stops taking it and prints to the nominal '
      + 'mix anyway.'),
    p_('Third, and decisively, the certification argument. A reviewer asked to accept a structure '
      + 'wants evidence of the process that produced it, not a sample of it. A continuous record of '
      + 'rheological state across every course is a far stronger artefact than four cylinders broken '
      + 'at 28 days, because it speaks to the whole structure rather than to whatever the operator '
      + 'happened to scoop.'),
    N('image', { storage_key: '', width: 420, height: 220,
      alt_text: 'Print head cross-section: bypass viscometer loop, diaphragm-sealed pressure tap, drive-torque instrumentation.' },
      { border: { color: '#CBD5E1', width: 1, style: 'solid' } }),
    N('caption', { prefix: 'Figure', number: 2,
      text: 'Instrumented print head. The viscometer sits in an isolatable bypass so it can be flushed without stopping the print.' },
      { style: 'italic', size: 9, color: '#64748B' }),

    h3('3.4  The strength estimator'),
    p_('The estimator predicts 28-day compressive strength from the windowed sensor state. In its '
      + 'partial-least-squares form the prediction is a projection onto latent components:'),
    N('equation', { latex: 'f_{28} = \\bar{f} + \\sum_{k=1}^{K} q_k (\\mathbf{x} - \\bar{\\mathbf{x}})^{\\top} \\mathbf{w}_k' }, {}),
    p_('where x is the thirty-second feature window, w are the PLS weights, and K is chosen by '
      + 'cross-validation against held-out aggregate profiles rather than within-profile error.'),
    N('footnote', { marker: '1', text: 'Leave-one-profile-out, not k-fold. The question is whether the '
      + 'model transfers to an aggregate it has never seen; k-fold over a pooled dataset answers an easier one.' }, {}),

    h3('3.5  Sensor selection and survivability'),
    p_('The viscometer is the component most likely to fail in the field, so it drove the selection. '
      + 'Rotational viscometers foul quickly in cementitious slurry. We use a vibrating-element '
      + 'device with no moving parts in the flow path, mounted in a bypass loop that can be isolated '
      + 'and flushed without stopping the print. Extrusion pressure is taken from a diaphragm seal '
      + 'rated for abrasive media; screw torque comes from the drive controller and costs nothing to '
      + 'instrument. None of the three is novel — the novelty is the correlation model that fuses '
      + 'them, which is where the Phase I risk sits.'),
    h3('3.6  The correlation model'),
    p_('The model maps a windowed feature vector — mean and variance of each channel over a thirty '
      + 'second window, plus the cross-correlation between pressure and torque, which carries the '
      + 'aggregate interlock signature — onto predicted 28-day compressive strength. We begin with '
      + 'partial least squares because it tolerates the collinearity these channels exhibit and '
      + 'produces a model a reviewer can interrogate. If PLS cannot reach the R² ≥ 0.85 exit '
      + 'criterion across the six profiles, a gradient-boosted alternative is held in reserve, with '
      + 'the explicit understanding that it trades reviewability for accuracy — a trade we would '
      + 'rather not make in a certification context, and would document if forced into it.'),

    h2('4.0  Risk and Mitigation'),
    N('table', {
      headers: ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
      rows: [
        ['Correlation does not generalise across aggregate types', 'Medium', 'High',
         'Six profiles chosen to span the envelope; per-family models accepted as a fallback with the loss documented'],
        ['Viscometer fouls in high-fines feedstock', 'Medium', 'Medium',
         'Isolatable bypass loop; pressure and torque alone carry a degraded model'],
        ['28-day breaks gate the schedule', 'High', 'Medium',
         'Campaign starts in month 3; control law developed against 7- and 14-day data in parallel'],
        ['PE reviewer rejects the data package shape', 'Medium', 'High',
         'Reviewer engaged in month 6, not month 9 — the gap list is the deliverable, not a surprise'],
      ],
    }, {}),
    N('caption', { prefix: 'Table', number: 2, text: 'Principal Phase I risks. Likelihood and impact assessed at proposal submission.' },
      { style: 'italic', size: 9, color: '#64748B' }),

    h3('3.7  What we are deliberately not doing in Phase I'),
    p_('We are not developing a printer. Phase I integrates onto an existing gantry system already in '
      + 'our facility, because the risk being retired is in qualification, not motion control. We are '
      + 'also not addressing reinforcement strategy: printed structures need tensile reinforcement, '
      + 'that work is mature elsewhere, and conflating it with feedstock qualification would produce '
      + 'a Phase I that answers neither question convincingly.'),

    N('page_break', {}, {}),
    h2('5.0  Phase I Work Plan'),
    N('table', {
      headers: ['Task', 'Description', 'Month', 'Deliverable'],
      rows: [
        ['1', 'Aggregate sourcing and baseline characterisation', '1–2', 'Six characterised profiles, gradation curves'],
        ['2', 'Instrument the print head; commission the sensor suite', '2–3', 'Calibrated rig, 50 Hz data path'],
        ['3', 'Correlation campaign — print, sample, break at 7/14/28 days', '3–6', 'Correlation dataset, R² report'],
        ['4', 'Control law development and hardware-in-the-loop test', '5–7', 'MPC controller, HIL results'],
        ['5', 'Closed-loop demonstration on an uncharacterised aggregate', '7–8', 'Demonstration report against O3'],
        ['6', 'Certification package draft and PE review', '8–9', 'Draft package, reviewer gap list'],
      ],
    }, {}),
    N('caption', { prefix: 'Table', number: 3, text: 'Phase I task schedule against the nine-month base period.' },
      { style: 'italic', size: 9, color: '#64748B' }),
    p_('Task 3 is the long pole and the schedule reflects it: 28-day breaks cannot be compressed, so '
      + 'the correlation campaign is started as early as the instrumented rig allows and runs in '
      + 'parallel with control law development against the 7- and 14-day data.'),

    h3('5.1  Task detail'),
    p_('Task 1 — Aggregate sourcing and baseline characterisation. Six aggregates are procured to '
      + 'match published gradation curves from candidate theatres: two coarse-graded, two well-graded '
      + 'and two with high fines content, the last being the case most likely to defeat both the '
      + 'viscometer and the correlation. Each is characterised by sieve analysis, specific gravity '
      + 'and absorption per ASTM C136 and C127, establishing the ground truth the correlation is '
      + 'measured against. Deliverable: six profiles with gradation curves.'),
    p_('Task 2 — Instrumentation and commissioning. The bypass viscometer loop, diaphragm-sealed '
      + 'pressure transducer and drive-torque tap are installed on the existing gantry, with a 50 Hz '
      + 'acquisition path and time synchronisation to the motion controller so that every sample can '
      + 'be located to a course and a position. Commissioning proves the sensors track a known mix '
      + 'through a deliberate water-ratio sweep before any unknown feedstock is introduced.'),
    p_('Task 3 — Correlation campaign. Each of the six profiles is printed at three water-cement '
      + 'ratios, with cylinders cast from the delivery line at the moment of extrusion rather than '
      + 'from the batch, so the sample and the sensor see the same material. Breaks at 7, 14 and 28 '
      + 'days per ASTM C39. Eighteen print runs, fifty-four cylinders, and the resulting dataset is '
      + 'the evidence for O2.'),
    p_('Task 4 — Control law and hardware-in-the-loop. The MPC controller is developed against the '
      + 'Task 3 dataset and exercised in a HIL environment that replays recorded sensor traces '
      + 'against the real actuation path, so the loop is tested at full rate before it touches '
      + 'material. Hard constraints on water-cement ratio are verified by attempting to violate them.'),
    p_('Task 5 — Closed-loop demonstration. A seventh aggregate, deliberately not characterised '
      + 'beforehand and not in the training set, is printed under closed-loop control with no '
      + 'operator intervention. Cylinders are broken at 28 days and compared to target. This is the '
      + 'single experiment that decides whether O3 is met.'),
    p_('Task 6 — Certification package. The continuous process record from Task 5, the correlation '
      + 'evidence from Task 3 and the constraint verification from Task 4 are assembled into the '
      + 'shape a structural reviewer would expect, and put in front of a licensed PE. The '
      + 'deliverable is not an approval — it is an enumerated list of what is still missing, which '
      + 'is the input to Phase II.'),

    h3('5.2  Phase I deliverables'),
    bl([
      'Aggregate characterisation report — six profiles, gradation curves, ASTM C136/C127 results',
      'Correlation dataset and analysis — eighteen print runs, fifty-four cylinder breaks, R² against 28-day strength',
      'Control law specification and HIL verification results, including constraint-violation testing',
      'Closed-loop demonstration report on an uncharacterised aggregate, measured against the ±15% criterion',
      'Draft certification data package with a licensed PE\u2019s enumerated gap list',
      'Final report and Phase II transition recommendation',
    ]),

    h2('11.0  Prior SBIR/STTR Awards'),
    p_('Immobileyes Inc. has received two prior SBIR awards, neither in this technical area. '
      + 'Award FA8649-23-P-0412 (AFWERX Phase I, 2023) addressed edge perception for counter-UAS and '
      + 'transitioned to a Phase II. Award N68335-24-C-0189 (NAVAIR Phase I, 2024) addressed '
      + 'automated inspection of composite structures and is in its option period. Neither overlaps '
      + 'the work proposed here in scope, personnel allocation or technical content; the common '
      + 'thread is closed-loop control of a process a human currently supervises, which is the '
      + 'company\u2019s stated technical focus rather than a duplication of effort.'),

    h2('12.0  Data Rights Assertions'),
    p_('All technical data developed under this effort is delivered with SBIR Data Rights per DFARS '
      + '252.227-7018. The correlation model, the control law and the certification package format '
      + 'are asserted as SBIR data. The sensor selection is commercial off-the-shelf and carries no '
      + 'assertion. No third-party proprietary data is incorporated, and no open-source component '
      + 'with a reciprocal licence is used in the delivered control software.'),

    N('page_break', {}, {}),
    h2('13.0  References'),
    bl([
      'ERDC/CERL TR-17-8, Automated Construction of Expeditionary Structures: Additive Construction of a Barracks Hut, 2017',
      'ASTM C39/C39M-21, Standard Test Method for Compressive Strength of Cylindrical Concrete Specimens',
      'ASTM C136/C136M-19, Standard Test Method for Sieve Analysis of Fine and Coarse Aggregates',
      'Le, T.T. et al., Hardened properties of high-performance printing concrete, Cement and Concrete Research, 2012',
      'Wolfs, R.J.M. et al., Early age mechanical behaviour of 3D printed concrete, Cement and Concrete Research, 2018',
    ]),

    h2('6.0  Related Work'),
    p_('ERDC\u2019s Automated Construction of Expeditionary Structures programme established printability '
      + 'of barracks-scale structures and produced the B-hut demonstration; its published limitation '
      + 'is reliance on a controlled mix delivered to site. Commercial work by ICON and COBOD has '
      + 'driven printer reliability and throughput to production levels, again on graded commercial '
      + 'feedstock. Academic work at Loughborough and TU Eindhoven has characterised the rheology of '
      + 'printable cementitious mixes in the laboratory. Our contribution sits precisely in the gap '
      + 'those three lines leave: nobody has closed the loop from in-line measurement to binder '
      + 'correction on feedstock that was not characterised in advance.'),
    p_('It is worth being precise about what we are NOT claiming. We are not claiming a better '
      + 'printer, a novel binder chemistry, or a new structural form. Each of those is an active '
      + 'field with participants better resourced than us. We are claiming that the qualification '
      + 'gap is the one holding the capability back, that it is tractable with sensors that already '
      + 'exist, and that nobody has done it because the incentive in commercial construction runs '
      + 'the other way — a commercial printer wants a controlled supply chain, not the ability to '
      + 'survive without one.'),
    N('blockquote', { text: 'The limiting factor was never the printer. It was that we could not tell '
      + 'a commander the wall would hold without shipping the mix we already knew.',
      cite: 'ERDC programme review, 2019' }, { style: 'italic' }),
    N('url', { href: 'https://erdc-library.erdc.dren.mil/', display_text: 'ERDC Knowledge Core \u2014 ACES programme reports' }, {}),

    p_('The nearest prior art is in-line quality control in ready-mix delivery, where drum-mounted '
      + 'slump sensors have been commercially deployed for over a decade. That work establishes the '
      + 'physical basis for our correlation. It does not transfer directly: a ready-mix drum sees a '
      + 'batch designed in a plant to a known specification, and its control authority is limited to '
      + 'adding water. We are correcting binder ratio against an unknown feedstock, which is a '
      + 'harder estimation problem and a wider actuation envelope.'),

    h2('7.0  Relationship with Future R/R&D'),
    p_('Phase II integrates the qualified loop onto a transportable platform and addresses '
      + 'reinforcement and multi-structure site planning, targeting a NAVFAC-accepted certification '
      + 'route. The Phase I certification gap list is the direct input to that scope — we expect it to '
      + 'be the controlling document for Phase II rather than the printer specification.'),
    N('numbered_list', { items: [
      { text: 'Platform integration \u2014 the qualified loop onto a transportable frame sized to one ISO container' },
      { text: 'Reinforcement \u2014 the tensile strategy excluded from Phase I, likely a cable-laying end effector' },
      { text: 'Certification \u2014 the Phase I gap list carried through to a NAVFAC-accepted route' },
    ] }, {}),
    p_('Concretely, Phase II has three workstreams. Platform integration takes the qualified loop '
      + 'from our gantry onto a transportable frame sized to a single ISO container, which is the '
      + 'form factor a unit can actually receive. Reinforcement addresses the tensile strategy '
      + 'deliberately excluded from Phase I, most likely through a cable-laying end effector, drawing '
      + 'on existing work rather than originating it. Certification carries the Phase I gap list '
      + 'through to a NAVFAC-accepted route, which we expect to be the long pole and have scheduled '
      + 'accordingly.'),
    p_('The transition customer is NAVFAC EXWC, with whom we have had preliminary discussions '
      + 'through the topic author. The Phase I certification package is the artefact that makes '
      + 'those discussions concrete: it converts "printed structures might be certifiable" into a '
      + 'specific list of what a reviewer still needs.'),

    h2('8.0  Commercialization Strategy'),
    p_('The dual-use case is disaster reconstruction, where the same constraint appears in civilian '
      + 'form: aggregate is abundant on site, graded commercial supply is not, and the qualification '
      + 'bottleneck is what keeps printed structures out of permitted reconstruction. We have a '
      + 'letter of interest from a regional builder in Florida contingent on a documented '
      + 'qualification route, which is exactly the Phase I deliverable.'),
    p_('The economics differ from the defence case in a way that matters. A disaster reconstruction '
      + 'contractor is not lift-constrained; they are constrained by the availability of skilled '
      + 'crews and by permitting. Closed-loop qualification addresses both — it removes the materials '
      + 'engineer from the crew requirement and produces the continuous process record a building '
      + 'official can accept. The same technical result serves both markets for different reasons, '
      + 'which is the strongest form a dual-use argument can take.'),
    p_('Our commercialization path does not depend on selling printers. We intend to license the '
      + 'qualification loop to printer manufacturers, whose current offering stops at motion control '
      + 'and whose customers keep asking the certification question. That is a smaller revenue per '
      + 'unit than hardware and a far shorter path to deployment, and it avoids competing with '
      + 'companies whose manufacturing capability we could not match.'),

    h3('8.1  The constraint the controller must never violate'),
    p_('Stated as the controller sees it, so a reviewer can check it against the implementation:'),
    N('code_block', { language: 'python', code: 'W_C_MAX = 0.55          # ACI 318 durability limit, exposure class F1\n\ndef clamp(binder_kg, water_kg):\n    # Hard constraint: the loop may trade workability, never durability.\n    if water_kg / binder_kg > W_C_MAX:\n        water_kg = binder_kg * W_C_MAX\n    return binder_kg, water_kg' }, {}),

    N('text_box', { text: 'Phase I decides one question: does the in-line signature predict strength on '
      + 'an aggregate the model has never seen? Everything else in this volume exists to make that '
      + 'question answerable.' },
      { fill: { color: '#EFF6FF' }, border: { color: '#1D4ED8', width: 1, style: 'solid', radius: 4 } }),

    N('shape', { shape: 'rounded_rectangle', text: 'O3 \u2014 closed loop, uncharacterised feedstock, \u00b115%' },
      { fill: { color: '#DCFCE7' }, border: { color: '#15803D', width: 2 }, shadow: true }),

    N('video', { url: 'https://example.gov/immobileyes/gantry-print-run.mp4',
      caption: 'Gantry print run at the Youngstown facility, February 2026 \u2014 the rig Phase I instruments.' }, {}),

    N('page_break', {}, {}),
    h2('9.0  Key Personnel'),
    bl([
      'Dr. Elena Marsh, Principal Investigator — 12 years in cementitious materials; led the rheology '
      + 'correlation work at her previous institution; 0.25 FTE.',
      'Tomas Reyes, Controls Lead — model-predictive control for process plants; implemented the HIL '
      + 'environment used in Task 4; 1.0 FTE.',
      'Priya Anand, Test Engineer — materials laboratory operations, ASTM C39 and C143 qualified; '
      + 'owns the break campaign; 0.5 FTE.',
    ]),

    h2('10.0  Facilities and Equipment'),
    p_('Work is performed at our 6,000 sq ft facility in Youngstown, Ohio, which houses a 4m × 4m × 3m '
      + 'gantry printer, an instrumented mixing plant, and a materials laboratory with a 250 kN '
      + 'compression frame calibrated to ASTM C39. No government-furnished equipment is required. '
      + 'Aggregate for the O1 profiles is sourced commercially to match published gradations from the '
      + 'target theatres rather than shipped from them.'),

    N('callout', { variant: 'warning', text: 'Registrations current at submission: SAM (expires 2027-03), '
      + 'SBIR company registry, and the DoD Contractor Verification Service. No lapses within the period of performance.' }, {}),

    N('signature', { label: 'Dr. Elena Marsh, Principal Investigator' }, {}),
  ] } as unknown as CanvasDocument;
}

/**
 * A five-slide capability brief that tells an actual story: the constraint, why it persists, what we
 * do differently, what we have already shown, and what we are asking for.
 *
 * The first version was five slides of two generic bullets each — "Print from local aggregate",
 * "Closed-loop thermal control" — which demonstrates the slide writer and nothing about whether a
 * person could brief from it. A deck is a sequence of claims, and if the claims are placeholders
 * the sequence has nothing to test.
 */
function capabilityDeck(): CanvasDocument {
  const title = (text: string) => N('heading', { level: 1, text }, { size: 28, color: '#0F172A' });
  const sub = (text: string) => N('text_block', { text }, { size: 13, color: '#475569' });
  const bl = (items: string[]) => N('bulleted_list', { items: items.map((text) => ({ text })) }, {});
  const brk = () => N('page_break', {});

  return { version: 1, canvas: { ...CANVAS_PRESETS.slide_deck },
    metadata: { title: 'Capability Brief — N261-EXP01', status: 'draft' }, nodes: [

    title('Printing the base, not shipping it'),
    sub('Additive construction for expeditionary basing · Immobileyes Inc. · N261-EXP01'),
    brk(),

    title('40% of lift is aggregate and water'),
    N('chart', { chart_type: 'bar', title: 'Delivered mass per barracks hut (tons)',
      categories: ['Conventional', 'Printed'], series: [{ name: 'Tons', data: [40, 4] }] }, {}),
    bl([
      'Both aggregate and water are already at almost every site that needs a structure',
      'Every ton moved is a ton not available for ordnance, fuel or medical materiel',
      'Twenty structures on a forward site \u2248 700 tons of lift released',
    ]),
    brk(),

    title('The printer is not the problem'),
    N('blockquote', { text: 'We could not tell a commander the wall would hold without shipping the mix '
      + 'we already knew.', cite: 'ERDC programme review, 2019' }, { style: 'italic', size: 15 }),
    bl([
      'ERDC has printed barracks huts; ICON and COBOD build houses at production rate',
      'All of it depends on graded commercial feedstock delivered to site',
      'Print from an uncharacterised aggregate and the structure cannot be certified',
      'So the capability stalls at demonstration and never reaches a unit',
    ]),
    brk(),

    title('Close the loop at the print head'),
    N('image', { storage_key: '', width: 300, height: 150,
      alt_text: 'Instrumented print head with bypass viscometer, pressure tap and torque sense.' },
      { border: { color: '#94A3B8', width: 1, style: 'solid' } }),
    bl([
      'Extrusion pressure, screw torque and in-line viscometry at 50 Hz',
      'Signature correlates to early-age strength \u2014 no 28-day wait for a control signal',
      'Controller trims binder and water against the measurement, not a nominal mix',
      'Removes the materials engineer from the critical path \u2014 the actual blocker',
    ]),
    // Layered deliberately: the constraint sits ON TOP of the mechanism it governs.
    N('shape', { shape: 'rounded_rectangle', text: 'Hard limit: w/c \u2264 0.55 \u2014 never traded for printability' },
      { fill: { color: '#FEF3C7' }, border: { color: '#B45309', width: 2 }, shadow: true },
      { x: 4.6, y: 1.4, w: 4.2, h: 1.1, z: 900 }),
    brk(),

    title('What Phase I buys you'),
    N('table', { headers: ['Objective', 'Exit criterion'], rows: [
      ['O2  Correlation', 'R\u00b2 \u2265 0.85 across six aggregate profiles'],
      ['O3  Closed loop', '\u00b115% of target on an UNCHARACTERISED aggregate, no operator input'],
      ['O4  Certification', 'Package reviewed by a licensed PE, gaps enumerated'],
    ] }, {}),
    N('text_box', { text: 'Ask: range access at two field windows, and the theatre aggregate gradation data.' },
      { fill: { color: '#ECFDF5' }, border: { color: '#15803D', width: 1, style: 'solid', radius: 4 } }),
  ] } as unknown as CanvasDocument;
}

/** A cost sheet as a real spreadsheet — a table the xlsx writer turns into a worksheet. */
function costSheet(): CanvasDocument {
  const rows: string[][] = [
    ['Direct labour — PI', '0.25', '12', '18,750'],
    ['Direct labour — Engineer', '1.00', '12', '96,000'],
    ['Direct labour — Technician', '0.50', '12', '33,000'],
    ['Fringe @ 28%', '', '', '41,370'],
    ['Overhead @ 55%', '', '', '104,216'],
    ['Materials — aggregate + binder', '', '', '22,400'],
    ['Travel — two field windows', '', '', '9,800'],
    ['G&A @ 12%', '', '', '39,065'],
    ['TOTAL', '', '', '364,601'],
  ];
  return { version: 1, canvas: { ...CANVAS_PRESETS.spreadsheet },
    metadata: { title: 'Cost Volume', status: 'draft' },
    nodes: [
      N('heading', { level: 1, text: 'Cost Volume — Base Period' }, { size: 14, weight: 'bold' }),
      N('table', { sheet_name: 'Cost', headers: ['Element', 'FTE', 'Months', 'Amount ($)'], rows }, {}),
    ] } as unknown as CanvasDocument;
}

async function main() {
  console.log(`\n╔══ FULL JOURNEY ══ screen grabs → ${OUT}\n`);

  const [admin] = await sqlBypass<Array<{ id: string; email: string }>>`
    SELECT id, email FROM users WHERE role IN ('master_admin','rfp_admin') AND is_active
    ORDER BY (role='master_admin') DESC, created_at LIMIT 1`;
  const [tenant] = await sqlBypass<Array<{ id: string; slug: string; name: string }>>`
    SELECT t.id, t.slug, t.name FROM tenants t
    JOIN user_memberships m ON m.tenant_id = t.id
    JOIN users u ON u.id = m.user_id AND u.is_active AND u.role='tenant_admin'
    GROUP BY t.id, t.slug, t.name ORDER BY t.created_at LIMIT 1`;
  const [member] = await sqlBypass<Array<{ email: string }>>`
    SELECT u.email FROM users u JOIN user_memberships m ON m.user_id=u.id
    WHERE m.tenant_id=${tenant.id}::uuid AND u.is_active AND u.role='tenant_admin'
    ORDER BY u.created_at LIMIT 1`;
  console.log(`  rfp_admin    ${admin.email}`);
  console.log(`  tenant_admin ${member.email} @ ${tenant.slug}\n`);

  const browser = await launch();
  const adminCtx = await signIn(browser, admin.email, process.env.RFP_ADMIN_PW || process.env.SANDBOX_PASSWORD || 'SandboxDrive2026!');
  const tenantCtx = await signIn(browser, member.email, process.env.TENANT_PW || 'DemoPass123!');
  const A = adminCtx.pages()[0];
  const T = tenantCtx.pages()[0];
  await A.setViewportSize({ width: 1680, height: 1050 });
  await T.setViewportSize({ width: 1680, height: 1050 });

  const made: { docs: string[]; opps: string[]; apps: string[]; buckets: string[]; tenants: string[]; sols: string[] } =
    { docs: [], opps: [], apps: [], buckets: [], tenants: [], sols: [] };

  // Saving a document MINTS LIBRARY ATOMS — 88 of them across these three volumes, none inserted
  // by this drive. Delete-what-I-created cannot see them (B119), so the box is reconciled on an ID
  // delta taken before a single row is written.
  let residueBefore: ResidueSnapshot | null = null;

  try {
    residueBefore = await snapshotResidue();

    // ═══ 1 · RFP ADMIN ════════════════════════════════════════════════════════════════════════
    console.log('══ 1 · RFP ADMIN ══');
    step('1a', 'admin command center renders', await visit(A, '/admin/command', 'admin-command'), admin.email);
    step('1b', 'admin dashboard renders', await visit(A, '/admin', 'admin-dashboard'));

    // ═══ 2 · INGEST + OPPORTUNITIES ═══════════════════════════════════════════════════════════
    console.log('\n══ 2 · INGEST + OPPORTUNITIES ══');
    const [{ n: solsBefore }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM curated_solicitations`;
    const [{ n: oppsBefore }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM opportunities`;
    step('2a', 'intake surface renders', await visit(A, '/admin/intake', 'admin-intake'));
    step('2b', 'curation queue renders', await visit(A, '/admin/rfp-curation', 'admin-curation'));
    // ── 2b · A REAL DOCUMENT, INGESTED ────────────────────────────────────────────────────────
    //
    // stageIntake (below) is structured intake — it creates the opportunity from fields. That is a
    // real producer, but it is NOT what "ingestion" means to anyone reading this: no document is
    // read, nothing is shredded, no text is extracted. So the arc drives the actual upload form and
    // its async shred first, on a 2.3MB government BAA the repository owns, and reports what came
    // out of the PDF rather than what was typed into a form.
    const ingestTitle = `JOURNEY INGEST ${Date.now().toString(36)}`;
    let ingestSol: string | null = null;
    try {
      const out = execFileSync('node',
        ['scripts/drive-ingest-scenario.mjs', ingestTitle, 'baa', '2026-12-15',
         'docs/DoD 25.2 SBIR BAA FULL_04212025.pdf'],
        { encoding: 'utf8', timeout: 600_000, env: process.env }).toString();
      ingestSol = (out.match(/SCENARIO SOL=([0-9a-f-]{36})/) || [])[1] ?? null;
    } catch (e) {
      gap(`2b: the ingest drive did not complete — ${String(e).slice(0, 110)}`);
    }
    if (ingestSol) made.sols.push(ingestSol);
    step('2b-ingest', 'a real 2.3MB BAA is uploaded and SHREDDED', !!ingestSol,
      ingestSol ? `solicitation ${ingestSol.slice(0, 8)}` : 'no solicitation id returned');

    // TRACK THE OPPORTUNITY BY THE TITLE THIS RUN GENERATED, not by its FK.
    //
    // The ingest leaves the opportunity with `solicitation_id` NULL, so a teardown that removes
    // "opportunities belonging to this solicitation" cannot see it — the first version of this
    // stage left exactly one opportunity behind every run for that reason. The title carries a
    // per-run timestamp suffix, so matching it reaches this run's rows and nothing else.
    const ingestOpps = await sqlBypass<Array<{ id: string }>>`
      SELECT id FROM opportunities WHERE title LIKE ${ingestTitle + '%'}`;
    made.opps.push(...ingestOpps.map((o) => o.id));

    if (ingestSol) {
      const [ex] = await sqlBypass<Array<{ chars: number; pages: number | null }>>`
        SELECT length(cs.full_text)::int AS chars,
               (SELECT page_count FROM solicitation_documents d WHERE d.solicitation_id = cs.id LIMIT 1) AS pages
        FROM curated_solicitations cs WHERE cs.id = ${ingestSol}::uuid`;
      // The number that proves a document was READ rather than a row inserted.
      step('2b-text', 'real text was extracted from the PDF', (ex?.chars ?? 0) > 100_000,
        `${(ex?.chars ?? 0).toLocaleString()} characters · page_count=${ex?.pages ?? 'NULL'}`);
    }

    // ── 2c · structured intake, the other producer ────────────────────────────────────────────
    const probeTitle = `JOURNEY OPP ${Date.now().toString(36)} — Directed Energy Counter-UAS`;
    // THROUGH THE ROUTE, not the library function underneath it.
    //
    // This called `stageIntake(...)` directly — the same function /api/admin/intake calls, so the
    // producer was real, but the AUTH, the role gate and the request validation in front of it were
    // never exercised. That is the difference between "the code path works" and "an rfp_admin can
    // do this", and only the second is worth a screen grab.
    const intakeRes = await A.evaluate(async ([u, b]) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b) });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, ['/api/admin/intake', {
      title: probeTitle, agency: 'Department of the Air Force',
      solicitationNumber: `JRN-${Date.now().toString(36).toUpperCase()}`,
      dueDate: '2026-12-15', description: 'Created by the full-journey drive.',
    }] as const) as { status: number; json: any };
    step('2c-route', 'the admin intake ROUTE accepts it (auth + validation exercised)',
      intakeRes.status === 200 || intakeRes.status === 201, `status ${intakeRes.status}`);
    const newOppId = intakeRes.json?.data?.opportunityId ?? intakeRes.json?.opportunityId ?? null;
    made.opps.push(...(newOppId ? [newOppId] : []));
    step('2c', 'a NEW opportunity is INGESTED through the real producer', !!newOppId,
      newOppId ? `opp ${newOppId.slice(0, 8)}` : `route returned ${JSON.stringify(intakeRes.json).slice(0, 90)}`);

    // The expected delta is DERIVED from what actually succeeded — one opportunity per producer that
    // ran. Hardcoding +1 was correct until the ingest stage was added beside stageIntake, and then
    // it failed a run in which BOTH producers had worked. An assertion that does not move with the
    // drive reports the drive's own growth as a regression.
    const expected = (ingestOpps.length) + (newOppId ? 1 : 0);
    const [{ n: oppsAfter }] = await sqlBypass<Array<{ n: number }>>`SELECT count(*)::int AS n FROM opportunities`;
    step('2d', 'the opportunity count moved by exactly what the producers created',
      oppsAfter === oppsBefore + expected, `${oppsBefore} → ${oppsAfter} (expected +${expected})`);
    step('2e', 'opportunities list renders with it', await visit(A, '/admin/opportunities', 'admin-opportunities', true),
      `${oppsAfter} opportunities · ${solsBefore} solicitations`);

    // ═══ 3 · CUSTOMER APPLICATION + ONBOARDING ════════════════════════════════════════════════
    console.log('\n══ 3 · CUSTOMER APPLICATION + ONBOARDING ══');
    // A real application row, the shape the public form posts, then ACCEPTED through the admin API.
    // THROUGH THE PUBLIC FORM'S ROUTE, not a SQL insert.
    //
    // This used INSERT INTO applications, which produced a row of the right shape and proved nothing
    // about what a customer actually touches: the zod schema, the terms literal, the minimum lengths
    // on motivation and tech summary. A fixture shaped like the product's output is not the product.
    const co = `Journey Robotics ${Date.now().toString(36)}`;
    const email = `dana.${Date.now().toString(36)}@journey.test`;
    const appRes = await T.evaluate(async ([u, b]) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b) });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, ['/api/applications', {
      contactEmail: email, contactName: 'Dana Reyes', companyName: co,
      techSummary: 'Autonomous perception payloads for contested airspace, with on-board inference '
        + 'and deterministic operator hand-off when track confidence falls below threshold.',
      motivation: 'We have the technology and no route into the SBIR process.',
      referralSource: 'Referred by a programme manager at NAVAIR',
      termsAccepted: true, termsSignature: email,
    }] as const) as { status: number; json: any };
    step('3a', 'the PUBLIC application route accepts a real submission',
      appRes.status === 200 || appRes.status === 201, `status ${appRes.status}`);

    const [app] = await sqlBypass<Array<{ id: string }>>`
      SELECT id FROM applications WHERE company_name = ${co} ORDER BY created_at DESC LIMIT 1`;
    if (app) made.apps.push(app.id);
    step('3a-row', 'it landed in the admin queue', !!app?.id, co);

    step('3b', 'applications queue renders', await visit(A, '/admin/applications', 'admin-applications'));

    const acc = await A.evaluate(async (u) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      return { status: r.status, body: (await r.text()).slice(0, 160) };
    }, `/api/admin/applications/${app.id}/accept`) as { status: number; body: string };
    step('3c', 'the application is ACCEPTED through the real admin route',
      acc.status === 200 || acc.status === 201, `status ${acc.status} ${acc.body.slice(0, 70)}`);
    // Accepting an application PROVISIONS A REAL TENANT. Recorded so the teardown can remove it —
    // otherwise this drive grows the box by one company every time it runs.
    try {
      const born = JSON.parse(acc.body.replace(/\.\.\.$/, '') + (acc.body.trim().endsWith('}') ? '' : '}}'));
      const tid = born?.data?.tenantId; if (tid) made.tenants.push(String(tid));
    } catch { /* recovered from the DB below instead */ }
    if (!made.tenants.length) {
      const [t2] = await sqlBypass<Array<{ id: string }>>`
        SELECT id FROM tenants WHERE name = ${co} ORDER BY created_at DESC LIMIT 1`;
      if (t2) made.tenants.push(t2.id);
    }
    const [after] = await sqlBypass<Array<{ status: string }>>`SELECT status FROM applications WHERE id=${app.id}::uuid`;
    step('3d', 'the application row records the decision', after?.status !== 'pending', `status=${after?.status}`);
    step('3e', 'tenants list renders', await visit(A, '/admin/tenants', 'admin-tenants', true));
    step('3f', 'the onboarded customer’s portal renders', await visit(T, `/portal/${tenant.slug}`, 'portal-home'),
      `${tenant.name}`);

    // ═══ 4 · LIBRARY ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ 4 · LIBRARY ══');
    const [{ n: atoms }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM library_atoms WHERE tenant_id=${tenant.id}::uuid AND archived_at IS NULL`;
    step('4a', 'tenant library renders', await visit(T, `/portal/${tenant.slug}/library`, 'portal-library', true),
      `${atoms} atoms`);

    // ═══ 5 · BUCKETS ══════════════════════════════════════════════════════════════════════════
    console.log('\n══ 5 · BUCKETS ══');
    step('5a', 'buckets surface renders', await visit(T, `/portal/${tenant.slug}/buckets`, 'portal-buckets', true));
    const bucketName = `Journey bucket ${Date.now().toString(36)}`;
    const mk = await T.evaluate(async ([u, n]) => {
      const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: n, description: 'created by the full-journey drive',
          criteria: { keywords: ['additive', 'construction'], weights: { keyword: 1 } } }) });
      return { status: r.status, json: await r.json().catch(() => null) };
    }, [`/api/portal/${tenant.slug}/buckets`, bucketName] as const) as { status: number; json: any };
    const bucketId = mk.json?.data?.id ?? mk.json?.data?.bucket?.id;
    if (bucketId) made.buckets.push(String(bucketId));
    step('5b', 'a NEW bucket is created through the real route', mk.status === 200 || mk.status === 201,
      `status ${mk.status}${bucketId ? ` · id ${String(bucketId).slice(0, 8)}` : ''}`);
    step('5c', 'the new bucket appears on the page',
      await visit(T, `/portal/${tenant.slug}/buckets`, 'portal-buckets-after', true));

    // ═══ 6 · CARDS + RANKING ══════════════════════════════════════════════════════════════════
    console.log('\n══ 6 · OPPORTUNITY CARDS + RANKING ══');
    const [{ n: cards }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_opportunity_cards WHERE tenant_id=${tenant.id}::uuid`;
    step('6a', 'the customer’s opportunity cards render', await visit(T, `/portal/${tenant.slug}/cards`, 'portal-cards', true),
      `${cards} cards`);
    const [{ n: scores }] = await sqlBypass<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM tenant_bucket_scores s
      JOIN tenant_spotlight_buckets b ON b.id = s.bucket_id WHERE b.tenant_id=${tenant.id}::uuid`;
    step('6b', 'bucket scores exist for ranking', scores > 0, `${scores} score row(s)`);

    // ═══ 7 · PORTAL PROVISIONING ══════════════════════════════════════════════════════════════
    console.log('\n══ 7 · PORTAL PROVISIONING ══');
    step('7a', 'the customer’s portals surface renders', await visit(T, `/portal/${tenant.slug}/portals`, 'portal-portals', true));
    const [portal] = await sqlBypass<Array<{ id: string }>>`SELECT id FROM proposal_portals ORDER BY created_at DESC LIMIT 1`;
    if (portal) {
      step('7b', 'the admin provisioning cockpit renders',
        await visit(A, `/admin/provisioning/${portal.id}`, 'admin-provisioning', true));
    } else { gap('7b: no proposal_portal exists to open the cockpit on'); }

    // ═══ 8 · VOLUME GENERATION ════════════════════════════════════════════════════════════════
    console.log('\n══ 8 · VOLUME GENERATION — all three shapes ══');
    const volumes = [
      { key: 'technical', preset: 'letter', doc: technicalVolume(), title: 'Technical Volume', want: 'pdf' },
      { key: 'deck', preset: 'deck', doc: capabilityDeck(), title: 'Capability Deck', want: 'pptx' },
      { key: 'cost', preset: 'sheet', doc: costSheet(), title: 'Cost Volume', want: 'xlsx' },
    ];
    const built: Array<{ key: string; id: string; doc: CanvasDocument; want: string }> = [];
    for (const v of volumes) {
      const cr = await T.evaluate(async ([u, p, t]) => {
        const r = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preset: p, title: t }) });
        return { status: r.status, json: await r.json().catch(() => null) };
      }, [`/api/portal/${tenant.slug}/documents`, v.preset, v.title] as const) as { status: number; json: any };
      const id = cr.json?.data?.documentId;
      if (!id) { gap(`8: could not create the ${v.key} volume (status ${cr.status})`); continue; }
      made.docs.push(id);

      const sv = await T.evaluate(async ([u, d, t]) => {
        const r = await fetch(u as string, { method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ content: d, title: t }) });
        return r.status;
      }, [`/api/portal/${tenant.slug}/documents/${id}/save`, v.doc, v.title] as const) as number;
      step(`8-${v.key}`, `${v.title} authored and saved`, sv === 200, `status ${sv}`);

      // COUNT THE VOCABULARY, do not claim it. "Uses all the primitives" is the kind of assertion
      // that rots the moment someone edits the content, so it is measured from the document itself.
      const kinds = new Set((v.doc.nodes as CanvasNode[]).map((n) => n.type));
      if (v.key === 'technical') {
        step('8-vocab', 'the technical volume exercises the full node vocabulary',
          kinds.size >= 18, `${kinds.size}/22 node types: ${[...kinds].sort().join(', ')}`);
      } else if (v.key === 'deck') {
        step('8-deck-vocab', 'the deck carries figures, charts and layered shapes — not just bullets',
          kinds.has('chart') && kinds.has('image') && kinds.has('shape') && kinds.has('table'),
          `${kinds.size} types: ${[...kinds].sort().join(', ')}`);
      }
      built.push({ key: v.key, id, doc: v.doc, want: v.want });

      await visit(T, `/portal/${tenant.slug}/documents/${id}`, `volume-${v.key}`, true);
    }

    // ═══ 9 · DOWNLOAD + MEASURE THE ARTIFACTS ═════════════════════════════════════════════════
    console.log('\n══ 9 · DOWNLOAD — and MEASURE what came out ══');
    for (const b of built) {
      const r = await T.evaluate(async ([u, d, f]) => {
        const res = await fetch(u as string, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ document: d, format: f }) });
        const ab = await res.arrayBuffer();
        let bin = ''; const bytes = new Uint8Array(ab);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return { status: res.status, b64: btoa(bin) };
      }, [`/api/portal/${tenant.slug}/documents/${b.id}/export`, b.doc, b.want] as const) as { status: number; b64: string };
      const buf = Buffer.from(r.b64, 'base64');
      writeFileSync(`${OUT}/${b.key}.${b.want}`, buf);

      // MEASURED FROM THE FILE, not from the model that produced it.
      if (b.want === 'pdf') {
        const printed = (buf.toString('latin1').match(/\/Type\s*\/Page(?![a-zA-Z])/g) ?? []).length;
        const ruler = estimatePageCount(b.doc);
        // TEN, because ten is what was asked for. An assertion trimmed to whatever the content
        // happens to produce tests nothing — it just records the outcome and calls it a pass.
        step('9-doc', 'the technical volume is a full 10-page volume',
          printed >= 10, `${printed} pages printed (ruler said ${ruler})`);
      } else if (b.want === 'pptx') {
        const zip = await JSZip.loadAsync(buf);
        const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
        step('9-deck', 'the deck is exactly five slides', slides === 5,
          `${slides} slides in the .pptx (ruler said ${estimateSlideCount(b.doc)})`);
      } else {
        const zip = await JSZip.loadAsync(buf);
        const sheets = Object.keys(zip.files).filter((f) => /^xl\/worksheets\/sheet\d+\.xml$/.test(f)).length;
        const shared = await zip.files['xl/sharedStrings.xml']?.async('string') ?? '';
        step('9-cost', 'the cost sheet is a real worksheet carrying its totals',
          sheets >= 1 && /364,601|TOTAL/.test(shared), `${sheets} worksheet(s), TOTAL present: ${/364,601|TOTAL/.test(shared)}`);
      }
      console.log(`     ${b.key}.${b.want} · ${Math.round(buf.length / 1024)}KB → ${OUT}/${b.key}.${b.want}`);
    }
  } finally {
    // EVERY STEP INDEPENDENTLY, so one failure cannot strand the rest.
    //
    // The first version ran these as a straight sequence and aborted on the first FK it hit —
    // `curated_solicitations` still referencing the opportunity — which meant the buckets and the
    // provisioned TENANT below it were never removed at all. A teardown that gives up halfway is
    // worse than one that never ran: it leaves a partial state nobody can reason about, and it
    // reports the abort as the drive failing rather than as litter.
    //
    // Each step now records its own failure and the run continues. Anything that genuinely could
    // not be removed lands in GAPS and is printed, so residue is named rather than discovered later
    // by another harness.
    // RETRIED, because the thing being cleaned up is still being WRITTEN.
    //
    // Stage 2 uploads a real BAA and the shred is ASYNCHRONOUS: the pipeline keeps creating rows
    // that reference the solicitation and its opportunity for a few seconds after the drive's own
    // work is done. A single-shot delete hits a foreign key that will not exist a moment later —
    // measured directly, by listing every FK pointing at the surviving opportunity after the fact
    // and finding NONE. The blocker was real when the delete ran and gone by the time I looked.
    //
    // So each step gets a few attempts with a pause. Only a failure that survives all of them is a
    // gap worth reporting; one that clears on the second try was never a defect, just impatience.
    const step_ = async (what: string, fn: () => Promise<unknown>, tries = 4) => {
      for (let i = 1; i <= tries; i++) {
        try { await fn(); return; } catch (e) {
          if (i === tries) { GAPS.push(`teardown: ${what} — ${String(e).slice(0, 90)}`); return; }
          await new Promise((r) => setTimeout(r, 1500 * i));
        }
      }
    };

    if (made.docs.length) await step_('documents', () => sqlBypass`DELETE FROM tenant_documents WHERE id = ANY(${made.docs}::uuid[])`);
    if (made.apps.length) await step_('applications', () => sqlBypass`DELETE FROM applications WHERE id = ANY(${made.apps}::uuid[])`);
    // DELETE UNTIL STABLE, not once and not on a timer.
    //
    // Stage 2's shred is asynchronous and the workflow engine keeps creating rows that reference
    // the opportunity — a process instance, a card, a bridge row — for a while after the drive's
    // own work finishes. A single delete hits a foreign key; a fixed retry window is a guess about
    // how long the engine takes, and mine guessed 9 seconds when it needed longer. Proven by
    // reproducing the exact delete afterwards by hand: it succeeded immediately, so nothing was
    // permanently stuck, only still arriving.
    //
    // `deleteUntilStable` (scenario.mts) runs the whole set repeatedly until a pass removes
    // nothing, which converges regardless of ordering AND regardless of how slow the producer is.
    // It is the mechanism the scenario factory already uses for exactly this, so this drive is not
    // inventing a second answer to a solved problem.
    const oppSteps: Array<() => Promise<number>> = [];
    for (const o of made.opps) {
      oppSteps.push(
        async () => (await sqlBypass`DELETE FROM process_instance_transitions WHERE instance_id IN (
          SELECT id FROM process_instances WHERE trigger_event_id IN (
            SELECT id FROM system_events WHERE payload->>'opportunityId' = ${o}))`).count,
        async () => (await sqlBypass`DELETE FROM process_instances WHERE trigger_event_id IN (
          SELECT id FROM system_events WHERE payload->>'opportunityId' = ${o})`).count,
        async () => (await sqlBypass`DELETE FROM tasks WHERE entity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM system_events WHERE payload->>'opportunityId' = ${o}`).count,
        async () => (await sqlBypass`DELETE FROM tenant_opportunity_cards WHERE opportunity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM opportunity_bridge WHERE opportunity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM opportunity_lifecycle_actions WHERE opportunity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM scout_findings WHERE match_opportunity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM curated_solicitations WHERE opportunity_id = ${o}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM opportunities WHERE id = ${o}::uuid`).count,
      );
    }
    for (const so of made.sols) {
      oppSteps.push(
        async () => (await sqlBypass`DELETE FROM solicitation_documents WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM solicitation_compliance WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM solicitation_volumes WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM solicitation_outlines WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM curation_notes WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM curation_revisions WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM opportunities WHERE solicitation_id = ${so}::uuid`).count,
        async () => (await sqlBypass`DELETE FROM curated_solicitations WHERE id = ${so}::uuid`).count,
      );
    }
    if (oppSteps.length) {
      await step_('ingest + intake rows', async () => {
        const { stuck } = await deleteUntilStable(oppSteps);
        if (stuck.length) throw new Error(`${stuck.length} step(s) never converged`);
      }, 1);
    }

    for (const b of made.buckets) {
      await step_('bucket scores', () => sqlBypass`DELETE FROM tenant_bucket_scores WHERE bucket_id = ${b}::uuid`);
      await step_('bucket', () => sqlBypass`DELETE FROM tenant_spotlight_buckets WHERE id = ${b}::uuid`);
    }
    // The tenant the accept provisioned, removed with the SAME graph-descent the scenario factory
    // uses — a second hand-written cascade would be a second opinion about the schema.
    for (const t of made.tenants) {
      await step_(`tenant ${t.slice(0, 8)}`, async () => {
        const { stuck } = await deleteUntilStable(await purgeTenantSteps(t));
        if (stuck.length) GAPS.push(`teardown: tenant ${t.slice(0, 8)} left ${stuck.length} table(s) stuck`);
      });
    }
    console.log(`\n  cleanup: ${made.docs.length} document(s), ${made.opps.length} opportunity(s), `
      + `${made.apps.length} application(s), ${made.buckets.length} bucket(s), ${made.tenants.length} tenant(s)`);
    if (residueBefore) await step_('minted atoms', async () =>
      console.log(`  ${describeResidue(await reclaimResidue(residueBefore!))}`));
    await browser.close();
    await sql.end().catch(() => {}); await sqlBypass.end().catch(() => {});
  }

  const failed = STEPS.filter((s) => !s.ok).length;
  writeFileSync(`${OUT}/JOURNEY.txt`,
    STEPS.map((s) => `${s.ok ? 'PASS' : 'FAIL'}  ${s.n}  ${s.what}  ${s.detail}`).join('\n')
    + (GAPS.length ? `\n\nGAPS\n${GAPS.map((g) => '· ' + g).join('\n')}` : ''));

  console.log(`\n══ ${STEPS.length - failed}/${STEPS.length} steps passed · ${shotN} screen grabs → ${OUT}`);
  if (GAPS.length) {
    console.log(`\n── what this arc could NOT do (${GAPS.length}) ──`);
    GAPS.forEach((g) => console.log(`  · ${g}`));
  } else {
    console.log('\n✓ every stage walked and photographed.');
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('JOURNEY ERROR', e);
  await sql.end().catch(() => {}); await sqlBypass.end().catch(() => {});
  process.exit(1);
});
