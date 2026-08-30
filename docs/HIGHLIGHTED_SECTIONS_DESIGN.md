# Highlighted Sections — a curated matching corpus, visible to the tenant

> **SUPERSEDED — see `docs/OPPORTUNITY_MATCHING.md`.**
> This file is kept for the record: it shows the reasoning as it stood, including the two places it
> turned. The consolidated analysis carries the corrected design and the measurements that decided it.

**Supersedes** initiative I1 in `docs/OPPORTUNITY_MATCHING_ANALYSIS.md`, which proposed matching
against `full_text`. That was wrong for a reason worth recording.

---

## 1 · Why not `full_text`

A solicitation is mostly boilerplate. FAR clauses, disclaimers, standard representations and
certifications, submission mechanics, evaluation legalese — text that is near-identical across every
DoD BAA and carries no signal about what the opportunity *is*.

Matching against it does not merely add noise; it **inverts the signal**:

- **False positives dominate.** Nearly every federal solicitation says "manufacturing" somewhere in a
  FAR clause about domestic sourcing. A bucket keyed on `manufacturing` would hit everything.
- **The denominator is destroyed.** `scoreCard`'s keyword factor is `hits / keywords.length`. Boiler-
  plate makes hits cheap, so a genuine three-of-three match and an accidental three-of-three match
  score identically.
- **It gets worse as the document gets longer**, which is exactly backwards — the longest documents
  are the multi-topic BAAs where discrimination matters most.

So the corpus must be **curated, not raw**. The question is who curates it and how cheaply.

---

## 2 · The design

**Carry the text that something deliberately marked as meaningful — and show it to the tenant.**

```
                    ┌── SYSTEM highlights ──┐
full_text ──────────┤  pattern-extract      ├──┐
                    │  rule fired + excerpt │  │
                    └───────────────────────┘  │      ┌─────────────────┐
                                               ├─────▶│ HIGHLIGHT SET   │
                    ┌── ADMIN highlights ───┐  │      │ (curated corpus)│
curation UI ────────┤  solicitation_        ├──┘      └────────┬────────┘
                    │  annotations          │                  │
                    │  kind='highlight'     │        ┌─────────┴─────────┐
                    └───────────────────────┘        │                   │
                                                     ▼                   ▼
                                            matching digest        tenant-visible
                                            (+ summary)            "Sections Highlighted
                                                     │              by System or Admin"
                                                     ▼
                                                 scoreCard
```

Three properties fall out of this shape, and each is worth more than the matching improvement:

**It is self-limiting.** Boilerplate never enters the corpus because nothing highlights it. No
stop-list to maintain, no FAR-clause filter to keep current — the absence of a highlight *is* the
filter.

**It carries provenance by construction.** A highlight is either system-fired (which rule, which
offset, which page) or admin-placed (which actor, when). That maps directly onto the trust order the
ingest-provenance work already established — `hitl > verified > override > pattern_match > ai >
default` — and onto its governing rule: *a value the product did not read from the solicitation must
never look like one it did.*

**It makes the summary derivable instead of typed.** Today the admin writes a 103-character blurb
from scratch. With a highlight set, the summary is **generated from the highlights and regenerable at
the gate** — and regenerating it after adding a highlight is one click rather than a rewrite.

---

## 3 · What already exists

Substantially more than I expected.

| Piece | Status |
|---|---|
| **Admin highlight capability** | **built** — `solicitation-save-annotation.ts` / `-delete-annotation.ts`, `kind: 'highlight' \| 'text_box' \| 'compliance_tag'`, `sourceLocation {page, offset, length, bbox?}`, `actor_id`, emits an event. Wired into `/admin/rfp-curation/[solId]`. |
| **Annotation storage** | **built** — `solicitation_annotations` since migration 009 |
| **System excerpt extraction** | **built, narrow scope** — `pattern-extract` produces a `SourceAnchor` per fired rule carrying the matching **excerpt**, its character offset into `full_text`, the page, `pageResolved` (never claims a page it did not resolve), and `docSegment` (which file, since page numbers restart per document) |
| **Provenance model** | **built** — mig 187 `field_provenance`, mig 188 documents the contract |
| **Tenant card carrier** | **built** — `tenant_opportunity_cards.card` is jsonb; adding a field is not a migration |
| **Summary editor at the gate** | **built** — `spotlight-summary-editor.tsx`, and `pushSolicitation` already refuses to release without a summary |

**The mechanisms are there. What is missing is the wiring between them** — plus one genuinely new
capability.

---

## 4 · What is missing

### M1 · System highlighting only fires for compliance rules

`pattern-extract` lifts page limits, fonts, margins, submission format — the things a *builder* needs.
It does not lift the things a *matcher* needs: scope statements, technology areas, the "areas of
interest" enumeration that makes an open topic broad.

