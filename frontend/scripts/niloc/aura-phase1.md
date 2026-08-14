# AURA™ — Autonomous RF Understanding for Counter-UAS
### Maturing NSWC Crane's Multi-Modal Passive-RF Discrimination for Expeditionary Navy Forces
**DoD (Navy) SBIR Phase I Technical Volume**

- **Proposing firm:** NILOC Technologies — a small business; parent company of RFP Pipeline
- **Principal place of business:** Columbus, OH `[confirm]`
- **CAGE:** 8NLC7 · **UEI:** K9NLC7X2M4Q8 · **Primary NAICS:** 541715 (Research and Development in the Physical, Engineering, and Life Sciences)
- **Principal Investigator:** Eric Wagner, Founder & CEO
- **Solicitation / Topic:** Navy Counter-UAS SBIR topic `[topic number to confirm]`
- **Phase / type:** Phase I — Feasibility Study — 6-month base + 6-month option
- **Proposed base cost:** ≈ $150,000 `[confirm ceiling]`; option priced separately `[confirm]`
- **Foundational IP:** U.S. Patent **12,461,538**, invented at **NSWC Crane Division** and assigned to *the Secretary of the Navy* — to be **licensed** by NILOC

## Abstract

Small unmanned aircraft systems (sUAS) now threaten expeditionary Navy and Marine Corps forces at a cost and scale that active-radar defenses cannot economically match, and they increasingly co-mingle friendly, commercial, and adversary aircraft in the same airspace — making *discrimination*, not mere detection, the decisive problem. Researchers at NSWC Crane Division invented and demonstrated a multi-modal deep neural network that performs exactly this discrimination: it treats emitters as "objects" inside RF time–frequency imagery, applies object-detection CNNs to **passive** RF signatures, and fuses that channel with EO/IR, radar, and acoustic inputs to perform **per-drone friend-or-foe (FoF) discrimination across simultaneous drones at low C-SWaP** on an embedded NVIDIA Jetson TX2. That capability is protected by U.S. Patent 12,461,538, assigned to the Secretary of the Navy. NILOC Technologies proposes to **license this Government-developed intellectual property** — field-of-use / co-exclusive, honoring Bayh-Dole and Government-purpose rights — and to mature it toward the field. **NILOC did not invent the core capability; our contribution is disciplined last-mile engineering.** Phase I is a feasibility study, not development. It will re-host the pipeline to modern edge hardware (NVIDIA Jetson Orin), stand up a repeatable evaluation harness against an expanded and current threat library, and characterize the three behaviors that most gate operational value: simultaneous-emitter (swarm) discrimination, graceful degradation under denied or spoofed modalities, and cooperative allow-listing of friendly emitters. We will deliver measured baselines, a bench feasibility demonstration, and a risk-retired Phase II maturation and transition plan.

## 1. Identification and Significance of the Problem or Opportunity

**The threat.** Group 1–3 UAS — from hobby quadcopters to purpose-built strike and ISR platforms — have become the defining tactical air threat of the decade. They are cheap, numerous, easy to modify, and increasingly employed in coordinated groups. Recent conflicts have shown that a handful of aircraft costing a few thousand dollars each can hold high-value assets at risk, saturate point defenses, and force expensive munitions to be spent on inexpensive targets. For naval and expeditionary forces the exposure is acute: ships in the littorals, amphibious landing forces, expeditionary airfields, forward logistics nodes, and Expeditionary Advanced Base Operations (EABO) sites all present fixed or slow-moving high-value targets to a low-cost aerial threat.

**Detection is not the hard part — discrimination is.** Modern airspace over a naval expeditionary site is crowded with friendly ISR drones, allied and commercial aircraft, and adversary systems, often simultaneously and often in the same RF bands. A sensor that merely flags "a drone is present" creates alert fatigue and courts fratricide. The operationally decisive capability is **per-aircraft friend-or-foe discrimination across multiple simultaneous emitters** — knowing not just *that* drones are present, but *which* are hostile, *which* are friendly, and *how many* — fast enough to cue a response.

