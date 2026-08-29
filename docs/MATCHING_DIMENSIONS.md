# Matching dimensions for federal R&D — a model from first principles

**Why this exists.** Everything in `OPPORTUNITY_MATCHING.md` up to §8e extends the scoring function
that is there. This document asks the prior question: **what dimensions actually discriminate a fit
from a non-fit for a small R&D business, across the whole federal opportunity landscape?** — and then
maps back. Where the two disagree, this one is the target and that one is the migration path.

---

## 1 · Four questions, four operators — and the modelling error

A company does not ask "is this a match." It asks four questions that behave **completely
differently**, and the current model collapses all of them into one weighted average of
boolean-and-fraction signals.

| Question | Operator it needs | Wrong answer if you use a weighted average |
|---|---|---|
| **Can I bid at all?** | **hard gate** — exclude | a disqualifier costs ⅙ of the score and ranks fourth |
| **Do I do this work?** | **set overlap** | fine — this is the one the current model fits |
| **Can I execute it?** | **range overlap** | a $5M award and a $50K award are "different", not "0" |
| **Do I want it?** | **preference weight** | conflated with capability, so preference dilutes fit |

**That is the modelling error.** Not the matching algorithm, not the corpus — the assumption that one
weighted mean can express eligibility, capability, capacity and preference at once.

---

## 2 · The landscape — what a small R&D business is actually choosing among

| Type | Instrument | Eligibility shape | Typical TRL | Size / PoP |
|---|---|---|---|---|
| **SBIR Phase I** | contract *or* grant | SB only · >50% US individual-owned · <500 emp · PI primarily employed by SBC | 2–4 | $75–300K · 6–12 mo |
| **SBIR Phase II** | contract *or* grant | prior Phase I | 4–6 | $750K–2M · 24 mo |
| **Direct to Phase II** | contract | SB · must *evidence* Phase-I-equivalent feasibility | 4–6 | as Phase II |
| **SBIR Phase III** | any, sole-source-able | prior SBIR awardee, no SBIR funds | 6–9 | unbounded |
| **STTR (all phases)** | contract *or* grant | **RI partner ≥30% · SB ≥40%** · PI may sit at the RI | 2–5 | as SBIR |
| **BAA** | contract / coop agreement | often open to all; white paper → full proposal | 1–6 | wide |
| **CSO** | contract / OT | commercial-item framing, fast turn | 5–8 | wide |
| **OTA** | Other Transaction (non-FAR) | usually consortium membership | 4–8 | prototype→production |
| **RIF / rapid transition** | contract | transition sponsor usually required | 6–8 | mid |
| **Grants / NOFO** (NSF · DOE · NIH · USDA) | grant / coop agreement | varies; some SB-only, some university-led | 1–4 | wide, cost share common |
| **Sources Sought / RFI** | *none* | anyone | — | **no award — signals a future one** |
| **Prize / Challenge** | prize | anyone | 3–7 | fixed, no IP transfer |
| **IDIQ / GWAC task order** | contract | **must already hold the vehicle** | 5–9 | large |
| **State programs** (e.g. Ohio TVSF) | grant | **geographic** · commercialization-oriented | 4–7 | $100–500K |

**Three things fall out that the current model cannot express:**

1. **Instrument type is a capability question, not a label.** A shop set up for grants — light
   reporting, flexible scope — often cannot absorb a FAR contract's CDRLs and DCAA exposure, and has
   no path at all into an OT consortium. This predicts fit better than most technology signals and is
   currently unmodelled.
2. **Phase is not a variant of programme.** `sbir_phase_1` in the live data conflates them; the
   taxonomy correctly separates `program` (sbir/sttr/baa/ota/cso/rif) from `phase`
   (phase_1/…/direct_to_phase_2). The data violates the product's own model.
3. **RFIs and Sources Sought have no award and are still valuable** — they are the earliest possible
   signal of a coming opportunity. A pipeline that scores them like solicitations either buries them
   or mis-ranks them; they need their own lifecycle treatment, not a score.

---

