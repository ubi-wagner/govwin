# Opportunity ingest → ranking — where the matching actually breaks

> **SUPERSEDED — see `docs/OPPORTUNITY_MATCHING.md`.**
> This file is kept for the record: it shows the reasoning as it stood, including the two places it
> turned. The consolidated analysis carries the corrected design and the measurements that decided it.

**Question:** an open topic that mentions manufacturing should reach an electronics researcher whose
work fits it. Today it does not. Why, and what is worth fixing?
**Method:** traced the live path and measured every stage against the sandbox corpus.
**Conclusion up front:** this is **not** a keyword-vs-semantics problem. **The ranker is reading
about 296 characters of a document that is orders of magnitude larger.** No matching algorithm,
neural or otherwise, can find a word that was never put in front of it.

---

## 1 · The chain, as built

```
source (DSIP / sbir.gov / grants.gov / admin upload / scout)
  └── stageIntake                      → curated_solicitations (status 'new')
      └── SHRED                        → curated_solicitations.full_text
      │                                   "every shredded document concatenated"
      │                                   ── consumed ONLY by pattern-extract + skeleton
      │                                      (compliance variables, page limits, citations)
      └── CURATE (human)               → spotlight_summary, compliance variables
          └── approve → pushSolicitation
              gate: submission_format present · spotlight_summary present
              └── opportunity_bridge   → tenant_opportunity_cards.card (jsonb)
                  └── scoreCard        → tenant_bucket_scores
                      text = title + spotlightSummary + description + office
```

**The break is visible in the diagram.** `full_text` — the whole solicitation — terminates at
compliance extraction. The ranking path never touches it.

---

## 2 · Measurements

### What the ranker actually reads

```
63 cards
  42  have a spotlightSummary
  49  have a description
  14  have NEITHER  → ranked on title + office alone          (22%)

ranked text length:   mean 296 chars · min 76 · max 406
spotlight_summary:    mean 103 chars
```

### What the matcher does with it

`keywordHit` is a lowercased **substring** test — with a word-boundary rule for tokens of three
characters or fewer, so bare `ai`/`ml` stop hitting "email"/"html". No stemming, no lemmatisation,
no synonyms, no term weighting. `scoreCard`'s keyword factor is `hits / keywords.length`.

Against the sandbox's own hand-curated buckets, where the keywords were *chosen* to match:

```
45 bucket scores · 19 with a keyword factor of exactly 0     → 42% literal miss
```

### For contrast — the library side, where the vector axis was actually built

```
303 atoms · 37 distinct tag values · 8.2 atoms per tag
dimensions: vehicle 6 · context 5 · kind 4 · topic 4 · agency 3 · form 3 · format 3 · program 3
```

A closed, tenant-authored vocabulary. **The semantic axis is deployed against 37 controlled tag
values and absent from an unbounded corpus of agency prose.**

---

## 3 · Findings

### F1 · The ranking corpus is ~296 characters. This is the root cause.

Everything else is downstream of it. An open topic's breadth lives in its technology-area
enumeration — the paragraph listing *additive manufacturing, directed energy deposition, embedded
sensing, power electronics* — and that paragraph is in `full_text`, which the ranker never sees.

Swapping substring matching for embeddings would not fix this. **It would embed the same 296
characters.**

### F2 · 22% of cards are ranked on title + office alone

`pushSolicitation` **requires** `spotlight_summary` — it throws *"a spotlight-match summary is
required before releasing into the Opportunity Pipeline"*. But `opportunity_bridge` reads it as
`?? null` and does not require it, so a card arriving by any other path (seeded fixtures, the scout
release, a direct bridge write) carries no summary at all.

**The gate exists in one path and the table accepts rows from several.** Those 14 cards are matched
on a title and an office name.

### F3 · The release gate is already light, and already on the right field

This is worth stating because it contradicts a reasonable worry. The push gate is:

```
REQUIRED_COMPLIANCE = ['submission_format']
+ spotlight_summary must be non-empty
```

**That is all.** No volumes, no mold skeletons, no completed compliance matrix. The
"release with minimum information" model is *already the design* — an opportunity reaches customers
long before it is build-ready, and `build_complete` (mig 182) is a separate, later flag governing the
proposal side.

So the gate is correctly placed: it demands exactly one human artifact, and that artifact is the one
the ranker reads. **The problem is that the artifact averages 103 characters.** The lift is in the
right place; it is simply too small to carry the load being put on it.

### F4 · The Ingest Studio phase machine governs nothing yet

`ingest_phase` is `not_started` on all 18 solicitations. Mig 189's state machine
(`extract → matrix → review → landed → molds → complete`) only governs rows created after it, by
design — but it means the staged, reviewable extraction path is not currently what produces the
matching context.

### F5 · Two scorers must agree, and they are separately maintained

`scoreCard` (TS) and `pipeline/src/workflows/actions/rescore.py::_keyword_hit` are a deliberate
mirror pair. Any change to matching has to land in both, or a card scored at push and a card rescored
on `capture:card.applied` will disagree. There is a comment saying so; there is no test asserting it.

---

## 4 · The open-topic case, worked

A DoD open topic says, in its full text:

> *…seeking innovations across additive manufacturing, directed energy deposition, embedded sensing
> and instrumentation, power electronics, and thermal management for expeditionary systems…*

The admin writes a 103-character spotlight summary: *"Open topic for expeditionary basing
technologies — broad scope, multiple award."*

