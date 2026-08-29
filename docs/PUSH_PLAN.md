# The plan — ingest → ranking

Seven pieces of work. For each: what changes, why it sits where it does, how it is verified, what
could go wrong, and rough size.

**Two rules for this push**, both written because of how the analysis drifted:

- **Every item must change what the admin does at ingest, or what a tenant sees in their ranking.**
  If it does neither, it is not in this push.
- **No new analysis documents.** Findings go in commit messages and the bug log.

---

## Order, and why

```
1  abstention fix ────┐
                      ├──▶ 5  bucket prefill + weight line
2  parity test  ──────┤
                      └──▶ 3  highlights on the card ──▶ 4  stemmed matching
                                     │                   6  tenant panel
                                     └──────────────────▶ 7  drafter context
```

**1 before 5** because prefill pushes `naics` and `setAsides` into criteria against card fields that
are 0/22 and 0/63 populated. Ship prefill first and every tenant's scores drop the day it lands.

**2 before 1, 3, 4** because each of those changes both scorers, and nothing currently asserts they
agree. The parity test is the safety net for the three riskiest edits.

**3 before 4, 6, 7** because all three consume the highlight set. There is nothing to stem, display,
or draft from until highlights reach the card.

---

## 1 · Abstention fix

**Change.** `frontend/lib/bucket-ranking.ts::scoreCard` and
`pipeline/src/workflows/actions/rescore.py::score_card`. Four factors — `agency`, `naics`, `program`,
`accessibility` — currently guard only the bucket side, so a card missing the field scores **0** and
still enters the denominator. Add a card-side guard to each, matching the shape `timeline` already
uses (`card.closeDate && …`, with the comment *"an invalid date must not change the denominator"*).

**Verify.** Red first: a fixture card with no `agency`, scored against a bucket naming agencies. Today
it scores 0 on that factor and the weighted mean drops. After: the factor is absent, the denominator
shrinks, the score reflects only signals both sides carry.

**Risk — this is the one to plan for.** Fixing it **changes every score already stored**. Scores rise
where a factor was unfairly zeroing. So:

- `tenant_bucket_scores` must be recomputed after the change lands
- the rescore path already exists (`rescore.py`, triggered by `capture:card.applied`) — it needs a
  deliberate full pass, not a wait for events
- do it in one transaction per tenant, and record before/after distributions so the change is
  observable rather than mysterious

**Size.** ~20 lines across two files, plus a rescore runbook step.

---

## 2 · Scorer parity test

**Change.** New. Not a vitest — the two implementations are in different runtimes, so:

- a **shared fixture file** (JSON: cards × bucket criteria × `now`)
- a **TS runner** and a **Python runner**, each emitting scores as JSON
- a **comparator** asserting identical output, registered in `run-branch-drives.sh` (which already
  dispatches `.py`, added earlier this session)

**Verify.** Red first: introduce a deliberate divergence — change one weight on one side — and confirm
the comparator fails and names the factor. Then revert and confirm green.

**Fixtures must include the asymmetric cases**, not just the happy path: a card missing each field, a
bucket setting each criterion alone, an unparseable close date, an empty criteria object.

**Size.** ~150 lines total. Half of it fixtures.

---

## 3 · Highlights ride the bridge onto the card

Three parts, in order.

### 3a · Annotations must capture text, not just a location

`solicitation-save-annotation.ts` takes `sourceLocation {page, offset, length, bbox?}` and a free-form
`payload`. **There is no excerpt text.** An anchor alone is useless on the card: an unpinned tenant has
no document for it to resolve against, so a panel built on anchors renders empty for exactly the
tenants it exists to persuade.

Add `text` to the schema — the selected string, capped — alongside the anchor. The anchor stays: it
becomes *live* once a tenant pins, resolving against their own copy.

### 3b · The bridge carries them

`opportunity-bridge.ts` builds the card payload. Add a bounded `highlights` array: `text`, `kind`,
`source` (`system` | `admin`), and the anchor. **Bounded at the bridge** — a card is read on every list
render, so cap the count and the per-item length there rather than trusting the input.

### 3c · Both scorers match them

`scoreCard`'s `text` becomes `title + spotlightSummary + description + office + highlights[].text`.
Same edit in `rescore.py`. The parity test from item 2 covers this.

**Verify.** An annotation created through the existing curation page appears on the card after a
republish, and a bucket keyword present only in the highlight now scores > 0 where it scored 0 before.

**Risk.** Card size growth on every list render. Mitigated by the bound; measure the card payload
before and after.

**Size.** ~120 lines across four files, plus a migration only if `payload` proves unsuitable for the
text (it is a free jsonb, so probably not).

---

## 4 · Stemmed matching