## 3 · NAICS is an eligibility input, not a matching signal

The challenge that prompted this section is correct, and it has a precise consequence.

NAICS is a **registration and size-standard** construct. A firm self-selects as many codes as it can
legitimately claim; the government uses the solicitation's code to determine the size standard and
set-aside applicability. **541715** — *R&D in Physical, Engineering and Life Sciences* — covers
essentially every SBIR firm in existence.

So as a *capability* discriminator its power is near zero: matching on it returns everything, and
returns it with equal confidence.

> **Move NAICS out of the fit vectors and into the eligibility gates**, where it does real work:
> determining whether this tenant is size-eligible and set-aside-eligible for this solicitation.
> That is not a downgrade — it is putting it where it is actually decisive.

The same reclassification applies to **set-aside type**: it is eligibility, not preference.

---

## 4 · The dimensions that actually discriminate

### 4.1 TRL band — the most under-used discriminator in federal R&D

**A TRL 2–3 basic-research topic and a TRL 6–8 transition topic want different companies**, with
different staff, facilities, and cost structures. A university spinout with a lab demonstration
cannot deliver TRL 7. A manufacturer with a production line does not want TRL 2. Nearly every DoD
topic states or strongly implies its band.

This is a **range overlap**, not a match:

```
topic wants   TRL 4–6
company works TRL 3–5      → overlap 4–5, strong
company works TRL 7–9      → no overlap, near-zero fit even with a perfect technology match
```

Nothing in the product models maturity at all. This is, in my judgement, **the single highest-value
dimension to add** — it is orthogonal to technology, it is stated in the source, and it explains
mismatches that technology matching cannot.

### 4.2 Technology area — use the official vocabulary

DoD SBIR/STTR proposals must self-identify against the **OUSD(R&E) Critical Technology Areas** — 14,
in three groups:

- **Seed / emerging** — Biotechnology · Quantum Science · FutureG (next-gen wireless) · Advanced Materials
- **Defense-specific** — Directed Energy · Hypersonics · Integrated Sensing and Cyber
- **Effective adoption** — Trusted AI and Autonomy · Integrated Network Systems-of-Systems ·
  Microelectronics · Space Technology · Renewable Energy Generation and Storage · Advanced Computing
  and Software · Human-Machine Interfaces

**This is authoritative and closed** — not a taxonomy we invent and then have to defend. Topics carry
it; companies can self-assess against it; it is multi-select on both sides and scores as set overlap.

For non-DoD, the equivalent authoritative axes exist and should be mapped rather than merged: NSF
directorates/divisions, DOE program offices, NIH institutes, Assistance Listing categories for
grants.gov.

### 4.3 Mission / application domain — orthogonal to technology

*Additive manufacturing* (technology) **for** *expeditionary basing* (mission). A company may do the
technology and never the mission, or the reverse. Collapsing them into one keyword axis is why an
open topic reads as a poor match — the tech matches, the mission does not, and one number cannot say
which.

Two vectors, scored separately, reported separately.

### 4.4 Work type

Basic research · applied research · advanced development · prototyping · test & evaluation ·
manufacturing scale-up · software sustainment. These are **different businesses**, and a company
rarely spans more than two adjacent ones.

### 4.5 Capacity — range overlap, banded

Award size and period of performance, expressed as **bands** on both sides, not exact figures. A
range is a classifier; a dollar amount is a fact about one opportunity. *"We take $200K–$2M, 12–24
months"* is a durable statement about a company; *"this award is $1.4M"* is not something a tenant
can pre-declare against.

### 4.6 Teaming posture

**STTR mandates a research institution at ≥30%.** A solo shop with no RI relationship should not see
STTRs ranked highest — not because the technology is wrong, but because they cannot form a compliant
team in the window. Similarly: consortium membership for OTs, vehicle-holding for task orders, prime
vs sub posture.

---

## 5 · The model

