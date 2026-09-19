# VERIFICATION COVERAGE MAP — what is verified, by whom, and what is not

> Assembled 2026-09-19 against a live sandbox at migration head **254**, serving the standalone
> build as `govtech_app` with RLS on — the production posture. Every number below was measured on
> that box in this pass; nothing is quoted from an earlier run or from memory.
>
> Regenerate the joins: `node frontend/scripts/map-coverage.mjs` ·
> `node frontend/scripts/reconcile-capability.mjs` · `node frontend/scripts/audit-automation-spine.mjs` ·
> `node frontend/scripts/inventory-frontend.mjs` · `node frontend/scripts/catalog-ui.mjs`.

---

## 0 · What "verified" is allowed to mean here

The word does more work than one rung can carry, so this document never uses it bare. Six rungs,
weakest to strongest, and every claim below says which one it is standing on:

| rung | what it establishes | what it cannot see |
|---|---|---|
| **compiles** | `tsc --noEmit` = 0 | nothing about `.mts` harnesses — `tsconfig` excludes them |
| **unit** | 2,702 tests over 256 files | anything requiring a database, a browser, or a second actor |
| **static join** | two inventories reconciled | anything only visible at run time |
| **lens** | a real signed-in actor drives a running box | only what the lens has an expectation for |
| **drive** | a scenario walked end to end, HITL + engine + agents | only the paths that scenario takes |
| **foreign engine** | an artifact opened by something that did not write it | only what it was pointed at |

Two rules govern how the rest reads. **A surface a lens has no expectation for is uncovered, not
passing** — so every section ends by naming what it did not reach. And **a drive that cannot run is
a failure, not a skip**: this pass had 0 could-not-run, which is the number that makes the 68
passes mean something.

---

## 1 · What ran in this pass, and what it said

| instrument | scope | verdict |
|---|---|---|
| `tsc --noEmit` | 1,526 files · 273,550 lines | **0 errors** |
| `vitest run` | 256 files | **2,702 passed · 2 skipped** |
| `next build` | standalone | **clean** |
| `run-branch-drives.sh` | 69 registered drives | **68 pass · 1 fail · 0 could-not-run · 0 missing** |
| `check-harness-syntax` | 270 harness files, parsed + bound | **clean** (makes no claim about types) |
| `verify-surfaces` | 117 surfaces, 3 actor lanes | **117 clean · 0 broken** |
| `verify-api-contract` | 157 GET routes on disk | **135 graded · 4 exempt · 18 unbound · 0 no-actor** |
| `verify-write-contract` | 266 write verbs on disk | **266 called · all 4xx with `{error,code}`** |
| `verify-db-crud` | writes land, cross-tenant refused | **clean**, fixture restored |
| `verify-ui-vs-db` | the number the page states = the number the table holds | **clean** |
| `audit-automation-spine` | 37 workflows · 122 steps · 508 emittable | **0 dead triggers · 0 dead waits · 0 open brackets · 0 unresolvable actions · 0 missing renderers** |
| `reconcile-capability` | 294 routes · 101 tables with rows · 39 archetypes | **5 unsurfaced routes · 5 unread tables · 1 unstartable archetype** |
| `audit-refusal-observability` | 3,256 refusal sites | **848 require an emit · 144 emit · 704 silent** |

**The one failure was a regression from this session's own work, and its story is the most useful
thing in this section.** `drive-project-lifecycle` asserts that every project event reaching a
customer's notification bell is a written sentence rather than a de-punctuated type. The `refuse()`
conversion had just created eleven new event types, and the customer's bell was showing
`Risk.refused`, `Cdrl.refused`, `Invoice.refused`. The drive caught it on the first run after the
change, on an assertion written for a different family of types entirely — which is what asserting a
property rather than a list buys.

Re-running it after the fix surfaced a **second, unrelated** failure that then passed three times
in a row. That intermittent turned out to be the drive itself: it searched `JSON.stringify(canvas)`
for the literal `44.4`, and every node's provenance carries an ISO timestamp that spends one second
in six hundred looking like `…T05:06:44.481Z`. Both are fixed; both are in the bug log.

---

## 2 · The five functions

Counts are from `map-coverage.mjs`, which classifies all 194 instruments by the signals in each
file and **refuses to file one it cannot place** (42 carry no function and are reported as such).
An instrument is counted for a function only where it touches that function's tables or routes —
vocabulary alone never claims one.

### 2.1 · Scouts, OPP analysis and ingestion