**The honest complication.** `scoreCard` is a **pure JS function** over card fields, called per card.
`tsvector`/`ts_rank` live in Postgres. Moving the keyword factor to SQL changes *where scoring runs*,
which is a bigger change than the description implies.

Two options, and I would take the second:

| | |
|---|---|
| **A · move the keyword factor into SQL** | true `ts_rank`, proper stemming, index-backed. But scoring stops being a pure function, the two runtimes diverge structurally, and the parity test gets much harder |
| **B · keep it in-process, improve the matcher** | a small stemmer (Porter) in both runtimes, plus normalisation. Less powerful than `ts_rank`; keeps scoring pure, keeps parity testable, and captures most of the benefit — `manufacturing`/`manufacture`/`manufactured` is the common case |

**Recommendation: B now, A later if measurement says the ceiling was reached.** `pg_trgm` stays
available for a separate fuzzy-search feature where SQL is the natural home.

**Verify.** Fixture pairs that should match after stemming and do not today. Parity test covers both
runtimes.

**Size.** ~80 lines plus a stemmer dependency in each runtime, or ~40 lines of a hand-rolled suffix
stripper if a dependency is unwelcome in the pipeline.

---

## 5 · Bucket authoring — prefill and the weight line

**Change.** `frontend/components/portal/spotlight-buckets.tsx` and the buckets route.

- **Prefill**: a *"Start from our company profile"* action reading `tenant_profiles` — `naics_codes`,
  `keywords`, `agency_priorities`, `set_aside_types`. Column-for-column, already collected on the
  profile page, currently unconnected. The tenant edits rather than recalls.
- **Weight line**: *"This lens scores on 1 of 6 signals. Keyword matches are 67% of its score."*
  Computed from the criteria object — pure display, no new data.

**Verify.** UI drive as `tenant_admin` **and** as a delegated member with `can_manage_buckets`, since
both may author. Confirm the percentage matches what `scoreCard` actually computes for that criteria
set — a wrong number here is worse than none.

**Risk.** Prefill against unpopulated card fields is exactly the trap item 1 fixes. **Do not ship
before item 1.**

**Size.** ~100 lines, mostly UI.

---

## 6 · Tenant panel — "Sections Highlighted by System or Admin"

**Change.** A card-detail component reading `card.highlights`, grouped by source: *Highlighted by our
analysts* (admin) and *Found in the solicitation* (system, with page). Excerpt text inline so it works
before a pin.

**Verify.** Renders for a tenant with an unpinned card. Joins `UI_CATALOG` and `UI_ATLAS` — a new
surface outside every lens is how 213 write verbs once went uncovered behind three green reports.
Phone width at 390px with the panel open.

**Size.** ~120 lines.

---

## 7 · Drafter reads the highlight set

**Change.** `draft_v0.py::_load_rfp_context` currently does `full_text[:18000]`. On the real DoW 2026
SBIR BAA that prefix is the cover page, the release schedule and the table of contents; Navy's
component instructions begin at char 99,803, 5.5× beyond the window.

Replace the blind prefix with the highlight set, falling back to the prefix when a solicitation has no
highlights yet — so nothing regresses for un-curated solicitations.

**Verify.** Draft one section against a highlighted solicitation and confirm the context contains the
component instructions. Record input-token counts before and after: this should *reduce* cost as well
as improve relevance.

**Risk.** Highlight coverage becomes drafting quality. That is the intended trade, and it should be
visible — a solicitation with no highlights should say so at the gate, not silently draft from front
matter.

**Size.** ~40 lines.

---

## Cross-cutting

**Both scorers, every time.** Items 1, 3c and 4 each touch `bucket-ranking.ts` *and* `rescore.py`.
Item 2 exists to catch the time one is forgotten.

**Rescore after item 1**, and again after items 3 and 4 — stored scores are derived data and go stale
on every scoring change. Worth a small script rather than three ad-hoc passes.

**Verification gate at the end**, not per item: five lenses, the branch suite, `drive-ui-states`,
`capture-ui-atlas`, `probe-interaction-mobile`. New surfaces from items 5 and 6 must appear in the
catalog and atlas.

**Measurement to repeat at the end.** The four numbers that motivated this push — 296-char corpus, 42%
literal miss, 12-vs-50 score gap, 67% keyword weight — re-measured on the same box. If they have not
moved, the push did not work.

---

## What "done" looks like

- an admin highlights while curating, and types less than they do today
- those highlights are on the tenant's card, matchable and visible
- a card missing a field is not punished for it
- both scorers provably agree
- the drafter reads the component's rules instead of a table of contents
- the four motivating numbers have measurably moved

## What is not in this push

The dimensional model, agency vocabularies, the cross-agency bridge, TRL bands, eligibility gates,
vocabulary maintenance, and the `cms-postgres` collapse. All recorded, none of it this work.
