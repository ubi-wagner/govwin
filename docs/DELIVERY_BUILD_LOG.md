# Delivery management — build log

The as-built record. Design: **docs/DELIVERY_MANAGEMENT_DESIGN.md** (the decisions). This file is
what actually happened, including the places the design was wrong.

Build order and task ids are the register in the V1 close-out plan: **D1 … D9**.

---

## D1 · Schema, RLS, and the assignment boundary — migration 216

**Shipped:** `db/migrations/216_delivery_spine.sql`, `frontend/lib/delivery/access.ts`,
`frontend/scripts/verify-delivery-isolation.mjs` (13 assertions),
`frontend/__tests__/delivery-assignment-boundary.test.ts` (14).

Eight tables. Nothing renders yet — isolation is provable before anything depends on it, which is
the whole point of doing this step first.

### The design's DDL would not have applied

```
CREATE TEMP TABLE probe (id int, current_date date);
ERROR:  syntax error at or near "current_date"
```

`delivery_milestones.current_date` is in the design doc and `CURRENT_DATE` is a **reserved
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

So `lib/delivery/access.ts` is one module with one predicate, and CLAUDE.md says why that is not
optional: *"Treat that belt as load-bearing — a new reader that omits it leaks, and RLS will not
catch it."*

| actor | scope |
|---|---|
| `tenant_admin` + (incl. descended `rfp_admin` / `master_admin`) | every project at their tenant |
| `tenant_user` | exactly their `delivery_assignments` rows |
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
| policy DROPPED on `delivery_wbs_nodes` | structure check fired · exit 1 |
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

**Shipped:** `lib/delivery/{projects,clins,provenance,gate}.ts`, four API routes,
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

**Shipped:** `lib/delivery/wbs.ts`, the `workplan` canvas format and its exemption,
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

**Shipped:** `lib/delivery/baseline.ts`, `…/delivery/projects/[projectId]/baseline` (GET · POST ·
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

*D5 onward appended as built.*
