# Projects — build log

The as-built record. Design: **docs/PROJECT_MANAGEMENT_DESIGN.md** (the decisions). This file is
what actually happened, including the places the design was wrong.

Build order and task ids are the register in the V1 close-out plan: **D1 … D10**, then
**P1** (the rename to Projects).

---

## D1 · Schema, RLS, and the assignment boundary — migration 216

**Shipped:** `db/migrations/216_project_spine.sql`, `frontend/lib/projects/access.ts`,
`frontend/scripts/verify-project-isolation.mjs` (13 assertions),
`frontend/__tests__/projects-assignment-boundary.test.ts` (14).

Eight tables. Nothing renders yet — isolation is provable before anything depends on it, which is
the whole point of doing this step first.

### The design's DDL would not have applied

```
CREATE TEMP TABLE probe (id int, current_date date);
ERROR:  syntax error at or near "current_date"
```

`project_milestones.current_date` is in the design doc and `CURRENT_DATE` is a **reserved
keyword**. Quoting it works, and then every hand-written query needs the quotes forever — a
permanent trap that reads like a typo when someone forgets.

It is **`forecast_date`** here, which is also the truer name: the current forecast for a milestone,
against the immutable `baseline_date`. The lens carries a standing regression check that no
`delivery_*` column is ever named with that keyword again.

### Every table carries `tenant_id`, and none carries it by lineage

Migrations 184, 212 and 213 exist because tables shipped without a policy and had to be retrofitted.
Mig 212's header records the cost: seven proposal-spine tables had `relrowsecurity = false` and zero
policies, so **100% of their rows were readable from any tenant context** — including
`canvas_versions`, which holds the text of every proposal.

It stayed invisible because every audit in this repo looks for a `tenant_id` **column**, and those
seven had none; their tenancy was FK lineage. So two rules here:

- every table gets `tenant_id uuid NOT NULL` **as a column**, even where the FK parent already
  implies it — a lineage-shaped table is invisible to the instrument meant to cover it;
- FORCE RLS plus the policy is written in the **same migration** that creates the table, so there is
  no window in which it exists unprotected.

The lens asserts all three properties (RLS on · FORCE on · exactly one policy · NOT NULL
`tenant_id`) and that assertion needs **no fixture data** — which matters, because an empty box is
exactly when a missing policy is easiest to introduce and hardest to see.

### Baseline immutability is a trigger, not a convention

Variance only means something if you still hold what you promised. A rebaseline that overwrote the
baseline would destroy "fourteen days late against baseline" — forever, and silently, because the
arithmetic would still work.

An app-layer rule protects only the writers that exist today, and the thing being protected cannot
be reconstructed afterwards. So `delivery_baseline_is_immutable()` fires `BEFORE UPDATE` on the WBS,
the milestones and the project, and allows exactly two things:

| transition | allowed | why |
|---|---|---|
| `NULL → value` | ✅ | setting the baseline, once |
| `value → same value` | ✅ | otherwise an idempotent whole-row UPDATE fails for touching a column it did not change |
| `value → different` | ❌ 23001 | the headline |
| `value → NULL` | ❌ 23001 | clearing is moving |

The lens asserts **all four**, and the first two matter as much as the third: a trigger that refused
the initial set would be a deny-all wearing an immutability badge, and would satisfy every "cannot
be moved" assertion. There is a fifth assertion that the **current** plan stays freely editable — a
trigger that was one column too wide would make the whole capability read-only and still pass
everything above it.

### Assignment is the half RLS cannot enforce

RLS scopes by tenant because the per-request context carries one value. Delivery needs a second,
narrower scope — *which employees of that tenant* — and a policy cannot consult the requesting user
without putting the user id into the request context for every table in the database.

So `lib/projects/access.ts` is one module with one predicate, and CLAUDE.md says why that is not
optional: *"Treat that belt as load-bearing — a new reader that omits it leaks, and RLS will not
catch it."*

| actor | scope |
|---|---|
| `tenant_admin` + (incl. descended `rfp_admin` / `master_admin`) | every project at their tenant |
| `tenant_user` | exactly their `project_assignments` rows |
| `partner_admin` (bare) | **none** — it ranks below `tenant_admin` and reaches a tenant only through a membership, pinning to `tenant_admin` when it descends |
| `partner_user` | **none, membership or not** |

That last row is the one worth stating out loud. `verifyTenantAccess` admits a cross-company
collaborator on a `source='collaborator'` membership — correct for the proposal spine, where
collaboration is the point. Delivery v1 has no collaborator surface at all, and **refusing the role
makes that a rule rather than a convention nobody wrote down.**

The boundary test asserts the **SQL text**, which is unusual and deliberate: the join is the
security boundary and its absence produces *more rows*, not an error. It also asserts that a refused
role issues **no query at all** — an empty result from a query that ran is indistinguishable from
one that was scoped out — and that both functions fail **closed** when the database is unreachable.

### Red first

| probe | result |
|---|---|
| before mig 216 | 8 tables reported absent · exit 1 |
| policy DROPPED on `project_wbs_nodes` | structure check fired · exit 1 |
| policy REPLACED with `USING (true)` — structure still valid, one policy, FOR ALL | **behaviour fired**: a foreign WBS node visible, and the cross-tenant INSERT succeeded · exit 1 |
| baseline trigger DISABLED | moving and clearing a set baseline both succeeded · exit 1 |
| assignment JOIN removed from the employee query | the boundary test fired · 13 of 14 still passing |

The third row is the meaningful one — it leaves the structure entirely plausible, so only the
behavioural assertion can catch it. All five went green on restore.

### The harness was wrong twice before the product was wrong once

Both were mine, both caught before reporting, and both are the same underlying trap:

1. `AS tenant_col` in a **bare-client** script. `lib/db.ts` applies
   `transform: { column: { from: toCamel } }`; a standalone `postgres()` does not, so `row.tenantCol`
   read `undefined` and the lens reported *"no NOT NULL tenant_id column"* against eight tables that
   all had one. **Second occurrence this session** — the email drive did the same thing with
   `sent_at`. The rule now written into both files: in a bare-client script, every alias is quoted
   camelCase.
2. A backtick inside a SQL comment **inside a JS tagged template**, which ends the literal. Instant
   `SyntaxError`, cheap to fix, and worth the comment that now sits next to it.

`tsc` 0 · vitest **2,034** (2,020 before) · `check-rls-posture` — 67 policies over 44 force-RLS
tables, 45 tenant-owned tables partitioning cleanly across 7 contexts.

---

## D2 · The anchor — projects, artifacts, CLINs with provenance

**Shipped:** `lib/projects/{projects,clins,provenance,gate}.ts`, four API routes,
`lib/storage/paths.ts` → `customerDeliveryPath`, migration 217,
`__tests__/delivery-provenance.test.ts` (14).

### The `project` namespace had to come forward, and the design undercounted it

D6 was going to register the namespace. It could not wait: `project.created` is the first thing
`createProject` emits, and the audit-coverage test requires every write route to leave a trail.

The design called this "a deliberate three-file change: the test's `REGISTRY`, `lib/events.ts`'s
`KNOWN_NAMESPACES`, and `docs/EVENT_CONTRACT.md`". **It is four**, and it missed the only one that
fails rather than warns:

| place | behaviour on an unregistered namespace |
|---|---|
| `system_events_namespace_chk` (DB) | **raises 23514** — fail-closed |
| `lib/events.ts` `KNOWN_NAMESPACES` | logs a warning, then inserts anyway |
| `__tests__/event-contract.test.ts` | fails the suite |
| `docs/EVENT_CONTRACT.md` §4 | documentation |

