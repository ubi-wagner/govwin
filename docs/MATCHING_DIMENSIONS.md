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