An electronics researcher's bucket has keywords `power electronics`, `embedded sensing`, `thermal
management`.

**Score: zero.** All three keywords are in the solicitation. None are in the 296 characters the
ranker reads. The card is real, the fit is real, the tenant never sees it ranked.

This failure mode is **specific to open topics and worst exactly where the opportunity is most
valuable** — a broad topic is one many tenants could win, and breadth is precisely what a short
summary compresses away.

---

## 5 · Improvement initiatives, by leverage ÷ cost

### I1 · Widen the ranking corpus — **SUPERSEDED, see docs/HIGHLIGHTED_SECTIONS_DESIGN.md**

> ⚠️ As first written this said "match against `full_text`". That is wrong, and wrongly in the
> dangerous direction. A solicitation is mostly FAR clauses, disclaimers and submission mechanics —
> text near-identical across every BAA. Matching it does not add noise, it **inverts the signal**:
> nearly every federal solicitation says "manufacturing" somewhere in a domestic-sourcing clause, so
> a bucket keyed on it hits everything, and because the keyword factor is `hits / keywords.length`
> boilerplate makes hits cheap enough that a genuine match and an accidental one score identically.
> It gets worse as documents get longer, which is exactly backwards.
>
> The corpus must be **curated, not raw** — the text something deliberately marked as meaningful,
> from `solicitation_annotations` (the admin capability is already built and unused) and
> `pattern-extract`'s excerpts (already produced, currently only for compliance rules). Boilerplate
> never enters because nothing highlights it: the absence of a highlight is the filter.
>
> Full design, including the tenant-visible "Sections Highlighted by System or Admin" panel and a
> regenerable summary: **docs/HIGHLIGHTED_SECTIONS_DESIGN.md**.

#### The original, for the record

### I1 · Widen the ranking corpus to `full_text` — **do this first**

The data is already retained, already tenant-agnostic (it lives on the master solicitation, not the
mirror), and already flows through the bridge. Nothing new is stored, no dependency is added, no
data leaves.

Options, cheapest first:
- match against `full_text` directly in `scoreCard`'s `text`;
- or precompute a **matching digest** at push — the summary plus the extracted technology-area and
  keyword sections — and carry it on the card.

The digest is better: it keeps the card self-contained (the bridge is forward-only by design), bounds
the text the scorer walks, and gives the admin something reviewable.

**This single change fixes the worked example above.** Nothing else on this list does, on its own.

### I2 · Replace substring matching with Postgres full-text search

`pg_trgm` and `tsvector` are **already installed** as of migration 001 and unused for ranking.

- stemming: `manufacturing` matches `manufacture`, `manufactured`, `manufacturers`
- stop words, term-frequency ranking (`ts_rank`), phrase queries
- `similarity()` for fuzzy near-misses and misspellings

Zero cost, zero subprocessor, no data leaves. Must land in **both** scorers (F5).

### I3 · Give the human lift a structure — the highest-value change to the admin queue

The curation step already demands one artifact and blocks release without it. Change *what it
demands*: instead of a free-text blurb, capture

- **technology areas** (a list, from the topic's own enumeration)
- **capability keywords** (the vocabulary a fitting company would use about itself)
- **who this is for**, in one line — which is what the blurb is good at

This is the same human effort, redirected from prose to structure. For open topics it is the whole
ballgame: the admin is the one person reading the technology-area list, and today that reading is
discarded. The shredder can propose the list from `full_text`; the human confirms or corrects it —
which is exactly the "put the lift on the human, given the variety the shredder encounters"
division, applied where it pays.

It also composes with I1 and I2 rather than competing: structured areas are better matching input
*and* better `tsvector` input.

### I4 · Wake `scoring_strategist`

Already designed, registered, dormant. A Haiku overlay reading tenant profile and past win/loss,
emitting −15..+15 **with a rationale, factor breakdown and confidence**, recalibrating on
`capture.proposal.outcome_recorded`. ~$20–25/month platform-wide at 100 tenants.

Do it **after** I1–I3, for a specific reason: an LLM overlay on a 296-character corpus inherits the
same blindness. Widen the corpus first, then let the model reason over something worth reasoning about.

### I5 · Close the no-summary path

Either require `spotlight_summary` at the bridge as well as at push, or render those cards
distinctly so nobody mistakes "unranked" for "poor fit". Fourteen of sixty-three is not an edge case.

### I6 · A parity test for the two scorers

F5 is a documented invariant with no test. A fixture set scored by both implementations, asserting
identical output, costs an afternoon and removes a whole class of silent divergence.

---

## 6 · What I would do first

**I1 + I2 together**, as one change: build a matching digest at push from `full_text`, and match it
with `tsvector`/`ts_rank` instead of `String.includes`. No new dependency, no new subprocessor, no
data leaving the boundary, and it directly fixes the open-topic case that motivated the question.

Then **I3**, because it is the change that compounds — every solicitation curated afterwards is
better input for everything downstream, and it is the one place where a human reading the document
once produces durable value for every tenant.

**I4 last, and only then.** It is the most sophisticated option and the least useful until the corpus
problem is fixed.

> **A note on measurement.** Every number here is from the sandbox, whose solicitation fixtures carry
> short seeded text — `full_text` is populated on only 6 of 18 rows and averages 147 characters,
> because these were seeded rather than shredded from real BAAs. The *shape* of the finding does not
> depend on that (the ranker's inputs are structurally the card's four short fields), but the
> **magnitude of the win from I1 is understated here** and should be re-measured against a real
> shredded corpus before anyone sizes the work.
