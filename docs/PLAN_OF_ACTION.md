# Plan of action — connecting what already exists

Built directly from the thirteen findings in `ALIGNMENT_INGEST_TO_RANKING.md`. Every step connects
things already in the system. **No new architecture, no new vocabularies, no new tables.**

**Six steps.** Steps 0–3 are the work; 4–5 make it usable and measurable.

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

## Step 3 · Use the full-text index that has been there since migration 001 (F10)

**The design decision, stated plainly.** `scoreCard` is a **pure function**; `full_text_tsv` lives in
Postgres. Do **not** move scoring into SQL — that splits the runtimes and makes parity untestable.

Instead: **one SQL pre-pass supplies one more input.**

```
for each bucket:
    SELECT solicitation_id, ts_rank(full_text_tsv, websearch_to_tsquery('english', <keywords>))
    FROM curated_solicitations
    WHERE full_text_tsv @@ websearch_to_tsquery('english', <keywords>)
        ↓
    scoreCard(card, criteria, now, { fullTextRank })   ← still pure, still mirrored, still testable
```

`fullTextRank` becomes a scoring factor that **abstains when null** — consistent with step 1.

**Why this is the corpus fix.** `curated_solicitations.full_text_tsv` is `GENERATED ALWAYS` from
`full_text` — the **entire shredded solicitation**, stemmed, GIN-indexed, maintained by Postgres for
free. It closes the 296-character gap without highlights, without new storage, without a
subprocessor. Verified working: `websearch_to_tsquery('manufacturing')` already ranks through
`idx_csol_fts`.

**It also gets stemming for free** — `manufacturing` matches `manufacture`, `manufactured`.

**Verify.** The 42% literal-miss set: how many now score > 0. Compare `ts_rank` ordering against the
keyword factor on the same cards.

**Size.** ~80 lines: one query in each runtime, one factor in each scorer, weight to be chosen.
**Risk.** Weight calibration — start it *below* the existing keyword factor so it assists rather than
overrides, and measure before raising.

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
| **Highlights on the card** (F7) | `solicitation_annotations` has 0 rows *and* `save-annotation` captures no excerpt text — two changes plus UI. **Step 3 may make it much less urgent**: the tsvector already covers the full document for keyword matching. Re-evaluate after step 6. |
| **Waking `scoring_strategist` / `onboarding_agent`** (F12) | both dormant by design; an LLM overlay is worth more once the deterministic signals are connected |
| **Surfacing `techFocusAreas` at solicitation-level curation** (F3) | a genuine gap, but step 2 makes the *existing* per-topic data useful first. Do it if step 6 shows coverage is the limiter |
| **The drafter's context window** (R1) | real and expensive — the 18,000-char prefix on a 330-page BAA is the table of contents — but it is a **different consumer**. Adjacent work, your call whether it rides along |

---

## Sequence and effort

```
0  parity harness      ~150 lines   additive, no risk
1  abstention fix       ~20 lines   + full rescore
2  tech_focus_areas     ~30 lines   + rescore
3  full_text_tsv        ~80 lines   + rescore, weight calibration
4  tenant side         ~100 lines   UI, three actor paths
5  attribution          ~20 lines   do early if convenient
6  re-measure + gate         —      the verdict
```

**Roughly 400 lines of code across six steps**, every one of them a connection between parts that
already exist.

**Start at 0 and 1** — the harness and the correctness fix. Neither depends on a decision, both are
prerequisites, and step 1 is the one that must land before the tenant side is touched.
