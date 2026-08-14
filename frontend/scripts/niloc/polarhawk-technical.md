# PolarHawk™ — A Low-SWaP Compact-Polarimetric Monopulse Radar for Small-UAS Detection and Classification

**SBIR Phase II Proposal — Technical Volume**
**Offeror:** NILOC Technologies (small business) · **Principal Investigator:** Eric Wagner, Founder & CEO
**Core technology licensed from:** U.S. Naval Research Laboratory, Radar Division — U.S. Patent **11,828,868 B2** (Rodenbeck, Beun, Ainsworth, Langlois), *Compact-Polarimetric Monopulse Aperture Antenna*, offered for license via the NRL Office of Technology Transfer / TechLink.

---

## Executive Summary

Small unmanned aircraft (Group 1–3 UAS) are the defining low-cost air threat of this decade, yet the radars asked to find them cannot reliably tell a quadcopter from a bird, a balloon, or wind-blown clutter. The polarimetric information that makes that discrimination easy has, until now, been confined to large full-quad-pol radars that require two transmit chains and the size, weight, power, and cost (SWaP-C) that come with them — precisely the budget a mobile or expeditionary C-UAS node does not have.

NILOC Technologies proposes to license and mature the NRL **Compact-Polarimetric Monopulse Aperture Antenna** (U.S. Patent 11,828,868 B2) into a fielded, low-SWaP counter-UAS radar we call **PolarHawk™**. The NRL invention transmits a single circular polarization and receives two orthogonal (H/V) polarizations while simultaneously forming monopulse sum/difference channels — delivering near-full-pol target-scattering information *and* precision angle tracking from **one transmitter**. This breaks the cost/SWaP barrier that keeps polarimetry off small platforms.

In this 24-month, [~$1.8M] Phase II effort, NILOC will execute the NRL license, prototype the compact-polarimetric feed, integrate it with a single-chain low-SWaP transceiver and digital back-end, and fuse the resulting polarimetric feature set with NILOC's AI/ML classifier — a portfolio advantage no antenna vendor can match. We will field-demonstrate PolarHawk against representative drones, birds, and clutter, advancing the system from TRL [4] to TRL [6].

NILOC's model is deliberately low-risk: we build on lab-validated government IP and add AI-native execution. The result is polarimetric drone discrimination at a sensor-head cost target of [<$50k] and prime power of [<150 W] — a capability the C-UAS enterprise, the origin Navy customer, and dual-use weather/maritime markets are actively demanding.

---

## Identification and Significance of the Problem/Opportunity

**The threat.** Inexpensive small UAS have moved from nuisance to primary threat across contested and homeland environments. They are small (radar cross-sections on the order of [0.01 m²]), slow, and fly low — the exact corner of the detection space where conventional surveillance radar is weakest. The hard part is no longer *detecting* a moving point; it is *classifying* it. Airspace over any base, border, port, or event is full of birds, weather cells, blowing debris, and ground traffic. A radar that alarms on all of them is operationally useless: it exhausts operators, wastes effectors, and trains crews to ignore it.

**Why polarimetry is the right discriminant.** A drone is a rigid, man-made object: motors, a battery mass, a metal-or-composite frame, and rotating rigid blades. These produce coherent, even-bounce (dihedral-like) and odd-bounce scattering with a stable polarimetric signature, plus distinctive rotor micro-Doppler. A bird is a soft, water-filled, flexing body that scatters diffusely with a very different polarimetric character. **Full-polarimetric radar measures exactly the scattering physics that separates these classes** — degree of polarization, odd/even/diffuse decomposition, circular-polarization ratio. This is why polarimetric discrimination is so powerful, and why it has been out of reach for the small platforms that need it most.

**Why it hasn't been fielded on small platforms.** True quad-pol radar transmits H and V (two transmit chains or time-multiplexed transmission) and receives both — doubling transmit hardware, prime power, thermal load, and cost. On a man-portable, vehicle, or tower node those budgets do not exist, so integrators field non-polarimetric radars and try to recover discrimination downstream with micro-Doppler and tracking heuristics alone. The result is the false-alarm problem the C-UAS community complains about constantly.

