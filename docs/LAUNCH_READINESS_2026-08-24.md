# LAUNCH_READINESS_2026-08-24.md — the current go/no-go

**Date:** 2026-08-24 · **Migration head:** 213 · **Branch:** `claude/nice-hamilton-kBqtD` (282 commits ahead of `main`)
**Backbone:** `tsc` 0 · `vitest` **1915** · `next build` clean · branch drives **38/38** · four lenses **4/4** ·
full journey **33/33** · canvas measurement harnesses **6/6, zero under-counts** · bug log **121 entries, 0 open**

> **This supersedes `LAUNCH_READINESS_2026-08.md`** (head 185 — twenty-eight migrations of drift) **and
> `LAUNCH_STATUS_2026-08-24.md`** (head 211, same date, written earlier in the day). Their punch lists
> are still substantially correct and are carried forward below; their *verdicts* are not current,
> because three things have been found since that change the answer.

---

## 0. Verdict

**No — and the build is not what is blocking.**

Everything in this branch has been proven on the sandbox. **Nothing in it has touched production.** FIVE
items must clear before a paying customer (§1), and the first is new since the last readiness pass: it can
take the admin surface down rather than degrade it. Three of the five are hard blockers that can break or
silently hollow out the product (1.0 · 1.1 · 1.2); the remaining two are a production proof (1.3) and a
commercial decision (1.4) that cannot be made from inside the repo.

*(This paragraph said "three" while §1 listed five — a stale count from an earlier pass, repeated forward
several times before anyone counted the headings. The number of things standing between a branch and a
paying customer is not a detail to carry loosely.)*

The customer spine itself is in good shape. The canvas, the isolation spine and the end-to-end journey are
verified harder than they were at head 185 — including a full arc that ingests a real 2.3MB BAA, walks every
stage through the product's own routes, and produces a 12-page volume, a 5-slide deck and a cost sheet,
leaving the database byte-for-byte as it found it.

---

## 1. MUST CLEAR, in order

### 1.0 — Verify the production owner role BEFORE migs 212/213 land  `[PROVE · NEW · can cause an outage]`

Migs 212 and 213 close a real cross-tenant leak: eleven proposal-spine tables had **no row-level security at
all** and four were measured leaking 100% of their rows to a foreign tenant context (B113). The fix is
correct and wanted.

**But all nine new policies are `FORCED`, which means the table OWNER is subject to them too.** Verified
directly against the catalog on the sandbox. So:

```sql
-- run as the role the frontend's owner pool actually connects with
select rolsuper, rolbypassrls from pg_roles where rolname = current_user;
```

* **Either flag true** → safe. `sqlBypass` continues to read across tenants.
* **Both false** → every admin cross-tenant read on those eleven tables returns zero rows after the
  migration. That is an outage of the admin surface, not a degradation.

**This compounds with item 1.1.** If `DATABASE_URL_OWNER` is unset, `sqlBypass` *is* `govtech_app`
(NOBYPASSRLS), and these migrations widen that existing failure by eleven tables. Clear 1.1 first, then
this, then deploy.

### 1.1 — Set `DATABASE_URL_OWNER` on the frontend service  `[CONFIG]`

Carried forward unchanged from the previous pass, and now load-bearing for 1.0. `lib/db.ts:63` —
`sqlBypass = postgres((DATABASE_URL_OWNER || DATABASE_URL)!)`. In production `DATABASE_URL` is the
NOBYPASSRLS `govtech_app` role, so an unset `DATABASE_URL_OWNER` silently sends every admin cross-tenant
read through the scoped pool. One Railway variable.

### 1.2 — Set `ANTHROPIC_API_KEY` on the pipeline, and prove ONE real invocation  `[CONFIG + PROVE · escalated]`

This was item #2 last time. It is now sharper, because of what was found on 2026-08-24:

**The entire agent workforce was inert.** `anthropic` 1.0.0 removed `temperature` from
`messages.create()`; passing it raises `TypeError` **client-side, before any HTTP request**. Measured across
a 30-day window: twelve archetypes, every invocation, `start` → `error`, zero tokens, 100% failure (B115).
Nothing surfaced it because the fabric safe-skips rather than dead-ending a workflow, so every flow
completed from the outside.

It is fixed — the fabric now introspects the installed SDK rather than pinning a version — **and the fix has
only ever run against the `:8787` emulator.** The bug was an SDK signature mismatch, which is precisely the
class of defect an emulator masks. So this item is no longer just "turn the key on": it is the only thing
that proves the fix.

**Acceptance:** one real invocation recording `tool_calls > 0` and `tokensUsed > 0` in `system_events`.
Not "the flow completed" — the flow completed for thirty days while doing nothing.

