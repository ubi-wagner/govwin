# Opportunity matching — analysis, design, and what to build

**Supersedes** `OPPORTUNITY_MATCHING_ANALYSIS.md` and `HIGHLIGHTED_SECTIONS_DESIGN.md`, which were
written in sequence as the understanding changed. This is the consolidated account, including the two
places the reasoning turned.

**Question that started it:** an open topic mentioning manufacturing should reach an electronics
researcher whose work fits it. It does not. Why?

---

## 0 · The answer, up front

**The ranker reads ~296 characters of a document that is orders of magnitude larger, and matches them
with `String.includes`.** Nothing about the algorithm is the problem — no matcher, neural or
otherwise, can find a word that was never put in front of it.

The cost of that, measured:

| | n | mean score | max |
|---|---:|---:|---:|
| cards where literal keyword matching **hits** | 26 | **50** / 100 | 100 |
| cards where it **misses** | 19 | **12** / 100 | 67 |

**A card that misses scores four times lower.** That happens to **42% of scored cards**, and it
matters as much as it possibly could because real buckets set keywords and nothing else — making the
keyword factor **two-thirds of the entire score**.

The fix is not a better matching algorithm. It is **two thin things that multiply**, and both have to
move:

- **A thin corpus.** Give the matcher something to read — a curated set of highlighted passages, drawn
  from what the system extracted and what an admin marked, carried onto the tenant's card and shown to
  them as *"Sections Highlighted by System or Admin"* (§6).
- **A thin query.** The bucket editor is four free-text comma-separated boxes with no prefill, no
  taxonomy and no suggestions, so tenants fill the first and stop — which is *why* keywords are 67% of
  the score. The capability record that would fill the rest already exists, one page away, and nothing
  connects them (§8b).

Fixing the corpus alone makes the keyword factor more accurate without making it less load-bearing.

---

## 1 · How the reasoning got here — including where it was wrong

Recorded because both turns are load-bearing, and because the second was a mistake I would otherwise
have shipped.

**Turn one — the semantic axis is on the wrong side of the product.** The investigation began as
"should we buy Voyage for semantic atom retrieval?" The answer was no, and the reason generalised: the
atom library is a **closed vocabulary** — 303 atoms across 37 distinct tag values, with dimensions of
6, 5, 4, 4, 3, 3, 3, 3 — authored by the tenant, about their own recurring teams and technologies,
and then *rewritten* by the drafter anyway. The vector axis was built there. Meanwhile opportunity
ranking, where the vocabulary is genuinely open and adversarial, matches with substring tests.

**Turn two — "so match against `full_text`" was wrong, and dangerously so.** The corrected version is
§4. A solicitation is mostly FAR clauses, disclaimers and submission mechanics; matching that does not
add noise, it **inverts the signal**. Nearly every federal solicitation says *manufacturing* somewhere
in a domestic-sourcing clause, and because the keyword factor is `hits / keywords.length`, boilerplate
makes hits cheap enough that a genuine three-of-three and an accidental three-of-three score
identically. It gets worse as documents get longer — exactly backwards, since the long multi-topic
BAAs are where discrimination matters most.

**The correction that resolved it:** the corpus must be **curated, not raw**. Carry only what
something deliberately marked as meaningful. Boilerplate never enters, because nothing highlights it —
the *absence* of a highlight is the filter, with no stop-list to maintain.

---

## 2 · The chain, as built

```
source (DSIP / sbir.gov / grants.gov / admin upload / scout)
  └── stageIntake                   → curated_solicitations (status 'new')
      ├── SHRED                     → curated_solicitations.full_text
      │                                "every shredded document concatenated"
      │                                └── consumed ONLY by pattern-extract + skeleton
      │                                    (compliance variables, page limits, citations)
      └── CURATE (human)            → spotlight_summary, compliance variables, annotations
          └── approve → pushSolicitation
              gate: submission_format present · spotlight_summary present
              └── opportunity_bridge → tenant_opportunity_cards.card (jsonb)
                  │                    carries: dates, amounts, description, summary,
                  │                             expertNotes, lifecycle — NO documents
                  ├── scoreCard      → tenant_bucket_scores
                  │                    text = title + spotlightSummary + description + office
                  └── pin (opt-in)   → copyObject → customers/<slug>/pinned/<opp>/
                                       manifest in pinned_docs
```

