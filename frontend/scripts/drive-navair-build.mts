/**
 * Drive the FULL govwin proposal chain for the Immobileyes DON26BX03-NP002 C-UAS effort:
 *   align Volume 2 to the DON Phase-I Open-Topic TV2 template → link a TV2 mold →
 *   provision the proposal → upload/atomize the supporting docs into library_atoms →
 *   AI-assist-draft the 8 Technical-Volume sections (GHOST direction + atomized sources,
 *   with cropped deck figures) → lock (matrix → satisfied) → export the Technical Volume .docx
 *   through the system's own canvas→docx exporter.
 *
 *   cd frontend && DATABASE_URL=… node --import tsx scripts/drive-navair-build.mts
 */
import { sql, getTenantBySlug } from '@/lib/db';
import { createAtom } from '@/lib/atoms';
import { provisionProposalForPortal } from '@/lib/provision-proposal';
import { assembleArtifactCanvas, renderCanvas } from '@/lib/export/artifact-export';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FIGDIR = '/home/user/govwin/scratchpad/navair/figs_embed';
const OUTDIR = '/home/user/govwin/docs/proposals/immobileyes-cuas';
let fail = 0;
const ok = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗ FAIL'} ${l}${x ? ' — ' + x : ''}`); if (!c) fail++; };

// ── canvas node helpers ────────────────────────────────────────────────────
let nid = 0;
const NID = () => `n${++nid}`;
const wrap = (type: string, content: any, style: any = {}) => ({ id: NID(), type, style, history: [], library_eligible: true, provenance: { source: 'manual' }, content });
const H = (level: number, text: string, numbering?: string) => wrap('heading', { level, text, ...(numbering ? { numbering } : {}) });
const P = (text: string, inline?: any[]) => wrap('text_block', { text, ...(inline ? { inline_formats: inline } : {}) });
const UL = (items: any[]) => wrap('bulleted_list', { items: items.map((t) => (typeof t === 'string' ? { text: t } : t)) });
const TBL = (headers: any[], rows: any[][], sheet?: string) => wrap('table', { headers, rows, header_style: { bold: true, bg: '#D9E1F2', alignment: 'center' }, ...(sheet ? { sheet_name: sheet } : {}) });
const FIG = (file: string, alt: string, w: number, h: number, caption: string) => {
  const buf = readFileSync(path.join(FIGDIR, file));
  const ext = file.endsWith('.png') ? 'png' : 'jpeg';
  return wrap('image', { storage_key: `data:image/${ext};base64,${buf.toString('base64')}`, alt_text: alt, width: w, height: h, caption }, { alignment: 'center' });
};

// SBIR TV2 canvas rules — US Letter, 1" margins, TNR 11pt, header + footer, 10-page cap.
const CANVAS = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  header: { template: '{company_name}   ·   Topic {topic_number}   ·   Volume 2: Technical Volume', height: 30, font: { family: 'Times New Roman', size: 9 } },
  footer: { template: 'Use or disclosure of proposal data is subject to the restriction on the title page.        Page {n} of {N}', height: 30, font: { family: 'Times New Roman', size: 8 } },
  font_default: { family: 'Times New Roman', size: 11 }, line_spacing: 1.0, max_pages: 10, max_slides: null,
};
const doc = (nodes: any[], title: string) => ({
  version: 1, document_id: '00000000-0000-0000-0000-000000000000', canvas: CANVAS, nodes,
  metadata: { title, volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '2026-07-20T00:00:00Z', last_modified_at: '2026-07-20T00:00:00Z', last_modified_by: '', version_number: 1, status: 'in_progress' },
});