**Known behaviour change to expect:** archetypes no longer receive their requested sampling (several set
0.2–0.3 for deterministic analytical output). Logged once at import, not silent. Whether they should move to
`output_config.effort` is an open product decision — `effort` is a different axis (how much reasoning) from
`temperature` (randomness), so mapping one to the other would be wrong.

### 1.3 — Run `docs/PROD_SMOKE_TEST.md` on live prod  `[PROVE]`

Unchanged. Converts sandbox proof into production proof across comp-code → curation → release → build →
package.

### 1.4 — Confirm comp-code vs. Stripe for cohort #1  `[DECISION]`

Unchanged. Checkout code exists but is off; the modal degrades to "use an access code." Comp-code is the
intended launch path.

---

## 2. What is newly PROVEN since head 185

| Area | Evidence |
|---|---|
| **Cross-tenant isolation** | Eleven proposal-spine tables closed (migs 212/213). Posture checker rewritten: it proved ONE table and reported a database-wide verdict, and passed green with all of B113 open. Now enforces a structural rule (every tenant-owned table carries a policy — needs no fixture data) plus a partition check whose expected value is `owned + shared × N`. |
| **The canvas, end to end** | 22/22 node types survive every writer; every styling capability reaches every format that has the concept; layering honoured in the deck exporter (PowerPoint z-order is emission order — the writer never sorted); equations typeset rather than printed as LaTeX source. ⚠️ **Read "survive" precisely: present in the emitted file.** B121 is a case where all 22 survived and the customer still received a deck with rows missing, because the loss was at render. Presence in the bytes and visibility on the page are different claims. |
| **The full arc** | 33/33 steps: real BAA ingest (773,877 characters extracted), the admin intake route, the public application route, admin accept provisioning a real tenant, buckets, cards, provisioning cockpit, three volume shapes, downloads measured from the files. Box unchanged after the run. |
| **The rig itself** | A hydration gate now precedes every lens run. `verify-surfaces` once reported **80/80 clean against a box where no JavaScript executed** — it gates on client throws, and code that never runs never throws. |
| **Decks open in a real PowerPoint engine** | NEW, and it had never been checked: every `.pptx` claim to date was XML-level. Converting one with LibreOffice Impress found **B121 — delivered decks were missing table rows and bullets the author wrote**, because six node types sized their frames without reading the text and PowerPoint clips rather than spills. Fixed against the page ruler's own wrapping model; `probe-deck-overlap.mts` measures each node against an engine that shares no code with ours. |

---

## 3. Known-open, non-blocking

* **13 tenant-owned tables are structurally protected but behaviourally unmeasured** (empty on this box).
  The posture checker reports them as unmeasured rather than passing, which is the honest state.
* **~10 business-entity rows per suite run** accumulate from drives whose scenarios later drives read.
  Bounded, identifiable, named in B119.
* **Five of thirty-nine molds over-count** by a page or two — the safe direction (B64: the ruler may
  over-count, never under). Zero under-count across molds, 18 stored volumes and 8 authored proposals.
* **The contents page inherits the ruler's over-count bias** — a late entry in a long document can
  read one page high. Stated in `CANVAS_STYLING_CAPABILITIES.md §5`; fixing it properly means making
  the ruler exact, not giving the TOC a second opinion.
* **A boxed slide node's height is unverified end-to-end.** `probe-deck-overlap.mts` reports callouts
  and text boxes INDETERMINATE rather than green, because their own fill is what the ink measures.

---

## 4. The pattern worth carrying into the deploy

Repeatedly on 2026-08-24 something was **green for the wrong reason**: a posture checker that proved one
table, a preflight that failed open on its own broken read, a `pgrep` that knew one of two spellings so two
workers ran different code, a surface sweep passing against a box with no JavaScript, a corpus that could not
contain the bug it was meant to catch, and a drive whose pass depended on the engine being slow.

B121 added four more in a single afternoon, and they are the sharpest examples yet because each one
was *measuring something real* — just not the thing its sentence named. A slide-balance test that
measured the hero layout instead of the code under test. An overlap check reading declared geometry
that is clean by construction. An ink check that passed a slide which had lost a third of its
content. A text-presence check that found the missing bullet, because occluded text is still painted
into the PDF.

Different mechanisms, one shape: **the check ran, and its scope was narrower than the sentence it printed.**

That is the frame for the production checks above. "The deploy succeeded" and "the migration applied" are
both sentences whose scope is narrower than they sound. Item 1.0 exists because a migration can apply
perfectly and still blind the admin surface, and item 1.2 exists because a workflow can complete for thirty
days while its agent does nothing at all.
