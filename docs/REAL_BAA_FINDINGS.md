# Measured against a real BAA — and the drafter is reading the table of contents

**Document:** `docs/DoW 2026 SBIR BAA FULL_R1_04132026.pdf` — the general solicitation cited by the
seeded `solicitation_compliance.custom_variables.baa_source`, and the one behind the Immobileyes work.
**Method:** text extracted with PyMuPDF, offsets computed against the same concatenation the product
builds as `curated_solicitations.full_text`.

**Why this document changes the analysis.** Every figure in `OPPORTUNITY_MATCHING.md` and
`PIPELINE_FRONT_TO_BACK.md` carried a caveat: the sandbox's `full_text` is *seeded*, 147 characters on
6 of 18 rows. At that size no truncation bites and no ratio is real. Against 1,027,823 characters the
picture is different, and one finding is considerably more serious than anything found so far.

---

## 1 · Scale

| | |
|---|---|
| DoW 2026 SBIR BAA (general solicitation) | **330 pages · 1,027,823 chars** |
| DoW 2026 STTR BAA | 137 pages · 423,373 chars |
| DoW 2026 SBIR CSO | 103 pages · 292,595 chars |

Against that:

```
ranker  (scoreCard)        296 chars      0.03% of the document      1 : 3,472
drafter (draft_v0)      18,000 chars      1.8%  of the document      1 : 57
```

The 61× ranker-to-drafter asymmetry from the seeded measurement **holds**. What the seeded data hid is
that *both* budgets are tiny against the real thing — and that the drafter's, which looked generous,
is 1.8%.

---

## 2 · The finding: the drafter's window is front matter

`draft_v0` takes `full_text[:18000]` — a **prefix**. On this document that prefix is:

| Chars | Pages | Content |
|---|---|---|
| 0 – 10,105 | 1–3 | cover page · release-date matrix · **table of contents** |
| 10,105 – 18,000 | 4–6 | eligibility · first mention of Critical Technology Areas |
| **18,000** | **~6** | **window closes** |

**56% of what the model receives is front matter.** Here is what it does *not* receive:

| Content | Page | Char offset |
|---|---|---|
| **Component-specific instructions — Navy, Army, Air Force** | **7** | **20,500** |
| OSD instructions | 9 | 27,885 |
| Evaluation criteria | 13 | 41,648 |
| Phase I requirements | 18 | 59,293 |
| Technology Readiness Level language | 162 | 501,524 |
| DARPA instructions | 225 | 699,562 |

> **A model writing a Navy SBIR proposal never sees Navy's instructions.** They begin 2,500
> characters after the window closes.

### Why this is worse than the ranking problem

- It is **expensive**: every build costs $1.00–$2.30, and a meaningful share of that is spent
  processing a table of contents.
- It is **invisible**: the draft comes back as plausible prose. Nothing errors. No lens catches it —
  the export gate checks size and compliance, not whether the model saw the requirements.
- It **degrades the core promise** directly. Ranking failures mean an opportunity is not seen;
  drafting on front matter means the thing the customer paid for is written without the rules.

### The structural cause, which generalises

`full_text` is *"every shredded document concatenated"*, and a solicitation's **specificity increases
with depth**: preface → general procedures → component instructions → topic. A prefix window over that
concatenation therefore captures **the least specific content available** and drops the most specific.

**A prefix is the worst possible window over a document ordered this way**, and it gets worse as
documents get longer — the same inversion already found in ranking, one stage later and costing real
money.

---

## 3 · What this corrects in the earlier analyses

| Claim | Status |
|---|---|
| "The ranker reads 296 chars, the drafter reads 18,000 — 61×" | **holds** — and against a real document the ranker is at 1:3,472 of the source |
| "Drafting needs nothing new" (`PIPELINE_FRONT_TO_BACK.md` §5) | **wrong.** It needs the same fix as ranking, and more urgently by cost |
| "Whether a curated corpus beats a raw 18,000-char prefix is a follow-on, not a blocker" | **wrong.** It is the same fix, and the measurement above is the evidence |
| "M0 blocks everything — shred a real BAA first" | **it was never blocked.** Seven real BAAs and five CSOs have been in `docs/` throughout |
| "There is exactly one thin boundary" | **two.** curated → card, *and* curated → drafter. Both are prefix-or-blurb views of a million-character document |

---

## 4 · Boilerplate — why "just widen the window" is not the answer

Raising 18,000 to 100,000 would reach the component instructions and still be 10% of the document, at
roughly 5× the input cost per drafting call — against measured input already at 93–95% of build spend.

And most of what it added would be **shared boilerplate**: a general solicitation is largely FAR
clauses, registration mechanics, standard certifications and the *other components'* instructions. A
Navy proposal does not benefit from DARPA's section at char 699,562.

**The corpus must be selected, not enlarged** — which is the same conclusion the highlight design
reached for ranking, now independently forced for drafting by cost as well as quality:

- **for ranking** — the curated highlight set carried on the card (§6 of the matching analysis)
- **for drafting** — the *relevant* slices: this component's instructions, the topic, evaluation
  criteria, the requirements for this phase

Both are *"select the meaningful parts once, at ingest, with a human confirming"*. **One mechanism,
two consumers.** That is a considerably stronger case for the highlight corpus than the ranking
argument alone.

---

## 5 · One thing I cannot yet claim

**Document order in a real multi-document ingest is unverified.** Here, component instructions live
*inside* one 330-page file. In a live DSIP ingest the topic arrives as a separate document, and
`full_text` is the concatenation — so whether the topic lands at char 20,000 or char 1,040,000 depends
on shred order. `copyOppFolder` orders `document_type='source'` first for the pin manifest; whether
the shredder uses the same order is **not established**.

If the topic concatenates *after* the BAA, the drafter never sees the topic at all — which would be
worse again. **That is the next measurement**, and it needs a real multi-document ingest rather than a
single PDF.

---

## 6 · What changes in the plan

**Elevate: the drafter's context window.** It was not on the list. It should sit beside B1, because it
is the same mechanism, costs real money on every build today, and is invisible without a measurement
like this one.

**Reframe M0.** Not *"shred a real BAA to unblock the plan"* — the documents were always here — but
*"run a real multi-document ingest end to end and measure what `full_text` actually contains and in
what order"* (§5).

**Strengthen the case for B1.** The highlight corpus now serves two consumers rather than one, and the
second consumer is the one the customer pays for.

**Add a guard.** Any prefix-or-truncation window over `full_text` should assert what it captured —
*"this window ends before the component instructions"* is a condition a machine can check and a human
would never notice.