**The opportunity.** Compact polarimetry — circular transmit, dual-linear receive (the CTLR architecture with deep SAR heritage) — recovers the great majority of the target-scattering information of a full quad-pol system using only **one transmitter**. NRL's patented aperture goes further by folding a **monopulse comparator** into that same compact waveguide feed, so a single low-SWaP front-end yields *both* the polarimetric feature vector *and* precision within-beam angle track. That combination — polarimetric classification quality at monopulse tracking accuracy, at single-transmitter SWaP-C — is the differentiator. It converts polarimetry from a large-platform luxury into a line-replaceable sensor that C-UAS primes, the Navy, and homeland-security customers can actually mount, power, and afford.

---

## Technical Objectives

Phase II will meet the following measurable objectives (all numeric targets flagged as [estimates] pending Phase I / modeling refinement):

1. **License and mature the CPM feed.** Execute the NRL license (US 11,828,868 B2) and prototype the compact-polarimetric monopulse feed at X-band [9.3–10.0 GHz], demonstrating transmit circular-polarization **axial ratio [< 1.5 dB]** and dual-linear receive **port isolation [> 28 dB]** across an operating bandwidth of [≥ 500 MHz].

2. **Preserve monopulse tracking.** Demonstrate simultaneous monopulse angle estimation with **null depth [> 30 dB]** and **boresight track accuracy [≤ 0.4°]** (≈ [1/15] of the [~7°] beamwidth) at [10 dB] single-pulse SNR — confirming that adding polarimetry does not degrade angle performance.

3. **Achieve low-SWaP integration.** Integrate the feed with a single-transmit-chain transceiver and digital back-end into a sensor head of **[< 10 kg]**, **prime power [< 150 W]**, and a target production unit cost of **[< $50k]** at volume.

4. **Extract calibrated compact-pol products.** Recover the compact-polarimetric Stokes vector and derived products (m-χ / m-δ decompositions, circular-polarization ratio, degree of polarization) and validate against canonical calibration targets to **within [~85%]** of a quad-pol reference — quantifying information retained.

5. **Classify drones vs. birds/clutter.** Fuse polarimetric features with rotor micro-Doppler and NILOC's AI/ML classifier to achieve **probability of correct classification Pcc [≥ 90%]** at **false-alarm probability Pfa [≤ 10⁻³]** on held-out field data.

6. **Field-demonstrate at TRL 6.** Conduct a government-witnessed field trial of the integrated PolarHawk prototype showing **detection [≥ 3 km]** and **classification [≥ 1.5 km]** on a [0.01 m²] UAS in representative bird/ground/weather clutter.

---

## Technical Approach & Work Plan

**Overview.** PolarHawk matures a lab-validated antenna into an integrated sensor along a linear, gated path: license and model the NRL feed (Task 1), prototype and characterize it in an anechoic chamber (Task 2), integrate a single-chain low-SWaP transceiver and digital back-end (Task 3), build the polarimetric feature and AI-classification pipeline (Task 4), and field-demonstrate the integrated system (Task 5). Each task ends in a go/no-go gate tied to a Section-3 objective.

**Task 1 — License Execution, Requirements & EM Modeling (Months 1–5).**
Subtasks: (1a) execute the NRL license via OTT/TechLink and establish a technical-support CRADA with the Radar Division; (1b) full-wave EM modeling of the compact-polarimetric monopulse feed (transmit-CP polarizer/septum, dual-linear OMT receive, monopulse comparator network) in [HFSS/CST]; (1c) derive the system requirements budget (band, beamwidth, SWaP, range). *Milestone/Go-No-Go:* modeled axial ratio [<1.5 dB], receive port isolation [>28 dB], and monopulse null depth [>30 dB] over [≥500 MHz]. *Risk:* license/IP delay → *mitigation:* engage NRL OTT/TechLink pre-award, structure a field-of-use (C-UAS) license, and preserve SBIR data rights on all NILOC foreground work.

