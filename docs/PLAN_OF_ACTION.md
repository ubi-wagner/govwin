# Plan of action — connecting what already exists

Built directly from the thirteen findings in `ALIGNMENT_INGEST_TO_RANKING.md`. Every step connects
things already in the system.

**Six steps.** Steps 0–3 are the work; 4–5 make it usable and measurable.

---

## Status — steps 0, 1, 2 and 3 are SHIPPED (mig 238)

> The one architectural decision this plan did not anticipate: **copy the solicitation inward.**
> The plan assumed the ranking corpus would be reached by a mirror-anchored JOIN to the master, and
> that was overruled for a reason stronger than isolation — **the master is mutable.** An amendment
> re-shreds `full_text`, so a tenant ranking against a joined master would see stored scores move
> with no bridge version, no card update and no audit, which is the one thing a forward-only bridge
> exists to prevent. The copy makes the corpus versioned WITH the card, so a score is reproducible
> from the row that produced it. So there IS one new table, and it earns its place.

| | |
|---|---|
| **0 · parity harness** | ✅ `verify-scorer-parity.mjs`, 37 fixtures, red-tested twice, wired into the branch suite so a divergence FAILS the run. Needed `lib/bucket-scoring.ts`, a zero-import leaf. **It found a live divergence before the comparator ran**: `new Date('Fri Aug 28')` is valid in JS and raises in Python |
| **1 · abstention** | ✅ all five factors guard both sides; a non-matching value is still a real 0. **0 of 45 stored pairs moved** — latent while buckets stay thin, exactly as F11 predicted, and no longer a trap under step 4 |
| **2 · `tech_focus_areas`** | ✅ plus `phaseType`, `topicNumber`, `topicBranch`, `topicStatus`, `pocName`, `pocEmail`, and a document manifest |
| **3 · the corpus** | ✅ **not** the planned join, and **not** blocked. `tenant_opportunity_documents` (mig 238) holds each source document per tenant with a GENERATED `text_tsv`; one SQL pre-pass feeds a `corpus` factor to the still-pure scorer. Ranking reads **no master table at all** |
| **4 · tenant side** | ✅ prefill from `tenant_profiles` (fills, never replaces; an empty profile says so) + a composition line computed off `DEFAULT_WEIGHTS`, the table `scoreCard` itself reads. Driven as all three actors, the delegated one in **both** directions |
| **5 · attribution** | ✅ and F13 was misdiagnosed: the write EXISTED, in a route whose own comment says the product never calls it. One shared `resolveSourceBucket` now backs both paths. Existing rows deliberately **not** backfilled |
| **6 · re-measure** | ✅ below |

**Measured on a real 433-page solicitation** (`drive-corpus-copy-inward.mts`, 16 checks, red first;
`measure-ranking-change.mts`):

```
ranking corpus          296 chars  →  660,425 mean per document      2,231×
corpus lexemes vs card       35    →  11,409                           326×
scores that exist ONLY because the solicitation matched:  4
   (corpus 100, keyword 0 — the card's own text matched none of them)
storage                 9,245,943 chars → 21 MB   (16 MB TOAST + 5 MB GIN)
```

**R2 is dissolved rather than done.** *"Does the topic land at char 20,000 or char 1,040,000?"* was
only a question because `full_text` is a concatenation. The copy keeps documents **separate**, so a
consumer selects by `document_type` and there is no order to get wrong.

**R1 is now cheap and still not done.** The drafter's `full_text[:18000]` prefix has its fix sitting
right there — per-document text, selectable by type — but it is a different consumer, so it stays
out of this push until asked for.

### Step 6 · the four motivating numbers

| | before | after |
|---|---|---|
| ranking corpus | **296 chars** | **660,425** per copied document — 2,231× |
| literal miss rate | 42% of scored cards | **4 scores now exist that did not**, on a card whose own text matched none of their keywords |
| score gap on a miss | 12 vs 50 of 100 | those four moved **0 → 33** |
| keyword share of the score | 67%, invisible | **stated on the form**, computed from the scorer's own table |

Re-ranking is **idempotent**: a second full pass moves nothing. And the abstention fix moved **0 of
45** stored pairs — latent while buckets stay thin, exactly as F11 predicted, which is why it had to
land before prefill rather than after.

**Honest limit.** One of nine opportunities on this box carries a corpus, because one is all that has
been through a real ingest. The mechanism is proven end to end on a real 433-page solicitation; the
*population* is a seeding question, not a code one.

---

## Step 0 · Parity harness — the safety net

**Why first.** Steps 1, 2 and 3 each change `scoreCard` (TS) *and* `rescore.py` (Python). They are a
deliberate mirror pair with a comment saying so and **no test asserting it**. This session already
found them mirroring each other *including a bug*.