**Two breaks are visible in the diagram.** `full_text` terminates at compliance extraction and never
reaches ranking. Documents cross into tenant space only on an explicit pin.

---

## 3 · Measurements

All from the live sandbox. Provenance and limits in §11.

### What the ranker reads

```
63 cards
  42  have a spotlightSummary
  49  have a description
  14  have NEITHER   → ranked on title + office alone            (22%)

ranked text:          mean 296 chars · min 76 · max 406
spotlight_summary:    mean 103 chars
```

### How it matches, and what that costs

`keywordHit` is a lowercased **substring** test, with a word-boundary rule for tokens ≤3 characters
so bare `ai`/`ml` stop hitting "email"/"html". No stemming, no lemmatisation, no synonyms, no term
weighting.

```
45 bucket scores · 19 with a keyword factor of exactly 0        → 42% literal miss

           keyword > 0 :  n=26   mean score 50   max 100
           keyword = 0 :  n=19   mean score 12   max  67
```

### Why the miss is so expensive — the weight model

Six factors, weighted: `keyword` 1 · `naics` 1 · `agency` 1 · `program` 1 · `accessibility` 1 ·
`timeline` 0.5, combined as a weighted average and scaled to 0–100. A factor only enters the
denominator if the bucket sets that criterion.

**Every real bucket sets keywords and almost nothing else:**

| Bucket | keywords | naics | agencies | programTypes | setAsides |
|---|---:|---:|---:|---:|---:|
| Additive Construction & 3D Printing | 7 | 0 | 0 | 0 | 0 |
| Advanced Manufacturing & Automation | 6 | 0 | 0 | 0 | 0 |
| Construction Technology & Housing | 6 | 0 | 0 | 0 | 0 |
| Materials — Concrete & Low-Carbon Cement | 6 | 0 | 0 | 0 | 0 |
| Non-dilutive Capital (SBIR/STTR & State) | 8 | 0 | 0 | 3 | 0 |

So the live denominator is `keyword 1 + timeline 0.5` — **the keyword factor is 67% of the score.**
A literal miss does not nudge a card down the list; it removes two-thirds of its score and leaves it
ranked by close date.

### For contrast — the library, where the vector axis was actually built

```
303 atoms · 37 distinct tag values · 8.2 atoms per tag
dimensions: vehicle 6 · context 5 · kind 4 · topic 4 · agency 3 · form 3 · format 3 · program 3
```

---

## 4 · Findings

**F1 · The ranking corpus is ~296 characters.** The root cause; everything else is downstream. An
open topic's breadth lives in its technology-area enumeration, which sits in `full_text` and never
reaches the ranker. Swapping substring matching for embeddings would embed *the same 296 characters*.

**F2 · A literal miss costs 4× the score, on 42% of cards.** Mean 12 versus 50, because keywords are
two-thirds of the weight in every bucket anyone actually authored.

**F3 · 22% of cards are ranked on title + office alone.** `pushSolicitation` **requires**
`spotlight_summary`; `opportunity_bridge` reads it `?? null` and does not. The gate exists in one path
while the table accepts rows from several.

**F4 · `expertNotes` is carried to the card and never matched.** A human-authored field, riding the
bridge, absent from `scoreCard`'s text. (Currently 0-populated, so this is latent rather than active
loss — but it is a second curated field going unused.)

**F5 · The release gate is already light, and already on the right field.** `REQUIRED_COMPLIANCE` is
`['submission_format']` plus a non-empty summary. No volumes, no mold skeletons, no completed matrix —
"release with minimum information" *is* the design, and `build_complete` (mig 182) governs the
proposal side separately. **The gate demands exactly one human artifact and it is the one the ranker
reads.** The lift is in the right place; it is 103 characters.