**Task 2 — CPM Feed Prototype & Anechoic Characterization (Months 4–11).**
Subtasks: (2a) fabricate the waveguide feed via precision CNC/EDM with additive-metal options for the comparator manifold; (2b) precision plating and tuning; (2c) anechoic-chamber measurement of axial ratio, cross-pol isolation, sum/difference patterns, null depth, and monopulse boresight slope. *Milestone/Go-No-Go:* measured performance within [1 dB] of model on axial ratio and [3 dB] on isolation; monopulse slope supports [≤0.4°] accuracy. *Risk:* X-band machining tolerances degrade CP purity and null depth → *mitigation:* tolerance-budget the design with margin, iterate two fabrication lots, and hold NRL design reviews at 2a and 2c.

**Task 3 — Low-SWaP Transceiver & Digital Back-End Integration (Months 9–16).**
Subtasks: (3a) integrate a single solid-state transmit chain and a coherent multi-channel receiver (two polarimetric + monopulse sum/difference) built on a COTS SDR/FPGA back-end; (3b) implement a pulse-Doppler waveform with coherent integration for the [0.01 m²] range objective; (3c) end-to-end coherent capture and polarimetric calibration against trihedral/dihedral and a rotating canonical target. *Milestone/Go-No-Go:* validated coherent dual-pol + monopulse capture; Stokes extraction matches canonical-target reference; sensor head [<10 kg], [<150 W]. *Risk:* single-chain link budget limits range → *mitigation:* waveform integration gain, low-noise receive design, and a staring-subarray growth option carried as a trade.

**Task 4 — Polarimetric Feature Pipeline & AI Classification (Months 14–21).**
Subtasks: (4a) implement compact-pol product extraction (Stokes, m-χ, m-δ, CPR, degree of polarization); (4b) fuse polarimetric features with rotor micro-Doppler; (4c) integrate NILOC's AI/ML classifier, train/validate on collected drone/bird/clutter signatures with injection-resistant, curated data. *Milestone/Go-No-Go:* Pcc [≥90%] at Pfa [≤10⁻³] on held-out data; quantified lift over a non-polarimetric baseline. *Risk:* insufficient/biased training data → *mitigation:* structured collection across drone classes and bird activity, physics-based augmentation from the calibrated model, and cross-validation.

**Task 5 — Integrated Field Demonstration (TRL 6) (Months 19–24).**
Subtasks: (5a) integrate PolarHawk in a fieldable enclosure; (5b) instrumented trials against Group 1–3 UAS with truth-tracked birds and ground/weather clutter; (5c) government-witnessed demonstration and transition documentation (ICD, test report, Phase III plan). *Milestone/Go-No-Go:* detection [≥3 km], classification [≥1.5 km] on a [0.01 m²] UAS, SWaP within target — TRL 6. *Risk:* clutter-driven false alarms in the field → *mitigation:* the polarimetric + micro-Doppler + AI triad, adaptive clutter maps, and staged range/geometry buildup.

---

## Related Work & Prior Results

The core aperture is **not NILOC's invention, and we state that plainly**: the Compact-Polarimetric Monopulse Aperture Antenna was conceived and reduced to practice at the **U.S. Naval Research Laboratory, Radar Division**, and is protected by **U.S. Patent 11,828,868 B2** (Rodenbeck, Beun, Ainsworth, Langlois). It is offered for license through the NRL Office of Technology Transfer and TechLink. NILOC's role is to license this government-owned IP and mature it into a fielded product — precisely the technology-transition pathway SBIR is meant to accelerate.

