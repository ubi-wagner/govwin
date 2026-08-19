/** Authored content for the Immobileyes GHOST proposal (DON26BX03-NP002), keyed by section_number.
 *  Every node is drawn from the GHOST past-proposal library (cocoon 684d8917) + the topic. Cost
 *  sections (§§14–15) are authored by the burden engine in immo-cost.mts, not here. */
import { randomUUID as uuid } from 'crypto';

type Node = Record<string, unknown>;
const base = (type: string, content: unknown, style: Record<string, unknown> = {}): Node => ({
  id: uuid(), type, content,
  style: { space_before: 6, space_after: 6, ...style },
  provenance: { source: 'manual' }, history: [], library_eligible: true,
});
export const h = (text: string, level: 1 | 2 | 3 = 2, numbering?: string): Node =>
  base('heading', { level, text, ...(numbering ? { numbering } : {}) }, { space_before: 12, space_after: 6 });
export const p = (text: string): Node => base('text_block', { text });
export const ul = (items: string[]): Node => base('bulleted_list', { items: items.map((text) => ({ text })) });
export const ol = (items: string[]): Node => base('numbered_list', { items: items.map((text) => ({ text })) });
export const table = (headers: string[], rows: string[][]): Node =>
  base('table', { headers, rows, border_style: 'single', header_style: { bold: true, bg: '#1f3a5f', fg: '#ffffff' } });
export const cap = (prefix: 'Figure' | 'Table' | 'Chart', number: number, text: string): Node =>
  base('caption', { prefix, number, text }, { alignment: 'center', space_after: 10 });