**Why passive and low-C-SWaP matter to the Navy.** Active radar emits, and emission is a liability: it violates emissions control (EMCON) discipline, reveals the defender's position, invites anti-radiation targeting and jamming, and is power-hungry — a poor fit for man-portable, vessel-mounted, or distributed expeditionary use. **Passive RF sensing** is covert, low-power, and exploits the signals the threat already radiates: command-and-control uplinks and video downlinks in the common ISM and control bands. Pairing passive RF with a low size, weight, and power (C-SWaP) edge-compute footprint enables the distributed, silent, battery- or vehicle-powered sensing that expeditionary and maritime forces actually need.

**The gap between "proven" and "fielded."** The Government has already retired the hardest scientific risk. NSWC Crane invented and demonstrated the multi-modal DNN described above (Patent 12,461,538) — a genuine capability, not a concept. What stands between that demonstration and a fielded system is **engineering maturation**: the demonstrator runs on 2017-era Jetson TX2 hardware; the threat library ages as new airframes and control protocols proliferate; swarm, denied-modality, and cooperative-IFF behaviors need to be characterized and hardened; and there is no C2 integration path. These are precisely the tractable, de-riskable problems a Phase I feasibility study should address.

**The opportunity.** NILOC's business is to license federally-developed technology and mature it into fielded products. This effort is the archetype: a Navy-origin, patent-protected core, licensed by NILOC and matured through the last mile of engineering — the fastest credible path from a Government demonstrator to a transition-ready expeditionary C-UAS capability.

## 2. Phase I Technical Objectives

Phase I answers concrete feasibility questions. Each objective pairs a question with a measurable feasibility criterion; none presumes a fielded product.

1. **TO-1 — Re-host feasibility (edge hardware).** *Can the Government pipeline (or its passive-RF core) be re-hosted from Jetson TX2 to NVIDIA Jetson Orin and run within a defined latency and power budget?* Orin platforms offer a generational leap in AI throughput over TX2 (published ratings up to `[~275 TOPS]` on AGX-class parts), creating headroom for larger models, more modalities, or lower power. *Criterion:* functional inference on Orin against reference data, with measured latency, throughput, and power against planning targets of `[≤ 100 ms per frame]` and `[≤ 30 W]` `[planning estimates]`.
2. **TO-2 — Classification on a modern, expanded library.** *Can we curate a current, expanded RF-signature threat library and establish repeatable baseline discrimination performance on it?* *Criterion:* a versioned dataset manifest and an automated evaluation harness that reports FoF accuracy, per-class precision/recall, and confusion structure — measured, not asserted.
3. **TO-3 — Simultaneous-emitter (swarm) behavior.** *How does per-drone discrimination degrade as the number of concurrent emitters rises?* *Criterion:* a characterized degradation curve identifying the onset of failure as a function of emitter count, overlapping bandwidth, and SNR.
4. **TO-4 — Denied / spoofed-modality robustness.** *How gracefully does the fused system behave when a modality is degraded or absent — an RF-silent (fiber-optic or fully autonomous) drone, EO obscured by night or weather, acoustics masked by ambient noise?* *Criterion:* quantified accuracy under single- and multi-modality denial versus the full-fusion baseline, plus a defined fusion fallback policy.
5. **TO-5 — Cooperative allow-listing (friendly-emitter IFF) feasibility.** *Can known-friendly emitters be allow-listed into the discrimination pipeline to suppress friendly-fire flags without opening a spoofing gap?* *Criterion:* a feasibility assessment and bench trial of an allow-list mechanism with a first-order spoof-resistance analysis.
6. **TO-6 (option) — C2 integration feasibility.** *Can AURA emit standards-compliant tracks/alerts to tactical C2?* *Criterion:* demonstrated feasibility of Cursor-on-Target (CoT) / TAK output on the bench.

## 3. Phase I Statement of Work

Phase I delivers analysis, measured baselines, and a **bench/lab feasibility demonstration — explicitly not a fielded or ruggedized product.** All work uses the licensed Government IP; no core algorithm is reinvented.

**Base period (Months 1–6)**

