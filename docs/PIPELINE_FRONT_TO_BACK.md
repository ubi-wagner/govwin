# Front to back — ingest → bucket → proposal → project

**What this is.** The whole lifecycle traced as a series of boundaries, asking one question at each:
**what does this stage inherit, and what gets dropped?** It supersedes nothing; it is the frame that
makes `OPPORTUNITY_MATCHING.md` and `MATCHING_DIMENSIONS.md` fit together, and it changes the priority
order.

**The finding, up front:** there is **exactly one thin boundary in the entire chain**, and it is the
one that decides whether a tenant ever reaches the rest.

---

## 1 · The chain, and what crosses each boundary

```
 SOURCE ──▶ CURATED ──▶ CARD ──▶ BUCKET ──▶ PURCHASE ──▶ PROPOSAL ──▶ AWARD ──▶ PROJECT
   DSIP      shred        bridge   score      comp code    provision    outcome    upload
   upload    curate       mirror   rank       release      draft/lock   contract   deliver
   scout     approve
```

| Boundary | What crosses | Verdict |
|---|---|---|
| source → **curated** | whole documents, shredded into `full_text`; compliance extracted with citations | **rich** |
| curated → **card** *(the bridge)* | title · summary · description · office · dates · amounts · lifecycle. **No documents. No highlights. No full text.** | ⚠️ **thin — the only one** |
| card → **bucket score** | the same ~296 characters | thin, inherited |
| card → **purchase** | comp code → `proposal_portals` | fine — a transaction, not context |
| curated → **proposal** *(provision)* | volumes · required items · page/slide/character limits · templates · expert notes · the compliance matrix | **rich** |
| proposal → **drafter** | **18,000 characters of `full_text`** + evaluation criteria | **rich** |
| proposal → **project** | deliberately *not* the spine — anchors on the **uploaded** contract and proposal-as-submitted | **rich, and correct by design** |

---

## 2 · The asymmetry, measured

The two stages that consume the solicitation see wildly different amounts of it:

```
RANKING    scoreCard            296 characters      ▏
DRAFTING   draft_v0          18,000 characters      ████████████████████████████████████████████████

                                                    61×
```

**The product already knows the solicitation matters. It only tells the drafter.**

And the economics run exactly backwards:

| | Ranking | Drafting |
|---|---|---|
| Cost per run | **free** — set arithmetic | **$1.00–$2.30** per build |
| Solicitation seen | 296 chars | 18,000 chars |
| Gates access to | **everything downstream** | one document |
| Runs | every card × every bucket | once a portal is bought |

The **free** stage that decides whether anyone ever buys a portal is starved; the **expensive** stage
that only runs after they have already bought one is fed.

---

## 3 · The bridge is thin *and* bypassed

`provisionProposal` reads `curated_solicitations` **directly** — the master, not the mirror:

```sql
SELECT id FROM curated_solicitations WHERE opportunity_id = $1
```

So the expensive downstream work **goes around the bridge to the source**, and gets everything.

That leaves the mirror serving essentially one consumer — the card list and its ranking — and it is
the only consumer given a degraded view. The bridge exists to make the tenant's copy self-contained
and forward-only, which is right; the mistake is that *self-contained* was implemented as *minimal*.

> **One line:** every stage that can reach the master does, and gets rich context. The one stage that
> cannot — ranking, which must work off the mirror — is the one that decides whether the tenant ever
> arrives.

---

## 4 · Why this reorders the plan

The matching analysis produced a long list. Seen front-to-back, most of it is **one fix wearing
different hats**: put enough of the solicitation on the card for ranking to work.

| Was | Now reads as |
|---|---|
| M2 highlights onto the card | **the fix** — the curated corpus crossing the bridge |
| M5 tenant panel + document manifest | the same fix, made visible and navigable |
| M3 tsvector/pg_trgm | the matching that becomes worth doing *once there is text to match* |
| M6a abstention | a correctness prerequisite, independent and cheap |
| M4 weight-consequence line | tenant-side truth-telling, independent and cheap |
| D2 maturation, M9/D-series classifiers | precision **after** the corpus problem is fixed |
| D7 annual floor review | a small maintenance act, not a subsystem |

**The reordering:** anything that widens the bridge comes first, because everything else either
depends on it or is cheap enough to run alongside.

---

## 5 · What the downstream stages need from this

Checked, so the fix does not create a new drop:

- **Provision** needs nothing new. It reads the master and always did.
- **Drafting** needs nothing new — 18,000 characters and evaluation criteria. Worth asking later
  whether the *highlight corpus* would serve it better than a raw prefix, since a curated 4,000
  characters may beat an arbitrary first-18,000. That is a follow-on, not a blocker.
