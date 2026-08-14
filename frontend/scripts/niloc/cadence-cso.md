# CADENCE™ — Turning the ISR Data Deluge into Decision Advantage

**A Commercial Solutions Opening (CSO) solution brief from NILOC Technologies**

**Submitted by:** NILOC Technologies — small business and non-traditional defense contractor
**Location:** Columbus, OH [confirm]
**CAGE:** 8NLC7 · **UEI:** K9NLC7X2M4Q8 · **NAICS:** 541715
**Principal contact / technical lead:** Eric Wagner, Founder & CEO
**Solicitation:** [CSO reference — DIU / AFWERX / component CSO] [confirm]
**Date:** 13 August 2026

> **In one line:** CADENCE productizes the U.S. Air Force's *patented* Pattern-of-Life normalcy analytic (the "POLE Machine") into a deployable, explainable, ATO-ready anomaly-detection capability for activity-based intelligence — licensing proven Government IP so the warfighter fields it in months, not years.

---

## 1. Operational Problem / Mission Need

Collection has outrun cognition. EO/IR, Wide-Area Motion Imagery (WAMI), full-motion video (FMV), and GPS/GMTI sensors now generate far more pixels and tracks per hour than the analyst enterprise can exploit — and the gap widens with every new platform. Analysts triage a firehose by hand; the overwhelming majority of collected data is never examined by a human, and the fraction that is gets a glance, not an analysis.

The deeper gap is **activity-based intelligence (ABI)**. Modern targets hide in *behavior*, not just in objects. Detecting *what is unusual* — an entity, place, or pattern deviating from its own established norm — is still largely done in analysts' heads rather than by a model that runs continuously against every incoming feed. The operational cost is concrete:

- **Missed indicators** buried in un-triaged collection.
- **Alert fatigue** from brittle, uncalibrated rules that cry wolf.
- **Slow tip-and-cue**, lengthening find → fix → track timelines.
- **No institutional memory** — normalcy walks out the door when an experienced analyst rotates.

The mission need is a system that *learns normalcy* from multi-INT data and *surfaces the anomalies that matter* — at machine speed, with explanations an analyst can trust and act on.

## 2. Proposed Solution & Outcomes

**CADENCE™ (Continuous Anomaly Detection & Entity Normalcy Engine)** is a continuously-running normalcy engine that models expected behavior across entities and areas and flags meaningful deviations for the analyst. What the Government **gets**:

- **A always-on normalcy model** that learns "what normal looks like" per entity/area and detects departures from it — turning ABI from an aspiration into a running service.
- **Multi-modal fusion** across EO/IR, WAMI, FMV tracks, GPS/GMTI kinematics, and categorical/numeric attributes — one behavioral picture from many sensors.
- **Calibrated, explainable alerts** — every anomaly ships with its *why*: which detector fired, which features drove it, and a confidence the analyst can actually rely on.
- **A human-in-the-loop workflow** that *reduces* analyst load — ranked queues, one-click adjudication, and feedback that makes the model smarter over time.
- **ATO-ready IL4/IL5 deployment** — containerized for the enterprise or the tactical edge.

**Outcomes for the mission:** faster detection of anomalous activity, fewer missed indicators, lower analyst cognitive load, and an auditable decision trail — compressing sensor-to-decision timelines and returning analyst attention to judgment instead of triage.

## 3. Technical Approach

**The licensed normalcy core.** CADENCE is built on the Air Force's **POLE Machine (Pattern-of-Life Estimation)**, developed at the **AFRL Information Directorate (Rome, NY)** and protected by **U.S. Patent 11,308,384 B1, "Method and framework for pattern of life analysis."** This is not a re-implementation of a paper — it is Government-owned intellectual property that NILOC will **license through AFRL-RI technology transfer / TechLink** and build upon directly. Its strength is a **normalcy model with three complementary detectors** working in concert:

- **Statistical** — flags distributional deviations from an entity's established baseline.
- **Spatial** — flags location and movement that don't fit the expected geography of behavior.
- **Categorical** — flags improbable combinations of categorical/numeric attributes.

Because the detectors are complementary, an anomaly caught by any one is surfaced, while agreement across detectors raises confidence — a design that is inherently more robust *and* more explainable than a single black-box score.

**NILOC's productization — the last mile from lab to fielded capability:**

1. **Modern ML** — augment the interpretable detector ensemble with current model architectures, embeddings, and feature stores where they add measurable lift, keeping the explainable core as the backbone.
2. **MLOps sustainment** — CI/CD for models, drift monitoring, versioned retraining pipelines, and rollback — so the capability *stays* accurate after fielding, not just at demo day.
3. **Calibration & explainability** — per-alert confidence calibration and feature attribution, so analysts get trustworthy, defensible alerts.
4. **Human-in-the-loop workflow** — triage queues, adjudication UI, and active-learning feedback capture.
5. **Secure deployment** — containerized, standards-based ingest, IL4/IL5, ATO-ready, edge-to-enterprise.

The division of labor is deliberate: **the Government's proven science stays the analytic core; NILOC delivers the engineering, sustainment, and user experience that make it operational.**

## 4. Demonstrated Maturity

