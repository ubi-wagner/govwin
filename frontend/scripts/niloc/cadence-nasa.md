# CADENCE-ISHM™ — A Learned Multi-Modal Normalcy Model for Autonomous Spacecraft Health Management

**NASA SBIR Phase I — Technical Volume**

| | |
|---|---|
| **Proposing Firm** | NILOC Technologies (small business; parent of RFP Pipeline) |
| **Location** | Columbus, Ohio [confirm] |
| **Identifiers** | CAGE 8NLC7 · UEI K9NLC7X2M4Q8 · NAICS 541715 (R&D in the Physical, Engineering & Life Sciences) |
| **Principal Investigator** | Eric Wagner, Founder & CEO |
| **Program / Subtopic** | NASA SBIR Phase I · Focus area: Autonomous Systems & Operations / ISHM · Subtopic no. [confirm] |
| **Period / Value** | 6 months · Firm-fixed-price ≈ $150,000 [confirm current NASA SBIR Phase I ceiling] |
| **Core technology** | CADENCE-ISHM™, built on the U.S. Air Force **POLE Machine** normalcy framework (AFRL Information Directorate, Rome, NY; **U.S. Patent 11,308,384 B1**), to be licensed by NILOC via AFRL-RI tech transfer / TechLink |

> **Technical abstract.** Deep-space and long-duration missions increasingly must detect and respond to off-nominal behavior *onboard*, because light-time delay and sparse ground contact make ground-in-the-loop fault response impractical. CADENCE-ISHM matures a validated Air Force normalcy framework — the AFRL POLE Machine — for spacecraft Integrated System Health Management. It learns a per-vehicle model of "normal" spanning three data modalities (continuous telemetry, relational/spatial channel structure, and discrete states/event logs) and applies three complementary detectors (statistical, spatial, categorical) to flag deviations early. **The analytic core is reframed for the space domain by NILOC, not invented by it.** Phase I establishes feasibility on representative/simulated telemetry — not flight software. All quantitative targets in this volume are planning estimates and no NASA-referenced performance is claimed.

---

## 1. Identification and Significance of the Innovation

NASA's mission set is moving faster than its capacity to supervise it. Deep-space SmallSats, planetary landers, cislunar-and-beyond infrastructure, and long-duration crewed transit all operate where one-way light-time (roughly 3–22 minutes each way to Mars, depending on geometry) and gaps between Deep Space Network passes make real-time ground diagnosis impossible. Crew attention is scarce and expensive; ground-operator attention does not scale across growing fleets. Vehicles must increasingly recognize *for themselves* when they are drifting off-nominal.

Today's caution-and-warning and fault-management (FM) systems lean heavily on hand-authored redlines, fault trees, and expert-built diagnostic models. These are labor-intensive to build and maintain, brittle to un-anticipated failure modes, and — critically — usually treat the three natural kinds of spacecraft data in separate stovepipes: continuous sensor channels (temperatures, voltages, rates), the *relational* structure among correlated or co-located channels (power/thermal balances, attitude-vs-actuator geometry), and *discrete* streams (mode transitions, command receipts, event/error logs). Data-driven anomaly detectors that have reached spaceflight typically model continuous channels well while under-serving discrete/event data and cross-channel structure. **That is the ISHM gap: there is no single, learned model of "normal" that spans all three modalities and requires no exhaustive a priori enumeration of failures.**

**The innovation.** CADENCE-ISHM adapts the AFRL **POLE Machine** — a normalcy framework that learns a *multi-modal normalcy model* and applies **three complementary detectors** (statistical for distributional deviation, spatial for relational/joint-structure deviation, categorical for discrete-state and event deviation) — to spacecraft ISHM. It learns per-vehicle normalcy directly from telemetry, subsystem states, and event logs, then flags off-nominal behavior early enough to feed autonomous FM and comm-limited operations. Because it learns "normal" rather than enumerating faults, it can surface novel precursors that a fault-tree never anticipated, while its three-detector decomposition makes each alert *characterizable* (which modality departed) rather than a single opaque score.

**Honest provenance.** The analytic core is **reframed, not invented, by NILOC.** It was developed at the AFRL Information Directorate (Rome, NY) and is protected by U.S. Patent 11,308,384 B1. NILOC's contribution — and the substance of this Phase I — is the *domain reframing and maturation*: mapping the framework's modalities from their native (pattern-of-life / ISR-style) domain [confirm] onto heterogeneous spacecraft telemetry, designing normalcy features for subsystem health, validating feasibility on representative space data, and defining the NASA infusion path. NILOC's business model is precisely this: license federally developed, patent-protected technology and mature it for a new mission. A cross-agency (DoD → NASA) transfer of a *validated* framework de-risks the science relative to inventing from scratch.

## 2. NASA Relevance and Applications