**F6 · Documents do not cross the bridge.** The card carries no manifest, so before pinning a tenant
cannot know the solicitation *has* four attachments and an amendment. Update propagation, by
contrast, works: republish sets `pin_update_available`, `amendments.ts` triggers it, resync re-copies.

**F7 · Two scorers must agree and nothing asserts it.** `scoreCard` (TS) and
`rescore.py::_keyword_hit` are a deliberate mirror pair with a comment saying so and no test.

**F8 · The Ingest Studio phase machine governs nothing yet.** `ingest_phase` is `not_started` on all
18 rows; mig 189's `extract → matrix → review → landed → molds → complete` applies only to rows
created after it.

---

## 5 · The open-topic case

A DoD open topic, in its full text:

> *…innovations across additive manufacturing, directed energy deposition, embedded sensing and
> instrumentation, power electronics, and thermal management for expeditionary systems…*

The admin writes: *"Open topic for expeditionary basing technologies — broad scope, multiple award."*
An electronics researcher's bucket holds `power electronics`, `embedded sensing`, `thermal management`.

**Today — score 0.** All three keywords are in the solicitation; none are in the 296 characters the
ranker reads. With keywords at two-thirds of the weight, the card lands at a mean of ~12/100 and is
effectively ranked by close date. The fit is real, and the tenant never sees it.

**The failure is specific to open topics, and worst where the opportunity is most valuable** — a
broad topic is one many tenants could win, and breadth is precisely what a short summary compresses
away.

---

## 6 · The design — Highlighted Sections

**Carry the text something deliberately marked as meaningful, and show it to the tenant.**

```
                    ┌── SYSTEM highlights ──┐
full_text ──────────┤  pattern-extract      ├──┐
                    │  rule + excerpt +     │  │
                    │  offset + page        │  │     ┌──────────────────┐
                    └───────────────────────┘  ├────▶│  HIGHLIGHT SET   │
                    ┌── ADMIN highlights ───┐  │     │ (curated corpus) │
curation UI ────────┤  solicitation_        ├──┘     └────────┬─────────┘
                    │  annotations          │                 │
                    │  kind='highlight'     │       ┌─────────┴──────────┐
                    │  + actor + location   │       │                    │
                    └───────────────────────┘       ▼                    ▼
                                             matching digest      tenant-visible panel
                                             (summary + text)     "Sections Highlighted
                                                    │              by System or Admin"
                                                    ▼
                                          scoreCard + rescore.py
```

Three properties fall out, each worth more than the matching gain:

**Self-limiting.** Boilerplate never enters, because nothing highlights it.

**Provenance by construction.** A highlight is system-fired (which rule, which offset, which page) or
admin-placed (which actor, when) — mapping onto the order the ingest work already established,
`hitl > verified > override > pattern_match > ai > default`, and its governing rule: *a value the
product did not read from the solicitation must never look like one it did.*

**The summary becomes derivable.** Generated from the highlight set, editable, and **regenerable at
the review gate** — with its own provenance, so a reader can distinguish an admin's own words from a
generated draft they accepted. One click after adding a highlight, not a rewrite.

---

## 7 · The document invariant

**Stated:** every upload rides the opportunity through — across the bridge and into tenant space — on
creation, on update, and on a later upload to the OPP. Whether implemented as push-on-bridge or as
pin-to-pull, **the foundational uploads must remain accessible to the tenant as published by the
issuing organization.** Copy-inward, never reference — the rule the atom library and template bridge
already follow.

| | Today |
|---|---|
| update / new upload propagates | ✅ republish sets `pin_update_available`; `amendments.ts` triggers it; resync re-copies and clears, with a watched-holder notification |
| accessible **as published** | ✅ once pinned — `copyObject` is a byte copy, not a re-render or an extract, `sourceKey` kept for lineage |
| rides across the bridge | ❌ the card carries **no document manifest** |
| into tenant space on creation | ❌ the copy happens on *pin* |