**The spine.** Source profiles and the crawler produce leads; the HITL source-scout extracts
opportunities; both land in `scout_findings`, a review→release queue that classifies each finding
deterministically as NEW or UPDATE (`lib/scout/classify.ts`) and releases it as an intake
(`stageIntake`) or an amendment (`logAmendment`). `stageIntake` emits
`finder:opportunities.detected`, which wakes the platform-scope `opportunity_scout` to prioritise
the triage backlog. Ingest Assist then merges three provenance layers per field —
`pattern_match` → `ai` → `default` — and **refuses an unshredded solicitation** rather than
inventing a skeleton.

**Evidence.** 32 instruments · 9 in the suite. `drive-scout-intake` (NEW-vs-UPDATE classification
and both release paths), `drive-opp-scout` (the wake and the ToDo), `drive-real-solicitation` and
`drive-curate-baa` (ingest against the real 433-page DoW 2026 SBIR set), `drive-application-intake`,
`drive-admin-demand`, `drive-uncovered-triggers`, `probe-customer-finish`, `probe-interaction-mobile`.
All pass.

**The rule this function is built against** — *a value the product did not read from the
solicitation must never look like one it did* — is verified at the drive rung: a deferral clears
the default and renders "Set elsewhere" with its citation, never a fabricated number.

**Not covered.** The crawler's own network behaviour (rate limits, robots, source outages) is
exercised only against fixtures — no instrument drives a live fetch, by design, and nothing measures
what happens when a source changes shape. `source_health` holds 3 rows that no application SQL
reads (§5, G7).

### 2.2 · RFP-admin curation, build-out and first release