This is the one real piece of new work. Two ways, and they compose:

- **Deterministic rules** for the structural cases — a topic's `TECHNOLOGY AREAS:` block, an
  `AREAS OF INTEREST` heading, the DSIP topic-description field. Same engine, new rule family, no key
  and no model. These are the highest-confidence highlights and should be tried first.
- **An AI pass** for the rest, stamped `ai` in the provenance order so it is visibly weaker than a
  pattern match and visibly weaker than an admin highlight. Bounded: propose highlights, never
  auto-confirm them.

### M2 · Highlights do not reach the card

`opportunity_bridge` carries the summary; it does not carry annotations. The highlight set needs to
land on the card as a bounded, denormalised array — text, kind, source, and the anchor — so the
mirror stays self-contained and forward-only, as the bridge requires.

**Bound it.** A card is read on every list render; an unbounded highlight array is a performance
problem and an unreadable panel. Cap the count and the per-highlight length at the bridge, and keep
the anchor so the full context is one click away rather than inlined.

### M3 · No tenant-facing surface

This is the part that turns a matching input into a product feature. **"Sections Highlighted by
System or Admin"** on the opportunity card, grouped by source:

- *Highlighted by our analysts* — admin annotations, with the curator's note
- *Found in the solicitation* — system extractions, each showing the excerpt and its page

The value is not decoration. A tenant looking at a card ranked #7 can read the four highlighted
passages and decide in fifteen seconds whether the ranking is wrong — which is a judgement no scoring
function can make for them, and a trust signal no score can carry.

### M4 · The summary is typed, not derived

`spotlight_summary` is hand-written and one-shot. It should be **generated from the highlight set,
editable, and regenerable** — with its own provenance, so a reader can tell an admin's own words from
a generated draft the admin accepted. The gate already requires a summary; it should also record
which of those two it is.

### M5 · Matching still reads the four short fields

Once M2 lands, `scoreCard`'s `text` becomes summary + highlights instead of summary + description.
Both scorers must change together — `scoreCard` (TS) and `rescore.py::_keyword_hit` are a deliberate
mirror pair with no test asserting they agree.

---

## 5 · The open-topic case, re-worked

Same topic as `OPPORTUNITY_MATCHING_ANALYSIS.md` §4:

> *…innovations across additive manufacturing, directed energy deposition, embedded sensing and
> instrumentation, power electronics, and thermal management for expeditionary systems…*

**Today:** the admin writes *"Open topic for expeditionary basing technologies — broad scope,
multiple award."* The electronics researcher's bucket (`power electronics`, `embedded sensing`,
`thermal management`) scores **zero**.

**With this design:** the deterministic rule finds the `TECHNOLOGY AREAS` enumeration and highlights
it. The admin, reviewing at the gate, confirms it and adds one more highlight from the
evaluation-criteria section. The summary regenerates to mention the areas. The bucket now matches
**three of three** — and the tenant, opening the card, reads the exact sentence that caused it to
surface.

Nothing in that path required a vector index, an embedding provider, or a subprocessor.

---

## 6 · Sequence

1. **M2 + M5 first, using what exists.** Carry admin annotations onto the card and match against
   them. This is wiring, not invention, and it is immediately useful for any solicitation an admin
   annotates — the capability that is built and currently unused.
2. **M3**, the tenant panel. Small, and it is what makes admins *want* to annotate: the lift becomes
   visible to the customer rather than disappearing into a scoring function.
3. **M1 deterministic rules.** Now the system fills the highlight set on its own and the admin's job
   becomes confirm-and-correct rather than find-and-type — the right division given the variety the
   shredder encounters.
4. **M4**, summary generation from highlights.
5. **M1 AI pass**, last and stamped weakest. By this point there is a human-confirmed corpus to
   measure a model against, which is the only honest way to decide whether it is pulling its weight.

**Also, independently: a parity test for the two scorers.** It is a documented invariant with no
test, and every step above changes both sides of it.

---

## 7 · What this does not solve

- **Nothing highlights a solicitation nobody curates.** The system rules narrow the gap, but an
  un-reviewed opportunity still matches on title and summary alone. The 22% of cards currently
  carrying neither summary nor description (`OPPORTUNITY_MATCHING_ANALYSIS.md` §F2) are unaffected
  until that path is closed.
- **Highlight quality is curation quality.** This design moves the load onto a human judgement that
  is currently discarded — which is the point — but it does mean a rushed curation produces a
  poorly-matched opportunity, and now visibly so, on the tenant's own screen. That is the right
  trade, and it should be a deliberate one.