```
  ┌─ ELIGIBILITY GATES ─────────────────────────────────────────────┐
  │  size standard (NAICS) · set-aside · ownership/citizenship      │
  │  clearance · ITAR/EAR · registrations (SAM/DSIP/eRA)            │
  │  RI partner required · prior-phase required · geography         │
  │  cost share required · vehicle held                             │
  │            EXCLUDE or FLAG WITH REASON — never score            │
  └───────────────────────────┬─────────────────────────────────────┘
                              │ survives
  ┌─ FIT VECTORS ─────────────┴─────────────────────────────────────┐
  │  technology      set overlap   (CTA + domain terms)             │
  │  mission/app     set overlap                                    │
  │  maturity        RANGE OVERLAP (TRL)                            │
  │  work type       set overlap                                    │
  │  instrument      preference match (grant/contract/OT/coop)      │
  │  capacity        RANGE OVERLAP ($ band, PoP band)               │
  │       each ABSTAINS when either side is silent  (§8e)           │
  └───────────────────────────┬─────────────────────────────────────┘
                              │
  ┌─ STRATEGIC WEIGHTS ───────┴─────────────────────────────────────┐
  │  agency affinity · follow-on potential · incumbency · recency   │
  │       tenant preference, reported SEPARATELY from fit           │
  └─────────────────────────────────────────────────────────────────┘
```

**Report the vectors, do not only blend them.** *"Technology 0.9, mission 0.2, maturity no overlap"*
tells a company something a single 54/100 cannot — and it is the same principle the project rollup
already follows in refusing to average cost, schedule and deliverables.

**Every vector abstains when either side is silent.** A tenant who fills only technology gets pure
technology matching. One who fills everything gets high precision. Nothing is restricted by not
selecting, which is the property §8e establishes and this model depends on.

---

## 6 · Realigning the three surfaces

The same closed vocabularies, at the three moments a human is already present.

### Onboarding / company profile — *what we are*

Today: free-text NAICS, keywords, agencies, set-asides, technology focus, research areas.

Should be:

| Captured | How | Feeds |
|---|---|---|
| CTA areas we work in | multi-select, official 14 | technology vector |
| mission domains | multi-select | mission vector |
| **TRL band we operate in** | range slider 1–9 | maturity vector |
| work types | multi-select | work-type vector |
| instruments we can execute | checkboxes (grant/contract/OT/coop) | instrument vector |
| capacity band | $ range + PoP range | capacity vector |
| RI relationships · consortium memberships · vehicles held | list | eligibility + teaming |
| ownership · size · clearances · registrations · certifications | structured | **eligibility gates** |
| NAICS | multi-select | **eligibility only** (size standard) |
| technology description, differentiators | **free text** | the highlight/keyword axis |

### Opportunity ingest — *what this is*

Same vocabularies, admin-confirmed at curation with the shredder proposing:

CTA areas · mission domain · **TRL band stated or implied** · work type · instrument · award band ·
PoP · programme **and** phase as *separate* fields · teaming requirement · every eligibility flag,
each with its `pattern_match` citation per the ingest-provenance contract.

### Bucket creation — *what we are looking for*

A bucket becomes a **partial specification over the same axes** — because a tenant has several lenses
and each names only what it cares about. *"Quantum sensing, TRL 3–5, Phase I, grant-or-contract"* is
one lens; *"manufacturing scale-up, TRL 6–8, any agency, $1M+"* is another. Prefilled from the
profile (B1), narrowed per lens.

---

## 7 · Why this is more accurate, mechanically

- **Eligibility stops competing with fit.** A disqualifier excludes with a reason instead of shaving
  a sixth off a score.
- **Range overlap replaces equality** where the underlying reality is a range — maturity and capacity
  are the two that most often make a technically perfect match unworkable.
- **Two vectors instead of one** for technology and mission, so an open topic can report *"your tech,
  not your mission"* rather than a single mediocre number.
- **Authoritative vocabularies** mean both sides mean the same thing by the same word, which §8c
  showed is the whole game.
- **Preference stops diluting capability**, because it is reported separately.
- **Abstention** means precision rises with the tenant's effort and never falls below today's.

---

## 8 · Migration — what this means for the existing plan