Without the CHECK widened first, every `project:` emit would throw at the database and the
surrounding best-effort catch would swallow it — a workspace that created itself correctly and left
no trace that it had. Migration 217 widens it, and the constraint now carries a `COMMENT` naming all
four places so the next person changing the registry finds them.

### The anchor rule, and where it is actually enforced

The uploaded executed contract and as-submitted proposal are the anchor **even when we authored the
proposal**: what lives in `proposals`/`proposal_sections` is a working copy that stayed editable
after submission, so a deliverable tracing to it traces to something that can still change.

But requiring both files at creation would mean nobody can open the workspace to see what is being
asked of them, which turns the ToDo into a dead end. The line is the **baseline**: `readiness()` is
the single place the two-artifact rule is enforced, and freezing a skeleton against documents that
are not there is the failure worth preventing.

### Provenance: the two cases that carry the weight

`badgeFor` has four tones, and two of them are the reason the module exists:

- **No provenance row reads `Unverified`, not neutral.** Silence about where a number came from is
  the same claim as "we made it up", and rendering it as ordinary is how a default becomes
  indistinguishable from a fact.
- **A citation with no value is a DEFERRAL** — `Set elsewhere`, with the excerpt. "The delivery
  schedule is set out in the Task Order" is not a missing PoP end date; it is the contract telling
  you where the answer lives. **Absence is a finding.**

`recordProvenance` refuses `verified` or `pattern_match` with no source document, which is what
stops "Read from source" appearing against a source nobody can open. The upsert only wins when the
new method **outranks** the incumbent, compared at the WRITE — a read-time comparison would leave
two rows to disagree — and a re-assertion of the same method is not a promotion, so a repeated `ai`
guess cannot creep upward by being written twice.

### FK-before-write, scoped to the project

`createWbsNode` validates `parentId` and `clinId` **within this project** before inserting. A parent
from a different project satisfies the FK — it is a real row — and would quietly graft one
contract's plan onto another's. RLS would not catch it either, because both rows can belong to the
same tenant.

---

## D3 · The WBS and the `workplan` canvas

**Shipped:** `lib/projects/wbs.ts`, the `workplan` canvas format and its exemption,
`__tests__/delivery-workplan-canvas.test.ts` (9).

Tables are the source of truth; the canvas is an editing surface over them. The four things this
capability must do — rollup, RLS, assignment, baseline comparison — are SQL operations, and none can
be done against a JSONB blob without projecting it back into tables anyway. What the canvas
contributes is the **interaction model**, which is the valuable half. The honest cost: no
`canvas_versions` history for free, so baseline and audit are explicit in tables.

Row ids live in `metadata.workplan.rowIds`, positionally aligned with the table's rows — not
smuggled into cell text, where a person could see and edit them. Baseline columns render beside the
current plan (variance is the number a PM actually reads) and are marked read-only, because the
database refuses to move them and an editable-looking cell would be a lie the UI tells until the
save fails.

### The exemption is structural first, and guarded second

A workplan declares `max_pages: null, max_slides: null`, the same way `spreadsheet` does, so in the
normal path the floor has **nothing to check** rather than being skipped by a special case. The
`isWorkplan` guard in `validateCanvasAgainstSpec` covers the one remaining route — a spec supplied
from somewhere else, a proposal's, applied by a caller that did not look at the format — and it
exempts the SIZE caps only. The font floor and the image rule still apply.

That distinction matters: a blanket early return would have silently dropped the font check too,
and would have looked identical in every test that only asserts "no page violation".

### The test asserts the exemption in BOTH directions

An exemption is a check that does nothing on purpose, which is the same shape as a check that does
nothing by accident — how `/admin/storage` shipped a red error banner past every lens (B131). So:

1. a 400-row workplan produces no page violation — a large project is not a violation
2. it stays exempt even when a page cap is supplied from elsewhere
3. **the exemption does not leak** — the same oversized content in a `letter` canvas still violates
4. a workplan still honours a font floor

Assertion 3 is what makes 1 and 2 mean anything. Without it, an exemption that disabled the page cap
for *every* format would satisfy them both and look correct.

### The harness was wrong again, and the same rule caught it

Assertion 3 **failed** on first run — reporting the exemption as leaking against code where it does
not. The fixture used `type: 'paragraph'`, which is not a canvas node type; the real name is
`text_block`. `getNodeText` returned `''` for every node, the ruler counted zero pages, and the
"leak test" was measuring an empty document.

Third harness defect this session, all three caught before they became a bug report. *A new
instrument's first output describes the instrument.*

`tsc` 0 · vitest **2,057** (2,034 after D1).

---

## D4 · Baseline and rebaseline

**Shipped:** `lib/projects/baseline.ts`, `…/delivery/projects/[projectId]/baseline` (GET · POST ·
PATCH), `__tests__/delivery-baseline.test.ts` (13).

Migration 216 already made the baseline immutable in a trigger. This is the other half of the same
rule and the legible half: the trigger raises `23001`, which reaches a user as a 500 and a stack
trace, while these guards turn the same refusals into an answer a person can act on.

| refusal | code | why it is not just the trigger's job |
|---|---|---|
| already baselined | `409 ALREADY_BASELINED` | the message names the alternative — *rebaseline* — which a SQLSTATE cannot |
| anchor documents missing | `409 NOT_READY` | names WHICH one is missing. The two-artifact rule is enforced here and nowhere else |
| no baseline to rebaseline from | `409 NOT_BASELINED` | |
| no reason given | `400 VALIDATION_ERROR` | a rebaseline is the moment a schedule stopped being true; six months later that field is the only answer to "why is everything fourteen days late" |

The set is a **compare-and-swap** — `baselined_at IS NULL` in the predicate — so two concurrent
requests cannot both win. The loser matches zero rows and rolls back rather than stamping a second,
later timestamp over the same frozen plan.

### The assertion this module exists for

`rebaseline` shifts `planned_*` and `forecast_date` and **does not name the baseline columns at
all** — asserted against the SQL text, the same way the assignment boundary is, and for the same
reason: the failure produces a plausible result rather than an error.

A rebaseline that shifted the baseline too would return *"shifted 14 days"*, every date would look
internally consistent, and **the variance would read zero** — the schedule silently having never
slipped. The trigger would catch it at run time; this catches it at build time and says why.

Red-first: adding `baseline_start = baseline_start + shift` to the update fired that assertion
immediately; removing it went green.

Two smaller decisions worth their line:

- **A met milestone does not move.** Its date is a fact, not a forecast, so the update is scoped to
  `status = 'pending'`.
- **`startOn` is converted into the same uniform shift** as `shiftDays` rather than taking its own
  path — one delta applied everywhere is what keeps durations intact.

`tsc` 0 · vitest **2,070** (2,057 after D3).

---

## D5 · Milestones, deliverables, acceptance

**Shipped:** `lib/projects/milestones.ts`, three API routes,
`__tests__/delivery-deliverables.test.ts` (18).

### Three acts, not one

Declaring a deliverable, uploading a file, and accepting it are separate verbs with separate
permissions:

| act | who | why |
|---|---|---|
| declare | `tenant_admin`+ | it defines what the contract owes |
| **upload** | **any assigned employee** | the everyday act of delivery work. Requiring an admin for every progress report would make the assignment roster pointless |
| **accept** | `tenant_admin`+ | acceptance is what closes a CLIN |

**A file being present is not a deliverable met.** Collapsing upload and acceptance would make "we
uploaded a draft" and "the government accepted it" indistinguishable, and the second is the one that
matters. So `uploadDeliverable` never sets `accepted_at`, `acceptDeliverable` never touches the
file, and `markMilestoneMet` refuses while any deliverable on it is unaccepted — naming them, and
saying why: *"Uploading a file is not acceptance."*