**Directorate fit.** CADENCE-ISHM is a crosscutting autonomy capability, best seated in the **Space Technology Mission Directorate (STMD)** as the developer, with infusion targets across the **Science Mission Directorate** (deep-space SmallSats, planetary landers) and **Exploration Systems Development / Space Operations** (Gateway, crewed-vehicle caution & warning) [confirm]. It maps to NASA's Autonomous Systems & Operations / ISHM thrust and, in the technology taxonomy, to **TX10 (Autonomous Systems)** and **TX02 (Flight Computing & Avionics)** for onboard deployment, with fault-management/ISHM crosscut [confirm mapping]. The precise solicitation subtopic is [confirm].

**Why it fits NASA specifically.** The framework's defining property — a *single learned normalcy model across continuous, relational, and discrete data* — matches the actual heterogeneity of spacecraft telemetry, and its dual-deployability (the same model runs onboard for autonomy *and* ground-side for operator support) matches NASA's real operating reality of intermittent ground contact.

**Representative applications:**

- **Deep-space SmallSats / CubeSats** with thin ground contact — onboard normalcy monitoring that protects the vehicle between DSN passes.
- **Planetary landers and rovers** — surface- and descent-phase health monitoring where light-time forbids ground intervention.
- **Gateway and crewed vehicles** — augmenting caution & warning with learned normalcy to reduce nuisance alarms and surface subtle precursors, easing crew and ground attention load.
- **Mission operations / ground segment** — the same model as operator decision support and fleet-wide trend detection.

Crucially, CADENCE-ISHM **complements, not replaces,** NASA's model-based FM heritage: learned normalcy provides broad, early, low-assumption *detection* that can trigger model-based *isolation and response* downstream.

## 3. Phase I Technical Objectives

Phase I answers whether the POLE Machine's normalcy framework can be faithfully and usefully reframed for spacecraft ISHM. Objectives are stated as feasibility questions.

| # | Objective (feasibility question) | Success criterion |
|---|---|---|
| **O1** | Can the multi-modal normalcy representation and its three detectors be mapped onto spacecraft telemetry, subsystem-state, and event-log data — including reframing "spatial" from its native geospatial meaning to spacecraft state-space/relational structure — without losing the three-detector decomposition? | A documented data model + normalcy-feature design for a representative subsystem, with each detector's role defined. |
| **O2** | Can a per-vehicle normalcy model be *learned* from representative/simulated telemetry that captures nominal behavior across operational modes? | A trained normalcy model with assessed mode coverage, data-volume needs, and training stability. |
| **O3** | Do the three detectors flag known/injected off-nominal events earlier and/or with fewer false alarms than a redline/threshold baseline on identical data? | Characterized detection latency and false-alarm behavior vs. baseline — reported as planning estimates [bracketed]; no performance claimed pre-demo. |
| **O4** | Is the learned model's runtime footprint plausibly compatible with representative flight/edge processors, with deterministic-enough inference for an FM context? | Compute/memory profile on flight-like hardware and an identified porting gap list [planning estimate]. |
| **O5** | Is the AFRL license path executable, and what is the credible Phase II maturation and NASA infusion target? | Confirmed license path [confirm] + a Phase II plan and named center/mission-class infusion target [confirm]. |

We estimate the framework at approximately TRL **[3–4]** in its native domain and TRL **[2]** for spacecraft ISHM today; a successful Phase I feasibility demo targets TRL **[3]** in the space domain [all TRL values are planning estimates].

## 4. Phase I Work Plan

Six months, sequenced so that the feasibility demonstration (T6) rests on results, not assertions. **The Phase I demo runs on representative and/or simulated telemetry; it is not flight software.**

| Task | Months | Objective | Activity |
|---|---|---|---|
| **T1 — License, data & requirements** | M1 | O5 | Execute/confirm AFRL license via TechLink [confirm]; select a representative telemetry corpus (candidate public NASA/space telemetry benchmarks and/or a GN&C/subsystem simulator) [confirm dataset]; scope subsystems and off-nominal scenarios. |
| **T2 — Modality mapping & normalcy design** | M1–M2 | O1 | Map continuous/relational/discrete data to the statistical/spatial/categorical detectors; design normalcy features and operational modes. |
| **T3 — Normalcy learning** | M2–M4 | O2 | Train the per-vehicle normalcy model; assess mode coverage, data needs, stability. |
| **T4 — Detection feasibility vs. baseline** | M3–M5 | O3 | Curate/inject off-nominal events; compare detectors to a redline baseline; characterize latency and false alarms [planning estimates]. |
| **T5 — Onboard-footprint assessment** | M4–M5 | O4 | Profile compute/memory on flight-like/edge hardware; list porting needs. |
| **T6 — Demo, Phase II plan & infusion** | M5–M6 | O5 | Integrated feasibility demo on the corpus; Phase II maturation plan; NASA infusion target; final report. |

**Milestones.** M-A (end M1): license confirmed [confirm], corpus & scenarios frozen, kickoff/requirements review. M-B (end M2): modality-mapping design review + normalcy-model spec. M-C (end M4): normalcy model trained + interim baseline-comparison results. M-D (end M5): onboard-footprint assessment complete. M-E (end M6): feasibility demo, final report, Phase II plan.