None of `OPPORTUNITY_MATCHING.md` is wasted, but its ordering changes.

| Existing item | Still right? |
|---|---|
| §8e abstention fix | **prerequisite for all of this** — the model depends on it |
| Highlights corpus (§6) | **yes** — it is the free-text axis, and stays the home for open language |
| tsvector/pg_trgm | **yes**, for the free-text axis |
| Taxonomy normalisation (§8c) | **yes**, generalised — more vocabularies, same discipline |
| Weight-consequence line (B4) | **yes**, and richer: *"this lens names 2 of 6 fit vectors"* |
| Profile prefill (B1) | **yes**, and the profile is what §6 above rebuilds |
| NAICS as a fit dimension | **no** — reclassified to eligibility (§3) |
| flat weighted mean | **no** — replaced by gates + vectors + preference (§5) |

**Sequence.** The abstention fix and the highlights corpus are unchanged and still first — they cost
nothing and block nothing. Then **TRL band**, which is the highest value per unit of work in this
document and needs one field on each side. Then CTA multi-select on both sides. Then eligibility
gates as a mechanic. The flat-mean replacement comes last, because by then there will be vectors
worth combining.

---

## 9 · What I am not certain of

- **TRL is stated inconsistently.** DoD topics often imply rather than declare it, and grants
  frequently omit it. The extraction may be a `pattern_match` for the explicit cases and an `ai`
  proposal for the implied ones — which is exactly the provenance ladder the ingest work already has,
  and it must render as *unverified* when inferred.
- **The non-DoD vocabulary mapping is unresolved.** NSF directorates and DoD CTAs are not the same
  shape. Mapping them into one axis loses information; keeping them separate means a bucket must
  choose. I do not have a confident answer.
- **Band granularity is untested.** TRL 1–9 as three bands or nine steps, award size in four bands or
  seven — these are empirical questions and I have no data to settle them.
- **Every number in the companion analysis came from a seeded sandbox.** This model should be sanity
  checked against a real corpus of a few hundred live topics before anyone builds the schema.

---

## 10 · Agency vocabularies — and why they cannot be merged

The four core axes are **agency · technology · maturation · alignment**. Each agency has an
authoritative classifier for technology, and they are **not the same shape**. That is the finding
this section exists to record.

| Agency | Authoritative technology axis | Organising principle | Maturation scale |
|---|---|---|---|
| **DoD** (OUSD R&E) | **14 Critical Technology Areas** — Biotechnology · Quantum Science · FutureG · Advanced Materials · Directed Energy · Hypersonics · Integrated Sensing & Cyber · Trusted AI & Autonomy · Integrated Network Systems-of-Systems · Microelectronics · Space Technology · Renewable Energy Generation & Storage · Advanced Computing & Software · Human-Machine Interfaces | **technology** | **TRL 1–9** |
| **DARPA** | **6 technical offices** — BTO · DSO · I2O · MTO · STO · TTO *(2026 reporting: I2O→IPTO, MTO→MXO — verify before encoding)* | **organisational unit** | program-phase, not TRL |
| **NSF** | **8 directorates** — BIO · CISE · ENG · GEO · MPS · SBE · EDU · TIP; plus ~**18 SBIR topic areas** (AI/ML, biotech, advanced materials, energy, quantum, robotics, semiconductors…) | **academic discipline** | **none formal** — Phase I/II is the only proxy |
| **DOE** | **Office of Science: 7** — ASCR · BES · BER · FES · HEP · IRP · NP; plus applied offices (EERE · NE · FECM · OE) and **ARPA-E**; SBIR carries **60+ topics / 250+ subtopics** | **mission + discipline** | TRL for applied; none for SC basic |
| **NIH** | **27 Institutes and Centers**; mechanism codes **R43/R44** (SBIR) and **R41/R42** (STTR) | **disease / organ system** | **T0–T4 translational continuum** |
| **NASA** | **4 mission directorates** — Aeronautics Research · Human Exploration & Operations · Science · Space Technology; × **10 centers** | **mission** | **TRL 1–9** *(NASA originated it — Sadin, 1974, seven levels; formalised to nine in the 1990s)* |