Both gaps are one gap: **before pinning, a tenant cannot see the documents exist.** They are deciding
whether to pursue without knowing what is in it.

### What that requires of the design

**R1 · A highlight carries its excerpt TEXT, not only its anchor.** An anchor is
`{page, offset, length, docSegment}` into `full_text`, and an unpinned tenant **has no document for it
to resolve against** — a panel built on anchors alone renders empty for exactly the tenants it exists
to persuade. Text rides the card; the anchor rides too and goes *live* on pin, resolving against the
tenant's own copy, never a central one.

**R2 · The card carries a document manifest.** Filename, type, size, published date, amendment flag.
No bytes. A field on a jsonb column — no migration — riding the existing forward-only republish. It
also makes `pin_update_available` legible: today the flag says *something changed*; with a manifest it
says **which document arrived**.

**R3 · Highlights survive a republish, or say they cannot.** A new document changes `full_text`, so
every offset after the insertion point moves. System highlights are re-derived and fine; **admin
highlights are hand-placed against offsets a later upload silently invalidates.** The excerpt text is
the recovery path — re-locate by search, and where the text is gone mark the highlight **stale for
review** rather than deleting it or leaving it pointing at whatever now occupies those bytes. Same
principle as the ruler: never claim a page we did not resolve.

**On auto-copy.** The invariant permits pin-to-pull, and pull is the right default: copy-on-creation
multiplies storage by tenants × opportunities for documents most tenants never open, against a bucket
already at 817 MB. **R2 delivers the guarantee at near-zero cost** — the manifest makes documents
visible and therefore accessible; the pin makes them the tenant's own. Auto-copy for a subset
(pinned, pursued, watched) is later a policy on an existing mechanism, not a redesign.

---

## 8 · What exists, and what is actually new

| Piece | Status |
|---|---|
| Admin highlight capability | **built, unused** — `solicitation-save-annotation.ts`, `kind:'highlight'`, `{page, offset, length, bbox?}`, `actor_id`, emits an event, wired into `/admin/rfp-curation/[solId]` |
| Annotation storage | **built** — `solicitation_annotations`, migration 009 |
| System excerpt extraction | **built, narrow** — `SourceAnchor` carries excerpt, offset, page, `pageResolved`, `docSegment` — but fires only for *compliance* rules |
| Provenance model | **built** — mig 187 `field_provenance`, mig 188 the contract |
| Card carrier | **built** — the card is jsonb; adding fields is not a migration |
| Summary editor at the gate | **built** — and push already refuses without a summary |
| Document copy + update propagation | **built** — pin, resync, `pin_update_available`, amendment trigger |
| Postgres text search | **installed, unused for ranking** — `pg_trgm` + `tsvector` since migration 001 |
| `scoring_strategist` | **designed, registered, dormant** — Haiku overlay, tenant profile + past win/loss, −15..+15 with rationale, factor breakdown and confidence, recalibrating on `capture.proposal.outcome_recorded` |

**Genuinely new work is one item:** system highlighting for *scope*, not just compliance. Deterministic
rules first — a topic's `TECHNOLOGY AREAS` block, an `AREAS OF INTEREST` heading, the DSIP
topic-description field — same engine, new rule family, no key and no model. An AI pass afterwards for
the rest, stamped `ai` so it reads visibly weaker than a pattern match or an admin highlight, and
bounded to *propose*, never auto-confirm.

Everything else is wiring.

---

## 8b · The other half — bucket authoring

Ranking is a query against a corpus. §1–§7 fixed the corpus. **The query is thin for its own,
independent reason**, and the two multiply.

### What a tenant is actually asked for

The bucket editor is **four free-text, comma-separated inputs**:

```
placeholder="Name (e.g. AF Autonomy)"
placeholder="keywords, comma-sep"
placeholder="agencies, comma-sep"
placeholder="program types (SBIR, STTR)"
                         …and NAICS
```

