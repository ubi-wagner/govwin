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

## F1 · The full lifecycle, driven as the actors — and the gap that only that could find

**Operator's ask:** *"Run a full project creation through milestone completions and close out and
HITL and automation and agentic support. Full DB to UI and back again verification as actors in the
system, no by hand work."*

`drive-project-lifecycle.mts` now runs twelve phases end to end, with the live Python engine polling
and the Claude emulator answering, and **every act performed by the person who would perform it**:

```
0  the engine has OnContractStarted registered            (else exit 2 — a harness that reports
                                                           "the automation did not fire" when the
                                                           automation was not running is reporting
                                                           on itself)
1  HITL       a tenant_admin records outcome=awarded through the real route
2  AUTOMATION the engine instantiates the workflow → a `project_setup` ToDo → a NOTIFY outcome
3  HITL       the project is opened; BOTH anchors uploaded as multipart, not inserted
4  HITL       CLIN with a citation → provenance · WBS parent + child · milestone · deliverable
4b HITL       two more phases · resequence · a 14-day slip that cascades · STAFFING
5             the baseline freezes once; the bracket closes carrying what it froze
6  HITL       an assigned employee uploads; only the admin accepts; then the phase can close
7             the three measures
7b HITL       the checklist — created by the admin, TICKED OFF BY THE EMPLOYEE — then completion
              with a note and metrics
7c            DB → UI → DB: the rendered page reconciled against the rows, and back to the API
8  HITL       the human closes the ToDo the engine raised
9  AGENTS     measured, not assumed
11 HITL       close-out: three refusals, the close, the double-close, the reopen
10            a second tenant sees none of it
```

### The gap: you could not staff a project

`lib/projects/access.ts` says assignment is the whole access mechanism for an employee. The **only**
`project_assignments` row anyone ever got was the one `createProject` writes for its creator. There
was no route, no button, no other insert — **no employee could ever be let into a project** — while
the empty state on `/projects` told them to *"ask a tenant admin to add you"*, describing a
capability that did not exist.

No lens could have caught it. `reconcile-capability` joins routes to callers, and **a route nobody
wrote has no row on either side**; the surface lens renders a page that works; the contract lenses
grade envelopes that are correct. It surfaced the first time a drive stopped acting as the manager
and tried to act as the EMPLOYEE — and could not tick off work that had been assigned to them.

Shipped with it: `POST/GET/DELETE …/assignees`, the roster on the workspace, and two rules that fall
out of taking the boundary seriously —

* **assigning work to someone not on the project is refused** (`NOT_ON_PROJECT`) with the fix in the
  sentence, rather than granting project access as a side effect of a task form. An access decision
  hidden inside an unrelated action is how a boundary stops meaning anything.
* **the last assignee cannot be removed** — an unstaffed project is one nobody can open, *including
  to re-staff it*.

### Close-out (mig 219)

`projects` grew `closed_at` / `closed_by` / `closeout_note` / `closeout_metrics`, with a CHECK making
the status and the stamp inseparable — the same rule mig 218 puts on a done task. Close-out is
milestone completion one scale up, deliberately the same shape, and it refuses on three separate
grounds because they are three different next actions:

```
✓ a project with phases still running will not close      MILESTONES_OUTSTANDING
✓ a task added AFTER its phase was met blocks close-out   TASKS_OUTSTANDING
    (the gap the milestone gate structurally cannot catch — it ran before the task existed)
✓ evidence the customer has not accepted blocks it        DELIVERABLES_OUTSTANDING
✓ closing twice is refused by compare-and-swap, not a second stamp
✓ a closed project reopens — and the close-out note is KEPT, because the reopen is a correction
  to what it says, not a deletion of it
```

### DB → UI → DB

Phase 7c reads the **rendered page** and reconciles it against the rows: the checklist counter, the
completion note, the metrics, every phase title, and no `NaN`/`Invalid Date` anywhere — then asks
the API for the same numbers, so a reader of either is reading the same thing.

### What the agents do

`outcome_tracker` and `outcome_analyst` wake on the award and run against the emulator. **Zero
workflows and zero agents consume the `project` namespace** — its events are emitted, bracketed and
readable, so the award side of the bridge is wired and the post-award side is not. Reported as a
number so it cannot pass for coverage.

### Three harness defects, each caught before it became a finding

* the drive asserted `milestones=1` on the baseline bracket — written before phase 4b added two more.
  Now derived from what the plan actually holds.
* phase 7b reused the milestone phase 6 had already closed, so *"the phase closes"* failed
  `NOT_PENDING` while the assertion above it passed **for the wrong reason** — the task gate answered
  a question phase 6 was asking about deliverables. The checklist now belongs to the next phase,
  which is also the honest sequence: you plan work you have not done.
* it read the roster from `/members`; the route is `/team` and it returns a **bare array** under
  `data`. Read the route, do not assume the envelope's inner shape.

`tsc` 0 · vitest **216 files / 2,145** · `next build` 0 · surfaces 80/80 · api-contract **141 GETs**
0 no-actor reachability clean · write-contract **230/230** · capability UNSURFACED still the
pre-existing 6 · the drive **green, all twelve phases**.

---

## G1 · ToDos, email and nudges — the build portal's infrastructure, not a second one

**Operator's ask:** *"Make sure ToDos and email and task nudges are built into the project management
portal. Treat it like a proposal build portal when it comes to infrastructure, automation, audit
ability, collaboration."*

### A projection, not a second queue

`project_milestone_tasks` is the project's own checklist — ordered under a milestone, gating its
completion, carrying the domain rules. The platform `tasks` table is a different thing: it is where a
PERSON looks — `/todos`, the notification bell, the Command Center, and the nudge sweep that already
chases everything else in the product.

Giving projects their own queue and their own nudge path would hand a customer two inboxes and us two
things to keep in step. So assigned project work is **projected** onto a real ToDo, exactly as
`editPortalWorkflow` re-projects a proposal's guardrail plan onto live `tasks` rows.

```
project_milestone_tasks   the domain object — the source of truth
        ↓ projection (lib/projects/todos.ts)
tasks                     how it reaches a human: queue · bell · Command Center · nudge sweeper
```

**The checklist is the source of truth and the ToDo follows it.** Ticking the work off closes the
ToDo; meeting the milestone and closing the project sweep up whatever is left. Nothing in the
projection ever writes back into the checklist — a mirror that can move the thing it mirrors is a
second writer, and the two disagree the first time one of them fails.

### One reminder, not two

The project sweep nudges by date; an assigned task now also has a ToDo the platform sweeper nudges.
Two reminders for one task teaches people to filter both, so `_run_project_nudges` now skips tasks
that have an assignee — the ToDo carries those — and keeps only **unassigned** work, which has no
queue to sit in and where the date is all there is.

### Email through the one seam

Assignment emits `system:notification.requested` with `project_task_assigned` rather than sending
directly, so delivery, suppression and the ledger stay the CRM's single implementation. The renderer
shipped **in the same change as the code that names it** — a template referenced by code and defined
nowhere emits `notification.failed` instead of sending, which this repo has done twice (B141).

Two mails, two jobs: `project_task_assigned` is per-person and per-item ("this is yours");
`project_nudge` is the grouped one that chases what is already known.

### Proven, as the actors

```
✓ every assigned checklist row raised a real platform ToDo — 2 of 2
✓ addressed to the person the work was given to, not to a role bucket
✓ each carries a nudge schedule, so the shared sweeper will chase it — [7,2]
✓ the assignee can read their own queue — 200
✓ and the project work is IN it — the same list as every other kind of task
✓ assignment asks for email through the notification seam — project_task_assigned
✓ ticking the work off cleared it from the queue — 0 still open
```

**One harness defect, caught before it became a finding:** the queue check originally ran AFTER the
employee had ticked the work off, so it read an empty open queue and reported a failure that was
entirely the ordering. Split: raised-and-queued before the tick, cleared after.

`tsc` 0 · vitest 216 files / **2,145** · pipeline scheduler/event tests 85 · spine audit: 0 templates
with no renderer · the full lifecycle drive green.

---


## G2 — Canvas deliverables: the report, the deck, the workbook and the PDF

*"the canvas system is great here as well because reports and slide deck and xls and pdf deliverables
can be implemented here nearly the same as the proposal build portal"*

### One column, not a second subsystem

The build portal already has everything a project needs to produce a deliverable: `tenant_documents`
holds a `CanvasDocument`, the canvas editor edits it, the compliance floor measures it, and
`…/documents/[id]/export` renders **docx · pptx · xlsx · pdf**. None of that is proposal-specific.
What was missing was one column saying *this deliverable IS that document* — mig 220,
`project_deliverables.document_id`.

A parallel authoring path for projects would have meant a second editor to keep in step with the
first and a second export pipeline to keep correct — the same argument that made project ToDos a
projection onto the platform queue rather than a queue of their own.

```
project_deliverables.document_id ──▶ tenant_documents (CanvasDocument)
                                        ↓ the SAME editor, floor and exporters
                                     docx · pptx · xlsx · pdf
```