/** section_number → node[]. Cost §§14–15 intentionally absent (engine-authored). */
export const CONTENT: Record<string, Node[]> = {
  // ─────────────────────────── VOLUME 1 — Cover Sheet & Technical Abstract ───────────────────────────
  '1': [
    h('Proposal Cover Sheet & Technical Abstract', 1),
    p('Proposal Title: Guided Hostile Optical Sensor-hijacking (GHOST) — Adaptive Optical Countermeasures for EO-Guided Fiber-Optic FPV Drones Using Distributed Beam Routing and Dynamic Sensor Defeat.'),
    p('Topic: DON26BX03-NP002 — NAVAIR & NAVSEA Open Topic for Counter-Unmanned Air Systems (C-UAS). Small Business Concern: Immobileyes, Inc., 1950 State Route 59 Ste 100, Kent, OH 44240 (UEI KL3MJVGD9XZ9; CAGE 8KQ82; SBC Control ID SBC_001832313).'),
    h('C-UAS Technology Area of Interest', 3),
    p('This proposal responds directly to the topic’s AI/ML areas of interest: AI-powered target recognition, AI/ML swarm detection and anomaly analysis, and the non-/low-kinetic defeat of Group 1–2 UAS. GHOST is a software-defined, non-kinetic optical effector that detects, tracks, identifies, and defeats individual and swarming EO-guided fiber-optic FPV drones — the RF-silent, GPS-independent threat class that today’s RF- and GPS-centric Navy C-UAS cannot engage.'),
    h('Technical Abstract', 3),
    p('Fiber-optic FPV drones carry no RF link, are immune to RF jamming, and fly in GPS-denied conditions, relying almost entirely on continuous electro-optical (EO) imagery for terminal guidance. Immobileyes proposes GHOST, integrating two mature Immobileyes technologies: STORM™ (Smart Tracking & Optical Response Mitigation), an AI-enabled, MOSA-based multi-sensor detect-track system with a graduated Warn→Dazzle→Deny optical response; and DEXTER™ (Directed-Energy Beam RouTER), an AlphaMicron liquid-crystal adaptive beam-routing engine that electronically splits, combines, and steers a single sub-kilowatt laser across tens-to-hundreds of beams with no moving parts. By attacking the drone’s optical guidance rather than the airframe, GHOST breaks terminal lock non-kinetically and defeats saturating swarms without the magazine-depth and cost-exchange penalties of kinetic interceptors. Phase I establishes feasibility of extending the Navy’s seeker-confusion principle (U.S. Pat. 8,305,252 / 8,212,709) from IR seekers to EO-guided FPV cameras, defines the STORM/DEXTER architecture for a shipboard Phase II prototype, and quantifies performance against existing non-kinetic C-UAS. The effort builds on a TRL-5 directed-energy C-UAS baseline demonstrated for the 72d Security Forces Squadron at Tinker AFB.'),
    h('Anticipated Benefits', 3),
    p('For NAVAIR and NAVSEA, GHOST addresses an urgent capability gap in protecting surface combatants, littoral vessels, flight lines, munitions magazines, and installations against cheap, saturating swarm attacks — replacing an unfavorable cost-exchange against sub-$1,000 airframes with a low-SWaP, reusable, software-allocated optical effect. Open MOSA interfaces integrate GHOST into existing Navy sensor and C2 networks (EO/IR, radar, RF). The software-defined architecture scales across the Joint Force (USMC expeditionary, Army RCCTO, Air Force Security Forces) and into FAA-aware homeland and commercial markets — airports, energy grids, deep-water ports, and public venues — where kinetic force or RF jamming is legally restricted.'),
    p('Key Words: CUAS, Counter-UAS, Laser, Dazzle, Mobile, Non-Kinetic, Directed Energy, Swarm Defeat.'),
  ],

  // ─────────────────────────── VOLUME 2 — Technical Volume (10-page white paper) ───────────────────────────
  '2': [
    h('1.0 Identification and Significance of the Problem or Opportunity', 1, '1.0'),
    h('Problem and Significance', 3),
    p('First-person-view (FPV) fiber-optic drones have become one of the most difficult unmanned-air-system threats on the modern battlefield. Unlike conventional FPV systems, these aircraft require no radiofrequency (RF) link, are immune to RF jamming, and operate in GPS-denied environments — relying almost entirely on continuous electro-optical (EO) imagery for terminal guidance. Fielded at scale in Ukraine and by non-state actors, they defeat the RF-centric and GPS-centric counter-UAS (C-UAS) systems the Navy fields today.'),
    p('The operational consequence is stark. RF-based detection and defeat (jammers, spoofers, high-power microwave) have no emission to exploit; GPS denial has no effect on a vehicle flown by wire over fiber; and kinetic interceptors are cost-prohibitive and collaterally constrained against a sub-$1,000 airframe. A single fiber drone can be produced for a few hundred dollars yet forces the defender to expend a far costlier effect — an unfavorable cost-exchange and magazine-depth problem most acute at the exact moment of a saturating swarm attack against a naval installation, aircraft on the ramp, or a ship in the littorals.'),
    p('Existing C-UAS remains optimized for RF disruption or kinetic defeat. Existing shipboard laser systems are effective on larger platforms but require significant size, weight, power, cooling, and integration resources, limiting their suitability for smaller, agile vessels. There is an operational gap for low-SWaP, scalable, non-kinetic laser countermeasure systems capable of detecting, tracking, identifying, and defeating both individual and swarming UAS across diverse maritime environments.'),
    h('Technical Innovation: Guided Hostile Optical Sensor-hijacking', 3),
    p('Immobileyes proposes a software-defined counter-UAS architecture integrating two Immobileyes technologies. STORM™ (Smart Tracking & Optical Response Mitigation) is an AI-enabled, MOSA-based C-UAS system combining multi-sensor detection, precision tracking, and adaptive optical countermeasures; through its partnership with PerceptView it is sensor-agnostic by design, integrating EO/IR, radar, and RF sources. Immobileyes has already developed and demonstrated a STORM prototype integrating an optical warn/dazzle payload with a PTZ EO/IR camera; during an FAA-authorized operational demonstration for the 72d Security Forces Squadron at Tinker AFB, the system achieved Warn (>500 m) and Dazzle (300–350 m) optical effects against representative UAS EO cameras while maintaining continuous target tracking, substantially reducing technical risk.'),
    p('STORM employs a graduated, human-in-the-loop optical response tailored to the threat. Zone 1 (Warn/Deter) uses low-level visible illumination to signal presence and encourage compliance. Zone 2 (Dazzle/Disrupt) degrades the drone’s EO camera, reducing image quality and ISR effectiveness. Zone 3 (Deny/Damage) concentrates optical energy to designate targets or disable optical sensors when authorized — a scalable, non-kinetic response against EO-guided UAS.'),
    p('DEXTER™ (Directed-Energy Beam RouTER) is a low-SWaP adaptive beam-routing architecture developed with strategic partner AlphaMicron, Inc. (AMI), leveraging AMI’s decades of defense-grade liquid-crystal (LC) optics expertise. Using adaptive LC polarization gratings, DEXTER electronically routes, splits, combines, shapes, and redirects laser energy with no moving parts, switching a single beam among multiple output channels in milliseconds — enabling simultaneous engagement of multiple drones, rapid beam steering, and scalable swarm defense at speeds unattainable with mechanically steered systems. STORM fuses RF, radar, and EO/IR inputs and operates either standalone or as an integrated effector within existing Navy and DoW C2 architectures, including MEDUSA.'),
    h('Optical Seeker-Confusion / Overwhelm Mechanism', 3),
    p('The effort updates and refines the Navy’s internally researched IR-guided seeker-confusion principle (U.S. Pat. 8,305,252 and 8,212,709). The Navy demonstrated that a continuous-wave optical source placed within an imaging seeker’s field of view generates a localized high-intensity region the tracking algorithm interprets as a feature; the tracker’s centroid then migrates toward the induced source, steering the vehicle away from the protected asset. Modern EO-guided FPV fiber drones rely on the same class of feature-tracking and optical-flow guidance running on uncooled CMOS/CCD cameras. Against those sensors, controlled illumination produces image saturation, blooming, false high-intensity features, contrast collapse, and machine-vision confusion, degrading or breaking terminal lock without physical destruction. Phase I investigates the wavelength, dwell, polarization, and beam-geometry parameters that maximize this effect and characterizes the transition from reversible dazzle (Zone 2) to persistent denial (Zone 3) as a function of delivered irradiance.'),
    table(['Attribute', 'GHOST / STORM–DEXTER'], [
      ['Laser output', '< 1 kW total, software-allocated across beams'],
      ['Effective range', 'Burnout > 500 m; Dazzle > 1 km; Warning > 3 km'],
      ['Wavelengths', 'Multi-wavelength — green/blue (450 nm) + IR'],
      ['Beam routing', 'DEXTER LC grating: 1 → tens–hundreds of beams, ms switching, NO MOVING PARTS'],
      ['Cueing / integration', 'Detection-agnostic MOSA — EO/IR, radar, RF/EW, TSPI (proven at Tinker AFB)'],
      ['Engagement doctrine', 'Graduated Warn/Deter → Dazzle/Disrupt → Deny/Damage; HITL or autonomous'],
      ['Maturity', 'Builds on TRL-5 AF STTR + TACFI prototype lineage'],
    ]),
    cap('Table', 1, 'GHOST System Snapshot — Key Attributes.'),
  ],
  '3': [
    h('1.1 Phase I Technical Objectives', 1, '1.1'),
    p('Phase I will establish the technical feasibility of the STORM/DEXTER optical counter-UAS approach against EO-guided Group 1–2 UAS. Specific objectives:'),
    ol([
      'Demonstrate technical feasibility. Evaluate extending the Navy’s seeker-confusion concept from IR seekers to EO-guided fiber-optic drones; characterize the susceptibility of representative EO cameras to optical perturbation.',
      'Define the STORM/DEXTER system architecture and integration approach for Navy C-UAS applications, including interface requirements, MOSA compatibility, and the hardware/software modifications needed for a shipboard Phase II prototype.',
      'Quantify performance improvements. Model and measure improvements over existing non-kinetic C-UAS: tracking disruption, multi-target engagement, reduced SWaP, elimination of mechanical beam steering, and effectiveness against RF-jamming-resistant fiber-optic drones.',
      'Develop a Phase II transition plan. Define the roadmap for a prototype able to recognize, track, and non-kinetically defeat Group 2 UAS and identify NAVAIR/NAVSEA transition.',
    ]),
    table(['Metric', 'Phase I Target', 'Go / No-Go Threshold'], [
      ['EO-camera susceptibility (measurable degradation of terminal tracking)', 'Demonstrated on ≥ 2 representative EO/FPV cameras', '≥ 1 camera'],
      ['Optical effect', 'Repeatable saturation / blooming at bench range', 'Qualitative confirmation'],
      ['DEXTER multi-beam routing', '≥ 3 simultaneously addressable output channels (model/bench)', '≥ 2 channels'],
      ['Predicted SWaP vs. mechanically steered baseline', '≥ 30% reduction (analysis)', 'Net reduction'],
      ['Architecture', 'STORM↔DEXTER interface + Navy C-UAS integration defined', 'Interface defined'],
    ]),
    cap('Table', 2, 'Phase I Feasibility Metrics (Go / No-Go).'),
  ],
  '4': [
    h('1.2 Phase I (Base and Option) Statement of Work', 1, '1.2'),
    p('The Base effort (6 months) establishes feasibility and system architecture. The Option (6 months), funded separately, advances the effort toward Phase II with a breadboard optical-effects demonstration and a prototype/transition package. All work is performed at Immobileyes’ Kent, OH facility; no foreign nationals perform on this ITAR-restricted effort.'),
    table(['Task', 'Title and Description', 'Months', 'Performer / Deliverable'], [
      ['1 (Base)', 'System Definition & Feasibility Assessment: assess the STORM/DEXTER architecture; review Group 1–2 UAS threats, EO cameras, and current Navy C-UAS to define requirements and gaps.', '1', 'Immobileyes — Kick-Off Briefing'],
      ['2 (Base)', 'System Architecture & Design: preliminary architecture integrating STORM detect-track with DEXTER beam routing; STORM/DEXTER interface; optical-engagement concept; control architecture.', '1–3', 'Immobileyes + AMI — Progress Report'],
      ['3 (Base)', 'Optical Countermeasure Feasibility Evaluation: laboratory test and modeling of saturation, blooming, false-feature generation, and contrast degradation against representative EO cameras; compare vs. existing non-kinetic C-UAS.', '2–5', 'Immobileyes — Test Data & Analysis Report'],
      ['4 (Base)', 'Transition Assessment & Phase I Reporting: consolidate results; document performance improvements and residual risk.', '5–6', 'Immobileyes — Final Technical Report; Initial Phase II Proposal'],
      ['5 (Option)', 'Maritime Platform Integration & Motion Analysis: evaluate deployment on Navy platforms; define stabilization, inertial compensation, and predictive-tracking requirements.', '7–8', 'Immobileyes — Analysis & Technical Report'],
      ['6 (Option)', 'Closed-Loop Tracking & Breadboard Demo: integrate STORM detection/tracking with DEXTER beam routing; validate tracking, software control, and optical effects.', '8–11', 'Immobileyes + AMI — Breadboard Demo & Performance Data'],
      ['7 (Option)', 'Phase II Prototype Definition & NAVAIR/NAVSEA Transition Package: prototype design baseline, test plan, and integration/transition plan for a Navy C-UAS demonstration.', '10–12', 'Immobileyes — Prototype & Transition Planning Package'],
    ]),
    cap('Table', 3, 'Phase I Base and Option Statement of Work.'),
    h('Base Period — Task Approach', 3),
    p('Task 1 (Month 1) establishes the Group 1–2 EO-guided fiber-optic threat set, catalogs representative FPV/EO camera technologies and Navy C-UAS capability gaps, and converts them into system requirements, use cases, performance metrics, and evaluation criteria presented at the Kick-Off Briefing. Task 2 (Months 1–3) develops the preliminary STORM/DEXTER architecture, including the STORM↔DEXTER interface, PerceptView EO-tracking integration, the optical-engagement concept, MOSA interfaces, and engagement algorithms that select the optical response from target range, aspect, camera orientation, closing velocity, and dwell. Task 3 (Months 2–5) performs analytical modeling and laboratory characterization of representative EO cameras to quantify laser-induced saturation, blooming, false-feature generation, contrast degradation, and tracking instability, determining the engagement envelope required to misguide EO-guided FPV drones while minimizing laser power. Task 4 (Months 5–6) integrates the results into the Final Technical Report, defines the preliminary Phase II prototype architecture and V&V approach, and prepares the Initial Phase II Proposal and NAVAIR/NAVSEA transition plan.'),
    h('Option Period — Task Approach', 3),
    p('Task 5 (Months 7–8) evaluates deployment of STORM on moving Navy platforms (RHIBs, Combatant Craft Assault, expeditionary craft, tactical vehicles) and the effects of roll, pitch, yaw, heave, and vibration on tracking accuracy and beam-pointing stability, defining stabilization and predictive-tracking requirements. Task 6 (Months 8–11) develops a laboratory breadboard integrating STORM detection/tracking with DEXTER beam routing to demonstrate the complete engagement chain — detection through electronic beam routing to measured optical effects on representative EO-guided FPV cameras — validating single- and multi-beam operation. Task 7 (Months 10–12) defines the Phase II prototype baseline (system design, software/hardware architecture, V&V plan, performance metrics) and prepares the NAVAIR/NAVSEA integration, manufacturing, and transition package.'),
    h('Phase I Deliverables', 3),
    ul([
      'Kick-Off Briefing (Month 1).',
      'Progress Report.',
      'Final Technical Report documenting the STORM and DEXTER baseline, the Navy C-UAS capability gaps addressed, required modifications, the feasibility assessment, and expected performance improvements.',
      'Initial Phase II Proposal and initial transition/commercialization framework.',
    ]),
  ],
  '5': [
    h('1.3 Related Work', 1, '1.3'),
    p('GHOST builds directly on a funded, TRL-5 directed-energy C-UAS lineage designed, developed, and successfully demonstrated by Immobileyes.'),
    p('Air Force STTR Phase II / TACFI. (SBC: Immobileyes; Research Institution: University of Central Florida CREOL.) Immobileyes advanced the STORM directed-energy C-UAS system from TRL 3 to TRL 5, incorporating operational feedback from the 72d Security Forces Squadron, Tinker AFB. Across three Air Force STTR Phase I awards (2021, 2023) and a Phase II/TACFI effort, the company has secured approximately $2 million in USAF SBIR/STTR funding to mature its adaptive optical C-UAS technologies.'),
    p('Intellectual Property. Immobileyes holds two issued patents (U.S. Pat. 11,519,701 and 11,686,560, Light Shield Device) and application WO2025122941A1 (Multi-Zone Multi-Target System), covering adaptive optical countermeasure technologies that extend the Navy’s foundational seeker-confusion inventions (U.S. Pat. 8,305,252 and 8,212,709). The Navy patents were made available through the Department of War’s Defense Patent Holiday initiative, which provides qualified companies no-fee Commercial Evaluation Licenses to evaluate and commercialize selected DoW laboratory inventions, and form the technical basis for the proposed STORM/DEXTER architecture.'),
    p('AlphaMicron, Inc. (Strategic Partner — DEXTER / LC optics). Partner since 2020 ($600K in-kind + $1.6M matching), AMI is a recognized leader in liquid-crystal electro-optics with decades of USAF, Army, and Navy R&D experience. Its electronically switchable LC product is the first of its kind included in the U.S. Army’s APEL (Authorized Protective Eyewear List) program. AMI provides the DEXTER adaptive beam-routing technology — LC polarization gratings and software-controlled optical switching — and supports prototype development, manufacturing, and transition, maintaining a long-standing relationship with the AFRL Functional Materials Division.'),
    p('PerceptView (Partner) combines decades of machine-vision and target-tracking expertise with ten years building end-to-end counter-UAS solutions. Its modular systems integrate EO/IR cameras, automated target tracking, radar, Remote ID, ADS-B, and Cursor-on-Target, with APIs to external C2 platforms and effectors.'),
  ],
  '6': [
    h('1.4 Relationship with Future Research and Development', 1, '1.4'),
    p('End users are NAVAIR and NAVSEA C-UAS for naval installations, aircraft, and ships, plus USMC and Joint-Force expeditionary air defense. The most reasonable near-term use case is fixed and expeditionary point defense of high-value assets against Group 1–2 EO-guided FPV fiber drones that today’s RF/GPS-centric C-UAS cannot engage. The system is small enough to mount to a fast boat or HMMWV for SEAL and special-operations use and can be scaled and modularized to support full ship or naval-base defense.'),
    h('Concept of Employment', 3),
    p('GHOST deploys as a modular effector cued by existing Navy sensors over MOSA interfaces, in three primary modes: (1) fixed-site installation defense of magazines, flight lines, and C2 nodes; (2) shipboard self-defense against EO-guided threats in the littorals; and (3) expeditionary or vehicle-mounted defense of maneuvering forces. In every mode, the graduated escalation framework lets the operator apply the minimum necessary effect (warn, dazzle, or deny), preserving rules-of-engagement latitude and minimizing collateral and airspace risk. DEXTER lets a single laser source be electronically routed across multiple targets, allowing one STORM effector to engage successive or simultaneous EO-guided FPV drones without the reload or magazine limitations of kinetic systems. Open MOSA interfaces integrate the system with existing Navy sensors and combat systems, minimizing integration risk and accelerating transition.'),
    p('Future R&D advances directly into Phase II (a TRL-6 shipboard prototype for a Navy operational demonstration), then Phase III production effectors and integration onto Navy C-UAS programs of record — building on the TRL-5 STORM baseline and the ~$2M of prior non-dilutive USAF investment.'),
  ],
  '7': [
    h('3.0 Commercialization / Transition Plan Summary', 1, '3.0'),
    p('DoW transition targets NAVAIR and NAVSEA (installation and ship C-UAS), the USMC, Army RCCTO, and Air Force Security Forces, building on the established Tinker AFB 72d SFS relationship. Non-DoW markets include critical-infrastructure and homeland defense — airports, nuclear facilities, and border security — where non-kinetic, FAA-aware defeat is essential.'),
    h('Transition Path and Timeline', 3),
    p('Phase I establishes feasibility; Phase II delivers a TRL-6 prototype for a Navy operational demonstration, building on the TRL-5 STORM baseline and ~$2M of prior non-dilutive USAF SBIR/STTR investment; Phase III targets production effectors and integration onto Navy C-UAS programs of record. The established AF Security Forces relationships provide operational and security guidance to ensure the system is demonstrable and fieldable by the Navy. NAVAIR and NAVSEA transition sponsors identified in Task 6 de-risk the path from prototype to program of record. Immobileyes’ AlphaMicron partnership (US-based LC manufacturing) and PerceptView partnership (US-based sensor integration) provide a scalable, secure domestic manufacturing and integration base.'),
    p('To accelerate maturation, manufacturing readiness, and transition, Immobileyes has established partnerships with the Youngstown Innovation Hub (YIH), the National Center for Defense Manufacturing and Machining (NCDMM), and the Ohio Defense Innovation OnRamp Hub (ODIH). Beyond Navy applications, the common STORM/DEXTER architecture supports layered counter-UAS protection of installations, expeditionary bases, ports, airfields, critical infrastructure, and commercial maritime assets — broad dual-use applicability that leverages manufacturing investment across defense and commercial markets.'),
  ],
  '8': [
    h('2.0 Key Personnel', 1, '2.0'),
    p('All proposed Immobileyes personnel are U.S. Citizens. The Phase I team combines a nationally recognized electro-optics research group with in-house engineering and machining staff, all under one roof at the Kent, OH facility.'),
    table(['Name and Title', 'Employer', 'Qualifications', 'FN (Y/N)', 'Relevant Experience'], [
      ['Atossa Alavi — CEO, Principal Investigator / Program Manager, Business & IP Lead', 'Immobileyes', 'MPhil (Neuroscience); JD (Case Western); USPTO-admitted', 'N', 'Program management, DoD transition, and IP strategy for the AlphaMicron/Immobileyes technology base.'],
      ['Dr. Bahman Taheri — CEO/CTO, Principal Scientist / Electro-Optics Lead', 'AlphaMicron (partner)', 'PhD/MS Physics (Oklahoma State); BS Physics (Cal Poly SLO); Secret clearance', 'N', '120+ patents; PI on Air Force, Navy (ONR), Army, DOE, and DARPA LC electro-optics and adaptive laser/flash-protection programs.'],
      ['Dr. Christopher Lukowski — Optical Engineer', 'Immobileyes', 'PhD Optics/Physics (University of Maryland)', 'N', 'Liquid-crystal beam steering, laser sources, and EO camera characterization.'],
      ['Electrical / Software Engineers', 'Immobileyes', 'BS/MS Electronic Engineering, Computer Science', 'N', 'Real-time detect-track, control electronics, and data pipelines for the feasibility campaign.'],
      ['Dr. Ross Lamm — CEO, PerceptView Integration Expert', 'PerceptView (partner)', 'PhD (UC Davis), computer vision and pattern recognition', 'N', 'Supported NASA JPL, MIT Lincoln Laboratory, and U.S. Navy / Coast Guard programs.'],
    ]),
    cap('Table', 4, 'Phase I Key Personnel. Principal Investigator time on project: 25%.'),
    p('This depth lets the team run the Phase I laboratory campaign without new hires or subcontracted labor and provides direct continuity into the Option benchtop prototype, the Phase II operational prototype, and Phase III fieldable solutions for the Navy. AlphaMicron and PerceptView will continue as key partners during Phase II prototype development, integration, testing, and manufacturing.'),
  ],
  '9': [
    h('Foreign Citizens', 2),
    p('This topic is ITAR-restricted (22 CFR 120–130). No foreign nationals (as defined in 22 CFR 120.16) are proposed to perform on this effort; all personnel are U.S. Citizens. Restriction on performance by foreign persons is acknowledged and complied with. Should any circumstance change, Immobileyes will disclose the foreign national’s name, country of origin, visa/work-permit status, and the specific Statement-of-Work tasks to be performed, and will obtain the required approvals before any such performance (topic ITAR clause; DoW CSO §3.5).'),
  ],
  '10': [
    h('4.0 Facilities / Equipment', 1, '4.0'),
    p('Immobileyes shares its facilities with AlphaMicron, an ISO 9001-certified manufacturer headquartered in a 30,000-square-foot facility in Kent, Ohio. The facility houses seven specialized laboratories, including two electro-optics and laser laboratories, liquid-crystal fabrication clean rooms, precision optical-assembly areas, a MIL-STD environmental test suite, electronics integration and rapid-prototyping capabilities, and in-house 3D printing for accelerated prototype development and system integration.'),
    p('The facility maintains an active DoD Facility Clearance (FCL), implements NIST SP 800-171 security controls, has completed a CMMC Level 2 self-assessment, and maintains OSHA-compliant laser-safety procedures. The laser labs feature a wide variety of continuous-wave and pulsed lasers, spectrometers, control electronics, amplifiers, waveform generators, and detectors. PerceptView provides US-based EO/IR camera payloads, stabilized pan-tilt systems, embedded vision processing, and low-rate production — an end-to-end, entirely U.S.-based capability spanning optical-component fabrication, laser integration, system assembly, environmental testing, and production, supporting a secure domestic supply chain.'),
  ],
  '11': [
    h('Subcontractors / Consultants', 2),
    p('No subcontractors are proposed for Phase I; teaming partners contribute in-kind. At least two-thirds of the Phase I work will be performed by Immobileyes (Firm POW 100%, Subcontractor POW 0%). Strategic partners AlphaMicron, Inc. (DEXTER liquid-crystal optics) and PerceptView (EO/IR tracking integration) support the effort under existing collaborative relationships and continue as key partners into Phase II prototype development, integration, testing, and manufacturing. Should any consultant or subcontractor be added, costs will be detailed in the Cost Volume and the minimum percentage-of-work requirements will be maintained.'),
  ],
  '12': [
    h('Prior, Current, or Pending Support of Similar Proposals or Awards', 2),
    p('No proposal for essentially equivalent work has been submitted to, or funded by, another Federal agency or DoD component. The proposed GHOST effort applies the company’s prior USAF STTR/TACFI directed-energy C-UAS technology base (STORM/DEXTER, ~$2M USAF SBIR/STTR to date) to the distinct NAVAIR/NAVSEA maritime C-UAS problem set; it does not duplicate or substantially overlap research funded elsewhere. Immobileyes will notify the Federal agency immediately if all or a portion of the work authorized and funded under this proposal is subsequently funded by another Federal agency.'),
  ],
  '13': [
    h('Assertion of Restrictions on the Government’s Use, Release, or Disclosure of Technical Data or Software', 2),
    p('Immobileyes is not submitting assertions under DFARS 252.227-7017 for this proposal. Technical data and computer software delivered under a resulting award will be provided with the standard SBIR data rights afforded under the funding agreement. Proposal contents are subject to the standard SBIR proposal use/disclosure restriction: for any purpose other than evaluation, the data (except cover sheets) shall not be disclosed outside the Government or duplicated, used, or disclosed in whole or in part, except as provided in a resulting funding agreement. This restriction does not limit the Government’s right to use information obtained from another source without restriction.'),
  ],

  // ─────────────────────────── VOLUME 4 — Company Commercialization Report ───────────────────────────
  '16': [
    h('Company Commercialization Report (CCR)', 2),
    p('The Company Commercialization Report is generated from the SBIR.gov Firm Forms (My Documents → CCR PDF) and submitted through DSIP. The current CCR of record for Immobileyes, Inc. (SBC Control ID SBC_001832313) is summarized below; the authoritative PDF is attached at submission.'),
    table(['Company Metric', 'Value'], [
      ['SBC Control ID', 'SBC_001832313'],
      ['Address', '1950 State Route 59 Ste 300, Kent, OH 44240-4118'],
      ['Year founded / current employees', '2020 / 39'],
      ['Year first Phase I award / # Phase I awards', '2021 / 4'],
      ['# Phase II awards', 'None to date'],
      ['% revenue from SBIR/STTR (last FY)', '95% (total revenue $500,000–$999,999)'],
      ['Woman-Owned', 'Yes'],
      ['Socially/Economically Disadvantaged', 'No'],
      ['Total investments / total sales / Phase III funding', '$0 / $0 / $0'],
    ]),
    cap('Table', 5, 'Company Commercialization Report summary (privileged and confidential per 15 U.S.C. 638(k)(4) and 5 U.S.C. 552).'),
    p('Immobileyes has no prior Phase II awards or commercialized Phase III sales to report; company revenue derives primarily from SBIR/STTR-funded R&D. The GHOST effort is positioned to become the company’s first maritime C-UAS transition, building commercialization history through the NAVAIR/NAVSEA path defined in the Transition Plan.'),
  ],

  // ─────────────────────────── VOLUME 5 — Supporting Documents ───────────────────────────
  '17': [
    h('Foreign Nationals Disclosure (ITAR / EAR)', 2),
    p('No foreign nationals are proposed to perform on this ITAR-restricted effort (22 CFR 120–130). All Immobileyes personnel, and all partner personnel with access to controlled technical data, are U.S. Citizens. Immobileyes understands and will comply with all export-control regulations; ITAR/EAR-controlled data will be present in the work and deliverables and will be handled under the company’s NIST SP 800-171 controls and DoD Facility Clearance. No foreign nationals as defined in 22 CFR 120.16 are proposed. Should staffing change, Immobileyes will disclose each foreign national’s country of origin, visa/work-permit status, and assigned SOW tasks and obtain approval prior to any performance.'),
  ],
  '18': [
    h('Letters of Support', 2),
    p('Letters of support from the Phase I teaming partners and transition ecosystem are attached at submission, confirming committed roles and in-kind contributions:'),
    ul([
      'AlphaMicron, Inc. — strategic partner providing DEXTER liquid-crystal beam-routing technology, prototype development, and US-based LC manufacturing ($600K in-kind + $1.6M matching relationship since 2020).',
      'PerceptView — EO/IR tracking and C2 integration partner providing sensor-agnostic MOSA integration and a secure domestic camera/payload supply chain.',
      'Youngstown Innovation Hub (YIH), National Center for Defense Manufacturing and Machining (NCDMM), and Ohio Defense Innovation OnRamp Hub (ODIH) — transition, manufacturing-readiness, and customer-discovery support.',
    ]),
    p('Signed letters are included as separate PDFs in the submission package; this page records their inclusion and scope.'),
  ],
  '19': [
    h('DD Form 2345 — Militarily Critical Technical Data Agreement', 2),
    p('Immobileyes maintains a current, approved DD Form 2345 (Militarily Critical Technical Data Agreement) with the Defense Logistics Agency Joint Certification Program, establishing eligibility to receive militarily critical / export-controlled technical data. A copy of the approved DD Form 2345 is attached to the submission package where required by the Service/Component-specific instructions (DoW CSO §3.2). This supports the ITAR-restricted nature of the GHOST effort and the handling of controlled EO/IR and directed-energy technical data.'),
  ],
  '20': [
    h('Technical Data Rights Assertions', 2),
    p('Immobileyes asserts SBIR data rights in all technical data and computer software developed under a resulting Phase I award, consistent with the SBIR/STTR data-rights provisions of the funding agreement. No pre-existing (background) technical data or software beyond the standard SBIR assertion is being restricted under DFARS 252.227-7017 for this proposal. Foreground data generated under the award — including STORM/DEXTER interface specifications, optical-effects characterization data, and feasibility results — will carry SBIR data rights for the statutory protection period. The Government retains unlimited rights only in data specifically generated with, and delivered under, non-SBIR funding, of which none is proposed here.'),
  ],
  '21': [
    h('CMMC Level 2 (Self) Reps & Certifications', 2),
    p('Immobileyes has completed a CMMC Level 2 self-assessment and implements NIST SP 800-171 security controls at its Kent, OH facility, which maintains an active DoD Facility Clearance (FCL). The company projects CMMC Level 2 (Self) status consistent with the topic’s requirement and will maintain the controls necessary to handle Controlled Unclassified Information (CUI) associated with this ITAR-restricted effort. The current self-assessment score and affirmation are recorded in SPRS and provided in the supporting reps & certifications at submission.'),
  ],

  // ─────────────────────────── VOLUME 6 — Fraud, Waste, and Abuse Training ───────────────────────────
  '22': [
    h('Fraud, Waste, and Abuse Training Certification', 2),
    p('The Principal Investigator, Atossa Alavi, has completed the required DON/SBA Fraud, Waste, and Abuse (FWA) training tutorial and certifies having read and understood it, consistent with the Navy SBIR FWA requirement (navysbir.com/fwa.htm). The signed 3-page FWA Training Certification is attached to the submission package and will be re-certified on the Phase I Kick-Off briefing FWA certification slide and reviewed annually. The certification affirms understanding of the civil and criminal consequences of fraud in obtaining or performing an SBIR/STTR award, the requirement to track and account for award funds separately, and the obligation to document expenditures and retain records.'),
    p('Certification of record: Atossa Alavi, Immobileyes, Inc. — valid Jul 21, 2026 through Jul 21, 2027.'),
  ],
};