**The spine.** An admin curates a master solicitation, marks it built out
(`completeBuildOut` → an `updated` fan-out to every tenant's mirror card), then releases a buyer's
private portal (`provisionAndReleasePortal` → `curation_pending` → `launched` → the tenant's
required Workflow Setup). The provisioning cockpit is the surface that lands the 72h SLA.

**Evidence.** 25 instruments · 5 in the suite — **the thinnest of the five**.
`drive-provisioning-cockpit` (both outcomes of Complete & Release), `drive-commercial-path`,
`drive-application-intake`, `drive-end-to-end`, `drive-rls-admin`. All pass.

**This function had the largest actor gap in the tree, and it is now closed at the drive rung.**
`rfp_admin` is the role CLAUDE.md specifies this entire function for, and it gates `/admin`,
`/api/admin` and `/architecture`. The box holds 28 accounts and **not one of them was an
`rfp_admin`** — every admin lane in every drive, lens and atlas signs in as a `master_admin`, who
outranks it at every gate. Two opposite defects were therefore structurally invisible: a surface
that wrongly refuses an RFP administrator, and the four `isMasterAdmin` walls, which had never once
been asked to refuse anybody. `drive-rfp-admin-role.mts` (new, now registered) mints one and
measures both directions, with a control lane that drives the same three walls as a master_admin —
because three refusals mean nothing without a positive beside them.

Result: twelve admin surfaces admit and render for an rfp_admin; the platform AI config,
force-release and application-decision walls all refuse with `{error, code}`; the same three open
for a master_admin (400 · 409 · 422). The fixture still contains no seeded rfp_admin, so **every
other** instrument continues to drive as master_admin (§5, G1).

### 2.3 · The OPP list — fan-out, ranking, pinning, ageing out

**The spine.** `solicitation.push` fans every activated opportunity onto the forward-only
`opportunity_bridge` → a denormalized `tenant_opportunity_cards` row per tenant, ranked by the
customer's own buckets, auto-scored on arrival. The solicitation is **copied inward** (mig 238) so a
score is reproducible from the row that produced it, per document rather than as one concatenation.

**Evidence.** 42 instruments · 19 in the suite — the best-covered spine in the product.
`drive-corpus-copy-inward` (16 checks, written red first), `drive-curated-ranking`,
`drive-bucket-authoring`, `drive-card-decision`, `drive-bridge-buckets`, `drive-pin-honesty`,
`verify-scorer-parity` (37 shared fixtures, TS ↔ Python, a divergence fails the run),
`audit-card-fields` (nothing declared-and-unwritten). All pass.

Two preflights in the suite are specific to this function and both held: cross-tenant references =
0, and scorer parity intact. The parity comparator is the strongest evidence in the document — it
is the only place where two independent implementations of the same rule are diffed against each
other rather than each against its author's expectation.

**Not covered.** Ageing-out is exercised by `closeMs()` arithmetic and by fixture close dates; no
drive advances the clock across a real close boundary to watch a card leave the list.

### 2.4 · The tenant library — upload → atomize → foundational doc → atom

**The spine.** Uploads are atomized into `library_atoms` (visibility-enforced, taxonomy-tagged);
retrieval is hybrid — the tag/context selector blended with semantic cosine similarity off a
per-atom pgvector index, **inert by default** so the un-gated path is byte-for-byte the pre-vector
selector. Admin master templates fan forward onto tenant template cards and instantiate into atoms.

**Evidence.** 56 instruments · 15 in the suite. `drive-atomization`, `drive-vault-isolation`,
`drive-collaborator-boundary` (the read-floor leak: a cross-company collaborator passes
`verifyTenantAccess`, so the library READ routes must floor at tenant_user), `drive-copy-starter`,
`drive-library-starter-copy`, `drive-archive`, `drive-canvas-authoring`, `drive-rls-pages`. All pass.

**This function's count was overstated by 21 until this pass.** `map-coverage` scored `/foundation/`
as a library signal, and the busiest fixture tenant is *named* `foundation` — so every drive that
touched its portal URL was being counted here. 77 → 56 after the signal was spelled so it can only
mean the library. The same correction removed `/api/admin/workflows/templates`, which is a workflow
template and a different thing.

**Not covered.** The semantic engine is inert on this box (no `VOYAGE_API_KEY`); `ATOM_EMBED=local`
exercises the code path but not the production embedder, so retrieval *quality* is unmeasured — only
that turning it on changes nothing when it is off.

### 2.5 · Proposal build and post-award projects

Post-award project management is the second half of this function, not a sixth one — the operator's
own framing puts it inside the customer's build life.

**The spine.** Requisition → provision → guardrail plan projected onto live `tasks` → section
authoring on the Canvas → the Studio's three gated loops (Draft · Refine · Compliance) → lock →
package as json/docx/pdf/zip. Then award → contract → project → CLINs → milestones → deliverables →
invoicing → close-out.

**Evidence.** 71 instruments · 20 in the suite — the largest population. `drive-project-lifecycle`
(the full arc, each act by the actor who performs it, with a DB→UI→DB reconciliation on the rendered
page), `drive-milestone-construct`, `drive-award-to-contract`, `drive-submit-gate`,
`drive-review-gate`, `drive-archive`, `drive-full-draft`, `drive-canvas-*`, the canvas rulers,
`probe-deliverable-artifacts`, `probe-deck-overlap`. All pass.

**The strongest rung in the document is here.** `probe-deliverable-artifacts` and
`probe-deck-overlap` reach the **foreign engine** rung: LibreOffice opens what our exporters wrote
and pdf.js reads the text layer back. Everything else in this document compares our writer against
our ruler. The deck probe exists because `.pptx` places absolutely and PowerPoint *clips* rather
than spilling — so a bad height estimate deletes content silently while the bytes stay complete, and
the export gate, the vocabulary probe and the ruler are all correct and all blind to it.

**Not covered.** `drive-full-draft` is **emission-only and says so in its own log** — it fires
`proposal:full_draft_requested` and does not verify the agent cohort ran. The agent half is covered
instead by `estimate-full-build-cost`, which clones its own fixture and *refuses a verdict (exit 2)
if zero sections were drafted*; that is real coverage, but it is a cost instrument and the naming
does not say so. See §5, G5.

---

## 3 · Actors — who has actually been driven as

The product defines six roles. This is what has signed in on a running box.

| actor | accounts on the box | driven as | rung reached |
|---|---:|---|---|
| `master_admin` | 2 | every admin lane, every drive, every atlas lane | drive |
| `rfp_admin` | **0** | `drive-rfp-admin-role` only, which mints its own | drive (one drive) |
| `partner_admin` | 2 | `drive-p3-*`, `drive-partner-*`, `probe-partner-multi` | drive |
| `tenant_admin` | 7 | the portal lane of every lens, most drives | drive |
| `tenant_user` | 6 | `drive-project-lifecycle`, `verify-db-crud` | drive |
| `partner_user` | 11 | `drive-collaborator-boundary`, `drive-p3-lifecycle` | drive |
| **anonymous** | n/a | **nothing, until this pass** | lens (new) |

Two entries deserve their own sentence.

**`rfp_admin` — zero accounts.** See §2.2. The gap is closed for one drive and open for everything
else.

**Anonymous — the product's front door.** `verify-surfaces` enumerated `app/admin` and
`app/portal/[tenantSlug]` and nothing else, so 35 of 126 pages were outside its scope: all 23
marketing pages and all 4 auth pages among them. Every page a prospect sees before they are a
customer, plus the login and password-reset flow every customer uses, and **nothing rendered any of
them under a gate**. `verify-public-links` reads their links statically and clears 26, while 35 more
are built from expressions it cannot follow — and a link that resolves says nothing about whether
the page it points at renders. A public lane now drives them anonymously, with a red control
measured before it was wired. 27 routes, all clean.

Eight routes still have **no lane**: `/dashboard`, `/go`, `/invite/[token]`, `/partner`, `/portal`,
`/select-company`, `/vaults`, `/vaults/[vaultId]`. They are authenticated pages outside both portal
trees, and the lens now names them rather than dropping them — driving them anonymously would land
on `/login`, render clean, and report a page that never rendered as a pass.

`/portal` is on that list because writing the filter as `/(admin|portal)(\/|$)/` was wrong in a way
worth keeping: `/admin` *is* driven (the admin lane walks `app/admin`, whose own `page.tsx` comes
out as `/admin`), but the tenant lane walks `app/portal/[tenantSlug]`, so `app/portal/page.tsx`
belongs to neither. The first spelling called it laned, and it fell through both — a route driven by
nothing and reported by nothing, which is precisely what the unlaned list exists to stop.

### 3.1 · The bridges — descent, collaboration, and what the customer is told

| path | covered by | result |
|---|---|---|
| rfp_admin → tenant shadow descent | `drive-shadow-tenant-admin`, `drive-descent-timeout`, `drive-force-ascend`, `drive-space-presence` | pass |
| partner_admin → owned company | `drive-partner-lifecycle`, `drive-partner-invite`, `probe-partner-multi` | pass |
| collaborator upload / share / comment | `drive-collaborator-boundary`, `drive-p3-invite`, `drive-p3-lifecycle` | pass |
| one identity, several companies | `drive-pin` (session pinned to one company) | pass |
| the customer's own record of all of it | `drive-rfp-admin-role` lane C (new) | **split — see below** |

Lane C is the one that changed shape under measurement. It first required a tenant portal route to
*refuse* an un-descended rfp_admin. It answered 200 — which looks exactly like a cross-tenant leak
and is not one: `verifyTenantAccess` grants master_admin and rfp_admin a derived `tenant_admin`
membership in every tenant, deliberately, so customer service does not need an invitation per
company. Asserting a refusal there was a harness bug.

What the system *does* guarantee is stronger, and nothing was checking it: `lib/space-presence.ts`
(migs 246/247) brackets an outside actor's presence with a `shadow.descended` and a matching
`shadow.ascended` written under **that customer's** `tenant_id` — their only notice that somebody
from the vendor was in their account. Measured, the guarantee splits in two:

```
page boundary   opening /portal/<slug>/dashboard   → 1 descent in the customer's trail  ✓
data boundary   GET /api/portal/<slug>/proposals   → 0                                  ▸
```

Presence is bracketed at the **page** boundary, not the **data** boundary (§5, G3).

---

## 4 · Cross-cutting

**Automation.** 37 workflows · 122 steps · 508 distinct emittable `(namespace, type, phase)`.
Zero dead triggers, zero dead waits, zero brackets a throw can walk out of, all 122 step actions
resolve the way `_execute_action` will at run time, and every NOTIFY template has a renderer. The
audit could not see the `refuse()` seam at all before this pass — it builds its type from
`${ctx.action}.refused`, so the whole family was landing in "observed with no emitter". Teaching it
the seam moved 471 → 508 emittable and 29 → 18 unattributed. **The instructive part is that the
parser worked on the first try and still only found five of sixty-five call sites**, because the
cheap pre-filter above it reads only files matching `/emitEvent|withEventBracket/`. That filter's
own comment documents this happening once before, to `withEventBracket`.

**Audit and observability.** Every actor, automation and agent action posts to `system_events`. The
gap is on the failure side and it is large: of 3,256 refusal sites, **848 are route sites at 409 or
5xx that require an emit, and 144 emit** (§5, G4). The 68 converted so far include every project
gate; the remainder are mostly 5xx crash paths.

**Isolation.** RLS is live and two-layer, and the sandbox emulates production exactly. Four RLS
drives plus `check-rls-posture` as a suite preflight, `verify-project-isolation`,
`verify-email-ledger-rls`, `drive-vault-isolation`, `drive-collaborator-boundary`, and a
cross-tenant-reference preflight that **fails the run** if it finds one. All pass. Incidental
confirmation from this pass: a `psql` session on the app role with no tenant context could not see
`tenant_documents` at all while debugging — the posture working where nobody was testing it.

**Projects.** 19 instruments · 5 in the suite. Before this pass the concern columns under-counted by
about a quarter, because `map-coverage` dropped an unclassified file *before* reading its
cross-cutting tags — so `drive-space-presence`, `verify-project-isolation` and
`drive-milestone-construct` vanished from the report entirely instead of appearing under bridge,
isolation and projects.

---

## 5 · The gap register

Ranked by what a gap would cost if the thing behind it were wrong.

| # | gap | rung it is missing | status |
|---|---|---|---|
| **G1** | No `rfp_admin` account exists. Every instrument but one drives as `master_admin`, who outranks it at every gate. | drive, for every lane but one | **partly closed** — one drive mints its own; the fixture still seeds none |
| **G2** | 704 of 848 route refusals at 409/5xx emit nothing. The caller is told; nothing else is. | drive | open, plan written |
| **G3** | Presence is bracketed at the page boundary, not the data boundary — a platform operator reading a customer's rows through the API alone leaves no trace in their trail. | design decision | **measured, not decided** |
| **G4** | Write verbs are graded for their REFUSAL shape (266/266) and for EFFECT only by a hand-picked set of invariants. | lens | open, by construction |
| **G5** | `drive-full-draft` is emission-only. The agent cohort's landing is covered by `estimate-full-build-cost`, a cost instrument whose name hides that. | drive | open |
| **G6** | 8 authenticated routes have no actor lane: `/dashboard` `/go` `/invite/[token]` `/partner` `/portal` `/select-company` `/vaults` `/vaults/[vaultId]`. | lens | **now named** by `verify-surfaces` |
| **G7** | 18 GET routes cannot be bound (no row exists for their params); 5 routes are UNSURFACED — nothing calls them and no page covers them; 5 tables hold rows no application SQL reads. | lens / static join | open, enumerated |
| **G8** | 107 lib modules are loaded by no harness — `volume-finish`, `source-scout`, `pdf-reader`, `content-admin`, `space-presence` among the largest. | unit | open, enumerated |
| **G9** | Components are covered only transitively, via a page that renders them. 1 component no route can reach. | lens | open, by construction |
| **G10** | 5 agent archetypes are wired to a workflow and have never run here; `ops_companion` appears in no workflow template at all. | drive | open |
| **G11** | The ambient-timezone hydration class is **structurally invisible on this box** — server and browser both run UTC, so every sweep is clean while production fires for every non-UTC admin. | lens | mitigated by a unit guard + `capture-hydration-diff`, never by a sweep here |
| **G12** | The marketing/auth lens, the UI atlas, the responsive and states drives, and `probe-partner-multi` are **not in the branch suite** — they run only by hand. | suite membership | open |
| **G13** | `CLAUDE.md` states migration head 247; the live head is **254**. | doc currency | open |
| **G14** | The crawler's live network behaviour is exercised only against fixtures; nothing measures a source changing shape. | drive | open, by design |
| **G15** | Semantic retrieval *quality* is unmeasured — the production embedder is absent from this box; only the inert-by-default equivalence is proven. | drive | open |

### The three that are decisions, not work

**G3** — whether all 294 API routes should bracket presence. They should probably not: bracketing
every request would bury the one signal a customer reads that trail for. But the boundary should be
stated rather than inherited, and the drive now prints the number so the choice is made against a
measurement.

**G4** — grading a write verb's *effect* means calling it successfully, which mutates the box being
measured. The current split (all verbs for refusal shape, chosen invariants for effect) is a
defensible design and an unstated scope; it is now stated, in `docs/FRONTEND_INVENTORY.md` §8.

**G11** — cannot be closed on this box at all. The only honest options are the unit guard that
already exists and running `capture-hydration-diff` with a non-UTC browser before a release.

---

## 6 · What this pass changed

Four defects, each found by an instrument rather than by reading:

1. **B168** — the first refusal events reached a customer's notification bell as `Risk.refused`,
   `Cdrl.refused`. Labelled from the payload's own reason; excluded from the bell, because a
   refusal leaves the world unchanged and the 5xx half would otherwise ring every teammate with an
   operator's error string. Red-proven with six new guards.
2. **B169** — `drive-project-lifecycle` failing one run in forty on an ISO millisecond field, with
   a literal that had stopped testing its own property some fixture ago.
3. **The automation spine could not see the refusal seam** — and its pre-filter hid sixty of
   sixty-five call sites even after the parser was right.
4. **`map-coverage` filed on ambiguous signals** — `/foundation/` matched a tenant's *name*,
   `/templates/` matched workflow templates, `/pin/` means two unrelated things, and three weak
   English words were enough to claim a function.

And two instruments gained reach: `verify-surfaces` now drives the public tree (90 → 117 surfaces),
and `drive-rfp-admin-role` exists.