- **Project** needs nothing from the bridge by design — it anchors on uploaded files because the
  proposal spine is a working copy that stayed editable after submission. Correct, and untouched by
  any of this.

**So the fix is contained.** Widening the card affects ranking and the tenant's view of a card, and
nothing downstream depends on the card staying thin.

---

## 6 · The plan

Grouped by what unblocks what. Everything in **Track A** is independent of everything else and can
run immediately.

### Track A — correctness and truth-telling (independent, cheap, start now)

| | Item | Why now |
|---|---|---|
| **A1** | **M0** · shred a real multi-document BAA and re-measure | blocks every offset-based claim; `solicitation_documents` is empty and `full_text` is seeded |
| **A2** | **M1** · scorer parity test, red first | a documented invariant with no test; every later step changes both sides of it |
| **A3** | **M6a** · abstention fix in both scorers | four of six factors punish a card for the ingest side's missing data; must land before any prefill |
| **A4** | **M4** · weight-consequence line on the bucket | a few hours; tells every tenant why their lens is fragile |
| **A5** | **D4** · split programme from phase in the live data | the data violates the product's own taxonomy; everything classifier-shaped depends on it |

### Track B — widen the bridge (the main event)

| | Item | Depends on |
|---|---|---|
| **B1** | **M2** · highlights onto the card, matched | A1, A2 |
| **B2** | **M3** · tsvector/ts_rank + pg_trgm | B1 |
| **B3** | **M5** · tenant highlights panel + document manifest (R1, R2) | B1 |
| **B4** | deterministic system highlight rules for *scope* | B1 |
| **B5** | **R3** · highlight re-anchoring on republish, stale-for-review | B1, A1 |

### Track C — precision, once there is a corpus

| | Item | Depends on |
|---|---|---|
| **C1** | **D1** · validate the dimensional model against a real topic corpus | A1 |
| **C2** | **D2** · maturation band, both sides, abstaining when unknown | A3, C1 |
| **C3** | **D3** · reclassify NAICS + set-aside as eligibility | A3 |
| **C4** | eligibility as a **hard-filter mechanic**, not a weighted signal | C3 |
| **C5** | **M6** · bucket prefill from the profile | A3 |
| **C6** | **M9/M7** · optional classifiers, both sides, one vocabulary | C1, C5 |
| **C7** | **D5/D6** · bridge coverage instrument · symmetric derivation + match explanation | C6 |
| **C8** | **D7** · annual floor review + ingest unrecognised-term flag | C6 |
| **C9** | `scoring_strategist` | B2, C6 |

### Track D — validation (continuous, and a gate)

**M8** · every UI existing and new, driven as the actor who owns it — rfp_admin curating and
highlighting, tenant_admin and delegated bucket author, tenant_user reading the panel, partner_user
refused. Five lenses, the 41-drive suite, `drive-ui-states` with overlays walked,
`capture-ui-atlas`, `probe-interaction-mobile` at 390px with panels open.

**New surfaces must join `UI_CATALOG` and `UI_ATLAS`**, not sit outside every lens — that is how 213
write verbs once went uncovered behind three green reports.

---

## 7 · Start here

**A1 and A2 in parallel.** A1 because every measurement in both analyses carries a caveat that only a
real shredded BAA removes, and every offset-based design in Track B is untested without it. A2 because
it is a red-first test of an invariant that three later steps modify.

Then **A3**, which is small, correct on its own terms, and blocks C5.

**Then B1** — the main event, and the one change that alters what the product can do rather than how
accurately it does it.

---

## 8 · What this analysis has not established

- **Every number came from a seeded sandbox.** `solicitation_documents` is empty, `full_text` is
  populated on 6 of 18 rows averaging 147 characters. The *shape* of the 296-vs-18,000 asymmetry is
  structural and does not depend on the fixtures — the two code paths read different things — but the
  magnitude of the win from widening does, and A1 is what settles it.
- **Whether the drafter would do better on a curated corpus than a raw 18,000-character prefix.**
  Plausible, untested, and a follow-on rather than a blocker.
- **Bridge and band granularity** — how coarse the floor must stay, how many maturation bands. Both
  empirical, both answered by C1, neither settled by argument.
- **Nothing downstream of the proposal has been re-examined at this depth.** Award → contract →
  project was traced for *carry-forward* and is correct by design; it has not been given the same
  adversarial read the ingest→ranking path just received.