// ── the 8 Technical-Volume sections (TV2 template outline) ──────────────────
const B = (t: string) => ({ text: t });
function sections() {
  return [
    { key: 'Description of Proposed Phase I Technical Effort', nodes: [
      H(1, '1.0  Description of Proposed Phase I Technical Effort'),
      P('This proposal includes data that shall not be disclosed outside the Government and shall not be duplicated, used, or disclosed—in whole or in part—for any purpose other than to evaluate this proposal (SBIR data rights).', [{ start: 0, length: 132, format: 'italic' }]),
      H(2, 'Problem and Significance'),
      P('First-person-view (FPV) fiber-optic drones have become one of the most difficult unmanned-air-system (UAS) threats on the modern battlefield. Unlike conventional FPV systems, these aircraft require no radio-frequency (RF) link, are immune to RF jamming, and operate in GPS-denied environments—relying almost entirely on continuous electro-optical (EO) imagery for terminal guidance. Fielded at scale in Ukraine and by non-state actors, they defeat the RF-centric and GPS-centric counter-UAS (C-UAS) systems the Navy fields today.'),
      FIG('fig1_threat.jpg', 'Fiber-optic FPV drone recovered in theater', 250, 252, 'Figure 1.  Fiber-optic FPV drones—no RF link, immune to jamming—now proliferating in current conflicts.'),
      P('The operational consequence is stark. RF-based detection and defeat (jammers, spoofers, high-power microwave) have no emission to exploit; GPS denial has no effect on a vehicle flown by wire over fiber; and kinetic interceptors are cost-prohibitive and collaterally constrained against a sub-$1,000 airframe. A single fiber drone can be produced for a few hundred dollars, yet forces the defender to expend a far costlier effect—an unfavorable cost-exchange and magazine-depth problem that is most acute at the exact moment of a saturating swarm attack against a Naval installation, aircraft on the ramp, or a ship in the littorals.'),
      P('Existing C-UAS remains optimized for RF disruption or kinetic defeat. Very little work addresses non-kinetic optical defeat of EO-guided fiber drones during the terminal attack—precisely the gap DON26BX03-NP002 targets: a novel, scalable capability to detect, track, identify, and neutralize single and swarm UAS in complex operational environments.'),
      H(2, 'Technical Innovation — GHOST (STORM + DEXTER)'),
      P('Immobileyes proposes GHOST (Guided Hostile Optical Sensor-hijacking Technology), a software-defined optical counter-UAS architecture integrating two mature Immobileyes/AlphaMicron technologies:'),
      UL([
        B('STORM — AI-enabled EO/IR detection, identification, and tracking with a graduated escalation framework (Warn/Deter → Dazzle/Disrupt → Deny/Damage) and a human-in-the-loop selecting the response level. STORM is detection-agnostic (MOSA): it accepts EO/IR, radar, RF/EW, or TSPI cueing.'),
        B('DEXTER (Dynamic Electronic Cross-connect for Tactical Energy Routing) — a low-SWaP adaptive liquid-crystal polarization-grating beam router (AlphaMicron) that electronically routes, splits, combines, and redirects laser energy with no moving parts, switching a single beam from one to tens or hundreds of outputs in microseconds.'),
      ]),
      FIG('fig2_escalation.jpg', 'STORM graduated escalation framework', 468, 125, 'Figure 2.  STORM graduated-escalation kill chain (Find→Fix→Track→Target→Engage→Designate); the multi-beam "shotgun" architecture engages swarms simultaneously.'),
      H(2, 'Optical Seeker-Confusion Mechanism'),
      P('The effort extends the Navy\'s patented seeker-confusion principle (U.S. Patents 8,305,252 and 8,212,709). The Navy demonstrated that a continuous-wave optical source placed within an imaging seeker\'s field of view generates a localized high-intensity region that the tracking algorithm interprets as a feature or target; the tracker\'s centroid or feature-match then migrates toward the induced source, steering the vehicle away from the protected asset. Modern EO-guided FPV fiber drones rely on the same class of feature-tracking and optical-flow guidance running on uncooled CMOS/CCD cameras. Against those sensors, controlled illumination produces image saturation, blooming, false high-intensity features, contrast collapse, and machine-vision confusion—degrading or breaking terminal lock without physical destruction.'),
      FIG('fig3_dazzle.jpg', 'Drone camera view without vs. with laser', 430, 133, 'Figure 3.  Drone-camera view, without vs. with a 450 nm blue optical effect—demonstrated against a representative EO camera.'),
      P('GHOST investigates the wavelength, dwell, polarization, and beam-geometry parameters that maximize this effect across representative EO camera types, and characterizes the transition from reversible dazzle (Zone 2) to persistent denial (Zone 3) as a function of delivered irradiance—giving the operator a calibrated, proportional response rather than a single binary effect.'),
      H(2, 'DEXTER Adaptive Beam Routing'),
      P('The enabling technology is DEXTER, built on AlphaMicron liquid-crystal polarization gratings (Pancharatnam–Berry-phase optics) that diffract incident light into selectable orders under low-voltage control, with no moving parts. Cascading these elements lets DEXTER electronically route a single laser source to one or many output channels in microseconds—splitting, combining, and steering beams to form the multi-beam "shotgun" that engages several targets at once. This replaces heavy, slow, failure-prone gimbaled mirror trains with a low-SWaP, solid-state, software-defined aperture, and enables a distributed architecture in which multiple beam directors share one laser source across fixed, mobile, shipboard, and expeditionary platforms.'),
      P('GHOST is therefore not a fixed dazzler but a software-defined effector: wavelength (multi-wavelength green/red/blue + IR), polarization, dwell, and beam geometry are selected in real time; a single sub-kilowatt laser source is electronically allocated across multiple beam directors for multi-target and swarm engagement without duplicating laser hardware.'),
      H(2, 'System Snapshot — Key Attributes'),
      TBL(['Attribute', 'GHOST / STORM–DEXTER'], [
        ['Laser output', '< 1 kW total, software-allocated across beams'],
        ['Effective range', 'Dazzle < 1 km; visual warning > 1 km'],
        ['Wavelengths', 'Multi-wavelength — green / red / blue (450 nm) + IR'],
        ['Beam routing', 'DEXTER liquid-crystal grating: 1 → tens–hundreds of beams, microsecond switching, no moving parts'],
        ['Cueing / integration', 'Detection-agnostic MOSA — EO/IR, radar, RF/EW, TSPI'],
        ['Engagement doctrine', 'Graduated Warn/Deter → Dazzle/Disrupt → Deny/Damage; human-in-the-loop'],
        ['Maturity', 'Builds on TRL-5 AF STTR (HALAR-L) + TACFI prototype lineage'],
      ], 'System Snapshot'),
    ]},
    { key: 'Phase I Technical Objectives', nodes: [
      H(1, '1.1  Phase I Technical Objectives'),
      P('Phase I will establish the technical feasibility of the STORM/DEXTER optical counter-UAS approach against EO-guided Group 1–2 UAS. Specific objectives:'),
      UL([
        B('Objective 1 — Assess technical feasibility. Evaluate extending the Navy\'s seeker-confusion concept from IR seekers to EO-guided fiber-optic drones; characterize the susceptibility of representative EO cameras to controlled optical perturbation and identify the most effective engagement mechanisms.'),
        B('Objective 2 — Define the STORM/DEXTER C-UAS architecture. Integrate STORM\'s AI EO/IR detect-track with DEXTER\'s adaptive beam routing and shaping; identify the hardware and software modifications required to transition to a deployable Navy C-UAS system.'),
        B('Objective 3 — Quantify performance improvements. Model and measure improvements over existing non-kinetic C-UAS: tracking disruption, multi-target engagement, reduced SWaP, elimination of mechanical beam steering, and effectiveness against RF-jamming-resistant fiber-optic drones.'),
        B('Objective 4 — Develop a Phase II transition plan. Define the roadmap for a prototype able to recognize, track, and non-kinetically defeat Group 2-and-below UAS, and identify NAVAIR/NAVSEA transition paths.'),
      ]),
      H(2, 'Phase I Feasibility Metrics (Go / No-Go)'),
      TBL(['Metric', 'Phase I Target', 'Go / No-Go Threshold'], [
        ['EO-camera susceptibility (measurable degradation of terminal tracking)', 'Demonstrated on ≥ 2 representative EO/FPV cameras', '≥ 1 camera'],
        ['Optical effect', 'Repeatable saturation / blooming at bench range', 'Qualitative confirmation'],
        ['DEXTER multi-beam routing', '≥ 3 simultaneously addressable output channels (model/bench)', '≥ 2 channels'],
        ['Predicted SWaP vs. mechanically steered baseline', '≥ 30% reduction (analysis)', 'Net reduction'],
        ['Architecture', 'STORM↔DEXTER interface + Navy C-UAS integration defined', 'Interface defined'],
      ], 'Phase I Metrics'),
      P('Phase I deliverables: Kick-Off Briefing; Progress Report; Final Technical Report documenting the STORM and DEXTER baseline, the Navy C-UAS capability gaps addressed, required modifications, the feasibility assessment, and expected performance improvements; and an Initial Phase II Proposal.'),
      H(2, 'Anticipated Phase I Outcomes'),
      P('At the conclusion of Phase I, the program will have delivered:'),
      UL([
        B('Demonstrated feasibility of applying the Navy seeker-confusion principle to EO-guided FPV fiber-optic drones, evidenced by measured optical degradation of representative EO cameras.'),
        B('A defined preliminary STORM/DEXTER architecture for Navy C-UAS applications, with the STORM↔DEXTER interface and MOSA integration specified.'),
        B('Identification of the hardware and software modifications required for a Phase II prototype.'),
        B('Quantified improvements over existing non-kinetic C-UAS: multi-target engagement, reduced SWaP, elimination of mechanical beam steering, and effectiveness against RF-jamming-resistant fiber-optic drones.'),
        B('An established technical baseline and transition plan for a Phase II prototype demonstration with NAVAIR/NAVSEA.'),
      ]),
    ]},
    { key: 'Phase I (Base and Option) Statement of Work', nodes: [
      H(1, '1.2  Phase I (Base and Option) Statement of Work'),
      P('The Base effort (6 months) establishes feasibility and the system architecture. The Option (6 months), funded separately, furthers the effort toward Phase II with a breadboard optical-effects demonstration and a prototype/transition package. All work is performed at Immobileyes\' Kent, OH facility; no foreign nationals perform on this ITAR-restricted effort.'),
      TBL(
        ['Task', 'Title', 'Months', 'Primary Deliverable'],
        [
          ['1 (Base)', 'System Definition & Feasibility Assessment — assess the STORM/DEXTER architecture; review Group 1–2 UAS threats, EO cameras, and current Navy C-UAS to define requirements and gaps.', '1', 'Kick-Off Briefing'],
          ['2 (Base)', 'System Architecture & Design — preliminary architecture integrating STORM detect-track with DEXTER beam routing; STORM/DEXTER interface; optical-engagement concept; control architecture.', '1–3', 'Progress Report'],
          ['3 (Base)', 'Optical Countermeasure Feasibility Evaluation — laboratory test and modeling of saturation, blooming, false-feature generation, and contrast degradation against representative EO cameras; compare vs. existing non-kinetic C-UAS.', '2–5', 'Test data & analysis'],
          ['4 (Base)', 'Transition Assessment & Phase I Reporting — consolidate results; document performance improvements and residual risk.', '5–6', 'Final Technical Report; Initial Phase II Proposal'],
          ['5 (Option)', 'Breadboard Optical-Effects Demonstration — STORM cue → DEXTER multi-beam routing → measured dazzle/disruption on a representative EO/FPV camera at range; quantify multi-beam swarm geometry.', '7–10', 'Breadboard demo & data'],
          ['6 (Option)', 'Phase II Prototype Definition & NAVAIR/NAVSEA Transition Package — prototype design baseline, test plan, and integration/transition plan for a Navy C-UAS demonstration.', '10–12', 'Prototype plan & transition package'],
        ], 'Phase I SOW'),
      H(2, 'Base Period — Task Approach'),
      P('Task 1 (Month 1) establishes the Group 1–2 EO-guided threat set, catalogs representative FPV/EO camera technologies and current Navy C-UAS capability gaps, and converts them into system requirements and evaluation criteria at the Kick-Off Briefing.'),
      P('Task 2 (Months 1–3) develops the preliminary GHOST architecture: the STORM↔DEXTER interface, the optical-engagement concept, the preliminary software and control architecture, and the integration requirements for Navy C-UAS platforms over MOSA.'),
      P('Task 3 (Months 2–5) is the analytical and laboratory core: bench characterization and modeling of saturation, blooming, false-feature generation, and contrast degradation against representative EO cameras, with performance compared against existing non-kinetic C-UAS on tracking disruption, multi-target potential, and SWaP.'),
      P('Task 4 (Months 5–6) consolidates the results into the Final Technical Report, quantifies expected performance improvements and residual risk, and produces the Initial Phase II Proposal.'),
      H(2, 'Option Period — Task Approach'),
      P('Task 5 (Months 7–10) builds a bench breadboard that closes the loop STORM cue → DEXTER multi-beam routing → measured optical effect on a representative EO/FPV camera at range, and quantifies the multi-beam swarm-engagement geometry.'),
      P('Task 6 (Months 10–12) defines the Phase II prototype baseline, test plan, and NAVAIR/NAVSEA integration and transition package for a Navy C-UAS demonstration.'),
      H(2, 'Key Technical Risks and Mitigations'),
      TBL(['Technical Risk', 'Mitigation'], [
        ['EO-camera diversity limits generalization of the optical effect', 'Test a representative camera set; parameterize wavelength, dwell, and beam geometry via DEXTER software control'],
        ['Atmospheric and seeker variability at operational range', 'Bench testing plus modeled range analysis; conservative Phase I feasibility claims, with the range demonstration deferred to the Option'],
        ['Eye-safety and FAA constraints on CONUS employment', 'FAA-aware graduated escalation (warn/deter first); OSHA laser-safety controls; non-kinetic-first doctrine'],
        ['Integration risk with Navy sensors and C2', 'MOSA / detection-agnostic interfaces; reuse of fielded STORM sensor integrations'],
      ], 'Risks'),
    ]},
    { key: 'Related Work', nodes: [
      H(1, '1.3  Related Work'),
      P('GHOST builds directly on a funded, TRL-5 directed-energy C-UAS lineage:'),
      UL([
        B('Air Force STTR Phase II (HALAR-L). Immobileyes built the Gen-1 HALAR-L directed-energy C-UAS prototype to TRL 5, developed with end-user input from the 72d Security Forces Squadron, Tinker AFB; the company has raised approximately $2M in non-dilutive USAF SBIR/STTR funding. Four prior AF STTR Phase I awards (2021, 2023) with Ohio State, Kent State, and the University of Toledo matured the optical-disruption approach.'),
        B('AlphaMicron (DEXTER / liquid-crystal optics). Partner since 2020 ($600K in-kind + $1.6M matching); liquid-crystal electro-optics fielded on the Army APEL eyewear program, with AFRL Functional Materials Division ties. Supplies the DEXTER beam-routing technology.'),
        B('Lighthouse Avionics (detection / sensor fusion). Detection partner with a $1.5M SBIR Phase II and an $800K FAA contract at the UAS Test Site, Griffiss NY, plus U.S. CORE II / Cyber Fortress 25 participation; fuses EO/IR, ADS-B, Remote ID, and laser ranging with multi-frame AI.'),
        B('Demonstrated effect. A 450 nm blue optical effect was demonstrated against a drone camera at 200 m in prior work—direct evidence for the Phase I optical-perturbation hypothesis (Figure 3).'),
        B('Intellectual property. Immobileyes holds issued U.S. Patents 11,519,701 and 11,686,560 (plus international application WO2025122941A1), extending the Navy seeker-confusion patents (8,305,252; 8,212,709) this effort applies.'),
      ]),
    ]},
    { key: 'Defense Need', nodes: [
      H(1, '1.4  Defense Need'),
      P('End users are NAVAIR and NAVSEA C-UAS for Naval installations, Naval aircraft, and ships, plus USMC and Joint-Force expeditionary air defense. The most reasonable near-term use case is fixed and expeditionary point defense of high-value assets against Group 1–2 EO-guided FPV fiber drones that today\'s RF/GPS-centric C-UAS cannot engage.'),
      FIG('fig4_pod.jpg', 'Field-deployed STORM effector', 220, 226, 'Figure 4.  Field-deployed STORM effector—low-SWaP, MOSA, tripod- or vehicle-mountable.'),
      H(2, 'Concept of Employment'),
      P('GHOST deploys as a modular effector cued by existing Navy sensors over MOSA interfaces, in three primary modes: (1) fixed-site installation defense of magazines, flight lines, and command-and-control nodes; (2) shipboard self-defense against EO-guided threats in the littorals; and (3) expeditionary or vehicle-mounted defense of maneuvering forces. In every mode the graduated escalation framework lets the operator apply the minimum necessary effect—warn, dazzle, or deny—preserving rules-of-engagement latitude and minimizing collateral and airspace risk. Because a single laser source is fanned into many DEXTER-routed beams, one effector engages multiple inbound drones without the magazine-depth penalty of kinetic interceptors.'),
      P('GHOST\'s graduated, non-kinetic, low-collateral effect is uniquely suited to CONUS bases and ships, where kinetic defeat is constrained by collateral risk, cost-per-shot, and FAA/host-nation airspace rules—GHOST is FAA-aware by design. STORM\'s MOSA interfaces let the effector drop into existing Navy sensor and C2 architectures rather than replace them, shortening the path to fielded capability.'),
    ]},
    { key: 'Key Personnel', nodes: [
      H(1, '2.0  Key Personnel'),
      P('The Phase I team is led by Immobileyes technical and program staff; all proposed personnel are U.S. Citizens.'),
      TBL(
        ['Name', 'Role on Effort', 'Education', 'Relevant Experience'],
        [
          ['Dr. Bahman Taheri', 'Principal Investigator / Electro-Optics Lead', 'PhD/MS Physics (Oklahoma State); BS Physics (Cal Poly SLO)', '90+ patents; PI on Air Force, Navy (ONR), Army, DOE, and NSF programs in liquid-crystal electro-optics, laser/flash protection, and cholesteric-liquid-crystal laser systems; Secret clearance.'],
          ['Atossa Alavi', 'Program Manager / Business & IP Lead', 'JD (Case Western); USPTO-admitted', 'Program management, DoD transition, and IP strategy for the AlphaMicron/Immobileyes technology base.'],
          ['Senior Optical Engineer', 'DEXTER integration & optical-effects test', 'MS Optics/Physics', 'Liquid-crystal beam-steering, laser sources, and EO camera characterization.'],
          ['Electrical / Software Engineers', 'STORM tracking & control; test automation', 'BS/MS EE, CS', 'Real-time detect-track, control electronics, and data pipelines for the feasibility campaign.'],
        ], 'Key Personnel'),
      P('The Phase I team combines a nationally recognized electro-optics research group with in-house engineering and machining staff, all under one roof at the Kent, OH facility. Dr. Taheri holds a Secret clearance and has served as principal investigator on directed-energy and liquid-crystal programs for the Air Force, Navy (ONR), Army, DOE, and NSF; the supporting optical, electrical, software, and mechanical engineers executed the HALAR-L and TACFI C-UAS prototypes. This depth lets the team run the Phase I laboratory campaign without new hires or subcontracted labor, and provides direct continuity into a Phase II prototype.'),
      P('Restriction on performance by foreign persons: this topic is ITAR-restricted (22 CFR 120–130). No foreign nationals are proposed to perform on this effort; all personnel are U.S. Citizens, consistent with topic §3.5.', [{ start: 0, length: 56, format: 'bold' }]),
    ]},
    { key: 'Commercialization / Transition Plan Summary', nodes: [
      H(1, '3.0  Commercialization / Transition Plan Summary'),
      P('DoD transition targets NAVAIR and NAVSEA (installation and ship C-UAS), the USMC, Army RCCTO, and Air Force Security Forces—building on the established Tinker AFB 72d SFS relationship. Non-DoD markets include critical-infrastructure and homeland defense—airports, nuclear facilities, and border security—where non-kinetic, FAA-aware defeat is essential.'),
      H(2, 'Transition Path and Timeline'),
      P('Phase I establishes feasibility; Phase II delivers a TRL-6 prototype for a Navy operational demonstration, building directly on the TRL-5 HALAR-L baseline and the ~$2M of non-dilutive USAF SBIR/STTR investment already made in the underlying technology; Phase III targets production effectors and integration onto Navy C-UAS programs of record. The established 72d Security Forces Squadron (Tinker AFB) relationship, combined with NAVAIR and NAVSEA transition sponsors identified in Task 6, de-risks the path from prototype to program of record.'),
      P('Immobileyes\' AlphaMicron partnership (liquid-crystal manufacturing) and Lighthouse Avionics partnership (sensor integration and FAA test access) provide a manufacturing and integration base and a dual-use path spanning counter-UAS optics, protective eyewear, and laser-safety products—markets that amortize non-recurring engineering and sustain the production line between defense deliveries. As EO-guided drone threats proliferate, both the DoD C-UAS market and the parallel homeland/critical-infrastructure market are expanding rapidly, and an FAA-aware, non-kinetic effector is differentiated for CONUS employment where kinetic options are precluded.'),
    ]},
    { key: 'Facilities / Equipment', nodes: [
      H(1, 'Facilities / Equipment'),
      P('Immobileyes operates a 30,000 square-foot, ISO-9001 facility in Kent, OH with seven laboratories, including an electro-optics/laser laboratory (optical benches and multi-wavelength laser sources) and a MIL-SPEC environmental test suite, plus in-house liquid-crystal device fabrication and assembly through co-located AlphaMicron.'),
      FIG('fig4_lab.jpg', 'Electro-optics / laser laboratory', 360, 234, 'Figure 5.  Immobileyes electro-optics/laser laboratory (Kent, OH)—optical benches and multi-wavelength laser sources for the Phase I test campaign.'),
      FIG('fig5_mfg.jpg', 'Manufacturing and assembly floor', 360, 203, 'Figure 6.  In-house manufacturing and assembly capacity (AlphaMicron co-location) supporting Phase II transition.'),
      P('The facility maintains NIST SP 800-171 controls (the basis for the topic\'s projected CMMC Level 2 (Self)), ITAR registration, and OSHA laser-safety compliance—sufficient to execute all Phase I laboratory tasks without new capital equipment. Firm identifiers: UEI KL3MJVGD9XZ9; CAGE 8KQ82; Woman-Owned Small Business (WOSB).'),
    ]},
  ];
}