The invention sits on well-established science, which de-risks the physics. Circular-transmit / linear-receive **compact polarimetry (CTLR)** has strong spaceborne SAR heritage (Raney's hybrid-polarity architecture; Souyris' reconstruction methods; operational use on RISAT-1, the RADARSAT Constellation Mission, and Chandrayaan-1 Mini-SAR), where it is documented to recover the large majority of quad-pol discrimination at roughly half the transmit hardware. **Monopulse** sum/difference angle estimation is textbook radar practice (Sherman & Barton). NRL's contribution — and the reason a license is worth executing — is folding both into a **single compact waveguide feed** so one transmitter yields polarimetry *and* precision track.

NILOC's own Phase I / feasibility work (or Phase I-equivalent supporting Direct-to-Phase-II eligibility) established the maturation basis: [full-wave models reproducing the patent's sum/difference and dual-pol behavior with axial ratio [<1.5 dB]; a breadboard comparator sub-assembly; a simulated drone-vs-bird polarimetric separation of [>X dB] in m-χ space; and a confirmed NRL licensing pathway]. NILOC also brings a working AI/ML C-UAS classifier from its separate portfolio, ready to consume the richer feature vector this front-end produces.

---

## Key Personnel

**Eric Wagner — Principal Investigator, Founder & CEO, NILOC Technologies.** Mr. Wagner directs NILOC's strategy of licensing federally developed innovations and maturing them into fielded products across RF/EM, computer vision, AI, and autonomy. He combines hands-on applied-AI expertise (he leads NILOC's C-UAS ML classifier and is founder of RFP Pipeline, an AI-native federal-proposal platform), working fluency in RF/EM system tradeoffs, and direct experience in federal contracting and technology commercialization. As PI he owns technical direction, the NRL license relationship, government demonstrations, and the transition plan. [Confirm-able specifics: degree(s) and field; [X]+ years in defense-technology commercialization; prior SBIR/STTR and program-transition record; security clearance status.]

Supporting the PI, NILOC will staff/subcontract the following roles:

- **[RF / Antenna Engineer — Senior, to be named]:** waveguide and monopulse comparator design, CP polarizer and OMT integration, anechoic characterization. [MS/PhD EE; [10]+ yrs microwave/antenna; X-band waveguide fabrication experience.]
- **[Radar Systems / DSP Engineer — role]:** single-chain transceiver integration, pulse-Doppler waveform, coherent multi-channel receive, Stokes/decomposition processing. [MS EE; pulse-Doppler and SDR/FPGA experience.]
- **[ML / Data Engineer — role, NILOC internal]:** polarimetric + micro-Doppler feature pipeline and classifier training/validation, leveraging NILOC's existing C-UAS model.
- **[NRL Radar Division technical consultant — CRADA/subcontract]:** design-review support and licensing-technical continuity.

---

## Commercialization Plan

**Market and sizing.** The global counter-UAS market is estimated at **[~$3.0B in 2025], growing at [~25% CAGR] to [~$12B by 2032]** (TAM). NILOC's serviceable segment is the **low-SWaP, mobile/expeditionary and fixed-site radar-sensor** portion reachable by a sub-$50k polarimetric front-end — estimated **SAM [~$500M/yr]**. A disciplined capture over the first six years of production yields a target **SOM of [~$60M cumulative / ~$20M/yr at maturity]**, corresponding to [low-single-digit] share of SAM — achievable because PolarHawk offers a capability (polarimetric discrimination at low SWaP-C) that incumbents do not.

**Defense transition.** The strongest pull is the **origin customer**: NRL and the broader Navy/USMC C-UAS enterprise (e.g., MADIS-class ground-based air defense) have both institutional familiarity with the IP and an acute small-UAS problem, especially in cluttered littoral and shipboard environments where sea-clutter and bird discrimination matter. Beyond the Navy, transition targets include the **Joint C-sUAS Office (JCO)**, Army **FS-LIDS/M-LIDS**, SOCOM, and DHS/homeland fixed-site security (airports, borders, mass events), plus allied FMS. Insertion is via two paths: (1) **sensor-into-prime**, offering PolarHawk as a drop-in polarimetric radar to C-UAS system integrators (Anduril, SRC, Leonardo DRS, and others) under a defined ICD; and (2) **direct** node sales to government end-users, supported by the Phase II TRL-6 demonstration and a Phase III production plan.

