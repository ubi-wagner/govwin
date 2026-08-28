# Cross-pipeline coherence review

**Question asked:** do the ten pipelines — rfp ingest · library ingest · document templating ·
atomization · document creation · document save + export · opportunity publish + update · buckets
and ranking · the proposal build pipeline · the project pipeline — behave like one product, or like
ten products sharing a repository? Specifically: siloing, one-off tools, conflict with the
automation-agent framework, wonky or mobile-unfriendly UIs.

**Answer:** one product, with five real divergences, all now closed. Two of them were rendering
wrong values to customers. Two more were instruments that could not see a whole population of the
thing they existed to check.

Regenerate everything below with:

```
cd frontend
node scripts/inventory-frontend.mjs          # the manifest every lens starts from
node scripts/audit-pipeline-coherence.mjs    # seam adoption, per pipeline
node scripts/audit-row-type-truth.mjs        # row types vs. what postgres.js returns
node scripts/audit-automation-spine.mjs      # joins 1–7b, incl. frontend notification templates
node scripts/drive-ui-responsive.mjs         # 390 / 820 / 1440, one dense page per pipeline
```

---

## Why this needed a new instrument

Every existing lens measures ONE pipeline against ITS OWN expectation. `verify-surfaces` asks
whether a page renders. `verify-api-contract` asks whether an envelope is shaped right.
`reconcile-capability` asks whether a capability has a door. All of them can be green on ten
pipelines that each solve the same problem a different way, because none of them ever compares two
pipelines to each other.

Siloing is not a defect in any one file. It is only visible in the join, so it needed its own
instrument: `frontend/scripts/audit-pipeline-coherence.mjs`. It assigns every file to at most one
pipeline (by path — the assignment is data, printed, and arguable) and asks, per shared seam:

| | meaning |
|---|---|
| **candidate** | this file does the seam's *job* |
| **adopted** | …and reaches the shared implementation |
| **bespoke** | …and does not — the finding |

A pipeline that never sends mail scores `—`, not zero: "did not need it" and "reimplemented it" are
opposite findings and must not print the same. A ratio is a place to look, never a verdict.

### Seam adoption, after the fixes

```
  pipeline                      events     email     todos    canvas     floor    tenant     audit    agents     dates     toast
  ------------------------------------------------------------------------------------------------------------------------------
  projects                       20/20       3/3       5/9      4/11         —     34/34     19/19       1/2     10/15     14/14
  proposal-build                 38/40         —       2/3     29/46       4/9     56/57         —       3/9       0/1       2/2
  rfp-ingest                     22/23         —       0/1       1/3         —         —         —       4/7       0/1         —
  library-ingest                 14/14         —       2/2     15/18       1/1     26/29         —       3/5         —         —
  templating                       8/8         —         —     41/45         —       8/8         —         —         —         —
  documents                        7/7         —       1/1     12/14       3/6       7/7         —       0/1         —         —
  export                             —         —         —      7/11       0/2         —         —         —         —         —
  opportunity                      9/9         —         —         —         —       4/4         —       0/2         —         —
  ranking                          2/2         —         —         —         —       3/3         —         —         —         —
  automation                     32/39         —       0/2       1/5         —       3/4         —       1/8         —         —

  findings: none — no file reimplements a seam it could have reached.
```

---

## The five findings

### 1 · A row type that lies about the runtime, and the dates it rendered

`sql<CdrlItem[]>` is an **assertion**. TypeScript never sees the query or the column, so a row type
is only as true as the person who wrote it. The inventory already catches the NAME half of this
(a snake_case field where `postgres.toCamel` gives camelCase, which has shipped twice). Nothing
caught the TYPE half — and it is the worse of the two. A wrong name is `undefined`, which throws
and gets noticed. **A wrong type is a value of the wrong shape that renders.**

`audit-row-type-truth.mjs` asks the live database what each column is and compares against
postgres.js's mapping (`lib/db.ts` configures no custom parsers, which the self-test asserts).

- **817** typed `sql<>` sites examined
- **248** row types that contradict the runtime
- **5** of those then read as a string — those are the ones a person sees
- **58** sites reported as NOT CHECKED, rather than assumed innocent