`ON DELETE SET NULL`, deliberately, and not CASCADE: deleting the document must not delete the
**deliverable**. The obligation to produce it survives losing the draft — that is the whole reason a
deliverable is a row rather than a file. A partial unique index keeps one document behind at most one
obligation, so accepting one can never look like evidence for another.

### Attaching widened; accepting did not

`storage_key` (an uploaded file) and `document_id` (an authored canvas) are two ways to **attach**
evidence. Neither is acceptance. `accepted_at` remains the separate, deliberate act by a
`tenant_admin`, because a deck someone wrote is not a deliverable the customer has signed for — the
same two-facts rule the upload path has always carried.

What that changed is the refusal: `NOTHING_UPLOADED` → **`NOTHING_ATTACHED`**, with a message naming
both ways out. "Upload one first" is wrong advice to give someone whose deliverable is a report they
are meant to write here. The CAS predicate widened to an `OR` of the two attachments — an `AND` would
make an authored document unacceptable, and a missing arm would let an empty deliverable close a
milestone. Both halves are asserted, including a case proving a deliverable backed **only** by a
document accepts.

### Proven, as the actors

```
✓ it cannot be accepted with nothing attached — file OR document — 409 NOTHING_ATTACHED
✓ a report is drafted in-product — 201
✓ asking twice hands back a refusal, not a second draft nobody will find — 409
✓ it exports as .docx … 200 ·  8,604 bytes · starts "PK"
✓ it exports as .pdf  … 200 ·    865 bytes · starts "%PDF"
✓ it exports as .pptx … 200 · 45,368 bytes · starts "PK"
✓ it exports as .xlsx … 200 ·  5,336 bytes · starts "PK"
✓ and once authored, a tenant_admin can accept it — 200
```

The export assertion checks **magic numbers**, not byte counts: a non-zero length proves the route
answered, not that anything can open what came back. `%PDF` and the `PK` local-file header are the
least a reader needs.

**Two failures worth recording.** The `author` action 400'd persistently against a `.next/standalone`
that did not exist while a server from an hour earlier kept serving the old route — the fix was
`rm -rf .next && next build`, and the lesson is to verify `BUILD_ID present · standalone present` and
grep the built route for the new literal before believing a 4xx. And an edit to the deliverable route
silently did not apply: the body is nested inside `withProject`, so it is indented six spaces, not
four, and a patch written against four matched nothing.

`tsc` 0 · vitest 216 files / **2,146** · api-contract 141 GETs, reachability clean · write-contract
230/230 · surfaces 82/82 · spine audit 0 dead triggers, 119 step actions resolve, 0 templates with no
renderer.

---

## G3 — The ruler on a deliverable, and the blank page it found

*"Measurements are easier with our ruler and grid system as well."*

### The G2 proof was not a proof

G2 asserted that the export route answered **200** and that the first bytes were `%PDF` or the `PK`
zip header. Both were true. Both stay true for a document with nothing in it — and that is exactly
what was being exported.

`starterFromPreset` builds a **blank** canvas. That is correct for the caller it was written for:
the "New document" chooser, where a person clicked *blank letter* and means it. It is wrong for a
deliverable, where the entry point is a **Draft…** button on a named contractual obligation with a
due date on a named project. The authored report came out as an empty page, and an **865-byte PDF**
passed every check.

The tell had been in the database the whole time — `tenant_documents.node_count = 0` — and nothing
looked, because the assertions that existed were about the **route** rather than the **artifact**.

### What goes on the page, and what must not

Only facts read off a row: the title, then one line — project · milestone · *Required by* date.

Scaffolding plausible headings (Introduction, Approach, Results) would make the starter look more
finished, and would put structure into a contract deliverable that nobody asked the product for.
That is the ingest spine's rule applied one floor up: *a value the product did not read from the
source must never look like one it did*. The nodes are stamped `source: 'template'`, not `ai_draft`,
so a reader opening the history is told the product read them off a row.

Rendered by LibreOffice, the delivered page reads:

```
Monthly technical report — March
E2E award probe · Prototype demonstration · Required by 2026-12-15
```

### The instrument: an engine that did not write it

`scripts/probe-deliverable-artifacts.mts` exports every authored deliverable through the shipped
exporters, converts the Office files to PDF with **LibreOffice**, and reads the text layer back with
**pdf.js**. Nothing in that chain is ours except the bytes under test — which is the point of B121's
rule: *an artifact is not verified until an engine that did not write it has opened it*.

It refuses to report a verdict it cannot earn, twice over:

- **self-test** — it measures a deliberately blank canvas first and requires the detector to see it
  as blank. A text layer that comes back empty because the reader silently failed looks exactly like
  a blank page, and would make every green below unearned.
- **control** — it converts a plain `.txt` before concluding anything about ours. A container with
  `libreoffice-core` and no filters fails on everything, and without the control that reads as *our
  .pptx is unopenable* — a claim this repo has actually made and had to retract.

```
self-test: a blank canvas reads as blank — the detector can fail
control:   LibreOffice converted a plain .txt — the engine works

✓ .pdf  — the rendered page names the deliverable — 1 page · 109 chars of text
✓ .docx — the rendered page names the deliverable — 1 page · 109 chars of text
✓ .pptx — the rendered page names the deliverable — 1 page · 109 chars of text
✓ .xlsx — the rendered page names the deliverable — 1 page · 117 chars of text
✓ the ruler does not UNDER-count what came out — estimate 1 · printed 1  (×3)
11/11
```

### Three harness defects, caught before they became findings

**The test agreed with the bug, twice.** "Names the deliverable" first read the whole INSERT
parameter list — which carries the `title` **column**, present on a blank document — so it passed on
the unfixed code. Narrowed to the canvas value, it still passed: `starterFromPreset` writes the
title into `metadata.title` of even an empty canvas. Only `canvas.nodes` is printed, so only
`canvas.nodes` answers *does the page say it*. Red-first was run after each narrowing, and only the
third version failed on the unfixed code.