1. **Task 1 — IP License & Technology Transfer (M1–M2).** Execute the Patent License Agreement / CRADA with NSWC Crane's technology-transfer office (via its ORTA / TechLink), receive Government artifacts (model, weights, documentation) `[availability to confirm]`, and stand up the secure development environment.
2. **Task 2 — Re-host to Orin & Reference Baseline (M1–M3).** Port the pipeline to Jetson Orin; reproduce Government-demonstrated behavior on reference data; instrument latency, throughput, and power (TO-1).
3. **Task 3 — Threat-Library Curation & Evaluation Harness (M2–M4).** Assemble an expanded, current signature library; build an automated, versioned evaluation harness; establish baseline discrimination metrics (TO-2).
4. **Task 4 — Swarm & Denied-Modality Characterization (M3–M5).** Run controlled experiments to characterize simultaneous-emitter degradation and denied/spoofed-modality robustness; define the fusion fallback (TO-3, TO-4).
5. **Task 5 — Feasibility Analysis, Bench Demo & Phase II Plan (M5–M6).** Consolidate findings, run the bench feasibility demonstration, retire/quantify residual risk, and author the Phase II maturation and transition plan.

**Option period (Months 7–12)** — exercised on a favorable base-period go/no-go.

6. **Task 6 — Cooperative Allow-Listing / IFF Feasibility Prototype (M7–M9)** (TO-5).
7. **Task 7 — TAK / CoT C2-Integration Feasibility (M8–M10)** (TO-6).
8. **Task 8 — Field-Representative Data Collection & Hardening Study (M9–M11).** Lab/range collection `[range access to confirm]`; environmental and EW-robustness study.
9. **Task 9 — Refined Transition Plan & Extended Demonstration (M11–M12).**

| Month | Milestone | Deliverable |
|---|---|---|
| M1 | Project kickoff; T2/license pathway initiated | Kickoff brief; Project Management Plan |
| M2 | License/CRADA executed; artifacts received `[confirm]` | Technology-transfer memo |
| M3 | Orin re-host running on reference data | Interim Technical Report #1; re-host demo capture |
| M4 | Evaluation harness + baseline metrics established | Baseline Metrics Report; threat-library manifest |
| M5 | Swarm & denied-modality characterization complete | Characterization Report |
| M6 | **Bench feasibility demo; go/no-go** | Final Phase I Report; Phase II Plan |
| M9 (opt) | Allow-listing + TAK feasibility shown | Interim Technical Report #2 |
| M12 (opt) | Extended demo; refined transition plan | Final Option Report |

Recurring deliverables: monthly progress reports and an SBIR-compliant final report. All performance figures above are `[planning estimates]` to be *measured* in Phase I, not claimed in advance.

## 4. Related Work

**The NSWC Crane foundation (stated plainly).** The core of AURA is not NILOC's invention. Government researchers at NSWC Crane Division conceived, built, and demonstrated the multi-modal deep neural network at issue: passive RF-signature analysis via object-detection CNNs applied to time–frequency (spectrogram) imagery — where each emitter is localized and classified as an "object" — fused with EO/IR, radar, and acoustic modalities to perform per-drone friend-or-foe discrimination across simultaneous drones at low C-SWaP on a Jetson TX2. This work is protected by U.S. Patent 12,461,538, assigned to the Secretary of the Navy. NILOC's role is to **license** that IP and perform maturation engineering; credit for the invention belongs to the Government.

**Adjacent state of the art.** The approach sits at the confluence of three active fields: (a) deep-learning RF/emitter classification, in which spectrograms are treated as images and modern detectors localize and label signals; (b) multi-sensor data fusion for C-UAS, combining RF, radar, EO/IR, and acoustics to overcome any single sensor's blind spots; and (c) the commercial C-UAS market, where passive-RF direction-finding and protocol-decode systems are fielded but generally emphasize *detection and geolocation* over robust *per-aircraft FoF discrimination in dense, multi-emitter airspace*. Published work and fielded systems each address pieces of the problem. **NILOC's differentiated contribution is last-mile engineering on a proven Navy core:** modern edge re-host, a current threat library, characterized swarm and denied-modality behavior, cooperative allow-listing, and a C2 integration path — the steps that convert a Government demonstrator into a transition-ready capability.

## 5. Relationship with Future Research / R&D

Phase I retires feasibility risk; Phase II matures the capability toward the field, and Phase III transitions it.

