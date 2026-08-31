# The push — ingest easy and effective, landing correctly in bucket rankings

**Objective, restated.** Two things:

1. **Ingest is easy and effective** for the RFP admin.
2. **What they capture lands in tenant bucket rankings properly.**

That is the whole scope. This document is the reset after an analysis that ran well past it.

---

## What the analysis actually established

Four facts, each measured, each directly serving the objective:

| | |
|---|---|
| **Ranking reads ~296 characters** — title + summary + description + office. A card that misses on literal keyword matching scores **12/100 against 50/100**, and that happens to **42% of cards** | the corpus is the problem |
| **Buckets are four free-text boxes** with no prefill and no suggestions, so tenants fill keywords and stop — making keywords **67% of the score** | the query is thin too, and it is a UI cause |
| **Four of six factors score a card 0** for the *ingest* side's missing data instead of abstaining; only `timeline` gets it right | a live bug that will bite the moment buckets get richer |
| **The admin already reads the solicitation** and the entire residue is a 103-character blurb | the fix is capturing work that already happens |

And one bug found on the way, which is real and belongs in this push because it shares the fix:
**the drafter reads `full_text[:18000]`, which on a real 330-page BAA is the table of contents.**

---

## The push

Six items. Nothing else.

| # | Item | Why it is in scope |
|---|---|---|
| **1** | **Abstention fix** in both scorers | a correctness bug; must precede anything that enriches buckets |
| **2** | **Scorer parity test**, red first | items 1, 3 and 5 each change both scorers; nothing asserts they agree |
| **3** | **Highlights ride the bridge onto the card**, and ranking matches them | the corpus fix — the admin's highlights become matchable text |
| **4** | **`tsvector`/`pg_trgm` instead of `String.includes`** | already installed; stemming makes `manufacturing` match `manufacture` |
| **5** | **Bucket authoring: prefill from the profile + the weight-consequence line** | the query fix, and it is the cheapest behaviour change available |
| **6** | **Tenant panel: "Sections Highlighted by System or Admin"** | makes the curator's lift visible to the customer, and explains a match |

**Plus one, because it shares the mechanism:** point the drafter at the highlight set instead of a
blind prefix.

### The ingest side, concretely

The admin is already reading the document. Give them:

- **highlight** — select text, it is captured with its anchor *(the tool exists, `kind='highlight'`, wired into the curation page, unused)*
- **tag** — the coarse things worth capturing while they are in there
- **a summary generated from the highlights**, editable, rather than typed from nothing

**Less typing than today, not more.** That is the test for whether "easy" is satisfied.

---

## Parked — good thinking, wrong push

Written during the analysis, correct as far as it goes, and **not this work**. Kept so it is not
re-derived later; explicitly out of scope now.

| Document | Status |
|---|---|
| `MATCHING_DIMENSIONS.md` — the four-operator model, agency vocabularies (NSF/DOE/DARPA/NIH/NASA), the cross-agency bridge, TRL/maturation, eligibility gates | **parked.** A dimensional redesign for a product that has not shipped V1. Revisit when there is real corpus and real tenants. |
| The vocabulary-maintenance design (scouts, annual floor review) | **parked** — it maintains a bridge that does not exist yet |
| `INFRASTRUCTURE_REVIEW.md` | **separate push.** The `cms-postgres` collapse is real and worth doing before staging is finalised, but it is not ingest-to-ranking. |
| Voyage / semantic retrieval | **closed.** Decided against, for recorded reasons. |

---

## Honest note on how this document came to exist

The analysis found the right problem early — a 296-character corpus and a four-box bucket form — and
then kept going: five agencies' classification ontologies, a two-layer vocabulary bridge, a
maintenance cadence for it, an infrastructure review, and page-offset forensics on a 330-page PDF
that produced two wrong numbers before producing a right one.

Some of that is genuinely useful later. None of it was needed to start.

**The check that would have caught it:** *does this change what the admin does at ingest, or what a
tenant sees in their ranking?* Items 1–6 do. Everything parked above does not — not yet.