Proven, not argued: a `date` column returns a `Date`, `String(d).slice(0, 10)` is `"Fri Aug 28"` —
no year — and an ageing calculation guarded on a `YYYY-MM-DD` shape shows nothing at all. The
project workspace rendered five: `Thu Aug 27 · Mon Oct 12 · Sat Oct 17 · Tue Oct 27 · Fri Aug 28`.
After the fix and a rebuild, on the same page: **none**, and ISO dates 24 → 29.

The root cause was one page silencing the compiler **eleven times**. Four sibling panels mapped
their dates through `isoDate`; three were handed `as unknown as`. One component tree, one page, two
conventions — the incoherence this review exists to find. The casts are gone, so the boundary is
type-checked, and the fix is at the SOURCE (`::text` in the lib's `SELECT`) so the declared type is
true for every caller and not just this page.

`setBaseline` separately returned `String(proj.baselinedAt)` — non-ISO where every other timestamp
in the API is ISO. Its test passed because **the fixture held an ISO string**. With a real `Date`,
as postgres.js gives, the unfixed code returns
`"Tue Mar 03 2026 00:00:00 GMT+0000 (Coordinated Universal Time)"`.

> A date fixture that is not a `Date` tests a different function than the one that ships.

### 2 · Twelve `String(v)` wrappers that defeat the type check

`String(v).slice(0, 10)` accepts anything, which is exactly how a `Date` reached a field declared
`string | null`. Removed from the project panels so the compiler is the guard; it immediately caught
a nullability case the wrapper had been hiding. The two that remain operate on values that
genuinely are not strings.

### 3 · One of six model call sites could not be emulated

Six places in the frontend call Claude. Four use `@anthropic-ai/sdk`, which reads
`ANTHROPIC_BASE_URL` from the environment by itself. Two used a raw `fetch` and had to do it
themselves — and only one did. `lib/tools/source-scout.ts` wrote `https://api.anthropic.com` as a
literal.

Not a style question. `EMULATE=1` sets `ANTHROPIC_BASE_URL` to the committed `:8787` harness
precisely so every AI-gated flow is drivable with no live key. The scout reached past the emulator
to the real API, with a placeholder key, and failed **alone** while every other AI flow ran. A call
site that ignores the switch opts out of the one mechanism that makes the whole class testable.

`lib/ai/endpoint.ts` is now the single answer; both raw-fetch callers go through it; and
`__tests__/ai-endpoint-single-source.test.ts` asserts the literal host appears there and nowhere
else. Red-tested: re-introducing the literal fails the test and names the file.

### 4 · A second writer that diverged in the part nobody was thinking about

`launchTemplate` had its own `INSERT INTO system_events`, with a comment explaining why: the launch
IS the event, so a swallowed insert would report a workflow started that never will, and
`emitEventSingle` swallows by design.

The comment was right about the throw and silent about the rest. The copy also skipped
`evaluateAutomationRules`, so **an event that launched a workflow was invisible to the tenant
automation-rule layer** while the identical event from any other source was not.

> That is what a second writer costs. It diverges in the part nobody was thinking about, not the
> part the comment justifies.

`emitEventSingleStrict` now carries both behaviours in one implementation. Deliberate behaviour
change; inert until a tenant writes a rule.

### 5 · Two instruments blind to a whole population

**`withProject` was in neither of the inventory's authorisation nor scope vocabularies**, though it
does both — `verifyTenantAccess`, then `runInTenant`. All 32 project routes read as *"resolves but
calls no authorisation helper"*, which was **32 of the 40 signals that instrument emits**. A signal
that is 80% false is one a reader learns to skip. Signals 40 → 8, and the 8 that remain are the
genuine public-route candidates.

**`audit-automation-spine.mjs`'s JOIN 7 walked only the Python step registry.** But a NOTIFY step
is no longer the only thing that names an email template: the frontend emits
`system:notification.requested` with a `template` in the payload, and the Projects capability sends
every one of its mails that way. B141 — *"8 of 15 named a template that existed nowhere, so the mail
emitted `notification.failed` instead of sending"* — was already the second occurrence of that gap,
and a whole second population of template names sat outside the audit built to prevent a third.
JOIN 7b joins them: 4 literal names across 3 files, all with renderers.

---

## The UI

`drive-ui-responsive.mjs` shoots 390 / 820 / 1440. Its route list was four admin pages and five
tenant ones — which covered **three of the ten pipelines**. The dense page of the others (the
workflow map, the agent roster, the template catalogue, the bucket editor, and most of all the
**proposal build workspace**) had never been photographed below `lg` — the exact gap the project
workspace was in before it was added.

Now one dense page per pipeline, with the build workspace resolved from the database (`ORDER BY
created_at`, and required to HAVE sections — an empty workspace photographs as a clean page while
telling you nothing).

**Result: 102 screenshots, no body-level horizontal scroll at any width, nav semantics correct at
every width.**

Two idioms coexist for dense tables on a phone, and the split is defensible rather than accidental:

| surface | idiom |
|---|---|
| tenant-facing (projects, proposals) | the row becomes a **column** — stacked, full-width controls |
| admin tables (`/admin/agents`) | the table **scrolls inside its own container** |

`/admin/agents` clips its third column at 390px, recoverable only by scrolling inside the table.
For a desktop operator tool that is an acceptable trade; it is recorded here rather than silently
"fixed", because converting every admin table to the stacked idiom is a large change with low value
and that call belongs to a person, not to this review.

**Still uncovered:** only the project workspace has a probe that OPENS its overlays
(`probe-project-mobile.mts`). The responsive pass shoots each route AT REST, and every dense thing
on a page is behind a click. Nine pipelines have no equivalent. That is uncovered, not passing.

---

## What did NOT diverge

Worth stating, because a review that only lists problems implies the rest was not checked.

- **Email.** Zero direct transports anywhere in the tree — no `nodemailer`, no `smtplib`, no
  Postmark API call outside the seam. Two legitimate paths (direct TS send, and
  `system:notification.requested` rendered by the CRM), both writing the same `email_send_ledger`
  and honouring the same suppressions.
- **Events.** Every pipeline emits through `lib/events`; the one exception is now closed.
- **Tenant authority.** 34/34 in projects, 56/57 in proposal-build, and the outliers are files with
  no tenant-scoped read.
- **Numerics.** `project_invoices.amount_paid` and friends are `numeric`, which postgres.js returns
  as a **string** — and the Projects code declares them `string` and converts through `money()`.
  The mirror of finding #1, got right.
- **Canvas.** One `CanvasDocument`, one compliance floor, one set of exporters. A project
  deliverable, a proposal volume and a standalone flier are measured by the same ruler.

---

## The recurring lesson

Three instruments were wrong before they were right, and **two of the three were wrong the same
way**: a text search for a bug pattern finds the *changelog* of that bug, and this repo documents
each defect at its own site. The first coherence run reported ten date defects, of which three were
the comment above correct code. The row-type audit's first `usedAsString` did the same.

> An instrument that reads documentation as code finds the most defects exactly where the most care
> was taken, which inverts the signal.

Both now strip comments before asking what a file *does*, while still reading the full text to ask
what a file is *about*.

A fourth was worse. The frontend-template join's first version matched `[a-z0-9_]+`, so the red test
— renaming a template to `project_review_decidedX` — made the match fail outright and the site
**disappeared from the count**. The audit reported "0 with NO renderer" while looking straight at a
broken one.

> A scanner that silently drops what it cannot parse reports a clean run, which is worse than not
> scanning.

And a fifth, in the coherence audit itself: three "this pipeline does not use the seam" findings
turned out to be predicates matching import *spelling* rather than resolved modules —
`lib/projects/milestones.ts` reaches the ToDo seam as `./todos`. A false negative is the dangerous
direction, because it invents work and nothing downstream contradicts it. All three are now pinned
in the self-test.

---

## Verification

`tsc` 0 · `vitest` 2,484 · branch drive suite 41 drives · coherence findings 0 · row types read as a
string 0 · frontend notification templates with no renderer 0 · responsive 102 shots with no
sideways scroll.