**The drive accused the product of the thing the harness got wrong.** Phase 7e read `docRow.nodeCount`
off a bare `postgres()` client, which has no `toCamel` — so it was `undefined`, `undefined > 0` is
false, and the drive reported `the draft is not a blank page — 0 node(s)` against a document the
database held two nodes for. The file's own header warns about this exact class. `node_count AS
"nodeCount"`.

**The drive left documents behind.** `project_deliverables.document_id` is `ON DELETE SET NULL` by
design, so deleting the project does *not* take the authored document with it — and a drive that
made one and walked away left a tenant holding documents for a project that no longer exists. Now in
the footprint. `KEEP=1` exists so the probe can open the artifacts while the deliverable that owns
them still exists; cleaning up first and then reporting "no authored deliverable" would be the probe
measuring the drive's tidying rather than the product.

`tsc` 0 · vitest 216 files / **2,151** · surfaces 82/82 · api-contract clean · write-contract clean ·
ruler on 18 stored volumes: 0 under-counts · spine audit 0 dead triggers · the full lifecycle drive
green, footprint removed.

---

## P4 — Task spine v2: the plan's rules move into the database

Six pieces, specified across three turns with the product owner. Migration **221**.

### The table keeps its name

`project_milestone_tasks` now holds rows belonging to no milestone. Renaming it would touch ~14
modules, the ToDo projection, both completion gates and three harnesses, for zero behavioural gain —
so what a rename would have bought, a reader not being misled, is bought instead by `scope` and by
`COMMENT ON TABLE`, which lands in `docs/SCHEMA_MAP.md` because that file is generated from the live
database. A comment where the reader already is beats a rename they have to notice.

`scope` is redundant with `milestone_id IS NULL` and that is *why* the paired CHECK exists —
redundancy without a guard is drift waiting to happen. It is `scope` and not `task_type` because the
platform `tasks` table already has a `task_type` with a different vocabulary, and project tasks are
projected onto that table: two same-named columns with different vocabularies, one feeding the other,
is a trap laid for whoever debugs the projection next.

### Two gates that were already right

Making `milestone_id` nullable came out correct on both completion gates for free, because they had
been scoped differently all along:

| gate | scope | result for standing work |
|---|---|---|
| `markMilestoneMet` | `milestone_id = ?` | never blocks a phase ✓ |
| `closeProject` | `project_id = ?` | **does** block close-out ✓ |

Both halves are now asserted in the drive rather than claimed in prose.

### The date rule, and the one date it does not touch

A milestone-scoped task's `due_date` must not fall after its milestone's **`forecast_date`** — the
current plan, not the frozen `baseline_date` and not the past `met_at`. `<=`, not `<`: finishing on
the date you were given is the normal case.

Enforced by a **trigger**, for the same reason the baseline freeze is: two paths write these dates —
editing the task, and rescheduling the milestone underneath it — and an invariant each path has to
remember is an invariant enforced nowhere. Pulling a milestone in **refuses and names the stranded
tasks** rather than dragging their dates along; silently moving a date somebody committed to is how a
plan stops being believed.

**And the estimate is deliberately exempt.** `estimated_completion` is the assignee's own forecast and
is free to run past the milestone. Refusing it would only teach people to enter the date that is
accepted rather than the one they believe, and the gap between the two — the early warning the column
exists for — would disappear.

### Dependencies are between milestones and nowhere else

One predecessor per milestone. No task-level graph, no critical path: task-level dependency graphs are
the feature that turns a plan into something nobody maintains. Same-project and acyclic are both
trigger-enforced (`23002`, `23003`).

What it buys is a **precise cascade**. `rescheduleMilestone` moved everything with a higher
`sort_index`; now, once anyone declares a dependency, it moves declared successors — two phases running
in *parallel* no longer both slip because one did. With no dependency declared anywhere it falls back to
serial order, so an untouched project behaves exactly as before.

### Open editing, audited

The per-task `PATCH` was **status-only**, so this is new surface rather than a permission loosening.
Anyone on the project may reassign, move a date or edit the note; creating a task stays `tenant_admin`
because that is adding scope. Every change emits `project:task.reassigned` / `task.rescheduled` with
who, from what, to what — open means visible, not untracked.

The projection follows: a reassignment closes the previous holder's ToDo and raises the new owner's
(`closeTaskTodos` was already plural for exactly this), and a moved date resets `nudges_sent` so the
shared sweeper re-fires against the new due. A status change and an edit cannot ride the same request —
a note save must never be able to reopen finished work.

### A reference is not evidence of completion

`project_task_attachments` (RLS-forced) lets a task carry files. Nothing in it touches task `status` —
the same separation that keeps uploading a deliverable from accepting it. A file appearing is not work
finishing, and a checklist that could close itself the moment somebody shared context would make "done"
stop meaning anyone decided it was done.

### Proven

Every schema invariant was exercised against real Postgres before a line of TypeScript depended on it —
ten cases in a rolled-back transaction, including the **two that must not refuse**:

```
PASS 1  scope/milestone pairing refused        PASS 5b same-day task accepted
PASS 2  self-dependency refused                PASS 5c estimate past the milestone accepted
PASS 3  cross-project dependency refused       PASS 6  pull-in refused, naming the task
PASS 4  cycle refused                          PASS 6b pushing the milestone out accepted
PASS 5  task due after milestone refused       PASS 7  project-scope task, any date, accepted
```

Then as the actors, through the real routes — drive phase 7f, 18 checks, and the close-out gate:

```
✓ a task with NO milestone is accepted — standing project work — 201
✓ and the database derived its scope rather than taking our word for it — scope=project milestone=null
✓ a task due AFTER its milestone is refused — by the trigger, on the real write path — 409
✓ but the SAME day is fine — finishing on the date is the normal case — 201
✓ the ASSIGNEE may say they expect to be late — the estimate is deliberately unconstrained — 200
✓ pulling the phase in is REFUSED and the tasks are named — 409 TASKS_WOULD_STRAND
✓ one milestone can be declared to follow another · a loop is refused · so is self-reference
✓ an EMPLOYEE can hand a task back to the team, and pick it back up — 200 / 200
✓ but not to somebody who is not on the project — 409 NOT_ON_PROJECT
✓ and BOTH handovers are on the record — 2 event(s), tenant_user → 07023cd4…
✓ a reference file attaches — and did NOT move the status — done → done
✓ standing work blocks CLOSE-OUT, having blocked no milestone — and the refusal names it
```

### Five defects caught, four of them mine

**The Proxy trap, twice in one file.** A hoisted `` sql`id, project_id, …` `` column list, and
`nudges_sent = ${moved ? 0 : sql`nudges_sent`}` — both written *within minutes of quoting the rule that
forbids them*. A nested tagged template in a value position is a Promise, not a fragment. Then a third
variant: a SQL comment written inside the template literal is still JavaScript, so its backticks and
`${` were parsed by the compiler.

**A `Date` is not its ISO string.** `before.dueDate` arrives as a JavaScript Date and the caller sends
`'2026-06-30'`; comparing them directly is *always* "different", so every save would have reset the
nudge watermark and re-raised a ToDo — a nudge storm produced by pressing save twice. Guarded by a test
that fails on exactly that.

**The self-dependency CHECK is unreachable**, found by exercising it: a `BEFORE` trigger runs ahead of
CHECK evaluation, so the cycle walk catches a self-reference first and reports it as a loop of length
one. Kept as a backstop, and the comment now says so instead of claiming the CHECK is what refuses it.

**Three harness lies, caught before they became findings.** An assertion demanding a `task.reassigned`
event after handing a task back to the person who already held it — asking the product to record
something that correctly did not happen. A page-counter check comparing a *project-wide* count against a
*per-milestone* string, which had only ever agreed because every task happened to sit under one
milestone. And `afterAttach.status !== 'done'`, which tested the drive's own ordering rather than
whether attaching a file moved anything — rewritten to compare before and after.

`tsc` 0 · vitest 217 files / **2,170** · surfaces 82/82 · api-contract clean · write-contract clean ·
the full lifecycle drive green at **126 checks**, footprint removed. `schema-check` reports it verified
nothing on a DDL-only migration and says so rather than claiming a pass.

---

## H1 — The conversation a project did not have

Before this, a project carried exactly **one** human decision: a tenant_admin accepting a
deliverable. There was nowhere to ask a question, nowhere to answer one, and nowhere to record why
a date moved. Everything the product knew about a project was a fact; nothing was a discussion —
which is why this came before more automation. Mail nobody can reply to is not a feature.

Migration **222**: `project_comments`.

### The anchor is polymorphic, and nothing in the database can check it

`entity_type` + `entity_id`, the shape the platform `tasks` table already uses, over four kinds of
row — `project` (a NULL `entity_id`) · `milestone` · `task` · `deliverable`. The pair is bound by a
CHECK in both directions, the same idiom as mig 221's `scope`.

There is **no FK on `entity_id`** — it cannot have one, pointing at four tables. That is the cost of
the polymorphic anchor, and it is paid in the domain layer, which validates the target belongs to
*this* project before writing. That lookup is the only thing standing between a comment and another
customer's contract, so it is asserted directly in both the unit tests and the drive.

`proposal_comments` was not widened: it has no `tenant_id` (it scopes through `proposal_id`), no
threading, and `resolved` is a bare boolean. Six months later "was this ever answered, and by whom"
is the question, and `true` cannot answer it — so resolution here is `resolved_at` + `resolved_by`,
bound by a CHECK, the same shape as deliverable acceptance.

### The mention is the point

A comment nobody is told about is a diary. `@` + an email, and the rules are where the subtlety is:

- **Token-boundary anchored.** An address in prose — *"write to dana@acme.test"* — is **not** a
  mention. Without that rule, every address anyone pasted would summon its owner.
- **Resolved against the project ROSTER, never the tenant directory.** Notifying somebody about a
  project they will be refused is worse than not notifying them — the same rule that makes
  `NOT_ON_PROJECT` a refusal on task assignment.
- **An unmatched token stays plain text and the comment still saves**, but the API returns
  `notified` and `unmatched` and the UI shows both. This is the failure this feature otherwise has:
  the author types a name, sees the comment appear, believes they were heard, and the reply never
  comes.
- **The author is dropped.** Writing `@me` to make a note must not raise a ToDo telling you what
  you already know.

A mention raises a real platform ToDo (`/todos`, the bell, the Command Center — not a second inbox,
per G1) and one email through the single seam, with `project_comment_mention` shipped in the *same
change* as the code that names it. The ToDo carries **no due date and no nudge schedule**: a mention
is a request to look, not a deadline, and chasing somebody about a comment on a cadence is how a
queue gets muted.

### One level of threading

A reply to a reply attaches to the same **root**, normalised rather than refused — "you may not
reply to that" is a strange thing to say mid-conversation, and nobody has ever wanted the fourth
indent.

### A latent bug in G1, found by building on it

Resolving a thread must close the mention ToDos behind it. Routing that through `completeTask`
**silently failed**: it asks "may this person complete this task" and answers no unless the actor
*is* the assignee or outranks an assignee **role**. A mention is addressed to somebody else by
definition, so the ToDo stayed open forever.

The same defect sat in **G1's own sweeps**. `closeTodosUnder` — called when a milestone is met or a
project closes out — runs as the tenant_admin, and a ToDo named to a person by id has no
`assignee_role`, so the admin is neither the user-assignee nor a role-assignee and gets a 403 that
best-effort code discards. It had not bitten yet only because the normal path closes each ToDo as
the assignee ticks their own row; it would have surfaced the first time work was reassigned and then
swept up by a manager.

`retireProjectedTodos` replaces it. The distinction it encodes: **this is not a person completing
somebody's work, it is the thing the ToDo pointed at ceasing to exist.** Narrow on every axis — this
tenant, the two `task_type`s this module projects, open rows only, always by an id the caller
resolved from a row it had already scoped — and `completed_by` still names whoever's action retired
it.

### Proven

Nine schema invariants against real Postgres in a rolled-back transaction, including that deleting a
root takes its replies and that a `resolved_by` with no `resolved_at` is refused. Then 34 unit
assertions across two files, then as the actors:

```
✓ anyone on the project can say something — 201
✓ and the person they named is told they were named — kate.ulepic@foundation3dp.com
✓ a mention raises a real platform ToDo — not a second inbox — 1 ToDo(s)
✓ with NO due date — a mention is a request to look, not a deadline
✓ and asks for email through the one seam, with a renderer that exists — project_comment_mention
✓ a name nobody here answers to is REPORTED, not silently dropped — nobody@elsewhere.test
✓ and nobody outside the project is summoned to a page they cannot open
✓ a comment cannot be anchored to another project's milestone — 400
✓ a reply to a reply attaches to the ROOT — never a fourth indent
✓ one person cannot rewrite another's words — 403
✓ anyone on the project can close a thread — 200
✓ and a finished conversation leaves nothing in anybody's queue — 0 still open
✓ recorded as WHO and WHEN — six months later, "true" answers nothing
```

**Red-first, five defects injected and caught**: dropping the token boundary (two cases fail),
not excluding the author, stripping the anchor's project/tenant scoping, skipping the ToDo sweep,
and resolving mentions against the whole tenant.

**One red-first attempt that silently did nothing** — the injected patch searched for a trailing
`;` the source does not have, so `.replace()` matched zero times and the suite passed, which read as
"the check cannot fail". Re-run with an `assert` on the match count, it failed correctly. A defect
injection without an assertion is not a red-first; it is a green run with extra steps.

### Found, not fixed here

The notification feed (`app/api/portal/[tenantSlug]/notifications/route.ts`) filters
`namespace IN ('proposal', 'capture', 'library', 'system')` — **`project` is not in the list**, on
either the tenant-wide or the partner-scoped query, so all 16 live project event types are invisible
in the bell. Recorded on H3, which is where it belongs; H1 does not depend on it, because a mention
reaches people through the ToDo and the email regardless.

`tsc` 0 · vitest 219 files / **2,204** · surfaces 82/82 · api-contract clean · write-contract clean ·
the full lifecycle drive green, footprint removed.

---

## M — The Projects UI on a phone

### It had never been photographed there

`drive-ui-responsive.mjs` shoots four tenant routes at 390 / 820 / 1440. The project workspace was
not one of them, so the densest page a tenant has — a plan, a checklist with inline edit rows,
deliverables, and now comment threads — had **never been rendered below the `lg` breakpoint by any
instrument**. A surface no viewport pass reaches is uncovered, not passing.

It is in the lane now, with the project id resolved from the database at run time: a hard-coded id
rots the first time the sandbox is reseeded, and a route that 404s photographs an empty page that
looks like a clean result. If the row is missing the placeholder is dropped and **said out loud**.

### And a page at rest is still not the UI

The responsive pass photographs each route AT REST and asserts the body never scrolls sideways.
Both matter; neither reaches this page, because every dense thing on it is behind a click — the task
edit row's four controls, the comment composer, the file input. `probe-project-mobile.mts` opens
them all and then measures. Its verdict at 390px, before any change:

**No overflow. No clipping.** Structurally sound, and the screenshot showed why that is not the same
as usable:

- One `flex-wrap` line carried the title, the due date, the assignee chip and two buttons, so a
  single task wrapped into four ragged lines with nothing marking where one ended and the next
  began. Two identical tasks looked structurally different depending on title length.
- `ml-auto` threw Edit and Block onto a line of their own, under an unrelated row, where they read
  as belonging to whatever was above them.
- `kate.ulepic@foundation3dp.com` is wider than a phone, so one chip became the row.
- The four-field edit panel put each control on its own line — a four-field edit became a scroll.

### The house idiom, applied

The codebase already had the answer, used 92 times: a `min-w-0 flex-1` content column that owns its
own wrapping, `truncate` on identifiers, `flex-col sm:flex-row` to stack. So:

- **The row became a column.** A fixed control, a content column with the title on its own line and
  a meta group that wraps as one unit, and actions that never leave the top line.
- **Identifiers truncate with a `title`** — `max-w-[11rem] truncate sm:max-w-none`, so the phone
  gets an ellipsis and every width above `sm` gets the whole thing back.
- **The edit panel is `grid-cols-2 sm:flex`** — the controls pair naturally, because they are two
  pairs: who/when, and expected/reference.
- **The deliverable row** stacks its actions below the title on a phone and restores `ml-auto`
  above `sm`; a mention chip gets `break-all`, since one unbreakable token wider than the viewport
  is the classic way a body forces the page sideways.

Nothing changed above `sm`. The tablet and desktop captures are the layout that was already there.

### The instrument disagreed with a decision, and the instrument was wrong

The clipping check then fired on **five chips I had just truncated on purpose**. Reporting a
deliberate, recoverable truncation as a defect achieves one thing: it teaches whoever runs the probe
to skip that line.

So the question narrowed to the one that matters — *is the clipped text reachable at all?* A `title`
carrying it means yes; nothing carrying it means a word is simply gone, and the page photographs as
tidy either way. That is **stronger** than the naive version, not weaker: a `truncate` added later
without a title now fails, where before it would have been lost in the noise of five false ones.

### Two writers, one file

The probe writes `project-mobile.json` rather than appending to `responsive.json`, and
`write-ui-docs.mjs` reads it as a third index. `drive-ui-responsive.mjs` rewrites its index whole on
every run, so anything merged in would vanish the next time it ran — and the images would then read
as orphans the doc generator offers to prune. Missing on disk resolves to `{shots: []}`, which is
honest: the probe has not been run here.

```
── phone · 390px ──   ✓ nothing runs past the viewport with every panel open
                      ✓ no text is clipped with no way to recover it
── tablet · 820px ──  ✓ both, and the single-line layout is restored above sm

docs/UI_STATES.md — 272 states · 20 sheets · 64 viewports · no orphaned images
```

The 61 controls under the 44px touch target are **reported, never failed** — 54 of them are the nav
rail's own 208×36 links, which is the app-wide convention, and failing a number that is mostly
somebody else's design decision is how a check gets silenced.

`tsc` 0 · vitest 219 files / 2,204 · surfaces 82/82 · api-contract clean · responsive pass: no
sideways scroll at any width, nav semantics correct.

---

## H2 — Somebody looked at this and said no, because X

Migration **223**: `project_reviews`.

### The state that did not exist

A deliverable was either accepted or silently not. There was no way to record that a person read it
and found it wrong, and no way to say why — so the rejection happened in a meeting or an email, and
the row went on looking like something nobody had got round to. **"Not yet accepted" and "rejected,
for these reasons" are different states, and only one of them tells the next person what to do.**

Rejection is therefore first-class, and the reason is enforced by a CHECK — including against
whitespace, because `'   '` is not a reason.

### Approving is not accepting

The separation this module runs on, now closed from a third direction. Uploading a file is not
accepting it; authoring a document is not accepting it; and **a reviewer approving is not accepting
either**. A review says an internal reader is satisfied; `accepted_at` says the obligation is met —
a different claim, made by a tenant_admin, and the one that closes a CLIN.

What a review *does* is gate that act:

| latest review | acceptance |
|---|---|
| none ever | proceeds exactly as before — nothing that worked stops working |
| **pending** | `409 REVIEW_PENDING` — it is still being looked at |
| **rejected** | `409 REVIEW_REJECTED`, **repeating the reason** so nobody has to go and find it |
| approved | proceeds |
| withdrawn | proceeds — the request was taken back |

Only the **latest** review counts, which is what makes reject → fix → re-request → approve a *loop*
rather than a dead end.

### Who may do what, and why they differ

**Requesting is open to anyone on the project** — asking a colleague to check something is
collaboration, the same act as an @mention. **Deciding belongs to the named reviewer or a
tenant_admin**, because a gate anyone can open is not a gate. **Withdrawing belongs to whoever
asked**, so a request made in error cannot hold a deliverable hostage.

One pending review per thing, enforced by a partial unique index: three open reviews is three people
each believing they are the decider, and the unique violation is caught and turned into
`REVIEW_ALREADY_OPEN` rather than a 500.

### The gate does not fail open

`blockingReview` returns a blocker on a database error rather than `null`. Reporting "nothing in the
way" when the gate cannot read its own state would turn a connection blip into an acceptance nobody
reviewed. Red-tested: flipping it to `null` fails the case that exists for it.

### Proven

Nine schema invariants against real Postgres in a rolled-back transaction, 23 unit assertions, and
the whole loop as the actors:

```
✓ an EMPLOYEE can ask a colleague to review a deliverable — 201
✓ a SECOND open review is refused — 409 REVIEW_ALREADY_OPEN
✓ and while it is out for review, it cannot be accepted — 409 REVIEW_PENDING
✓ a rejection with no reason is refused — 400
✓ a rejection WITH a reason is recorded — 200
✓ and the reason is on the record, not in somebody's inbox
✓ a rejected deliverable still cannot be accepted — 409 REVIEW_REJECTED
✓ so whoever tries to accept it learns what is wrong without going to look
✓ a fresh review supersedes the rejection — reject is a loop, not a wall — 201
✓ APPROVING IS NOT ACCEPTING — the reviewer is satisfied; the obligation is not yet met
✓ and once approved, a tenant_admin can accept it — 200
```

Red-first, three defects injected: the gate failing open, a rejection ceasing to block, and a
rejection allowed to be silent. Each fails exactly the case written for it.

---

## The verification backbone had a hole in it, and I had been reporting through it

**`npx tsc --noEmit` never checked a single drive.** `tsconfig.json` includes `**/*.ts` and
`**/*.tsx`; **`.mts` matches neither.** Only the 66 harnesses pulled in transitively as imports are
seen; the drives themselves are not.

Verified in both directions rather than read off the config: `tsc --listFiles` does not load
`drive-project-lifecycle.mts`, and a duplicate `const` injected into it produces **zero** errors.

This is not theoretical, and it is mine: **twice in one sitting** a duplicate `const` inside a
drive's `main()` passed `tsc` clean and then failed under esbuild at run time — each time after a
full rebuild and a server restart, to learn something a binder knows instantly. Every "tsc 0" I have
reported covered the app and not the harnesses.

**Adding `.mts` to the include surfaces 121 pre-existing type errors.** A check that fails 121 times
on its first run is one somebody turns off that afternoon, so that is recorded for the X review
rather than done here.

`scripts/check-harness-syntax.mjs` is the part that pays today: 269 harness files, parsed and bound,
in about a second. It makes **no claim about types** — pretending otherwise is how the 121 get
ignored.

**Its first version did not work.** It used `esbuild.transformSync`, on the reasoning that esbuild is
what reported the bug. Red-tested against the exact defect, it reported a clean run: a per-file
transform does no cross-scope binding. Rebuilt on the TypeScript binder, filtered to the
declared-twice diagnostic family plus every syntax error, it catches it:

```
✗ 2 problem(s) that will fail the moment the harness is run:
  · scripts/drive-project-lifecycle.mts:758 — TS2451: Cannot redeclare block-scoped variable 'asked'.
```

An instrument that cannot detect the thing it exists for is worse than none, because it reports a
clean run.

### And the repo's own lesson, repeating

Fixing the fixtures, `both refusals ride ONE compare-and-swap` failed — because it read
`db.state.queries[0]`, and the review gate's read had moved into that slot. **The same file already
carries a comment about this exact mistake**, made when the open-tasks gate was added in front of the
deliverables gate. Selected by what it *is* now, in both places.

`tsc` 0 · vitest 221 files / **2,229** · harness syntax 269/269 · surfaces 82/82 · api-contract
clean · write-contract clean · spine audit 0 dead triggers · lifecycle drive green · mobile probe
clean at 390 and 820 with every panel open.

---

## H3 — The inbox: post-award work reaches the surfaces people already read

### 29 event types were reaching nobody

The notification feed selected `namespace IN ('proposal', 'capture', 'library', 'system')`. **The
`project` namespace was not in the list**, on either arm of the query — so every event migs 216–223
emit landed in `system_events` and was never selected. The bell was not filtering them out; it was
never asking for them.

### And nine of them had no sentence

Reconciling the DISTINCT types the database has actually emitted against the labels in
`lib/event-labels.ts` — the same join that found B136's *"Shadow descended"* — turned up nine with
no case: everything P4, H1 and H2 added. They would have reached a customer's feed through the
humaniser as "Comment posted" and "Review rejected": not wrong so much as **nobody's sentence**, and
in the rejection's case dropping the one thing a reader needs.

The labels now carry what makes each row worth reading:

| event | what the row says |
|---|---|
| `review.rejected` | **the reason**, in the row — not behind a click |
| `task.reassigned` | **who** it went to |
| `comment.posted` | the excerpt, and how many people were mentioned |
| `milestone.dependency_set` | whether it was set or cleared |

Two labels — `project.reopened` and `comment.edited` — happened to read *exactly* like the humanised
fallback, so nothing could tell a written label from a missing one. Rather than weaken the test,
both were given the fact a reader of that row actually wants: *"Closed-out project reopened"* and
*"Comment edited by its author"*.

`event-label-jargon.test.ts` now carries all 29 project types, built the same way — joined from what
the database emitted, not from what the code declares.

### The partner arm's exclusion is now deliberate

A `partner_user` is refused the project capability outright, so they must not see post-award
activity. They already didn't — but only because the partner query requires
`payload->>'proposalId'`, and project payloads carry `projectId`. **That is an accident of payload
shape**, and the first project event to carry a proposal id would have quietly undone it. The
namespace list is where the decision belongs, and the omission is now commented as load-bearing.

### "For you" learns what a project is

A proposal event is yours when it touches a section assigned to you. A project event is yours when
it happens on a project **you are on** — the roster is the access mechanism there, so it is the right
routing key — or when a comment **mentions you outright**, which is stronger than either.

### The Command Center lane

Scoped by `listProjectsForActor`, the same function the workspace uses: a lane built on a second
query would be a second opinion about who can see what.

The badge counts **what needs a person** — overdue milestones plus reviews awaiting a decision — not
how many projects exist. A lane that reads "3" because you are on three healthy projects is a lane
that is always non-zero and therefore never informative. A project with nothing outstanding says so,
quietly, rather than being hidden.

`'projects'` had to be added to `KNOWN_TABS`, or marking the lane seen is refused and the "new since
you looked" dot never clears — a lane that always shouts is a lane people stop looking at.

### Proven

```
✓ project events reach the notification bell at all — 36 of 100 row(s)
✓ and every one of them is a written sentence, not a de-punctuated type — all labelled
✓ and work on a project I am ON is flagged for me — the roster is the routing key — 10 flagged
✓ the Command Center carries a Projects lane — 200
```

`tsc` 0 · vitest **2,260** · harness syntax 269/269 · surfaces 82/82 · api-contract clean ·
lifecycle drive green.

---

## P9 — The customer's act, filed by us

Migration **224**: `project_acceptance_evidence`.

### What it replaces, and why that is the better trade

The plan originally had a read-only login for the customer's contracting officer. That reopens a
boundary this product closed on purpose — `partner_user` is refused the project capability outright,
which is what removes cross-tenant from it entirely — and it would mean an external session, a new
audience for every project surface, and a scoping question on each one.

Filing the evidence costs none of that. **The customer's act reaches the system as a file the
tenant_admin already has**, and the boundary stays where it is.

### Evidencing is not accepting — the fourth time this line is drawn

Uploading is not accepting. Authoring is not accepting. Approving is not accepting. And evidence of
the customer's act is not the customer's act. **Four ways to attach a fact, one deliberate act by a
person who is allowed to make it.** Nothing in this module writes `accepted_at`.

### And a claim about somebody is not their act

This is the ingest-provenance rule applied to acceptance: *a value the product did not read from the
source must never look like one it did.*

An admin types a contracting officer's name into a form. The product has never met that person,
verified nothing, and holds no record of them — so `customer_name` is stored as free text with **no
attempt to resolve it to a user**, because inventing a user row for a COR would manufacture an
identity nothing checked. The event keeps `filedBy` (a user id) and `customerName` (a string
somebody typed) as **separate fields**, and the workspace renders:

> accepted by **dana@acme.test** · evidence: Email from the COR/CO, 2026-04-02

never *"accepted by the government"*. A deliverable accepted with nothing on file says so, in amber:
**no customer evidence on file**.

Filing is `tenant_admin`+ — anyone on the project may upload a working file, but asserting that
somebody outside the company signed for it is a narrower thing.

### Proven

Nine unit assertions and, as the actors:

```
✓ a tenant_admin can file the customer's acceptance evidence — 201
✓ and the row keeps the reported name and the filing admin APART — two different facts
  — reports "J. Rivera" · filed by a real user
✓ the evidence is on file
✓ and an employee cannot file it — 403
```

Red-first, two defects injected: filing that *also* accepts, and the reported name merged into a
single `acceptedBy`. Each fails exactly the case written for it — and neither would have errored in
production. They would have produced a clean, confident, wrong sentence, read six months later in a
dispute, which is the only moment it matters.

`tsc` 0 · vitest **2,271** · surfaces 82/82 · write-contract clean · mobile probe clean at 390 and
820 · lifecycle drive green.

---

## P2 — The register, and the question a review actually asks

Migration **225**: `project_risks`.

### One table, because the transition is the point

A risk is something that might happen; an issue is a risk that did. Two tables would make that
transition a **copy** between them — and a copied row cannot answer the question every program
review asks: *when did we know, and what did we rate it?*

So `kind` moves risk → issue **in place** and `became_issue_at` records when. One row, one history,
and the score it carried at the time survives. The drive checks the row count afterwards for exactly
this reason: **ONE row, moved — not a risk row plus an issue row.**

An issue **keeps its probability**. It reads oddly — the thing happened, so probability is moot —
but *"we had this at 20 out of 25 and it landed"* is the register's whole claim to having been
useful, and blanking the field on transition destroys it.

`kind` and `status` are separate axes, so a closed risk and a closed issue stay distinguishable: one
was mitigated before it happened, the other was survived.

### The score is GENERATED

`probability × impact`, computed by the database. A number the UI calculated goes stale the day the
formula changes, and nothing afterwards says which rows are which. The UI shows it live while you
pick the ratings, and it cannot drift, because the server never accepts one.

### A mitigation is a real task

*"Order the long-lead parts now"* is work with an owner and a date — which is exactly what
`project_milestone_tasks` is. A private checklist on the register would give a customer **two places
their work lives**, the same argument that made project ToDos a projection rather than a queue, and
canvas deliverables one column rather than a second editor.

So `mitigate` creates a project-scope task, and it inherits everything that spine already has: a
ToDo, an email, nudges, reassignment, attachments. The drive proves the consequence rather than
asserting the intent — the mitigation **blocked close-out** until it was ticked off, like any other
standing work.

### Who

Raising and rescoring are open to **anyone on the project**: the person who sees a risk first is
rarely the manager, and a register only a manager may write lags reality by a week. Closing is
`tenant_admin` — deciding a risk is behind us is a management call.

### Proven

Eight schema invariants against real Postgres, 16 unit assertions, and as the actors:

```
✓ a risk is raised — 201
✓ and the database computed its score — never a number the UI sent — 20
✓ a rating outside 1-5 is refused, not clamped — 400
✓ its mitigation becomes a real project task — 201
✓ which means it inherits the ToDo, the email and the nudges — not a second checklist — 1 ToDo(s)
✓ an employee can say it happened — they usually see it first — 200
✓ the SAME row became an issue, and recorded when
✓ and it KEPT the score it was rated at — "we had this at 20 and it landed" — score=20
✓ a second click cannot re-stamp the day we learned — 409
✓ ONE row, moved — not a risk row plus an issue row — 1
✓ the mitigation is worked and ticked off, like any other task
```

### Two harness defects, and one duplication caught in my own work

Two assertions matched the `RETURNING` clause and reported defects that were not there:
`INSERT … RETURNING …, score, …` contains the word "score" without writing it. Narrowed to the half
of the statement before `RETURNING`, which is what "does it write this" actually means.

And by 7k I had written **three inline copies** of *open a browser context, log in as the employee,
do one thing, close it*. That is precisely the duplication this drive is used to find in the
product. Folded into one `asEmployee_` helper that returns `null` when there is nobody to be — and
the **caller** decides whether that is a skip or a finding, because a helper that silently
substituted the admin would report the manager's half twice.

`tsc` 0 · vitest 222 files / **2,293** · surfaces 82/82 · write-contract clean · mobile probe clean ·
lifecycle drive green.

---

## P3 — What was agreed, and whether it happened

Migration **226**: `project_meetings`, plus one nullable back-pointer on the task table.

### The notes are a canvas document

Not a `notes text` column. The same `tenant_documents` row a deliverable uses, so minutes get the
same editor, the same compliance floor and the same docx · pptx · xlsx · pdf exporters — **minutes
that cannot be exported are minutes nobody can send**, and a text column would have passed every
other check here and failed that one. The drive exports them and checks the `PK` header for exactly
that reason.

Seeded with facts read off the row — the title, the date, who was there — and **no agenda
headings**. Scaffolding *Agenda / Discussion / Next steps* would put structure into a record of what
was actually said, and the product does not know what was said.

Attendees are **names, not user ids**: half the room usually works for the customer, and resolving
would either lose them or manufacture an identity nothing verified. Same rule as
`acceptance_evidence.customer_name`.

### An action item is an ordinary task

`project_milestone_tasks.meeting_id` is a nullable back-pointer, not a new kind of row. Work agreed
in a meeting is work with an owner and a date — so it arrives with a ToDo, an email, nudges,
reassignment and attachments, and lands in the same list as everything else that person owes.

**A separate "action items" table would have been the fifth second-checklist this module has
refused** — after the ToDo queue, the nudge path, the canvas editor and the risk register's
mitigations.

What the meeting adds over the document is provenance: six weeks later, *"who agreed to this?"* is
settled by the notes it was decided in.

### One call, and both halves of the answer

That is how a meeting ends — somebody reads back five things. Raising them one at a time is five
chances to be interrupted, leaving **notes claiming five agreements beside a plan holding two, both
looking complete**. Nothing errors; the disagreement surfaces weeks later when the thing nobody was
assigned does not happen.

So the batch is one call, and it reports what it refused, by name. One bad item does not lose the
others — but **nothing landing is a refusal, not a partial success**: an employee hitting the
tenant_admin rule gets a 403, not a cheerful 201 with an empty list.

### Proven

14 unit assertions, two red-first defects (a silently dropped item; nothing landing reporting
success), and as the actors:

```
✓ an employee records the meeting — whoever took the notes — 201
✓ attendees are kept as names, de-duplicated, customer and all — Kate Ulepic · J. Rivera (COR)
✓ and the notes are a real canvas document — the same editor and exporters as everything else
✓ minutes that cannot be exported are minutes nobody can send — 200 · 8,831 bytes
✓ the agreed items are raised in ONE call — 201
✓ and one bad item does not lose the other two — the refusal comes back NAMED — 2 raised · 1 refused
✓ each one is an ORDINARY task, so it lands in the same queue as everything else that person owes
✓ and still knows which meeting it was agreed in — six weeks later, that is the question — 2 traced
```

### The harness check paid for itself

`check-harness-syntax.mjs` (H2) caught a duplicate `const met` **before** the rebuild — the third
occurrence of that exact defect, and the first one that cost seconds instead of ten minutes.

`tsc` 0 · vitest 223 files / **2,309** · harness syntax 269/269 · surfaces 82/82 · mobile probe
clean · lifecycle drive green.

---

## P6 — The cost measure gets a source, and the WBS starts driving

Migration **227**. Two things that belong together.

### Part 1 · The WBS is the spine; the CLIN is a tag on it

Stated by the product owner: *"WBS is CLIN like and should drive everything. They can be associated
with CLIN numbers as tags such that monthly reports are WBS milestones each month but all be a unit
of CLIN 0002 deliverables."*

The WBS side already worked — `project_wbs_nodes.clin_id` is inherited by children, and `rollup.ts`
resolves the effective CLIN with a recursive CTE. **Milestones did not.** Measured on this box:

```
milestones with BOTH clin_id and wbs_node_id : 0
milestones with clin_id ONLY                 : 3
milestones with wbs_node_id                  : 0
```

Every milestone tagged a CLIN **directly** and hung off no WBS node at all. So the WBS drove nothing
for them, and a milestone could name CLIN 0001 while sitting under a node tagged CLIN 0002 — two
answers to "what does this CLIN cover", both plausible. Adding labour roll-up on top would have made
them visibly disagree.

The fix is not to delete the column: a detached milestone still needs a CLIN, and every existing row
is one of those. It is to make the two **agree by construction** — a trigger walks to the nearest
ancestor carrying a CLIN, exactly as the roll-up does, and forces the milestone's tag to match.
Attach a milestone to the WBS and the CLIN follows; leave it detached and the direct tag stands.

### Part 2 · The measure that reported against nothing

`rollup.ts` computed cost from `project_wbs_nodes.actual_cost` — **a column nothing had ever
written.** The honest `null` → "not measured" was hiding a missing *input*, which is the worse kind
of empty because it reads as restraint.

Time is logged against a **WBS node, required**. It is the level the plan is costed at and the level
the CLIN roll-up already resolves, so twelve monthly-report nodes all reach CLIN 0002 without anybody
re-tagging an entry. A task may be tagged too, but the node carries the money.

Three rules, each protecting a number somebody gets billed for:

- **The rate is copied in, not looked up.** Resolved later, history re-prices itself every time
  somebody gets a raise, and last year's cost report stops matching last year's invoice.
- **`actual_cost` is not overwritten.** It keeps its meaning — other direct costs, travel and
  materials — and labour is summed beside it. Two writers on one number is how a total becomes
  unexplainable. The roll-up reports **both halves**, because a number a reader cannot decompose is a
  number they cannot check.
- **Logging is not approving** — the fifth time this module draws that line. Anyone logs their own
  hours; a tenant_admin approves; **only approved hours count**.

### Proven against hand-computed numbers

The roll-up is SQL, so it is proven by a live drive rather than a mock. Both new failure modes
produce a *plausible* number rather than an error, so the fixture was chosen to make each visible —
and red-first confirmed each one:

| defect injected | what the drive reported |
|---|---|
| unapproved hours counted | labour **1500**, expected 500 · cost **150%**, expected 50% |
| entries joined into the CTE rather than aggregated first | CLIN 0002 planned **1500.00**, expected 1000 |

```
ok  0002 labour cost — APPROVED hours only (400 + 100), not the 1000 nobody signed off = 500
ok  0002 approved hours (4 + 2, not the unapproved 10) = 6
ok  0002 cost% = (odc 0 + labour 500) / 1000 — a measure with a SOURCE at last = 50
ok  0002 planned cost is 1000 — the labour join did not multiply the WBS rows
ok  project cost% from ROWS (1300/3000), not the average of CLIN percentages (45%) = 43.3
ok  project labour is the sum of APPROVED entries = 500
ok  and other direct cost is reported SEPARATELY, so the total can be decomposed = 800
```

Six schema invariants held too — including a milestone's **wrong** CLIN tag being overridden by its
WBS node's, and a detached milestone keeping its own.

This unblocks **A5** (`cost_estimator` EAC/ETC), which had no input.

`tsc` 0 · vitest 224 files / **2,329** · surfaces 82/82 · write-contract clean · rollup drive green ·
lifecycle drive green.

---

## The WBS is the milestone list — migrations 228 · 229

**The correction, from the product owner, hours after P6 shipped:**

> *"CLIN 002 can have 12 milestones under the WBS. Milestones drive everything. That is what a WBS
> is comprised of typically. 1 project is the portal. It has high level information like
> participants and contact upload and summary and start and end dates. Then the WBS are the
> milestones with tasks and deliverables. The deliverables on any milestone could be CLINs from the
> contract."*

`project_wbs_nodes` had been a SECOND hierarchy sitting beside `project_milestones` since migration
216 — its own dates, its own costs, its own CLIN, describing the same thing. That is the shape this
codebase has refused five times elsewhere (a second ToDo queue, a second nudge path, a second
editor, a second checklist, a second comment table) and it was in the middle of the schema the whole
time.

It also produced two answers to one question. **P6 shipped a trigger to reconcile them** — forcing a
milestone's CLIN to follow its WBS node's — which was the right fix for the wrong model. Migration
228 drops that trigger four hours old. The model did not need reconciling; it needed one spine.

```
projects                     the portal: participants, contract documents, summary, dates
  └── project_milestones               = THE WBS ELEMENT
        · code, dates, owner, cost, completion record
        · clin_id  — the GROUPING: CLIN 0002 has twelve monthly milestones
        ├── project_milestone_tasks
        └── project_deliverables
              · clin_id — the CONTRACTUAL ITEM this deliverable satisfies
```

**Two CLIN links, and they are different claims.** A milestone's CLIN says *which line item this
month's work is under*. A deliverable's CLIN says *this is the thing the contract asked for*. They
usually agree, and a monthly milestone under CLIN 0001 that produces a CLIN 0002 artefact is
counted where the contract counts it — which one column could not express.

What went away: a recursive CTE in `rollup.ts` resolving an inherited CLIN up a parent chain, a
second `UPDATE` in both `setBaseline` and `rebaseline`, `parent_id`, and P6's reconciliation
trigger. Collapsing a parallel structure is supposed to feel like this.

### The half that did NOT survive, and had to be gone back for

Migration 228 was applied, the code was repointed, `tsc` was clean and the rollup drive was green
on all fourteen assertions. **It had silently dropped the cost baseline.** The WBS node froze three
columns under migration 216's immutability trigger — `baseline_start`, `baseline_end` and
`baseline_cost`. The milestone froze one: `baseline_date`.

So after 228 the schedule promise was still held and the cost promise was not — and
`lib/projects/wbs.ts` renders a **read-only column labelled "Baseline cost"**. With nothing to read,
the repointing had aliased `planned_cost` into it. A person would have read the current plan out of
a greyed-out cell promising the frozen one, and cost variance would have computed as **zero
forever**, cheerfully, because both sides of the subtraction were the same column — rendering as a
project permanently on budget.

Nothing caught it. Every unit test passed; the isolation lens asserted milestone `baseline_date`
immutability and said nothing about cost; the lifecycle drive counted frozen rows without asking
what was frozen in them. It was found by reading the migration back and asking what the old table
held that the new one does not.

Migration **229** adds `project_milestones.baseline_cost`, re-declares the trigger over both columns
(the function is generic over `TG_ARGV`, so this is a redefinition and not a second rule), carries
the old values across, and only then drops `project_wbs_nodes` — the one project table ever dropped.
`setBaseline` freezes both promises in the one statement.

**Red-first on the three new assertions**, each failing against the code as it stood:

| assertion | on the unfixed code |
|---|---|
| `setBaseline` freezes BOTH promises | `expected 'UPDATE project_milestones SET baselin…' to match /baseline_cost\s*=\s*planned_cost/` |
| the baseline columns render the FROZEN values | `baseline cost: expected '1250.00' to be '1000.00'` |
| a milestone with no baseline renders EMPTY | `expected '1250.00' to be ''` |

The grid's column contract shrank with the model: `Baseline start · Baseline end · Baseline cost`
was three columns fed by two values, one of them repeated. It is now `Baseline date · Baseline cost`,
read from the two columns that exist.

### Two things the repointing turned up on its own

**The seed had been unrunnable since P4.** `seed-project-scenario.mjs` writes a checklist task due
`CURRENT_DATE - 12` under a milestone forecasting `CURRENT_DATE - 16`, which migration 221's
`project_task_due_within_milestone` trigger refuses (23004). P4 added that trigger and nothing
re-ran the seed, so it sat broken until this pass. Fixed in the fixture, not by loosening the rule:
a blocked task is still due before the phase it belongs to.

**A drive that asserted positions rather than properties.** The `/wbs` route now writes a milestone,
so the plan gained a row and every `chain[1]` / `chain[2]` index shifted by one — the same trap as
reading `queries[0]` in a mocked test. The serial-date checks now assert what the rule actually says
— *each unpinned phase starts the day after the previous one ends, and a pinned start is respected*
— by title, at whatever length the plan happens to be. It is a stronger assertion than the
hard-coded offsets it replaces.

Two smaller corrections fell out: `baseline.set` was carrying `wbsNodes` **and** `milestones` in its
payload, both filled from the same array — two names for one number, which reads as corroboration
and is not; and `verify-ui-vs-db` was joining the deliverables count through the old node table
rather than copying the predicate from `rollup.ts` as its own header requires.

### And the migration runner stopped crying wolf

Applying 229 surfaced a standing `⚠️ DRIFT` on `221_project_task_spine.sql` — edited after it was
applied. Every object it declares was verified present by hand (columns, all three triggers, the
attachments table with its four policies, all seven CHECKs), so the drift was comment bytes. But a
warning nobody can clear is a warning everybody learns to scroll past, and the next one will be
real. `migrate.mjs` now takes `--accept-drift=<file>`: an explicit, named, logged restamp, never a
wildcard, and a name that is not actually drifting is reported rather than silently doing nothing.

### Verification

`tsc` 0 · vitest 224 files / **2,332** · migration 229 applied · isolation lens 13/13 (including the
new cost-immutability refusal) · rollup drive 15/15 against hand-computed numbers · **lifecycle
drive green end to end** · surfaces 82/82 · api-contract 127 graded, 0 violations · write-contract
244/244 · ui-vs-db green · mobile probe green at 390 and 820 · `next build` clean.

## P5 · Contract modifications — migration 230

**A CLIN had no update path, and that was not an omission.** `lib/projects/clins.ts` shipped with
`createClin` and no `updateClin`. Every CLIN field carries a citation on the ingest-provenance trust
order, and a plain UPDATE would move the value while leaving the badge reading "Read from source",
pointing at a contract page that no longer says that.

A contract does not change because somebody edited a field. It changes because **a modification was
signed**. So that is the write path: a mod carries its own number, its own signed date and its own
document, and executing it is what moves the CLIN.

```
project_modifications            P00001 · kind · draft|executed · executed_on · signed document
  └── project_modification_changes
        'amend'     clin_id + field + old_value → new_value
        'add_clin'  an option exercise; payload carries the row, clin_id set at execution
```

There is deliberately no `remove_clin`. A contract does not delete a line item, it **deobligates**
one — an `amend` setting `funded_amount` to 0 — and deleting the row would take the milestones,
deliverables and delivery history that reference it along with it.

**Draft is not executed** — the eighth time this capability draws that line (upload is not
acceptance; logging is not approving; a comment is not a review). A draft that moved the money would
put unsigned numbers into the roll-up.

**And an executed mod is immutable**, by trigger. Same rule as the baseline, for the same reason: it
records what was agreed on a date. A mistake is corrected by **issuing another mod**, which is also
how it works on paper.

### The decision the module is built around: executing does NOT rebaseline

A mod that extends the period of performance is exactly the moment somebody wants the schedule
baseline moved, and this refuses to do it silently. `baseline_date` and `baseline_cost` are the
ORIGINAL promise; `rebaseline` already exists, already demands a reason, and already moves the
current plan without touching what was frozen.

So executing **raises a ToDo** asking a person to rebaseline — onto the same `tasks` spine, the same
queue, the same nudges. Two writers on the plan's dates is how a schedule stops being explainable,
and an automatic rebaseline would be the second. The ToDo is skipped entirely on a project with no
baseline yet: the question has no meaning before there is a promise to be out of step with, and a
ToDo nobody can action is how a queue becomes noise.

### The bug it found in the provenance helper

`recordProvenance` upserts **only when the new method outranks the existing one** — the trust order
doing its job at the write. So `verified` (this mod's signed document) replacing `verified` (the
original award) is *refused*: `array_position(new) < array_position(old)` is false when they are
equal.

The funded amount would have moved to $900,000 and the badge would still have read "Read from
source", citing the award page that says $750,000. That is precisely the failure the provenance
model exists to prevent, arriving through the provenance model itself.

The trust order compares **method, not recency**, and it cannot tell "a weaker source is clobbering
a stronger one" (refuse) from "a later document of equal authority replaced the earlier one"
(allow). `recordProvenance` now takes `supersedes: true` for the second case — and nothing else: the
"a citing method needs something to cite" refusal, which is the one that actually protects the badge,
still applies. Confirmed red: without the flag the assertion fails on the same build.

### And the isolation lens had been measuring seven tables out of seventeen

`verify-project-isolation.mjs` hard-coded migration 216's seven table names. Ten project tables have
been added since — tasks, attachments, comments, reviews, evidence, risks, meetings, time entries and
both modification tables — and **none of them had a structural isolation check**, because the lens
only ever asked about names somebody had remembered to type. Every one carries tenant data.

It now enumerates from the database (`relname LIKE 'project%'`), keeping the hand-list only as an
existence FLOOR — enumeration cannot tell you a table is *missing*, since one never created is
simply not in the enumeration. It accepts either policy shape: one `FOR ALL` (mig 216) or four
per-command (mig 184, which every table since has used); anything else is a partial set, which is
the state that leaks. Proven by dropping one `UPDATE` policy on `project_modifications` — a table
the old lens never looked at — and watching it fail: *"3 policies — expected 1 or 4, not a partial
set"*.

### Verification

`tsc` 0 · vitest 225 files / **2,356** (24 new) · migration 230 applied · **15 modification
assertions green in the live lifecycle drive** — drafting leaves the CLIN untouched, executing moves
it, the recorded `old_value` is the one that was standing at execution, the citation follows the mod,
the frozen baseline does not move and a rebaseline ToDo is raised instead, and a second execution is
refused 409 · isolation lens 17 tables (was 7) · surfaces 82/82 · api-contract clean ·
write-contract **247/247** · mobile green at 390 and 820 · `next build` clean.

## P7 · Invoicing — migration 231

Where everything else in this capability becomes money. It is built on what is already here, and
invents no second source for a number that already has one:

| what | where it comes from |
|---|---|
| the CEILING | `project_clins.funded_amount` — which **P5** made movable only by a signed modification |
| the LABOUR | approved `project_time_entries` — **P6**'s hours, and only the approved ones |
| the WORK | an ACCEPTED deliverable under a milestone — what a payment milestone actually bills |

That is the point of doing P5 and P6 first. "How much may we bill" has exactly one answer and one
way to change it, and the drive asserts precisely that: **the ceiling under test is the $900,000
modification P00001 set, not the $750,000 the award did.**

### The two invariants

**You cannot bill past the ceiling** — checked at SUBMIT (a draft may hold anything while it is
assembled, exactly as a modification may), and checked **cumulatively**. Three invoices of $300,000
against $750,000 funded are each comfortably under the limit and together are over it, and each one
looks correct at the moment it is submitted. The refusal names the overage, because "over the
funding" with no number sends somebody to a spreadsheet to work out what this code already knew.

**The same hours cannot be billed twice** — `project_time_entries.invoice_line_id` is the link, so
"unbilled" is a query rather than a convention. The claim is made in the PREDICATE
(`approved_at IS NOT NULL AND invoice_line_id IS NULL`), so a concurrent invoice racing for the same
entries loses by matching zero rows rather than both marking them. **Voiding releases them** — a
void keeps its lines (they record what was claimed), so the release is explicit; without it a
voided invoice would hold its hours hostage and the correcting invoice could never re-bill the work.

**And submitted is not paid** — the ninth time this capability draws that line. Partial payment is
the normal case, not an edge one: a government customer pays against a withholding, and an invoice
that can only be all-or-nothing forces somebody to lie about which. `amount_paid` accumulates and
`status` flips to `paid` only when the claim is settled to the cent.

### One conflation caught while writing it

`clinBilling` originally counted every non-void invoice as `billed`, which is right for the ceiling
check and **wrong for reporting**: the position on the dashboard would have moved every time
somebody opened a form and typed a number. They are two different questions. `clinBilling` now
reports SUBMITTED and PAID only, and `submitInvoice` adds the draft's own lines to that figure
itself. One function answering both would have to be wrong for one of them, and the wrong one is
silent.

`remaining` is `null` — rendering **"funding not set"** — when a CLIN carries no funded amount. Zero
is a measurement; a missing ceiling is not one, and a reader cannot tell them apart once both render
as a number.

### Verification

`tsc` 0 · vitest 226 files / **2,380** (24 new) · migration 231 applied · **17 billing assertions
green in the live lifecycle drive** — the ceiling is the modification's, a draft does not move the
billed position, submitting does, a second invoice under the limit is refused *cumulatively* with
the overage named, a partial payment does not settle, the rest does, a submitted invoice's lines are
frozen (23001), and a void does not count against the funding · isolation lens **19 tables** (it
picked both new ones up with no edit — the enumeration doing its job) · surfaces 82/82 ·
api-contract 129 graded · write-contract **249/249** · ui-vs-db green · mobile green at 390 and
820 · `next build` clean.

## P8 · The CDRL register — migration 232

**A CDRL is an obligation; a deliverable is one instance of it.** "A002 — Monthly Status Report,
DI-MGMT-81334D, monthly, Distribution Statement B" is written into the contract once; the twelve
reports it produces are twelve deliverables under twelve monthly milestones — the same shape the
product owner described for the WBS.

So the submission history of a CDRL **is** its deliverables, in date order. There is no second
deliverable table and no parallel submission-history table; building one would have been the fifth
structure this module has refused. What comes *back* is already modelled too:
`project_acceptance_evidence` (P9) records a DD-250 or a transmittal as a claim ABOUT the customer,
uploaded by an admin, never the customer's own act.

### The third state, which the deliverable genuinely lacked

|  |  |
|---|---|
| ATTACHED | `uploaded_at` — a file or an authored document is on it |
| ACCEPTED | `accepted_at` — a tenant_admin signed off internally |
| **SENT** | `submitted_at` — **the customer has it** |

For a CDRL the distinction is the whole point: the contract sets a date by which the item must be
**delivered to the government**, and lateness is measured against the day it was sent, not the day
somebody finished writing. Neither existing state carried that.

Sending is gated on internal acceptance — in the database *and* in the domain layer, so the refusal
is a sentence rather than a 500 carrying a SQLSTATE. Sending work nobody signed off is the failure
the acceptance gate exists to prevent, arriving one step later. **Un-sending is refused outright**:
a corrected version is a new submission, and the record of what the customer received has to survive.

### The marking is not decoration

Distribution Statement B–F restricts who may receive the document, and the marking is required to
appear ON the artifact. It is carried on the CDRL so it can be stamped on a deliverable authored in
this product's own canvas (mig 220) — the post-award analogue of the compliance floor.

`distributionMarking()` returns **null** when the contract stated none, and the form's dropdown does
not pre-select. Defaulting to "A" because it is the permissive letter would put a public-release
marking on a document that may not be publicly releasable — a legally significant claim, invented by
a UI convenience. Confirmed red: with the default in place, the test reads
`expected 'DISTRIBUTION STATEMENT A: Approved fo…' to be null`.

The register renders each letter **with its meaning**, because "B" alone tells a reader nothing and
knowing who may receive the document is the entire purpose of the marking.

### An assertion that was passing without being exercised

The drive's gate check looked for an existing unaccepted deliverable and reported *"none found"* —
by that point in the run every deliverable on the project has been accepted. That is **uncovered,
not passing**, and it left the most important assertion in the phase inert. It now **builds** the
case: create an unaccepted deliverable, prove the refusal, then accept it and prove the *same call*
goes through — because without that second half the refusal would pass identically against a route
that refused everything. Same shape as the isolation lens asserting a baseline can be set once
before asserting it cannot be moved.

### Verification

`tsc` 0 · vitest 227 files / **2,400** (20 new) · migration 232 applied · **16 CDRL assertions green
in the live lifecycle drive** — a recurring item with no first due date is refused by name, a
duplicate number 409s, the register answers "0 of 1 sent", an unaccepted deliverable cannot be sent,
an accepted one can, lateness is real (`daysLate=5`), sending twice is refused, and un-sending is
refused **by the database itself** (23001) · **0 broken links in the whole chain** · isolation lens
**20 tables** (it picked the new one up with no edit) · surfaces 82/82 · api-contract 130 graded ·
write-contract **251/251** · ui-vs-db green · mobile green at 390 and 820 · `next build` clean.