### These are different ontologies, not different lists

- **DoD** classifies by *technology*.
- **NSF** classifies by *academic discipline*.
- **NIH** classifies by *disease and organ system*.
- **DARPA and NASA** classify by *organisational unit and mission*.
- **DOE** does both — Office of Science by discipline, applied offices by mission.

An organ system is not a technology. A directorate is not a technology area. **Flattening them into
one list destroys the meaning that makes each one authoritative**, and produces a vocabulary that no
agency's own solicitations actually use — the §8c failure at a larger scale.

---

## 11 · Two corrections this forces

### 11.1 "TRL band" was too narrow — maturation is a normalised axis with per-domain scales

§4.1 called it *TRL band*. That is right for DoD, NASA and applied DOE, and **wrong everywhere else**:

- **NIH** uses the **T0–T4 translational continuum** — basic → pre-clinical → clinical → practice →
  population. Not TRL, and not convertible without loss.
- **NSF** has **no formal maturation scale at all.** Phase I versus Phase II is the only signal, which
  is a funding stage, not a technical maturity.
- **DARPA** frames maturity by program phase and go/no-go milestones rather than a standing scale.

So the dimension is **maturation**, held as a normalised band with each agency's native scale mapped
onto it — TRL 1–9, T0–T4, or "stage unknown". A company declares its band once; the mapping is what
lets a biotech firm's *pre-clinical* and a hardware firm's *TRL 4* both be understood.

**And "stage unknown" must abstain, not default.** An NSF topic with no maturity statement should not
be scored as though it were TRL 1 — that is the §8e rule applied to the axis that most tempts a
default.

### 11.2 The technology axis needs two layers

One list cannot be both authoritative and cross-agency. So carry both:

**Layer 1 — the agency-native classifier**, stored as the agency states it. A DoD topic carries its
CTAs; an NIH funding opportunity carries its IC and activity code; an NSF solicitation carries its
directorate and topic area. Nothing is translated, nothing is lost, and a company that works with
that agency sees the vocabulary it already knows.

**Layer 2 — a coarse cross-agency bridge axis**, deliberately small, that every native term maps
onto. This is the *alignment* axis: it lets one bucket saying "quantum" reach a DoD CTA, an NSF topic
area, a DOE BES program and a DARPA office — without pretending those four are the same thing.

```
   DoD CTA "Quantum Science" ─┐
   NSF topic "Quantum"        ├──▶  bridge: QUANTUM  ◀── bucket says "quantum"
   DOE BES quantum materials  │
   DARPA MTO/MXO programs    ─┘

   native layer: precise, authoritative, agency's own words
   bridge layer: coarse, lossy, and the ONLY thing a cross-agency bucket matches on
```

**The bridge is lossy on purpose, and must be labelled as such.** A tenant matching on the bridge
should see *"matched at the cross-agency level"* and be able to narrow to the native term when they
care. Presenting a bridge match as though it were a native one is the same class of error as
presenting a `default` value as though it were read from the source.

### 11.4 Effort is scoped. Reach is not. — the correction that matters most

An earlier draft said onboarding should be *"agency-scoped: a firm that only does NIH work should
never be asked to self-assess against DoD CTAs."* The first half is right and the second half, read
as written, would have built **a filter bubble into the product's core value**.

**Not required ≠ not shown.**

| | Scoped? | |
|---|---|---|
| **Effort** — what a company fills in | **yes** | never make a biotech firm learn DoD's 14 CTAs to be onboarded |
| **Reach** — what a company is shown | **never** | a DoD Biotechnology topic is often exactly the opportunity they would never have found alone |

A firm that has only ever done NIH work **should absolutely learn about DoD-aligned opportunities.**
That is not a nice-to-have on top of the pipeline; for many tenants it *is* the pipeline — the whole
reason to use a discovery product rather than watching one agency's portal.

### The bridge is not a convenience layer — it is the discovery mechanism