### A replaced file revokes acceptance

An accepted deliverable whose file has since changed is not an accepted deliverable. Re-uploading
clears `accepted_at`/`accepted_by`, and the emitted event carries `replacedAcceptance: true` so the
revocation is visible rather than inferred from an absent flag. Without it a milestone could close
against a document nobody approved.

Each upload gets a **new object key**, so a replacement does not overwrite the prior bytes — the row
points at the current file and the old one survives for audit.

### Two compare-and-swaps, both closing a real window

- `markMilestoneMet` updates `WHERE status = 'pending'`, so a double-click cannot stamp two
  `met_at` values or emit two events.
- `acceptDeliverable` carries **both** refusal conditions in one statement's predicate —
  `storage_key IS NOT NULL AND accepted_at IS NULL`. A read-then-write would leave a window in which
  two accepts both see a null. The follow-up read exists only to say *which* refusal it was
  (`NOTHING_UPLOADED` vs `ALREADY_ACCEPTED`), never to decide it.

The met event carries `varianceDays` computed once, so the activity feed can say "met, nine days
late" instead of leaving a reader to subtract two dates.

### Red first

| probe | result |
|---|---|
| `uploadDeliverable` also sets `accepted_at` — the two facts collapse | **2 assertions fired**, including the replaced-acceptance one |
| the milestone gate checks `storage_key IS NULL` instead of `accepted_at IS NULL` | **fired** — a milestone would close on files nobody approved |

Both green on restore. The second probe is the one worth keeping: it leaves every return value and
every date plausible, and only an assertion on the predicate itself can catch it.

`tsc` 0 · vitest **2,097** (2,079 after the registry work) · delivery isolation lens green.

---

## D6 · The award bridge

**Shipped:** `pipeline/src/workflows/on_contract_started.py`, the `delivery_setup_ready` CRM
template. The `project` namespace and its event labels landed earlier — in D2 (out of order,
because `project.created` could not wait) and in the registry consolidation.

### One event, and it deliberately does not create the project

`capture:contract.started` already fires when a proposal's outcome is recorded as awarded. The
bridge turns it into a **ToDo** — *"Set up delivery workspace"* — plus an independent notification.

It does **not** auto-create the delivery project, and resisting that is the whole design. A
workspace is anchored to two uploaded artifacts; one created the instant an outcome is recorded
would be anchored to **nothing**, which is exactly what the provenance model forbids. It is the
ingest-provenance rule one domain over: *a value the product did not read from the source must never
look like one it did* — and an auto-created project would look precisely like a sourced one.

So the bridge raises work for a person, and `readiness()` refuses to baseline until both files are
actually there. Two independent enforcement points for one rule.

### The two steps are independent, on purpose

Neither `depends_on` the other. A failed notification must not leave the ToDo unraised, and a failed
ToDo must not leave the admin uninformed — either one alone still lands the customer in the right
place, and there is no downstream step waiting on either, so nothing dead-ends.

The ToDo's timeout is **ten days**. Award-to-kickoff is measured in weeks; a gate that expires
before the work is plausible is a gate people learn to ignore.

### The template was written in the same change as the workflow that names it