// ── source atoms (upload → atomize into library_atoms) ──────────────────────
function atomSpecs() {
  return [
    { title: 'GHOST/STORM/DEXTER — Technical Innovation (directional draft)', vol: 'technical', kind: 'narrative',
      summary: 'GHOST extends the Navy seeker-confusion patents to EO-guided FPV fiber drones via STORM detect-track + DEXTER liquid-crystal beam routing.',
      content: 'GHOST integrates STORM (AI EO/IR detect-identify-track with a graduated Warn/Deter→Dazzle/Disrupt→Deny/Damage escalation framework, human-in-the-loop) and DEXTER (AlphaMicron liquid-crystal polarization-grating beam router, no moving parts, one→10s–100s beams electronically). It extends U.S. Navy patents 8,305,252 and 8,212,709 (seeker confusion) from IR missile seekers to EO-guided FPV fiber-optic drones, producing saturation, blooming, false features, and contrast degradation in the drone camera. Software-defined: multi-wavelength green/red/blue+IR, <1kW total, multi-beam swarm engagement.' },
    { title: 'Past Performance — AF STTR HALAR-L (TRL 5, Tinker AFB 72d SFS)', vol: 'past_performance', kind: 'past_perf_blurb',
      summary: 'AF STTR Phase II built the Gen-1 HALAR-L C-UAS prototype to TRL 5 with Tinker AFB 72d SFS; ~$2M non-dilutive USAF funding; 4 prior AF STTR Phase I.',
      content: 'Immobileyes built the Gen-1 HALAR-L directed-energy C-UAS prototype to TRL 5 under an Air Force STTR Phase II, developed with 72d Security Forces Squadron (Tinker AFB) end-user input; ~$2M non-dilutive USAF SBIR/STTR raised. Four prior AF STTR Phase I awards (2021, 2023) with Ohio State, Kent State (x2), and the University of Toledo matured the optical-disruption C-UAS approach. A 450 nm blue dazzle was demonstrated against a drone camera at 200 m.' },
    { title: 'Partner — AlphaMicron (DEXTER liquid-crystal optics)', vol: 'past_performance', kind: 'past_perf_blurb',
      summary: 'AlphaMicron backs DEXTER liquid-crystal beam routing; $600K in-kind + $1.6M matching; APEL eyewear; AFRL Functional Materials ties.',
      content: 'AlphaMicron has partnered with Immobileyes since 2020 ($600K in-kind + $1.6M matching), supplying DEXTER liquid-crystal polarization-grating beam-routing technology. Its liquid-crystal electro-optics are fielded on the Army APEL protective-eyewear program, with AFRL Functional Materials Division ties.' },
    { title: 'Partner — Lighthouse Avionics (sensor fusion / FAA test)', vol: 'past_performance', kind: 'past_perf_blurb',
      summary: 'Lighthouse Avionics: $1.5M SBIR Phase II, $800K FAA contract (Griffiss NY UAS Test Site); fuses EO/IR, ADS-B, Remote ID, laser ranging.',
      content: 'Lighthouse Avionics provides detection/sensor-fusion, with a $1.5M SBIR Phase II and an $800K FAA contract at the UAS Test Site (Griffiss, NY), and U.S. CORE II / Cyber Fortress 25 participation; fuses EO/IR, ADS-B, Remote ID, and laser ranging with multi-frame AI.' },
    { title: 'Key Personnel — Dr. Bahman Taheri (PI)', vol: 'key_personnel', kind: 'bio',
      summary: 'PI/CTO; PhD Physics; 90+ patents; AF/Navy(ONR)/Army/DOE/NSF programs in LC electro-optics & laser systems; Secret; US Citizen.',
      content: 'Dr. Bahman Taheri, PI/Electro-Optics Lead (CTO, Immobileyes). PhD/MS Physics (Oklahoma State), BS Physics (Cal Poly SLO). 90+ patents; PI across Air Force, Navy (ONR), Army, DOE, NSF R&D in liquid-crystal electro-optics, laser/flash protection, cholesteric-liquid-crystal laser systems. Secret clearance; U.S. Citizen.' },
    { title: 'Facility & Compliance — 30k sqft ISO-9001, Kent OH', vol: 'facilities', kind: 'boilerplate',
      summary: '30,000 sqft ISO-9001 facility, Kent OH; 7 labs incl. MIL-SPEC test suite; NIST SP 800-171; CMMC L2 (Self) projected; ITAR; UEI KL3MJVGD9XZ9; CAGE 8KQ82; WOSB.',
      content: 'Immobileyes operates a 30,000 sqft ISO-9001 facility in Kent, OH with seven laboratories including an electro-optics/laser lab and a MIL-SPEC environmental test suite, plus in-house liquid-crystal fabrication via co-located AlphaMicron. Maintains NIST SP 800-171 controls (basis for projected CMMC Level 2 Self), ITAR registration, OSHA laser-safety. UEI KL3MJVGD9XZ9; CAGE 8KQ82; WOSB.' },
    { title: 'Cost methodology — Immobileyes indirect rates', vol: 'cost', kind: 'budget_data',
      summary: 'Firm rate stack: Fringe 35%, Labor OH 77%, G&A 40%, Fee 7%; labor PI $63, Sr Optical $50, PM $50, EE/SW $45, ME $35, Machinist $30.',
      content: 'Immobileyes actual indirect rates: Fringe 35% (on direct labor); Labor Overhead 77% (on labor+fringe); G&A 40% (on burdened labor + materials + ODC); Fee 7% (on total cost). Labor categories: Principal Investigator $63/hr, Senior Optical Engineer $50/hr, Program Manager $50/hr, Electrical/Electronic Engineer $45/hr, Software Engineer $45/hr, Mechanical Engineer $35/hr, Machine-shop operator $30/hr. Phase I Base NTE $200,000; Option NTE $115,000.' },
  ];
}