No dropdowns. No checkboxes. No taxonomy. No prefill. No suggestion. Each field is an unaided act of
recall, typed from memory, with no visible consequence for leaving one blank.

**That is the causal explanation for the weight concentration in §3.** It is not that tenants do not
care about NAICS or agencies — it is that every additional field is another memory exercise, so people
fill the first one and stop. Four of five buckets: keywords only.

### The capability record already exists, and nothing connects it

`tenant_profiles` is a column-for-column match for what a bucket needs:

| `tenant_profiles` | `BucketCriteria` |
|---|---|
| `naics_codes` | `naics` |
| `keywords` | `keywords` |
| `agency_priorities` · `target_agencies` | `agencies` |
| `set_aside_types` | `setAsides` |
| `technology_focus` · `research_areas` · `company_summary` | *(no equivalent — rich, unused)* |

It is collected at `/portal/[tenant]/profile`, read by the dashboard, the manage page and the agent
tools. **It is not read by bucket authoring.** A tenant fills in their capability profile, walks to
the buckets page, and types keywords again from memory.

And the profiles are barely populated — of two rows: one is empty across every field; the other has
7 keywords, 3 research areas, 97 characters of technology focus and a 350-character company summary,
with **zero** NAICS, agencies or set-asides. Same cause, one screen earlier.

### The multiplication

```
thin corpus  ·  the ranker reads 296 characters          (§1)
thin query   ·  the bucket carries one signal            (§8b)
             ─────────────────────────────────────────
             a 42% miss rate that costs two-thirds of the score
```

Fixing either alone helps. **Fixing the corpus while buckets still carry one signal leaves the whole
score resting on that one signal being right** — a better corpus makes the keyword factor *more*
accurate, not less load-bearing. They have to move together.

### What already exists for the fix

| Piece | Status |
|---|---|
| `tenant_profiles` | **built, unconnected** — the exact fields, collected on its own page |
| `taxonomy_terms` | **built, seeded** — controlled vocabularies: agency 18 · kind 16 · party_role 11 · dept 11 · vol 39 · program 7 · phase 7 · fmt 6 · access 4 |
| `library_atoms` + `atom_tags` | **built, populated** — evidence of what the tenant actually does, across 8 tag dimensions |
| `onboarding_agent` | **designed, registered, dormant** — its stated outputs are *"profile enrichment suggestions", "spotlight buckets to seed", "readiness assessment (profile / library / buckets)"*, with tools `get_onboarding_context`, `search_library`, `get_tenant_profile` |
| Authoring authority | **built** — `canManageBuckets`: tenant_admin+, or a delegated member with `can_manage_buckets` (mig 181); cap 25, rfp-admin settable |

**The agent designed to do exactly this is already in the roster and asleep.**

### The design — evidence-based authoring, not recall

**B1 · Prefill from the profile.** *"Start from our company profile"* fills naics, agencies,
set-asides and keywords in one click. The tenant edits rather than recalls. Zero new data.

**B2 · Suggest from the library.** A tenant's atoms and their tags are evidence of what they do —
far better evidence than what they remember on a Tuesday. Tag values map onto programme and vehicle
criteria directly; atom text mines candidate keywords. *"Suggest criteria from my library."*

**B3 · Controlled vocabulary where one exists.** `taxonomy_terms` already holds agency (18),
programme (7) and phase (7). Those become **dropdowns and checkboxes**, not comma-separated recall.
Keywords stay free text — that dimension is genuinely open — but with suggestions from B2 beside it.

**B4 · Make the weight consequence visible.** This is the smallest change and possibly the highest
leverage. A bucket carrying only keywords should say so:

> *This lens scores on 1 of 6 signals. Keyword matches are **67%** of its score — a solicitation
> that words things differently will rank near the bottom. Add agencies or NAICS to spread it.*

That number is already computable from the criteria; it is the weight model told back to the person
who set it. It makes the problem self-correcting instead of invisible.