A NOTIFY step naming a template that exists nowhere does **not** error — `render_template()` returns
`None` and the listener emits `system:notification.failed` instead of sending mail. That has
happened twice in this repo (the 052 regression, then eight more found by the spine audit's join 7).

Red-first, and **both** instruments caught it: renaming the template to `delivery_setup_TYPO` fired
`test_notify_templates_exist.py` and the audit's join 7, each naming
`OnContractStarted.notify_delivery_setup → delivery_setup_ready`. Green on restore.

Spine audit after: **35 workflows · 119 steps · 0 dead triggers · 0 dead waits · 0 unresolvable
actions · 0 NOTIFY steps naming a template with no renderer.**

`pipeline` 1,319 passed · vitest 2,107 · `tsc` 0.

---

## D7 · Rollups — three measures, never blended

**Shipped:** `lib/projects/rollup.ts`, the rollup route,
`frontend/scripts/verify-project-rollup.mjs` (9 assertions against hand-computed values),
`__tests__/projects-rollup-measures.test.ts` (4).

**There is no `percentComplete` in the response and there is not going to be one.** Sixty percent of
budget against forty percent of schedule is the most useful thing a PM can see; averaging them to
"50%" destroys exactly that signal while still looking like an answer. The drive asserts the absence
outright.

### Not measured is not zero

A project with nothing planned is not 0% spent. A CLIN with no deliverables is not 0% delivered.
`null` says *not measured*; `0` says *measured, and it is zero* — and the UI has to render them
differently, which is the point. The caught-error path returns an all-null rollup for the same
reason: zeroes would render as a project with no spend and no progress, which is a claim, and a
false one.

### The SQL is where the risk lives, so the test is live

Three failure modes, each producing a **plausible number** rather than an error:

| defect | what it reads |
|---|---|
| aggregate on the raw `clin_id` instead of the resolved one | children silently dropped from their CLIN's cost |
| join deliverables into the WBS statement | each cost row multiplied by the deliverables beneath it |
| unweighted schedule average | a 2-day task and a 200-day task counted equally |

So the drive seeds a fixture whose numbers make each one show up as a *different* wrong answer, and
asserts against values computed by hand in the comments:

```
ok  0001 cost% (child inherits the CLIN: 800/2000) = 40
ok  0001 planned cost is 2000 — no cartesian product with deliverables
ok  0002 schedule% (duration-weighted 2/202, NOT the 50% an unweighted average gives) = 1
ok  0002 deliverables% (none exist — NOT MEASURED, not zero) = null
ok  project cost% from ROWS (800/3000), not the average of CLIN percentages (20%) = 26.7
```

Red-first: unweighting the schedule produced **50% instead of 1%** — a PM would have read a CLIN
that has not started as half done. Aggregating on the raw column fired too.

### The harness had no tenant context, and got silence for it

The drive's first run reported all four measures `null` and read like a broken rollup. The rollup was
fine: the script called it without `enterTenant`, so `sql` ran with `app.tenant_id` unset, **RLS
matched nothing, and every query returned zero rows with no error.**

That silent-empty is exactly why `verify-project-isolation.mjs` asserts own-rows-visible *before*
foreign-rows-invisible — a deny-all satisfies every "no leak" check trivially, and here it satisfied
every arithmetic check with a null. Fourth harness defect this session, all four caught before
reporting.

Work belonging to no CLIN is **reported as its own row**, not folded into the total: an unassigned
node is usually a plan someone has not finished writing, and hiding it inside a total is how it
stays unfinished.

`tsc` 0 · vitest **2,111** · rollup drive green.

---

*D8 onward appended as built.*
## D8 · The UI — and two visible defects every automated lens passed

**Shipped:** `app/portal/[tenantSlug]/projects/page.tsx` (the list),
`app/portal/[tenantSlug]/projects/[projectId]/page.tsx` (the workspace), the nav entry in the portal
layout, `components/projects/deliverable-row.tsx` (the upload/accept controls),
`lib/projects/dates.ts`, `__tests__/projects-dates.test.ts` (9),
`frontend/scripts/seed-project-scenario.mjs`.

### The rail item is shown to someone with nothing in it

`deliveryScope` refuses `partner_user` outright and the link does not render for that role — delivery
v1 has no collaborator surface, which is what takes cross-tenant out of this capability entirely. But
an *employee with no assignments* still sees the link and lands on an empty list that explains who can
add them. A missing rail item reads as "this company does not do delivery"; an empty list with a
sentence reads as what it is.

### The page refuses to state a number nobody measured

Three measures side by side, never averaged, and a measure with no denominator renders **"not
measured"** rather than `0%` — the UI half of D7's `null`-not-zero rule. Every CLIN field carries a
provenance badge, and a value with no recorded source reads **Unverified**, not neutral: silence about
where a number came from is the same claim as "we made it up".

### All five lenses were green, and the page was visibly broken

```
Kickoff and SOW agreed          met  NaN days early against baseline
0001  Base period …   Tue Apr 28 → Wed Apr 28
```

postgres.js returns a `date` column as a JavaScript `Date`; the page treated one as an ISO string.
`String(d).slice(0,10)` gives `"Tue Apr 28"`, and `Date.parse` of that is `NaN`.

Both halves of that are worth naming, because neither is a typo:

* the variance rendered **at all** because `NaN !== 0` is true, and it labelled itself **early**
  because `NaN > 0` is false, so the ternary took the cheerful branch. A wrong number would have been
  better — a wrong number looks wrong.
* the period of performance showed start and end identically because ten characters of a `Date`'s
  string form cut before the year.

`verify-surfaces` scored it clean (it rendered). `verify-api-contract` scored it clean (the envelope
was textbook). `verify-ui-vs-db` scored it clean (its expectation is the page's own query, and the
page's own query returned the right rows — the defect was in the *rendering* of them). None of those
lenses is broken. **This is the case docs/UI_ATLAS.md exists for**, and it was found by opening the
screenshot.

### The fix's own test caught a flaw in the fix

`lib/projects/dates.ts` accepts whatever the driver hands back, and is unit-tested **against a real
`Date`** — a test fed only ISO strings would have passed against the broken code too.

The first version simply handed the string to `new Date()`. That does not throw and is not `Invalid
Date`: Node parses `'Tue Apr 28'` and **invents a year**. So the exact value produced by the bug this
file exists for would have been accepted and turned into a confident, wrong date. Hence `ISO_SHAPE` —
a `Date` instance is trusted because the driver produced it, a string must look like an ISO date, and
anything else is `null`.

`daysBetween` returns `null`, never `NaN`: a milestone with no baseline has no variance, which is a
different fact from "on time".

### The seed exists so the photographs show something

A page rendering its empty state is a valid render and proves almost nothing —
`verify-ui-vs-db` in particular cannot compare a stated number to a held one when there are no rows.
`seed-project-scenario.mjs` seeds one coherent award: both anchor documents, two CLINs whose
provenance is deliberately *mixed* (one cited, one a deferral with a citation and no value, one with
no provenance at all), a WBS whose child inherits its CLIN, milestones with real variance, and
deliverables in all three states. A screenshot in which the three badges look the same is the failure
the provenance model exists to prevent, so the fixture makes all three appear at once.

### D8b · The controls the capability lens found unsurfaced

The upload and accept routes shipped in D5 and **nothing called them.** Five green lenses said
nothing, because none of them can: a route with no caller answers correctly to a harness and is
invisible to a person. `reconcile-capability.mjs` reported the pair UNSURFACED in a feature written
the same week — the class it exists for, caught inside its own build.

`DeliverableRow` is the caller. Two controls, because they are two facts: any assigned employee
attaches a file, only a tenant_admin accepts. Replacing a file revokes a prior acceptance server-side,
so the confirm says so *first* rather than letting someone discover it afterwards. Accept is hidden
when there is nothing to accept — the server still refuses, but that refusal is a backstop, not the
first thing a person should meet.

`tsc` 0 · vitest **2,120** · five lenses green · atlas re-shot.

---

## D9 · The verification pass — and three defects the pass itself found

**Shipped:** the delivery block in `frontend/scripts/verify-ui-vs-db.mjs`, a lane-partial guard in
`drive-ui-states.mjs`, a merge-not-replace index write in `capture-ui-atlas.mjs`, the date-idiom guard
in `__tests__/projects-dates.test.ts`, and fixes in `lib/projects/milestones.ts` and
`lib/projects/baseline.ts`.

The point of a verification pass is not to collect greens. Every finding below came from the pass.

### 1 · The D8 date bug had two siblings the D8 fix did not touch

`lib/projects/dates.ts` repaired the *page*. A grep for the idiom that caused it found two more:

| where | what it did |
|---|---|
| `milestones.ts` — the `project:milestone.met` payload | `String(baselineDate).slice(0,10)` → `NaN`, and `JSON.stringify(NaN)` is **`null`** — so every met milestone recorded "no baseline" instead of "nine days late", permanently and with nothing to notice |
| `baseline.ts` — the ALREADY_BASELINED 409 | told a person *"This project was baselined on Tue Apr 28"* — **no year**, in a message whose only job is to say when |

Neither is reachable by a unit test without a database, and neither is visible to any lens: one lives
in an event payload nothing renders, the other in a 409 body no happy path produces. A grep is the
only instrument that sees them, so a grep is now the instrument —
`__tests__/projects-dates.test.ts` scans the delivery tree for `String(…).slice(0, 10)`.

Red-first, against `HEAD`: both files OFFEND before the fix, both clean after.

**The guard's own self-test caught a flaw in the guard.** The first regex was
`/String\([^)]*\)\.slice\(0, 10\)/` — and `toISOString()` **ends in** `String()`, so it also matched
the one idiom that is correct. That is why the first version had `dates.ts` exempted: the exemption
was hiding the defect rather than expressing a rule. A lookbehind fixed the regex, and no file is
exempt now. Comments are stripped before matching, because every file that fixes this bug quotes it.

### 2 · The `ui-vs-db` lens had no expectation for delivery at all

Four hand-written blocks, none of them delivery — which under this repo's own rule means the surface
was **uncovered, not passing**, and it is precisely the surface where two visible defects survived
every other lens. The new block reconciles the deliverables denominator (`N of M accepted`) against
the deliverables query **copied from `lib/projects/rollup.ts`, GROUP BY and all**, checks the roster
count, and asserts three things about the rendering itself:

* no `NaN` anywhere — it reaches a page as literal text no matcher would otherwise look for, which
  is exactly why nothing caught it
* no `Invalid Date` — the sibling symptom of the same root cause
* a period of performance renders as two ISO dates **whose ends differ** — `Tue Apr 28 → Wed Apr 28`
  was the D8 symptom

It also fails, rather than skipping, when there is no delivery project to reconcile against.

### 3 · A `--lane` capture had silently shrunk the sweep to a quarter

`docs/ui-atlas/index.json` is not only the atlas's report — `drive-ui-states.mjs` reads it to decide
what to drive. A `capture-ui-atlas.mjs --lane tenant` run had **overwritten** it, leaving 40 shots
all in one lane. The next full states drive then found five of its six lanes empty, skipped them at
`if (!mine.length) continue` **without a word**, and finished `EXIT=0` with

```
94 state screenshot(s) across 29 route(s)
```

against a committed index from the previous full run holding **311 shots across 123 routes**. Nothing
failed. Coverage fell by three quarters and the only trace was arithmetic in a header — 40 considered,
29 driven — that nobody subtracts.

Two changes, at both ends of the coupling:

* a lane capture now **merges** into the index, replacing only its own lane and recording
  `partialLanes`, so `--lane` can never narrow a downstream consumer's scope again;
* a full states drive **exits 2 as a HARNESS DEFECT** when any lane has no routes, naming them.

Red-first: the guard fires on exactly the index that produced the false-clean run.

### 4 · The atlas caught an intermittent twice, on two different routes — and it was a bug class

The full atlas reported `/partner` **broken**: `Minified React error #418`, a hydration mismatch,
during a sweep of 153 pages. It did not reproduce — no structural divergence between the server HTML
and the hydrated DOM, no invalid nesting, and 18 loads across 6 fresh sessions threw nothing. On its
own that reads like noise.

Then the next full sweep threw the same error on **`/admin/agents`**. Two routes with nothing in
common, both only under sustained load. That is not a page defect; it is a **timing** defect, and the
repo already has its name: **B79 — a `'use client'` component that reads the clock during render.**
The server writes "just now", the client hydrates a beat later and computes "1m ago", the text does
not match, React throws #418, and **hydration fails for the whole subtree while the route answers
HTTP 200 the entire time.** It is intermittent by construction: the two renders usually agree, and
disagree only when the gap between them crosses a rounding boundary — which is exactly what a
153-page sweep makes likely and a single local load makes vanishingly unlikely.

`components/ui/time-ago.tsx` was written for this, after occurrences one to three. **Five components
had re-implemented the unsafe version anyway:**

| file | helper | granularity |
|---|---|---|
| `components/portal/proposal-timeline.tsx` | `relativeTime` | **seconds** — customer-facing, on every proposal |
| `components/scout/candidate-queue.tsx` | `rel` | **seconds** |
| `components/admin/recent-sessions.tsx` | `relTime` | **seconds** |
| `components/admin/diff-history.tsx` | `formatRelative` | minutes, `just now` |
| `components/admin/source-card-actions.tsx` | `formatRelative` | minutes, `just now` (3 call sites) |

All five now go through the mount rule — `now` is null until mounted, so the first paint is a
deterministic UTC stamp on both sides and the relative form appears on the next tick. The two with an
absolute-date fallback past a week keep their exact wording: this is a hydration fix, not a copy
change.

And a guard, because this is the eighth occurrence: `__tests__/client-clock-in-render.test.ts` matches
the SHAPE — a module-level function in a `'use client'` file that reads the clock, builds a
relative-time string, and is called from JSX. A clock read inside an effect, a handler or a `useMemo`
is fine and is not matched. Red-first against `HEAD`: it fires on all five, and is clean on all five
fixes.

**What this does not claim.** I have not reproduced #418 on a fixed build under load, so I cannot say
the two observed throws were *these* five components — none of them renders on `/partner` or
`/admin/agents`. What is established is that the class was live in five places, that it produces
exactly this signature, and that it is now closed in those five. If a sweep throws again, the next
step is a dev-build capture where React names the component.

### 5 · A third defect, and the picture caught this one too

```
FUNDED
1100000.00                       ← $1.1M, or $11,000.00 with a stray zero?
805000 of 1750000 spent
```

Every number was **correct**, and `verify-ui-vs-db` compares the value the page states to the value
the table holds — so it matched, exactly. `numeric` comes back from postgres.js as a string, and the
page rendered the string. On a federal contract workspace the funded amount is the first number a
reader looks for, and a wall of digits with no separator and no currency is not a style preference:
it is a number the reader has to count on their fingers before they trust it.

`lib/projects/money.ts` follows the house convention (`lib/export/canvas-html.ts:172`) — `$`, `en-US`
grouping, no cents. Cents on a million-dollar CLIN are noise; the ledger keeps them, the page does not
show them. **The unit test caught a hole in the first version**: `Number(String([]))` is `0`, so an
empty array rendered as **`$0`** — a confident zero on a funded amount, which is the failure this
whole codebase keeps fighting. `usd` now takes a number or a numeric-shaped string and nothing else.

### The pass itself

| instrument | result |
|---|---|
| `verify-surfaces` | 80 surfaces · 80 clean · 0 broken · 3 unaddressable, each reported |
| `verify-api-contract` | 139 GETs on disk · 119 graded · 4 exempt · 16 unbound · **0 no-actor** |
| `verify-ui-vs-db` | every stated number matches, **including the new delivery block** |
| `verify-db-crud` | every write landed; fixture restored |
| `verify-write-contract` | 225 write verbs · 225 called · 0 no-actor |
| `verify-project-isolation` | 13 assertions — RLS, cross-tenant INSERT refused, baseline immutable |
| `verify-project-rollup` | 9 assertions against hand-computed values |
| `verify-email-ledger-rls` | 8 assertions — own rows visible, foreign and platform rows not, writes refused |
| `check-rls-posture` | 67 policies · 44 force-RLS tables · 53 tenant-owned tables partition cleanly |
| `audit-automation-spine` | 0 dead triggers · 0 dead waits · 0 unclosed brackets · **119** step actions all resolve · 17 NOTIFY steps all have a renderer |
| `reconcile-capability` | UNSURFACED back to the pre-existing **6** — none of them delivery |
| `drive-ui-states` | **273 states across 126 routes in 6 lanes** (the pre-guard run: 94 across 29 in one) · 2 harness navigation aborts, reported not swallowed |
| `capture-ui-atlas` | 153 shots · 118 routes considered · 0 no-actor |
| build | `tsc` 0 · vitest **212 files / 2,130 tests** · `next build` 0 |

Every mutating drive ran between a `pg_dump` and a `pg_restore`, and the restore was verified against
the pre-drive counts (27 tasks · 45 bucket scores · 2 delivery projects · 4,023 events · 863 atoms).

**What is still uncovered, stated rather than implied:** `verify-db-crud` has no delivery block — the
two purpose-built delivery drives cover that ground more closely than a generic CRUD walk would, but
that is a judgement, not a measurement. `/admin/site` produced no states this run (a navigation abort
the drive reported); the atlas renders it 200. And `/partner` threw once and has not since.

---
## D10 · The API was dead, and five green lenses said otherwise

Found by pressing a button in a screenshot.

`drive-ui-states` captured a toast on the delivery workspace, `kind: toast · trigger: "Accept"`. The
toast was **red**, and it said **"Deliverable not found"** — on a deliverable rendered directly above
it, with a file attached and an id straight out of the page.

### Every delivery route ran with no tenant context

```
GET   …/delivery/projects                    → 200 {"data":{"projects":[]}}   a tenant with two
GET   …/delivery/projects/[id]/clins         → 404 {"error":"Project not found","code":"NOT_FOUND"}
GET   …/delivery/projects/[id]/milestones    → 404  same
GET   …/delivery/projects/[id]/rollup        → 404  same
GET   …/delivery/projects/[id]/documents     → 404  same
GET   …/delivery/projects/[id]/wbs           → 404  same
GET   …/delivery/projects/[id]/deliverables  → 404  same
PATCH …/deliverables/[id]                    → 404  the red toast
```

**All twenty handlers.** `deliveryGate` called `enterTenant()` from inside itself.
`AsyncLocalStorage.enterWith` sets the store for the remainder of the CURRENT execution — a route
that `await`s the gate resumes in a *different* microtask, in the context captured before the await,
so the store was gone before the handler's first query. RLS matched nothing and every read came back
empty.

The mechanism is worth stating exactly, because a first attempt to reproduce it FAILED: moving
`enterTenant` into the wrapper, called synchronously immediately before `handler(gate)`, works
perfectly — same frame, no await between. **It is the `await` boundary that loses the store, not the
nesting.** `lib/db.ts` already said so in a comment on `verifyProposalAccess` ("context does not flow
child→parent"), and so did this file's own header — which described returning-not-wrapping as
deliberate while the code below it did the opposite.

The PAGES were unaffected: they call `enterTenant` in their own frame. So the workspace rendered
perfectly, with correct numbers, while its entire API returned nothing.

### Why every lens passed — and this is the part worth keeping

| lens | what it asked | why it could not see this |
|---|---|---|
| `verify-api-contract` | is the envelope `{data}` / `{error,code}`? | a 404 with both fields is **textbook**. It graded them green. |
| `verify-write-contract` | does a client error answer 4xx with both fields? | a blanket 404 on every verb is *exactly* what it wants. |
| `verify-surfaces` | does the page render? | it did — the pages don't use the API. |
| `verify-ui-vs-db` | is the stated number the held number? | it was — same reason. |
| `reconcile-capability` | is anything unsurfaced? | the routes ARE called, by a page that works. |

Five green lenses and a dead capability. None of them is broken; the question "does this route return
its own tenant's data" was in no lens's scope.

### The fix, and the guard

`withDelivery(tenantSlug, handler)` runs the handler inside `runInTenant` — `store.run()`, the
primitive that actually scopes a callback. There is no way to hold the actor without being inside the
context. All 20 handlers converted; `__tests__/projects-gate-scoping.test.ts` fails if a route
imports the raw gate, if any handler is unwrapped, or if the gate reaches for `enterTenant` again.

A wrapper rather than "each route calls `enterTenant` itself", because `lib/projects/access.ts` says
it plainly of the assignment predicate and it is just as true here — *a boundary applied by
convention at N call sites is applied at N−1 of them the first time someone is in a hurry.* Here it
was applied at **0 of 20**.

### And the lens gap, closed

`verify-api-contract` now asks a second question of the tenant lane: **a 404 at an id bound from a
real row this tenant owns is a finding, not a pass.** The envelope grader stays deliberately blind to
status — a 404 with `{error, code}` IS the contract working — so reachability is a separate check
with its own `REACHABILITY_EXEMPT` list and its own reason-required rule.

**Red first, on the exact pre-fix gate rebuilt and served:** 8 delivery GETs flagged. On the fixed
gate: clean.

Its first run produced two findings that were **not** product defects, and chasing them down is the
instrument-before-the-finding rule earning its keep:

* `/api/portal/…/processes/[instanceId]` — `instanceId` was bound `SELECT id FROM process_instances
  LIMIT 1`, which picked an `rfp-pipeline` row. A foundation actor 404ing on another tenant's
  instance is **correct isolation**. Now bound to a foundation instance, which also means the route
  is finally graded against data it should be able to see.
* `/api/portal/…/template-cards/[cardId]` — `[cardId]` names **two different entities** in this tree:
  an opportunity card under `/cards` and a template card under `/template-cards`. One binding served
  both, so a template route was handed an opportunity id and its correct 404 read as a defect. **A
  shared parameter name is not a shared entity.**

`tsc` 0 · vitest 214 files / 2,135 · five lenses green · the delivery API returns its own data.

---

## P2 · The end-to-end drive — HITL, agents, automation, live

**Shipped:** `frontend/scripts/drive-project-lifecycle.mts` (44 assertions across 10 phases),
`__tests__/projects-tenant-transactions.test.ts`, and fixes in `lib/projects/baseline.ts`,
`pipeline/src/workflows/on_contract_started.py` and the proposal-outcome route.

Every lens in this repo asks about a surface at rest. None asks the only question a customer has:
**does the thing happen.** An award is recorded — is there a task in someone's queue? Does the
Python engine, a separate process polling a shared table, notice? Does the baseline freeze? Does
acceptance close a milestone? Does the variance survive into the record a person reads months later?

That chain crosses three runtimes, two trust boundaries and one human gate. It found three defects
on its first complete run, and **each one had been green in every lens.**

### 1 · The baseline could not be set. At all.

```
POST …/projects/<id>/baseline
409  "This project was baselined by someone else a moment ago."
```

— on the FIRST attempt, for a project nobody had ever baselined.

`lib/db.ts`'s `sql` is a Proxy, and its own header says only the tagged-template CALL is routed
through the tenant context: *"`sql.json/array/begin/…` forward to rawSql. So … `sql.begin` routes
must use an explicit client."* `baseline.ts` used `sql.begin`. It ran on the raw `govtech_app` pool
with `app.tenant_id` **unset**, so RLS matched nothing, every statement in the transaction updated
zero rows, and the compare-and-swap on `projects` read its empty result as a lost race.

Why nothing saw it: the unit tests mock the database; `verify-project-isolation` drives the tables
with the OWNER client, which is not subject to the policy; `verify-api-contract` grades envelopes
and a 409 carrying `{error, code}` is textbook; `verify-write-contract` asserts precisely that a
client error answers 4xx with both fields. Five green lenses over a capability whose central
operation was impossible.

This is the same family as the `enterWith`-across-an-`await` defect one commit earlier — a tenant
context that looks present and is not — by a completely different mechanism. `withTenant` fixes it;
`__tests__/projects-tenant-transactions.test.ts` fails on `sql.begin(` anywhere in the Projects tree
or the portal API. Red-first against `HEAD`: it fires on `baseline.ts` and is clean on the fix.

### 2 · The notification was queued behind the gate it announces

`OnContractStarted` declared its two steps as TODO-then-NOTIFY and its docstring called them
"INDEPENDENT — a failed ToDo must not leave the admin uninformed."

They are not independent. **A TODO step PARKS the instance** (`manager.py`: `status='paused'` until
a human completes it) and the engine runs steps in order, so the NOTIFY never ran:

```
created process instance … for workflow OnContractStarted
[_create_task] … (project_setup) … step todo_setup_project
workflow instance … finished with status=paused          ← notify never attempted
```

The customer would have been told they had won **after** they had already found out and done the
setup themselves. Reordered: tell them, then park. The docstring now describes what happens rather
than what was intended.

### 3 · …and it would have been sent with no tenant

The same NOTIFY step maps `tenant_id: payload.tenantId`, and the emitter's payload never had one —
`tenantId` is a column on the event row, and `processor.resolve_input` understands only
`payload.*` / `result.*` / `step.*.result.*`. It cannot reach the event's own columns. So the
notification would have dispatched with a null tenant and the CRM would have had nobody to mail.
Fixed at the emitter, where the workflow can actually see it.

Both now verified live: `system:notification.requested` fires with
`template=project_setup_ready` and a real `tenant_id`.

### What the drive proves, and what it refuses to claim

```
✓ a person records outcome=awarded through the real route
✓ a contract entity appears · capture:contract.started reaches the event table
✓ the engine (separate process) creates the instance and raises a ToDo for tenant_admin
✓ the NOTIFY reports an outcome rather than vanishing
✓ the project opens · both anchor artifacts upload · a CLIN is entered WITH a citation
✓ the citation is recorded as provenance, not dropped
✓ a child WBS node inherits its CLIN · the baseline freezes 2 nodes and 1 milestone
✓ a SECOND baseline is refused, naming a real ISO date
✓ project:baseline.set opens a bracket AND closes it, carrying what was frozen
✓ the milestone REFUSES to close while its deliverable is unaccepted
✓ acceptance closes it, and milestone.met carries varianceDays = -45 — a number, not a null
✓ the rollup reads 100% deliverables and a MEASURED zero cost
✓ the human closes the ToDo the engine raised
✓ the award woke outcome_tracker and outcome_analyst (4 tool:agent.invoked)
✓ a second tenant lists 0 of our projects and is refused 404 at our id
```

**STATED GAP: 0 workflow templates and 0 agents consume the `project` namespace.** Its events are
emitted, bracketed and readable; the award side of the bridge is wired and the post-award side is
not. The drive prints that as a number so it cannot pass for coverage.

The CRM service is not running in this sandbox, so `notification.requested` is proven and the
send itself is not — that consumer is `rfp-crm`, and this drive stops at the boundary it can see.

### Three of the drive's own findings were the drive's fault

Recorded because the instrument-before-the-finding rule is the only reason they were not filed as
product defects: `process_instances.template_name` is `workflow_name`; `agent_task_queue` has
`agent_role`, not `archetype`; and — the interesting one — a `withEventBracket` end event carries
the RESULT as its payload and correlates to its start by `parent_event_id`, so filtering both
phases on `payload->>'projectId'` reported **"1 start / 0 end"**, a bracket that looked unclosed and
was not. An agent probe that reads only `agent_task_queue` also reports "no agents" for a run in
which an agent did work, because a declarative `AI_INVOKE` runs INLINE in the engine.

---

## P3 · Every lens on the renamed tree — and the intermittent, explained

The rename touched 8 tables, 20 route handlers, 13 modules and every doc, so the whole instrument
set ran again. It also finally cornered the React #418 that had been recorded twice as
*"observed, unreproduced."*

### The partner console re-provisioned its own org on every render

`/partner` threw `Minified React error #418` for the third time — the second on that route — during
a 153-page atlas sweep. Two facts, measured rather than guessed, closed it:

* the Entrepreneurs' Center org held **0 spotlight buckets** and had **12
  `finder:tenant.provisioned` events in two hours**;
* two of those events were **three seconds apart, from one page load**.

`ensurePartnerOwnOrgProvisioned` runs on every `/partner` render and is meant to no-op after the
first. Its gate was *"does this org have zero spotlight buckets"* — a fair proxy back when a new org
was seeded with buckets. **#189 removed seeded buckets**, because a bucket is the customer's own
ranking lens and the product imposes none. Nothing in this file changed. The condition simply became
permanently true, and every render re-ran `backfillTenant` + `scoreTenantCards` +
`copyStarterSetToTenant` + `backfillTenantTemplates` — four write-heavy operations — and emitted an
event asserting a first-time act that had already happened.

A server component that MUTATES during render is the textbook cause of a hydration mismatch: Next
renders the page twice (the HTML pass and the RSC pass), and the second pass saw state the first had
just written. Which is exactly what the two events three seconds apart show.

The gate now reads the **record of the act** — the `tenant.provisioned` event the function itself
writes. After the fix: **153 shots, 153 clean, 0 broken**, and no `tenant.provisioned` event fired
during the sweep at all.

> **The rule this leaves behind:** a gate that infers *"have we done X"* from a side effect ANOTHER
> feature owns is a gate that another team can switch off without touching this code. Gate on the
> record of the act. `__tests__/partner-own-org-gate.test.ts` asserts both the behaviour and the
> shape — it must read `tenant.provisioned`, and it must NOT read `tenant_spotlight_buckets`.

I have not reproduced #418 on a dev build where React names the component, so the causal link is
strong and circumstantial rather than proven: the write-on-render was real and is gone, the route
was broken and is clean, and the events stopped. If it recurs, a dev-build capture is the next step.

### And the branch suite disagreed with itself depending on whether the engine was running

`scenario-factory` failed the full suite with `LEAKED: instances 178→179`. The leaked row was an
`OnSourceChangeDetected` instance at PLATFORM scope — nothing to do with the factory, which had
disposed its own 6,164 rows cleanly. Stopping the workflow engine and re-running the identical
drive made it pass; restarting the engine made it fail again.

**A global `count(*) FROM process_instances` is not a property this drive controls.** The engine is
a separate process polling the same table, and in production it is always running — so the check
was measuring the box. It is now scoped to `tenant_id IS NOT NULL`, and platform-scope drift is
PRINTED rather than asserted, because it is information the reader wants and not a leak the drive
caused.

(The fix's own first version broke the suite differently — a backtick inside a SQL comment inside a
JS tagged template closes the template. Second occurrence this session.)

### The pass

| instrument | result |
|---|---|
| `verify-surfaces` | 80/80 clean · 0 broken |
| `verify-api-contract` | 139 GETs · 119 graded · 0 no-actor · reachability clean |
| `verify-write-contract` | 225/225 called |
| `verify-ui-vs-db` | every number matches, Projects block included |
| `verify-db-crud` | green, fixture restored |
| `verify-project-isolation` · `verify-project-rollup` | 13 + 9 assertions |
| `verify-email-ledger-rls` | 8 assertions |
| `check-rls-posture` | 67 policies · 44 force-RLS · 53 tables partition cleanly |
| `audit-automation-spine` | 0 dead triggers · 0 dead waits · 0 unclosed brackets · 119 actions resolve |
| `reconcile-capability` | UNSURFACED still the pre-existing 6 — no Projects route among them |
| `capture-ui-atlas` | **153 shots · 153 clean · 0 broken** |
| `drive-ui-states` | **272 states · 126 routes · 6 lanes** · 2 navigation aborts, reported |
| `run-branch-drives.sh` | **40 passed · 0 failed · 0 could-not-run** (incl. the new `project-lifecycle`) |
| build | `tsc` 0 · vitest **216 files / 2,143** · `next build` 0 |

The agent fabric was visibly alive throughout the states sweep — `opportunity_analyst` ×10,
`scoring_strategist` ×10, plus `formatter`, `compliance_reviewer`, `packaging_specialist` and
`redaction_guard` — which is the "agents" half of end-to-end exercised through the UI rather than
asserted from a registry.

Every mutating drive ran between a `pg_dump` and a verified `pg_restore`.

---

## P4 · The other half of "end to end" — the pre-award arc, and the seam

I drove the post-award arc live and called it end-to-end. It was half of one.

`drive-end-to-end.mjs` runs the first half — *a government PDF nobody wrote for us* → ingest ·
curate · push · discover · buy · provision · author · lock · package · download — and
`run-branch-drives.sh` **names it in its own header as the thing the branch drives complement while
never actually listing it.** It was run by hand or not at all, which is precisely how a drive stops
being run. And `drive-project-lifecycle.mts` started by INSERTING a submitted proposal with SQL: a
proposal I invented is not a proposal the product authored and locked, so the joint between the
halves was never crossed by anything.

### It could not run standalone, and the reason was a credential shadowing itself

Stage 3 died twice on `login?error=invalid`, which reads as a broken purchase flow. It was two
files disagreeing about one value — for the **fourth** time (B146/B147):

* `run-branch-drives.sh` exports `BUYER_PW="${BUYER_PW:-$TENANT_PW}"`, so inside the suite the buy
  drive authenticates. `sandbox-env.sh` did not export it at all, so a standalone run — the exact
  invocation `drive-end-to-end.mjs` documents — fell back to a private literal in
  `drive-buy-and-build.mjs` that no account has.
* Worse, and the actual killer: `sandbox-env.sh` exported `LIGHTHOUSE_PW` **twice**. The first,
  ten lines earlier, pinned it to a literal `LighthouseAdmin`; the second, whose comment says it
  exists so that "running one suite cannot silently break the other", was therefore a **no-op**.
  The file shipped `LIGHTHOUSE_PW=LighthouseAdmin` against an account whose password is
  `TENANT_PW`. The comment described an intent the code did not implement.

One export, one place. Both fixed; the arc then ran green on the first attempt.

### The seam, crossed

`drive-project-lifecycle.mts` now reads the arc's journal and continues from **the build the
product actually made** — and says which mode it is in, loudly, because a reader has to know
whether the seam was crossed or stepped over:

```
✓ CONTINUING THE ARC — this build was ingested, authored, locked and packaged by the product
```

It is also re-runnable: recording an outcome archives the proposal and the route then answers
`409 ALREADY_ARCHIVED` — correct product behaviour that made this a one-shot. An already-awarded
artifact is now rolled back to the state the arc left it in, as printed setup. (Its cleanup had the
matching bug: it deleted the project it remembered rather than every project on the contract, so
the second run died on `projects_contract_id_fkey` and reported it as a broken product link.)

### What the joined arc proves

One continuous artifact, from a government PDF to a met milestone:

```
ingest → curate → push → discover → buy → provision → author → lock → package → download
       → award → the engine raises a ToDo → a person opens the project → CLINs · WBS · milestones
       → the baseline freezes ONCE → upload is not acceptance → the milestone closes carrying a
         real variance → the person closes the ToDo the engine raised
```

And with the whole arc's history behind it the fabric is properly awake — **12 archetypes, 30
`tool:agent.invoked` events** in the window: `curator`, `library_seed_suggester`, `research_scout`,
`packaging_specialist`, `section_drafter`, `pp_matcher`, `cost_estimator`, `proposal_architect`,
`capture_strategist`, `color_team_reviewer`, `outcome_analyst`, `outcome_tracker`. Against a
synthesised proposal only two woke. The difference is the point: agents respond to history, and a
drive that starts from a fixture cannot see them.

`end-to-end` is now registered in the suite, ahead of `project-lifecycle`, so the two run as one
arc by default: **41 passed · 0 failed · 0 could-not-run**.

The `project` namespace still has **0 consumers** — that gap is unchanged and still printed as a
number.

---

## M1–M3 · The milestone construct — one shape, two cases

**Operator's outline, 2026-08-27:** *"a simple milestone construct which is extendable. A project
with one milestone can be a simple complex ToDo and task completion list for employees. It still has
simple automation built into the completion date and notifications and nudges. Make it 1:N with
serial dates and milestone completion notes or metrics."*

**Shipped:** mig 218 (`project_milestone_tasks` + `starts_on`/`owner_user_id`/`completion_note`/
`completion_metrics`/nudge watermark on `project_milestones`), `lib/projects/milestone-tasks.ts`,
two routes, `components/projects/milestone-checklist.tsx`, `_run_project_nudges` in the lifecycle
scheduler, the `project_nudge` mail renderer, six new `project:*` labels, and
`scripts/drive-milestone-construct.mts` (28 assertions).

### The shape, and why there is no "simple mode"

```
project 1:N milestone      a dated segment: starts_on → forecast_date, an owner, a checklist
             1:N task      title · assignee (a person OR a role) · due · open|done|blocked
             completion    a note and open jsonb metrics — "met" alone is unreadable later
             automation    due-soon / overdue → event + notification + nudge, hard-bounded
```

**One milestone is a dated ToDo list with nudges. N milestones are that, in series.** The small case
is not a stripped-down mode of the large one; it IS the large one with a length of one, which is
what makes it extendable rather than configurable. There is no `is_simple` flag anywhere in the
capability.

### Serial dates are a default, not a constraint

`starts_on` defaults to the previous milestone's end + 1 day, so a plan entered as four dates reads
as a chain. It is a default: a pinned start is respected, and overlap is legal — real plans overlap
and a schema forbidding it would be wrong more often than it helped. The database enforces only what
is always true: a segment cannot end before it starts.

`reschedule` moves the end date and, by default, **everything after it by the same delta**. That is
what serial means in practice — slipping phase 2 by three weeks slips 3 and 4 unless someone says
otherwise. It moves the CURRENT plan and never `baseline_date`; variance is the distance between the
promise and the plan, so a cascade that touched the baseline would erase the number the reschedule
exists to reveal. Proven, not asserted:

```
✓ phase 2 starts the day after phase 1 ends — 2026-09-27 (phase 1 ends 2026-09-26)
✓ phase 3 slipped by the same 14 days — 2026-11-25 → 2026-12-09
✓ phase 1, which is EARLIER, did not move
✓ no baseline_date moved
```

### The checklist gates completion, and completion is a record

Two refusals, deliberately separate messages: **`TASKS_OUTSTANDING`** (the work is not finished) and
**`DELIVERABLES_OUTSTANDING`** (the customer has not accepted it). Different problems, different
next actions. A blocked task still blocks, and blocking requires a reason — a blocked task nobody
explained is one nobody can unblock, and it sits in the list looking like progress.

Completion carries a note and metrics, and both reach the event a person reads months later:

```
Milestone met: phase 1 · Plan agreed at the kickoff; two wording changes to the SOW.
```

Metrics are an open jsonb OBJECT (`{ attendees: 9, sowRevisions: 2 }`), enforced by a CHECK and by
`sql.json` on the write — a column per metric would be a schema change per customer, and a string
written as jsonb reads back as a string and char-iterates.

### Who may do what — and this is the point of the feature

Adding tasks and closing a milestone are `tenant_admin`. **Ticking a task off is open to any member
who can reach the project.** A checklist only a manager may tick is a status report they maintain on
everyone else's behalf, which is the thing this replaces.

### The automation

`_run_project_nudges` runs in the daily block beside the start-nudge sweep and follows its shape
exactly: bracketed start/end (the `finally` guarantees the `end` — it fired even on the run that
failed), per-row `nudges_sent`/`last_nudged_at` watermarks, and ONE grouped
`system:notification.requested` per sweep rather than a mail per row. Measured:

```
milestone.overdue ×1 · task.overdue ×1 · watermarks set on 2 rows · mail: project_nudge → 1 tenant
nudges_sent 2 → 2 on an immediate re-run   (the spacing bound)
9 → 9 at the cap with spacing long past    (the ceiling)
```

Blocked tasks are **not** nudged: somebody already said why it cannot move, and repeating it weekly
is how a nudge stream becomes noise. The `project_nudge` renderer was written in the same change as
the sweep that names it — B141 twice over is what a template referenced by code and defined nowhere
costs.

### Three defects the work turned up, and one harness lie

1. **`sql` fragments in a value position 500'd every task tick.**
   `completed_at = ${next === 'done' ? sql`now()` : null}` — the `lib/db.ts` Proxy intercepts the
   tagged-template CALL, so a nested ``sql`…` `` is a **Promise**, not a fragment, and postgres.js
   throws `RangeError: Invalid time value` serialising it. Third distinct way that Proxy bites
   (after `enterTenant` across an await and `sql.begin`), same root: only the call is routed. Fixed
   by computing the values in JS; guarded in `projects-tenant-transactions.test.ts`, red-first.
2. **The sweep queried `projects.archived_at`, which does not exist** — mig 216 predates the archive
   contract for that table. Caught on the first live run by the query failing loudly rather than
   returning nothing, and repointed at `status <> 'closed'`.
3. **The seed ordered the checklist by `abs(dueOffset)`**, so it rendered backwards. Visible only in
   the screenshot.

And the lie: my first bound check counted nudge events in a 20-second window that **overlapped the
previous sweep**, and reported `SPACING NOT HELD`. The watermark is the honest measure; the clock
window was measuring the clock. Instrument before the finding, again.

### The pass

`tsc` 0 · vitest **216 files / 2,145** · `next build` 0 · surfaces 80/80 · api-contract 140 GETs,
0 no-actor, reachability clean · write-contract **227/227** · ui-vs-db · db-crud · project isolation
13 · rollup 9 · RLS posture **68 policies / 45 force-RLS tables** (the new table is in it) ·
spine audit 0 dead triggers / 0 templates with no renderer · capability UNSURFACED still 6 ·
`drive-milestone-construct` 28/28.

`projects-deliverables.test.ts` needed rebasing: the new task gate runs BEFORE the deliverables gate,
so the mock's result queue starts an entry earlier. One of its probes selected the query by
POSITION (`queries[0]`) and would have kept passing while asserting against a different statement —
it now selects by what the query reads.

---