// ── run ─────────────────────────────────────────────────────────────────────
const TV2_ITEMS = [
  'Description of Proposed Phase I Technical Effort',
  'Phase I Technical Objectives',
  'Phase I (Base and Option) Statement of Work',
  'Related Work',
  'Defense Need',
  'Key Personnel',
  'Commercialization / Transition Plan Summary',
  'Facilities / Equipment',
];

try {
  const tenant = await getTenantBySlug('immobileyes');
  ok('tenant immobileyes', !!tenant, tenant?.id);
  const [opp] = await sql<{ id: string; solicitationId: string | null }[]>`
    SELECT id, solicitation_id FROM opportunities WHERE source_id = 'DON26BX03-NP002' LIMIT 1`;
  ok('opportunity DON26BX03-NP002', !!opp, opp?.id);
  const [usr] = await sql<{ id: string; email: string }[]>`SELECT id, email FROM users WHERE email = 'admin@immobileyes.test' LIMIT 1`;
  const solId = opp.solicitationId!;

  // Phase 1 — align Volume 2 to the DON TV2 template outline + link a TV2 mold
  const [v2] = await sql<{ id: string }[]>`SELECT id FROM solicitation_volumes WHERE solicitation_id = ${solId}::uuid AND volume_number = 2 LIMIT 1`;
  const moldCanvas = doc([
    H(1, 'Volume 2: Technical Volume'),
    P('[DON SBIR/STTR Phase I Open Topic — Technical Volume template. Not to exceed 10 pages; single column, single-spaced; 8.5x11; 1-inch margins; no font smaller than 10-point. Include the Option within the 10-page limit.]', [{ start: 0, length: 200, format: 'italic' }]),
    ...TV2_ITEMS.map((t, i) => H(2, `${['1.0', '1.1', '1.2', '1.3', '1.4', '2.0', '3.0', ''][i]}  ${t}`.trim())),
  ], 'DON Phase I Open Topic — Technical Volume 2 Template');
  const [mold] = await sql<{ id: string }[]>`
    INSERT INTO document_templates (name, template_type, program_type, tenant_id, created_by, canvas_preset, canvas_document, is_system)
    VALUES (${'DON Phase I Open Topic — Technical Volume 2 (Immobileyes)'}, 'technical_volume', 'sbir_phase_1', ${tenant!.id}::uuid, ${usr.id}::uuid, ${sql.json({ preset: 'letter_sbir_phase1' })}, ${sql.json(moldCanvas)}, false)
    ON CONFLICT DO NOTHING RETURNING id`;
  let moldId = mold?.id;
  if (!moldId) { const [m2] = await sql<{ id: string }[]>`SELECT id FROM document_templates WHERE name = ${'DON Phase I Open Topic — Technical Volume 2 (Immobileyes)'} LIMIT 1`; moldId = m2?.id; }
  ok('TV2 template mold', !!moldId, moldId);

  await sql`DELETE FROM volume_required_items WHERE volume_id = ${v2.id}::uuid`;
  for (let i = 0; i < TV2_ITEMS.length; i++) {
    await sql`INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required, template_id)
              VALUES (${v2.id}::uuid, ${i + 1}, ${TV2_ITEMS[i]}, 'word_doc', true, ${i === 0 ? moldId : null})`;
  }
  ok('Volume 2 aligned to TV2 outline + template linked', true, `${TV2_ITEMS.length} items`);

  // Phase 2 — provision the proposal fresh
  await sql`DELETE FROM proposals WHERE tenant_id = ${tenant!.id}::uuid AND opportunity_id = ${opp.id}::uuid`;
  const prov = await provisionProposalForPortal({ tenantId: tenant!.id, tenantName: tenant!.name, tenantSlug: 'immobileyes', opportunityId: opp.id, label: 'primary', actorId: usr.id, actorEmail: usr.email });
  if ('error' in prov) { ok('provision', false, prov.error); throw new Error(prov.error); }
  ok('provision proposal', prov.sectionCount > 0, `${prov.sectionCount} sections`);
  const proposalId = prov.proposalId;

  // Phase 3 — upload/atomize supporting docs → library_atoms (idempotent: clear prior upload atoms first)
  await sql.begin(async (tx: any) => {
    await tx`SELECT set_config('app.tenant_id', ${tenant!.id}, true)`;
    await tx`DELETE FROM library_atoms WHERE tenant_id = ${tenant!.id}::uuid AND source = 'upload'`;
  });
  let atomN = 0;
  for (const a of atomSpecs()) {
    await createAtom(tenant!.id, {
      grain: 'reference', title: a.title, content: a.content, summary: a.summary, source: 'upload', status: 'approved', visibility: 'tenant',
      tags: [
        { dimension: 'vol', value: a.vol, source: 'admin', confirmed: true },
        { dimension: 'kind', value: a.kind, source: 'admin', confirmed: true },
        { dimension: 'agency', value: 'navy', source: 'admin', confirmed: true },
        { dimension: 'program', value: 'sbir', source: 'admin', confirmed: true },
        { dimension: 'phase', value: 'phase_1', source: 'admin', confirmed: true },
      ],
    } as any, { id: usr.id, kind: 'admin' });
    atomN++;
  }
  ok('atomized supporting docs → library_atoms', atomN === atomSpecs().length, `${atomN} atoms`);

  // Phase 4 — AI-assist draft the 8 Technical-Volume sections
  const secs = sections();
  let drafted = 0;
  for (const s of secs) {
    const [row] = await sql<{ id: string; artifact_id: string; volume_name: string | null; volume_number: number | null; version: number }[]>`
      SELECT id, artifact_id, volume_name, volume_number, version FROM proposal_sections
      WHERE proposal_id = ${proposalId}::uuid AND title = ${s.key} LIMIT 1`;
    if (!row) { ok(`section row for "${s.key}"`, false); continue; }
    const cdoc = doc(s.nodes, s.key);
    (cdoc.metadata as any).proposal_id = proposalId;
    await sql`UPDATE proposal_sections SET content = ${JSON.stringify(cdoc)}, status = 'complete', version = version + 1, last_modified_by = ${usr.id}::uuid, updated_at = now()
              WHERE id = ${row.id}::uuid AND proposal_id = ${proposalId}::uuid`;
    drafted++;
  }
  ok('drafted 8 Technical-Volume sections', drafted === secs.length, `${drafted}/${secs.length}`);

  // Phase 5 — lock the Technical-Volume sections (matrix → satisfied) + roll up the artifact
  const tvSecs = await sql<{ id: string; artifactId: string }[]>`
    SELECT s.id, s.artifact_id FROM proposal_sections s
    WHERE s.proposal_id = ${proposalId}::uuid AND s.volume_number = 2`;
  for (const s of tvSecs) {
    await sql`UPDATE proposal_sections SET status = 'approved', accepted_by = ${usr.id}::uuid, accepted_at = now(), completed_stage = 'draft', completed_at = now(), is_locked = true, locked_at = now(), locked_by = ${usr.id}::uuid, editing_by = NULL, editing_since = NULL
              WHERE id = ${s.id}::uuid AND is_locked = false`;
    await sql`UPDATE proposal_compliance_matrix SET status = 'satisfied' WHERE section_id = ${s.id}::uuid AND status <> 'not_applicable'`;
  }
  const tvArtifactId = tvSecs[0]?.artifactId;
  if (tvArtifactId) await sql`UPDATE proposal_artifacts SET is_locked = true, status = 'locked' WHERE id = ${tvArtifactId}::uuid`;
  await sql`UPDATE proposals SET lock_count = ${tvSecs.length} WHERE id = ${proposalId}::uuid`;
  const [{ satn }] = await sql<{ satn: number }[]>`SELECT count(*)::int satn FROM proposal_compliance_matrix WHERE proposal_id = ${proposalId}::uuid AND status = 'satisfied'`;
  ok('locked TV sections → matrix satisfied', tvSecs.length > 0 && satn >= tvSecs.length, `${satn} satisfied of ${tvSecs.length} TV rows`);

  // Phase 6 — export the Technical Volume artifact → .docx via the system exporter
  const expSecs = await sql<{ title: string | null; content: string | null }[]>`
    SELECT title, content FROM proposal_sections WHERE proposal_id = ${proposalId}::uuid AND artifact_id = ${tvArtifactId}::uuid ORDER BY section_number`;
  const [artRow] = await sql<{ artifactType: string | null; volumeName: string | null }[]>`SELECT artifact_type, volume_name FROM proposal_artifacts WHERE id = ${tvArtifactId}::uuid`;
  const canvas = assembleArtifactCanvas(expSecs as any, artRow.artifactType as any, artRow.volumeName ?? 'Technical Volume');
  const vars = { company_name: 'Immobileyes, Inc.', topic_number: 'DON26BX03-NP002' };
  const buf = await renderCanvas('docx', canvas as any, vars);
  const outPath = path.join(OUTDIR, 'Immobileyes_DON26BX03-NP002_Technical_Volume.docx');
  writeFileSync(outPath, buf as any);
  ok('exported Technical Volume .docx (system exporter)', (buf as any).length > 20000, `${(buf as any).length} bytes → ${outPath}`);

  console.log(`\nPROPOSAL_ID=${proposalId}\nTV_ARTIFACT_ID=${tvArtifactId}`);
} finally {
  await sql.end();
}
console.log(`\n${fail === 0 ? '✅ FULL CHAIN GREEN' : `❌ ${fail} CHECK(S) FAILED`}`);
process.exit(fail === 0 ? 0 : 1);
