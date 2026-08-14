# PolarHawk™: A Low-SWaP Compact-Polarimetric Radar for Detecting and Classifying Small Drones in the National Airspace

**Company:** NILOC Technologies (small business) · Columbus, OH [confirm] · CAGE 8NLC7 · UEI K9NLC7X2M4Q8 · NAICS 541715
**Technical Lead:** Eric Wagner, Founder & CEO
**NSF SBIR/STTR Project Pitch — America's Seed Fund**

## 1. The Technology Innovation

PolarHawk™ is a compact, low-cost radar sensor that detects *and classifies* small unmanned aircraft systems (sUAS) — telling a drone apart from a bird, from rain, from ground clutter — at a size, weight, power, and cost (SWaP-C) low enough to deploy densely around airports, stadiums, and critical infrastructure.

Its core is a **compact-polarimetric monopulse aperture antenna**: U.S. Government intellectual property invented at the **U.S. Naval Research Laboratory (NRL)** and protected by **U.S. Patent 11,828,868 B2**. NILOC will license this Government IP through the NRL Office of Technology Transfer [confirm license status] and mature it into a fielded sensor.

The innovation unites two ideas in one small aperture:

- **Compact polarimetry** — transmit circular polarization, coherently receive two orthogonal linear polarizations (H and V). With a *single* transmitter and a small aperture, this hybrid-polarity architecture recovers a target's polarimetric scattering signature — information conventionally obtainable only from large, expensive full quad-polarimetric radars.
- **Monopulse angle estimation** — precise single-pulse angle-of-arrival for accurate tracking.

**Why this is disruptive.** Every incumbent counter-drone sensor forces a bad trade. Passive RF detection is blind to autonomous drones that never transmit. EO/IR is line-of-sight and weather-limited. Conventional radar sees small, slow, low-flying drones poorly and — decisively — cannot reliably separate a drone from a bird, burying operators in false alarms. Full-polarimetric radars *can* discriminate, but are too large, costly, and power-hungry to blanket a runway perimeter or a stadium. PolarHawk moves classification-grade polarimetric discrimination into a small, low-power, low-cost aperture — enabling the deployment density that civil airspace protection actually requires.

**The technical risk NSF R&D would retire.** Compact polarimetry trades information relative to full quad-pol. It is an open research question *how much* target discrimination survives at the low-SWaP/low-cost operating point — reduced aperture, limited SNR, and the calibration imperfections of an inexpensive RF front end — and which feature-extraction and machine-learning methods best exploit what remains. This is high-risk and, if it holds, transformative: it would make polarimetric classification a commodity capability rather than a high-end luxury.

## 2. The Technical Objectives and Challenges

Phase I is a feasibility study establishing whether compact-pol classification holds up at deployable SWaP-C. All quantitative targets below are planning estimates to be fixed in Phase I.

1. **Signature characterization.** Assemble a compact-polarimetric scattering dataset — through modeling and measurement — across representative sUAS classes, birds, and clutter; quantify feature separability.
2. **Feature extraction & classification.** Develop and benchmark hybrid-polarity feature sets (Stokes parameters, degree/angle of polarization, m-δ and m-χ decompositions) with a classifier; target [≥90%] correct drone-vs-clutter classification at a [≤X%] false-alarm rate [confirm targets].
3. **Low-SWaP sensitivity & calibration.** Quantify how aperture reduction, SNR, and low-cost front-end calibration error degrade discrimination; produce the SWaP-C-versus-performance trade curve.
4. **System feasibility.** From the trade study, define a Phase II sensor architecture and range budget; target [< X kg, < Y W] and [Z m] detection range against a [Group 1] drone [confirm].

**Key unknowns and risks:**

- How much polarimetric discrimination survives at the low-cost operating point versus full quad-pol.
- Whether a low-cost dual-linear receive chain can be calibrated stably enough to preserve the classification margin.
- Whether the classifier generalizes across drone types, aspect angles, and environments (rain, urban multipath, mixed bird traffic).
- The honest null hypothesis — whether compact-pol features add enough over kinematic/micro-Doppler cues to justify the architecture. Phase I is designed to *test*, not assume, this.

## 3. The Market Opportunity

**The problem — civil first.** Cheap, capable drones have opened a national-airspace security gap. Runway-incursion events have halted operations at major airports; stadiums and mass gatherings, energy and data-center sites, correctional facilities, and public-safety agencies all need drone detection that is affordable *and* trustworthy — that does not swamp operators with false alarms. Expanding U.S. counter-UAS authorities and airspace-integration rulemaking are pulling this market from federal-only toward broad civil deployment [confirm regulatory specifics].

**Why now.** Incidents and beyond-visual-line-of-sight drone traffic are rising, but incumbent sensors are either too costly and bulky to blanket a perimeter or too false-alarm-prone to rely on. A low-SWaP-C, classification-grade radar uniquely enables the dense, layered coverage civil sites need.

**Market size (planning estimates — to be validated).** The global counter-UAS market is estimated at [~$X B by 20XX], with civil, critical-infrastructure, and airport segments the fastest-growing share [confirm sources]. NILOC's beachhead is [U.S. airports, stadiums, and critical-infrastructure sites], a serviceable market of [~$X] [confirm]. Every figure here is a bracketed planning estimate, not a measured result.

**Competition & moat.** Incumbents include established radar primes, specialist counter-UAS firms, and RF- and EO/IR-sensing vendors. PolarHawk's differentiation is polarimetric *classification* at a price and SWaP that make civil density feasible; the licensed NRL patent is a defensible technical moat.

**Dual-use adjacencies & broader impacts.** The same compact-pol aperture is a low-cost polarimetric sensor for (a) **weather and remote sensing** (precipitation typing, hydrometeor classification) and (b) **low-cost polarimetric perception for autonomy** (material and surface discrimination for autonomous vehicles and robotics). Defense counter-sUAS force protection is a secondary, adjacent market. Broader impacts include a safer national airspace as drone integration scales, protection of public gatherings and critical infrastructure, and democratizing polarimetric sensing beyond high-end platforms — anchored to an Ohio-based advanced-sensor engineering base [confirm].

## 4. The Company and Team

**NILOC Technologies** is a small business [Columbus, OH — confirm] (CAGE 8NLC7 · UEI K9NLC7X2M4Q8 · NAICS 541715) built on a clear model: **license federally-developed technology and mature it into fielded product.** Starting from proven Government science de-risks the venture and speeds transition — PolarHawk is the model's first program.

**Licensing basis, stated plainly.** The base aperture is U.S. Government IP invented at NRL and protected by U.S. Patent 11,828,868 B2. NILOC will secure a commercialization license through the NRL Office of Technology Transfer [confirm status: in negotiation / LOI / executed]. Under an STTR track, NILOC would pair with a qualifying research-institution partner [confirm]; the SBIR/STTR track will be set to fit the collaboration.

**Eric Wagner, Founder & CEO**, is the technical lead — accountable for technical direction, the NRL license, and commercialization strategy [background and credentials — confirm].

**Evidence of execution.** NILOC is the parent of **RFP Pipeline**, a multi-tenant SaaS platform — built and operating — that helps government contractors discover, score, and build federal proposals. It demonstrates that the team ships complex production software and is fluent in the federal contracting and transition ecosystem PolarHawk must navigate.

**Team build-out.** NILOC is engaging radar/polarimetry and RF-hardware expertise — advisors and/or the NRL inventors — to complement its systems-engineering and commercialization strength [confirm]. Phase I validates the science; Phase II builds and fields the sensor.