- **It is still lexical.** Highlighted text matched by `tsvector` handles morphology, not synonymy: a
  highlight saying *directed energy deposition* still does not match a bucket keyed on *additive
  manufacturing* unless something relates the two. That is where `scoring_strategist` earns its place
  — reasoning over a curated corpus, which is a far better job than reasoning over 296 characters.

---

## 8 · The document invariant, and what it requires of this design

**Stated:** every upload rides the opportunity through — across the bridge and into tenant space — on
creation, on update, and on a new document uploaded to the OPP later. Whether that is implemented as
push-on-bridge or as the pin-to-pull protocol, **the foundational uploads must remain accessible to
the tenant as published by the issuing organization.**

Copy-inward, never reference: the same rule the atom library and the template bridge already follow.

### Where that stands today

The pin protocol is `pin = full copy` (mig 094/095). Pinning copies every
`solicitation_documents` row — `document_type='source'` first — into
`customers/<slug>/pinned/<opp>/` via `copyObject`, recording a manifest in `copied_docs` with the
`sourceKey` retained for lineage. The customer owns a local, shard-safe copy.

| The invariant | Today |
|---|---|
| **update / new upload propagates** | ✅ **holds.** A republish sets `docs_update_available`; `amendments.ts` triggers it; resync re-copies and clears the flag, with a watched-holder notification |
| **accessible as published** | ✅ **holds once pinned.** `copyObject` is a byte copy — not a re-render, not an extract — so the tenant holds the organization's file as published |
| **rides across the bridge** | ❌ **does not hold.** The card carries dates, amounts, description, summary, notes, lifecycle — **no document manifest at all** |
| **into tenant space on creation** | ❌ **does not hold.** The copy happens on *pin*, not on card creation |

The two gaps are the same gap seen twice: **before a tenant pins, they cannot see that the documents
exist.** Not "cannot read them" — cannot know the solicitation has four attachments and an amendment.
A tenant deciding whether an opportunity is worth pursuing is deciding without knowing what is in it.

### What this design must therefore do

**R1 · A highlight carries its excerpt TEXT, not only its anchor.**

This was already the shape in §4/M2, but it is now a *requirement* rather than a choice, and the
reason matters: an anchor is `{page, offset, length, docSegment}` into `full_text`, and an unpinned
tenant **has no document for it to resolve against**. A panel built on anchors alone would render
empty for exactly the tenants who have not yet committed to the opportunity — the ones it exists to
persuade.

So: the excerpt text rides the card and the panel works unpinned. The anchor rides too, and becomes
*live* once pinned — "show me this in the document" resolves against the tenant's own copy, never
against a central one.

**R2 · The card carries a document manifest.**

Filename, document type, size, published date, and whether it arrived as an amendment. No bytes —
this is the *table of contents*, and it is what makes the invariant's "remain accessible" meaningful
before a pin. It is a jsonb field on a jsonb column: no migration, and it rides the existing
forward-only republish.

That manifest is also what makes `docs_update_available` legible. Today the flag says *something
changed*; with a manifest the tenant sees **which document arrived**, which is the difference between
a notification and a reason to act.

**R3 · Highlights must survive a republish, and be re-anchorable.**

A new document changes `full_text`, so every character offset after the insertion point moves. The
system's own highlights are re-derived on re-extraction and are fine. **Admin highlights are not** —
they are hand-placed against offsets that a later upload silently invalidates.

`solicitation_annotations` stores `source_location` as absolute `{page, offset, length}`. That is
correct for a static document and wrong across an amendment. The excerpt text is the recovery path:
re-locate by text search, and where the text no longer appears, mark the highlight **stale for
review** rather than deleting it or, worse, leaving it pointing at whatever now occupies those bytes.

This is the same principle the ruler and the provenance work already apply — *never claim a page we
did not resolve*. A highlight that cannot re-anchor should say so.

### On auto-copying every document to every tenant

The invariant permits pin-to-pull, and pull is the right default. Copy-on-creation multiplies storage
by tenants × opportunities for documents most tenants will never open; the production bucket is
already 817 MB against a handful of tenants.

**R2 gets the guarantee at near-zero cost.** The manifest is what makes the documents *visible and
therefore accessible*; the pin is what makes them *the tenant's own*. If auto-copy is wanted later
for a subset — pinned, or pursued, or a watched holder — that is a policy on top of a mechanism that
already exists, not a redesign.

> ⚠️ **`solicitation_documents` has 0 rows in the sandbox.** The pin copy path, the manifest, and
> every offset-based anchor above are therefore untested against real documents on this box. Before
> building R1–R3, shred one real multi-document BAA and re-measure — particularly `docSegment`
> numbering across a file boundary, which is where anchors are most likely to be wrong.