**Deliverables.** Monthly progress reports; normalcy-model specification; recorded feasibility demonstration on representative/simulated telemetry; a results memo (latency/false-alarm characterization, all as planning estimates); Phase II proposal with infusion plan; final report.

**Risks & mitigations.** *License timing* — mitigate via early TechLink engagement and, if needed, a licensable-terms letter with delay-tolerant scoping [confirm]. *Data representativeness* — use multiple public corpora plus a simulator to avoid single-dataset bias. *Onboard footprint* — Phase I assesses on ground/flight-like hardware; true flight porting is deliberately deferred to Phase II.

## 5. Related R&D

**The licensed base (stated plainly).** CADENCE-ISHM's analytic core is the AFRL **POLE Machine** normalcy framework (U.S. Patent 11,308,384 B1; AFRL Information Directorate, Rome, NY). It was developed by the U.S. Government and will be licensed by NILOC; NILOC reframes and matures it for space ISHM but did not invent it. Its demonstrated native domain is pattern-of-life / ISR-style analytics [confirm], and its *space-domain* validation is exactly the open question Phase I addresses.

**NILOC lineage.** NILOC operates the terrestrial **CADENCE** ISR-analytics line [confirm scope] and, as parent of RFP Pipeline, brings the productization and program-execution spine that turns licensed federal IP into a fielded offering.

**Adjacent ISHM state of the art (public prior art, honestly cited).**

- **NASA Ames Inductive Monitoring System (IMS)** — data-driven clustering of nominal telemetry (Iverson) — the closest philosophical neighbor; CADENCE-ISHM extends the "learn nominal" idea across three modalities rather than one.
- **Model-based diagnosis heritage** — Livingstone / Livingstone-2, flown in the Remote Agent Experiment on Deep Space 1 (1999); HyDE; TEAMS. CADENCE-ISHM *feeds* these rather than competing with them.
- **Deep-learning telemetry anomaly detection** — LSTM with nonparametric dynamic thresholding on spacecraft telemetry (e.g., JPL's Telemanom on SMAP/MSL, Hundman et al., 2018) — strong on continuous channels; weaker on discrete/relational structure.
- **Prognostics** — NASA Prognostics Center of Excellence (remaining-useful-life).

**Differentiation.** CADENCE-ISHM's distinctive claim is a *unified* multi-modal normalcy model — continuous *and* spatial/relational *and* categorical/event — with three complementary, individually interpretable detectors, deployable both onboard and on the ground. Point tools that specialize in a single modality do not provide this in one learned model.

## 6. Key Personnel

- **Eric Wagner — Founder & CEO; Principal Investigator.** Founder of NILOC Technologies and its RFP Pipeline platform; architect of NILOC's license-and-mature model. As PI, responsible for technical direction, AFRL license execution, evaluation design, and NASA infusion strategy. Bio specifics (degrees, prior program experience) [confirm]; PI time commitment to meet or exceed the NASA-required minimum [confirm].
- **[Name] — ISHM / Spacecraft Systems Lead** [TBD/confirm]: subsystem domain, telemetry semantics, and FM framing; to be staffed or subcontracted.
- **[Name] — ML / Detection Engineer** [TBD/confirm]: normalcy-model implementation, detector adaptation, and evaluation.
- **[Advisor] — Space-domain ISHM advisor** (former NASA/industry) [TBD/confirm].
- **AFRL Information Directorate** — technology source and licensor; potential tech-transfer/consulting support [confirm].

Space-domain specialist roles are intentionally listed as [confirm] rather than fabricated; NILOC will name and commit these personnel at award, consistent with NASA's PI-eligibility and effort rules.

## 7. Commercialization

**Primary path — NASA infusion.** CADENCE-ISHM targets onboard and ground ISHM for deep-space SmallSats, landers, and Gateway/crewed caution-&-warning, advancing Phase I feasibility → Phase II flight-representative maturation → Phase III infusion through a NASA center or mission prime [confirm targets]. The government-developed, patent-protected core lowers infusion and IP risk relative to a clean-sheet capability, and the DoD-origin heritage supports cross-agency credibility.

**Dual-use markets** (all sizing deferred as planning estimates [bracketed]; none fabricated):

1. **Terrestrial ISR / defense analytics via CADENCE** — the framework's native domain, providing near-term revenue and a continued AFRL relationship.
2. **Industrial equipment health / predictive maintenance** — the same multi-modal normalcy applied to rotating machinery, energy, and manufacturing telemetry.
3. **Commercial satellite operators / NewSpace constellations** — onboard + ground normalcy monitoring where per-vehicle expert modeling does not scale to large fleets.

**Business model.** License-and-mature: federal IP (AFRL license) matured into a productized ISHM offering, with SBIR data rights protecting NILOC's space-domain reframing and evaluation work. This aligns NASA's investment with a company whose core competency is exactly the disciplined maturation of validated federal technology — reducing the risk that a Phase I result stalls before it reaches a vehicle.