CADENCE begins from a **decisive head start**, not a whiteboard. The analytic core is **patented, Government-owned, and matured through development and evaluation in AFRL Information Directorate laboratories** — the hard research risk has already been retired by the inventing organization.

- **Maturity today:** approximately **[TRL 5–6 [confirm]]** — validated/demonstrated in a relevant (laboratory) environment.
- **Prototype target:** **[TRL 7 [confirm]]** — demonstrated in an operational/representative environment on Government-representative data.

Licensing this IP **de-risks, accelerates, and lowers the cost** of the effort in one move:

- **Technical risk is retired up front** — the anomaly-detection science is proven and peer-reviewed, and the method is patented.
- **Schedule collapses** — NILOC starts from a working analytic core and spends the period of performance on integration, hardening, and UX, not fundamental research.
- **Cost is lower and the return compounds** — the Government funds productization of an asset it already owns, then reuses that investment across missions.

This is the CSO thesis in practice: a *commercial* maturation path applied to a *proven* Government technology, delivering a fielded capability far faster than a clean-sheet development.

## 5. Schedule & Rough Order of Magnitude

An **Other Transaction (OT) prototype** under the CSO, structured for a **non-competitive follow-on production OT** upon successful completion (see §7). All figures below are **[bracketed] planning estimates** for refinement during agreement negotiation.

| Phase | Window | Key outputs |
|---|---|---|
| **0 — Mobilization & licensing** | **[Months 0–2]** | Execute AFRL-RI/TechLink license; stand up IL4/IL5 dev enclave; data access & use agreements |
| **1 — Core integration** | **[Months 2–6]** | Instantiate POLE detectors on Government-representative data; multi-modal fusion pipeline; MLOps scaffolding |
| **2 — Productization** | **[Months 6–10]** | Calibration, explainability, human-in-the-loop workflow, analyst UI |
| **3 — Operational prototype & ATO package** | **[Months 10–14]** | Demonstrate in representative/operational environment; assemble ATO artifacts; transition plan |

- **Prototype period of performance:** **[~12–14 months]**.
- **Prototype ROM (firm planning estimate):** **[$1.8M–$3.4M]**, milestone-funded.
- **Follow-on production:** priced at prototype completion; executed as a follow-on production OT under **10 U.S.C. § 4022(f)** — no re-competition required.

## 6. Team & Past Performance

**Eric Wagner, Founder & CEO,** leads the effort as principal investigator and technical lead, owning the licensing relationship with AFRL-RI/TechLink and the productization roadmap. NILOC will augment the core team with cleared ML, MLOps, and geospatial/ISR specialists and subject-matter advisors as the prototype scopes [confirm].

**Proof of AI-native execution — RFP Pipeline.** NILOC is the parent company of **RFP Pipeline**, a production, multi-tenant, AI-native SaaS platform that helps organizations discover, score, and draft responses to Government opportunities. It is directly relevant past performance for CADENCE because it demonstrates, in a *shipping* product, exactly the disciplines this prototype demands:

- **Operating ML in production** — drafting, scoring, and review models under real users, with the MLOps to sustain them.
- **Multi-tenant security and data isolation** — row-level isolation and least-privilege access, the same rigor an IL4/IL5 multi-mission deployment requires.
- **Fast, disciplined delivery** — a small team shipping a complex, audited AI system end to end.

**Non-traditional defense contractor.** NILOC qualifies as a **non-traditional defense contractor [confirm]** and as a small business — the exact profile CSOs and OT prototype authorities are designed to reach. NILOC's model is purpose-built for this pathway: **license federally-developed technology and mature it into fielded capability**, keeping Government science Government-owned while adding commercial-grade engineering.

*(Consistent with the honesty of this brief, NILOC claims no prior DoD contract performance and cites no named teaming partners here; RFP Pipeline is offered as commercial past performance and proof of execution.)*

## 7. Transition & Commercialization / Dual-Use

**Transition path.** The CSO prototype is structured from day one to transition without a capability gap: **prototype OT → follow-on production OT (10 U.S.C. § 4022(f)) → integration with existing PED/ISR exploitation architectures** as a service the enterprise consumes. NILOC's non-traditional participation is the statutory enabler for both the OT prototype and the streamlined production follow-on — a clean, low-friction route from demonstration to sustained fielding. The IL4/IL5, ATO-ready packaging means transition is an *authorization and scaling* exercise, not a re-engineering one.

**Dual-use and commercialization.** Multi-modal normalcy and anomaly detection is a broad commercial capability. The same engine that flags anomalous activity for the warfighter applies to **critical-infrastructure monitoring, maritime domain awareness, port/border security, commercial geospatial analytics, and behavioral/fraud analytics.** A commercial product line sustains the roadmap, spreads sustainment cost across markets, and continually returns hardening and features back to the Government deployment — **lowering total cost of ownership** on the DoD side.

**Alignment of interests.** Government IP remains Government-owned; NILOC's commercial value-add is the productization, MLOps, and user experience layered on top. The Government funds the maturation of an asset it already holds, gains a fielded ABI capability in a single OT period of performance, and shares in a product that keeps improving long after the prototype closes.

**CADENCE takes proven, patented Air Force science off the lab bench and puts it on the analyst's screen — faster, cheaper, and lower-risk than building it new, exactly as the CSO pathway intends.**