**Build.** A shared fixture file (cards × criteria × `now`), a TS runner and a Python runner each
emitting JSON, and a comparator. Register in `run-branch-drives.sh`, which already dispatches `.py`.

**Fixtures must include the asymmetric cases** — a card missing each field, a bucket setting each
criterion alone, an unparseable close date, empty criteria.

**Red first.** Change one weight on one side; confirm the comparator fails and names the factor.

**Size.** ~150 lines, half fixtures. **Risk.** None — additive.

---

## Step 1 · Abstention fix (F11)

**What.** `agency`, `naics`, `program`, `accessibility` guard only the bucket side, so a card missing
the field scores **0** and still enters the denominator. Add a card-side guard to each, matching the
shape `timeline` already uses.

**Why here.** It is a correctness bug, and it **blocks step 4** — prefill pushes `naics` and
`setAsides` into criteria against card fields populated 0/22 and 4/22, so prefill shipped first would
lower every tenant's scores.

**Files.** `frontend/lib/bucket-ranking.ts` · `pipeline/src/workflows/actions/rescore.py`.

**Risk — plan for it.** This **changes every stored score**. `tenant_bucket_scores` needs a deliberate
full recompute, with before/after distributions recorded so the movement is observable rather than
mysterious.

**Size.** ~20 lines + a rescore pass.

---

## Step 2 · `tech_focus_areas` crosses the bridge (F6)

**What.** Add it to the card payload in `opportunity-bridge.ts`, and to the matched text in both
scorers.

**Why this is the cheapest real win.** The signal is already extracted by the AI shred, already
editable by the rfp_admin, already read by `capture_strategist`. Only the data flow drops it. Values
are exactly right: `autonomous`, `ai/ml`, `hypersonic`, `lidar`, `mems`, `multi-sensor fusion`.

**Carry `phase_type` in the same edit** — same drop, same fix, and Phase I vs Direct-to-Phase-II is a
real discriminator for a small business.

**Verify.** A bucket keyword matching only a tech focus area scores > 0 where it scored 0.

**Size.** ~30 lines across three files. **Risk.** Card payload growth — negligible for two fields.

---

## Step 3 · Stemmed matching — over the mirror, not the master (F10)

> **Revised after measurement.** The first version of this step said *"use the full-text index that has
> been there since migration 001."* Both existing indexes were then measured, and **neither contains a
> single field the rfp_admin curates** (F10). Using either as written would have been a regression. The
> step below is what the measurement supports.

**The design decision, stated plainly.** `scoreCard` is a **pure function**; a tsvector lives in
Postgres. Do **not** move scoring into SQL — that splits the runtimes and makes parity untestable.
One SQL pre-pass supplies one more input; the scorer stays pure, mirrored and testable.

**And the index must be mirror-side.** The scored thing is the card. `tenant_opportunity_cards` is
FORCE-RLS; `opportunities` and `curated_solicitations` are RLS-off platform scope, so a master-anchored
query is unfenced — from one tenant's context it sees **18 solicitations and 22 opportunities against
their 9 cards.** Anchoring on the mirror is what makes RLS the fence (verified: 9 cards visible, 9 after
joining outward to the master).

### 3a · A generated tsvector on the card — works today

```sql
ALTER TABLE tenant_opportunity_cards ADD COLUMN card_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('english',
    COALESCE(card->>'title','')            || ' ' ||
    COALESCE(card->>'spotlightSummary','') || ' ' ||
    COALESCE(card->>'description','')      || ' ' ||
    COALESCE(card->>'office','')           || ' ' ||
    COALESCE(card->>'agency','')           || ' ' ||
    COALESCE(card->>'techFocusAreas','')   -- arrives with step 2
  )) STORED;
CREATE INDEX idx_toc_tsv ON tenant_opportunity_cards USING GIN (card_tsv);
```

**Proven on the box**, not asserted: the expression is accepted, and on a probe row it stems
`printing`→`print` and `manufacturing`→`manufactur` *and* matches `grant` from `spotlightSummary` —
the exact case `opportunities.full_text_tsv` misses.

⚠️ **`concat_ws` is rejected** — *"generation expression is not immutable."* The `COALESCE(…) || ' ' || …`
form above is the one that compiles. The obvious way to write it fails.

**What this buys, honestly.** Stemming over the corpus we already have — *not* more corpus. Against the
five live buckets it gains 4 card-hits and, unlike the `opportunities` index, loses none. It also
retires work the tenants are visibly doing by hand: `print`/`printing`, `material`/`materials`,
`robotic`/`robotics`, `automated`/`automation` are all separate keywords in the live lists today.

**It composes with step 2 for free** — adding `techFocusAreas` to the card payload puts it in the index
in the same migration.

### 3b · The deep corpus — blocked, and say so

`curated_solicitations.full_text_tsv` is the **entire shredded solicitation**, `GENERATED ALWAYS`,
GIN-indexed, maintained by Postgres for free. It is reached by a mirror-anchored join:

```
tenant_opportunity_cards ⋈ opportunities ⋈ curated_solicitations
```

**The join is proven for all 63 cards. The data is not there.** `full_text` is non-empty on 6 of 18
solicitations, mean **147 characters**, and on **0 of the 63 card-bearing ones** — the fixtures were
seeded, never shredded. So `ts_rank` over it would abstain for every card on this box, and the step's
*value* is unmeasurable until a real solicitation goes through the product.

Do not ship 3b on a green from seeded data. It gates on **R2** — a real multi-document ingest — and
seven real BAAs and five CSOs have been sitting in `docs/` untouched.

**Weighting.** Whichever half lands, `fullTextRank` **abstains when null** (consistent with step 1) and
starts *below* the existing keyword factor so it assists rather than overrides. Measure before raising.

**Verify.** The 42% literal-miss set: how many now score > 0, 3a alone. Compare rank ordering against
the keyword factor on the same cards.

**Size.** 3a ~60 lines + a migration. 3b ~40 more, after R2.

---

## Step 4 · Connect the tenant side (F8, F9)

**Prefill.** *"Start from our company profile"* fills `naics`, `agencies`, `set_asides`, `keywords`
from `tenant_profiles` — a column-for-column match, collected on the profile page, currently unread by
bucket authoring. The tenant edits rather than recalls.

**Composition line.** *"This lens scores on 1 of 6 signals — keyword matches are 67% of its score."*
Computed from the criteria object; pure display.

**Why after 1–3.** Prefill is only safe once abstention is fixed, and the composition line should
describe the scoring as it will be, not as it was.

**Verify.** Drive as `tenant_admin`, as a delegated member with `can_manage_buckets`, **and as an
rfp_admin in the shadow path** — all three can author, and the shadow path is confirmed working.

**Size.** ~100 lines, mostly UI.

---

## Step 5 · Close the loop (F13)

**What.** Populate `proposals.source_bucket` and `origin_card.bucket` at provisioning. Both are
defined; neither is written.

**Why it matters more than its size suggests.** It is the only way to answer *"which lens surfaced the
opportunity that became this build."* Without it, steps 1–4 cannot be judged by outcome — only by
score distribution.

**Size.** ~20 lines. **Do it early if convenient** — it costs almost nothing and starts accumulating
evidence immediately.

---

## Step 6 · Re-measure and gate

**The four numbers that motivated this**, re-measured on the same box:

| | Before |
|---|---|
| ranking corpus | 296 chars |
| literal miss rate | 42% of scored cards |
| score gap on a miss | 12 vs 50 of 100 |
| keyword share of the score | 67% |

**If they have not moved, the work did not land.**

**Validation gate.** Five lenses, the branch suite, `drive-ui-states`, `capture-ui-atlas`,
`probe-interaction-mobile` at 390px. New surfaces from step 4 must join `UI_CATALOG` and `UI_ATLAS`.

---

## Deliberately not in this plan

| | Why |
|---|---|
| **Highlights on the card** (F7) | `solicitation_annotations` has 0 rows *and* `save-annotation` captures no excerpt text — two changes plus UI. ~~Step 3 may make it much less urgent.~~ **Reinstated as a live question:** step 3a adds stemming, not corpus, and 3b is blocked on a real shred — so nothing in this plan closes the 296-character gap. Re-evaluate at step 6 with that in hand. |
| **Waking `scoring_strategist` / `onboarding_agent`** (F12) | both dormant by design; an LLM overlay is worth more once the deterministic signals are connected |
| **Surfacing `techFocusAreas` at solicitation-level curation** (F3) | a genuine gap, but step 2 makes the *existing* per-topic data useful first. Do it if step 6 shows coverage is the limiter |
| **The drafter's context window** (R1) | real and expensive — the 18,000-char prefix on a 330-page BAA is the table of contents — but it is a **different consumer**. Adjacent work, your call whether it rides along |

---

## Sequence and effort

```
0   parity harness     ~150 lines   additive, no risk
1   abstention fix      ~20 lines   + full rescore
2   tech_focus_areas    ~30 lines   + rescore
3a  card_tsv + stem     ~60 lines   + a migration; composes with step 2
3b  deep corpus         ~40 lines   BLOCKED on R2 — a real shred
4   tenant side        ~100 lines   UI, three actor paths
5   attribution         ~20 lines   do early if convenient
6   re-measure + gate        —      the verdict
```

**Roughly 400 lines of code**, every one of them a connection between parts that already exist —
with **3b the one piece that cannot be validated on this box** and must not be shipped on a green from
seeded data.

**Start at 0 and 1** — the harness and the correctness fix. Neither depends on a decision, both are
prerequisites, and step 1 is the one that must land before the tenant side is touched.