**B5 · Require breadth, not atoms specifically.** A hard requirement to include atoms fails the
brand-new tenant who has none. **Require ≥2 signal dimensions**, with B1/B2 making the second one
nearly free. Atoms are the best *source* when present, not a gate.

**B6 · Wake `onboarding_agent` to propose the first set.** Advisory, per the fabric contract — it
proposes buckets and profile enrichment; a human accepts. A new tenant then arrives with lenses
derived from their own uploaded past performance rather than a blank form and a comma placeholder.

---

## 9 · Sequence

1. **Carry admin annotations onto the card and match them.** Wiring, not invention; immediately useful
   for any solicitation an admin annotates. Both scorers together (F7).
2. **`tsvector`/`ts_rank` + `pg_trgm` instead of `String.includes`.** Already installed. Stemming alone
   makes `manufacturing` match `manufacture`/`manufactured`. Zero cost, zero subprocessor.
3. **The tenant panel (R1) and the document manifest (R2).** Small, and they are what make admins
   *want* to annotate — the lift becomes visible to the customer instead of vanishing into a score.
4. **Deterministic system highlight rules.** Now the set fills itself and the admin's job becomes
   confirm-and-correct rather than find-and-type — the right division given the variety the shredder
   meets.
5. **Summary generation from highlights, regenerable at the gate**, with provenance.
5b. **Bucket authoring: prefill (B1), the weight-consequence line (B4), taxonomy dropdowns (B3).**
   B4 alone is a few hours and tells every tenant why their lens is fragile. Do it early — it is the
   cheapest item in this entire document and it changes behaviour rather than code.
5c. **Library-derived suggestions (B2) and `onboarding_agent` (B6).**
6. **`scoring_strategist`, last.** An LLM overlay on 296 characters inherits the same blindness; over a
   curated corpus it is doing the job it was designed for. ~$20–25/month platform-wide at 100 tenants.

**Independently, and early: a parity test for the two scorers.** It is a documented invariant with no
test, and every step above changes both sides of it.

---

## 10 · What this does not solve

- **An un-curated solicitation still matches on title alone.** The 22% carrying neither summary nor
  description (F3) are untouched until that path is closed — either require the summary at the bridge
  as well as at push, or render those cards distinctly so nobody reads *unranked* as *poor fit*.
- **Highlight quality becomes curation quality, visibly.** That is the point, and it means a rushed
  curation now produces a poorly-matched opportunity on the tenant's own screen. The right trade, but
  a deliberate one.
- **It remains lexical.** A highlight saying *directed energy deposition* will not match a bucket keyed
  on *additive manufacturing* unless something relates them. That is precisely where step 6 earns its
  place — and why it is last rather than never.
- **Bucket authoring is untouched.** Every measured bucket sets keywords and nothing else, which is
  what makes keywords 67% of the score. Better tenant-side guidance on NAICS, agencies and programme
  types would spread the weight and reduce the blast radius of any single factor.

---

## 11 · Provenance of these numbers, and their limits

Every figure is from the live sandbox at migration head 237, measured directly rather than estimated.
Three limits, stated because they change how much weight the numbers carry:

- **`full_text` is seeded, not shredded** — populated on 6 of 18 solicitations, averaging 147
  characters, because the fixtures were seeded rather than parsed from real BAAs. The *shape* of F1
  does not depend on this (the ranker's inputs are structurally the card's four short fields) but the
  **size of the win from a widened corpus is understated here.**
- **`solicitation_documents` has 0 rows.** The pin copy path, the manifest, and every offset-based
  anchor in R1–R3 are untested against real documents on this box. **Shred one real multi-document
  BAA before building them** — particularly for `docSegment` numbering across a file boundary, which
  is where anchors are most likely to be wrong.
- **45 bucket scores across 5 buckets and 63 cards** is a small sample. The 42% miss rate and the
  12-versus-50 gap are consistent with the mechanism rather than proof of its magnitude at scale;
  re-measure once a real corpus exists.