**Phase II (maturation).** Building on measured Phase I baselines, Phase II would: expand and field-collect the threat library; harden the models against realistic clutter, multipath, and electronic-attack conditions; build a ruggedized low-C-SWaP prototype for expeditionary use; complete cooperative-IFF and full TAK/C2 integration; and conduct instrumented test events with a Navy or Joint end user. The objective is to advance maturity from an estimated `[TRL 4]` at the close of the Government demonstration to a `[TRL 6]` prototype validated in a relevant environment `[TRL assessments are planning estimates]`. Cyber-hardening and a documented spoof-resistance posture for the allow-list mechanism would be first-class Phase II work products.

**Phase III (transition).** The natural transition path is to Navy and Joint expeditionary base-defense and force-protection programs, with the licensed Government-purpose rights honored throughout. NILOC's operating experience building and fielding software products (as parent of RFP Pipeline) supports the productization, sustainment, and configuration-management discipline a Program of Record requires. Alignment with the Joint Counter-small UAS Office (JCO) and relevant Navy/Marine Corps sponsors `[sponsors to confirm]` would guide requirements and test venues.

## 6. Commercialization / Transition Potential

**Defense transition.** The primary market is DoD C-UAS: Navy expeditionary and shipboard layered air defense, Marine Corps installation, EABO, and forward-arming-and-refueling-point protection, and Joint base defense. Passive, low-C-SWaP, distributed sensing is attractive precisely where EMCON, power, and mobility constraints make active radar impractical. Because the core is Navy-origin IP transitioned under Government-purpose rights, the pathway back into Navy programs is direct rather than adversarial. Specific transition sponsors and Programs of Record are `[to be identified/confirm]`.

**Dual-use commercial.** The same discrimination-first, passive-RF capability addresses a large and growing civil counter-drone market `[market-size figures to be substantiated; treat as bracketed estimate]`: airport and airspace-safety authorities managing drone incursions; stadiums and mass-gathering venues; critical infrastructure (power generation and transmission, refineries, water, data centers); correctional facilities defeating contraband delivery; and event and executive-protection security. Passive operation is a decisive civil advantage — it avoids the spectrum-emission licensing and interference concerns that constrain active-radar deployment at fixed civil sites, and its low C-SWaP suits distributed, always-on installation.

**Business model and posture.** NILOC's model is to license federally-developed technology and mature it into fielded products; AURA is the flagship instance. The commercialization sequence is deliberate: license the Government IP → mature and validate → productize a C-SWaP edge appliance with a maintained threat library and C2 integration → sell into defense (via transition) and regulated civil markets (via a subscription-maintained library and support model). Market tailwinds — sUAS proliferation, evolving FAA Remote ID and counter-UAS authorities, and rising infrastructure-protection demand — support durable, recurring revenue beyond the initial platform sale.

## 7. Key Personnel

**Eric Wagner — Founder & CEO; Principal Investigator.** Mr. Wagner will serve as PI, holding overall technical and programmatic responsibility: license/technology-transfer execution with NSWC Crane, experimental design and feasibility adjudication, Government reporting, and the Phase II transition plan. As founder of NILOC and its RFP Pipeline product, he brings direct experience building, shipping, and operating production software systems — the productization and program-discipline backbone this maturation effort requires. Proposed PI commitment is `[__% level of effort — confirm]`, meeting the SBIR minimum for the PI's primary employment with the small business `[confirm]`.

**Additional roles (to be named/confirmed).** The Phase I team will be completed by:
- **RF/Machine-Learning Technical Lead** — `[Name — confirm]`; owns the Orin re-host, evaluation harness, and discrimination-performance analysis.
- **Embedded / Edge-Systems Engineer** — `[Name — confirm]`; owns C-SWaP integration, latency/power instrumentation, and the bench demonstrator.
- **C-UAS / EW Subject-Matter Advisor** — `[Name — confirm]`; ideally a former Navy or Joint C-UAS practitioner, advising on threat realism, CONOPS, and transition.
- **Government IP / Technology-Transfer Liaison** — `[Name/role — confirm]`; supports the license/CRADA with NSWC Crane's ORTA and TechLink.

Facilities, equipment (Jetson Orin development kits, RF collection/instrumentation, and any range or anechoic access), and specific consultant agreements are `[to confirm]`. The effort's foundation is the licensed Government IP; NILOC's added value is the disciplined engineering team that carries it the last mile to the field.