§11.2 introduced the cross-agency bridge as a way to let one bucket match several vocabularies. That
undersold it. **The bridge is what makes cross-agency reach possible without cross-agency data
entry:**

```
company declares (native, NIH):        regenerative medicine · NIAMS/NIBIB · T2 translational
                        │
                        ▼  bridge derivation, same table, both directions
company's bridge terms:                BIOTECHNOLOGY · ADVANCED MATERIALS
                        │
                        ▼
reaches:                               DoD CTA "Biotechnology" topic
                                       NSF BIO/TIP topic
                                       DOE BER program
```

They never touched a DoD vocabulary, and a DoD topic still found them.

**Three consequences follow.**

**1 · Derivation must run symmetrically, on both sides.** If bridge terms are derived only for
opportunities, the join has a native term on one side and nothing on the other and matches nothing.
The company's declared native terms must derive bridge terms too, by the same table.

**2 · The failure mode is worse than I said.** §12 called a stale mapping table *"a source of
confidently wrong matches."* That is the lesser half. The greater half is **invisible absence** — a
missing mapping means a tenant never sees an entire agency's worth of relevant work, and they cannot
tell, because nothing appears. A wrong match is annoying and self-correcting; a silent gap is neither.

That raises the stakes on the mapping table's ownership and cadence considerably, and it argues for a
standing check: *for each bridge term, does every agency that plausibly funds it map onto it?* — an
instrument, not a review meeting.

**3 · A bridge match must explain itself, or it reads as noise.** A biotech firm shown a DoD topic
will distrust the pipeline unless the card says why:

> *Matched via **Biotechnology** — your NIH regenerative-medicine profile. This is a cross-agency
> match; narrow to DoD Critical Technology Areas to tune it.*

§11.2 called labelling a bridge match a correctness requirement, on the grounds that presenting it as
a native match is like presenting a `default` as a value read from the source. That still holds — and
it is also what makes an unexpected match **credible instead of alarming**, which is the difference
between a tenant exploring a new agency and a tenant deciding the ranking is broken.

### The model, corrected

**The bridge axis is the universal floor, required of everyone. Native vocabularies are optional
precision, offered per agency.** Filling in more improves ranking accuracy within that agency; filling
in nothing beyond the floor still reaches every agency. Nothing a company declines to fill in ever
narrows what it sees.

### 11.3 Consequences for the three surfaces

- **Onboarding** captures the bridge axis for **everyone**, plus native classifiers as *optional
  depth* for the agencies a company actively pursues. See §11.4 — the distinction between what a
  company is **asked to fill in** and what it is **shown** is load-bearing, and an earlier draft of
  this document got it wrong.
- **Ingest** records the native classifier as stated — with its provenance citation — and derives the
  bridge term. Derivation is a mapping table, not a model: deterministic, reviewable, and correctable
  by an admin.
- **Buckets** may name either layer. A DoD-focused lens names CTAs; a technology-agnostic lens names
  bridge terms; both work, and the score says which layer matched.

---

## 12 · What this changes in the plan

| Item | Change |
|---|---|
| D2 · "TRL band" | **broaden to maturation band** with per-scale mapping; "unknown" abstains |
| Technology classifier | **two layers** — native per agency, plus a small shared bridge |
| Onboarding | agency-scoped: only ask for the native vocabularies a company actually pursues |
| Ingest | native as stated + derived bridge, mapping table not model, admin-correctable |
| The bridge mapping table | **new artefact**, and the one thing here that needs ongoing curation |

**The honest cost:** the bridge mapping table is a maintained asset — and per §11.4 it is also the
**discovery mechanism**, not merely a matching convenience, so its failure mode includes a tenant
silently never seeing an agency's work. Agency vocabularies drift —
DARPA's offices were reportedly renamed in 2026, NSF added TIP in 2022, DoD's CTA list has been
revised more than once. A mapping table nobody maintains becomes a source of confidently wrong
matches, which is worse than no bridge at all. It needs an owner and a review cadence, and that
should be decided before it is built rather than after it rots.