**Dual-use.** The same single-transmitter polarimetric front-end serves commercial markets that also fight clutter: **weather / gap-filler radar** (polarimetric hydrometeor classification at micro-radar SWaP-C), **maritime surface-search and navigation** (small-target and sea-clutter discrimination — skiffs, debris, ice), airport **bird-strike and drone** monitoring for the FAA/airports, and critical-infrastructure perimeter security. Dual-use breadth de-risks the business by decoupling revenue from any single defense program cycle.

**Competition and differentiation.** Incumbents include Echodyne (metamaterial ESA — high performance, **not polarimetric**), SRC and Leonardo DRS/RADA, and micro-Doppler specialists (Robin Radar, Fortem). **None deliver polarimetric classification at single-transmitter SWaP-C.** NILOC's moat is threefold: (1) the licensed, lab-validated NRL aperture; (2) polarimetry + micro-Doppler + **NILOC's AI/ML classifier** as an integrated feature-to-decision stack; and (3) AI-native, low-risk execution.

**Revenue model.** (1) Hardware unit sales of the PolarHawk sensor; (2) recurring **software/AI-classifier licensing** and model-update subscriptions; (3) NRE for prime-integration and variant tuning; (4) sustainment/support. **IP strategy:** pursue a **field-of-use (C-UAS) license** to US 11,828,868 B2 from NRL — exclusive where obtainable — and stack NILOC foreground IP (feed integration, calibration methods, polarimetric AI features, packaging) protected under SBIR data rights, creating a defensible, layered position atop government-owned base IP.

---

## Quad Chart

**① Technology & Innovation**
- Licensed NRL Compact-Polarimetric Monopulse Aperture (US Pat. 11,828,868 B2)
- **Single transmitter**: circular transmit, dual-linear (H/V) receive + monopulse Σ/Δ
- Near-full-pol scattering data **and** precision angle track in one compact feed
- Compact-pol (CTLR) heritage + monopulse — recovers ~[85%] of quad-pol at half the transmit hardware

**② Operational Capability & Benefit**
- Discriminate drones from birds/clutter: **Pcc [≥90%] @ Pfa [≤10⁻³]**
- Detection [≥3 km] / classification [≥1.5 km] on a [0.01 m²] UAS
- Low SWaP-C: head [<10 kg], power [<150 W], unit cost [<$50k]
- Dual-use: C-UAS, weather, maritime, perimeter security

**③ Transition & Commercialization**
- Origin pull: NRL/Navy; JCO, Army FS-LIDS/M-LIDS, SOCOM, DHS, FMS
- Sensor-into-prime + direct node sales; hardware + AI-classifier subscription
- TAM [~$3B→~$12B by 2032]; SAM [~$500M/yr]; SOM [~$20M/yr at maturity]
- Field-of-use license + stacked NILOC foreground IP (SBIR data rights)

**④ Program, Cost & Schedule**
- Phase II: **[24 months], [~$1.8M]**; **TRL [4]→[6]**
- 5 gated tasks: License/Model → Feed Prototype → Transceiver Integration → AI Classification → Field Demo
- Team: E. Wagner (PI/CEO) + [RF/antenna], [radar/DSP], [ML] engineers + NRL CRADA consultant
- Deliverables: PolarHawk TRL-6 prototype, government-witnessed demo, ICD + Phase III plan

---

*Honesty statement: The foundational aperture antenna is U.S.-Government-owned intellectual property invented at the Naval Research Laboratory and protected by U.S. Patent 11,828,868 B2. NILOC Technologies proposes to license this technology and develop follow-on capability; all performance figures in brackets are planning estimates to be confirmed by modeling, Phase I / feasibility results, and Phase II test data.*