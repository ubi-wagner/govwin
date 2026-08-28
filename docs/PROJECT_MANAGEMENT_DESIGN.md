# Projects — CLIN · WBS · deliverables

> Named **Projects** in the product (operator decision, 2026-08-27). It was drafted as "Delivery";
> the tables are `projects` / `project_*`, the surface is `/portal/<slug>/projects`, and the event
> namespace was always `project`. "Delivery" survives only where a contract clause uses the word.

**Status:** BUILT (D1–D10). Design decisions locked with the operator 2026-08-26; renamed 2026-08-27.
**Original status line:** design, not built. Decisions locked with the operator 2026-08-26.

A segregated capability for tenants who have **won**. It reuses the platform substrate — tenancy,
RLS, the workflow engine, storage, canvas, email — and shares no schema with the proposal spine.

---

> ## ⚠️ SUPERSEDED IN ONE PLACE: `project_wbs_nodes` NO LONGER EXISTS
>
> Migration **228** collapsed it into `project_milestones` and **229** dropped the table. The
> product owner's correction, verbatim:
>
> > *"CLIN 002 can have 12 milestones under the WBS. Milestones drive everything. That is what a
> > WBS is comprised of typically. 1 project is the portal. It has high level information like
> > participants and contact upload and summary and start and end dates. Then the WBS are the
> > milestones with tasks and deliverables. The deliverables on any milestone could be CLINs from
> > the contract."*
>
> So **the milestone IS the WBS element**, and the shape below — a node tree beside a milestone
> list, each with its own dates, costs and CLIN — was two structures describing one thing. It also
> produced two answers to the same question, which migration 227 tried to reconcile with a trigger
> before 228 removed the need for one.
>
> **Read as built:** `docs/PROJECT_BUILD_LOG.md`. Everything below stands except that wherever this
> document says `project_wbs_nodes`, the table is `project_milestones`; there is no `parent_id`
> (milestones do not nest — `sort_index` orders them); the frozen columns are `baseline_date` and
> `baseline_cost`, and the current plan is `starts_on` / `forecast_date` / `planned_cost`.
>
> One thing did NOT survive the collapse and had to be restored: the node carried a frozen
> `baseline_cost` and the milestone did not, so migration 229 added it. Without it, cost variance
> subtracted `planned_cost` from itself and read as a project permanently on budget.

---

## Why segregated rather than extended

Three places the proposal spine's shapes would actively fight this, each verified in the code:

**`tasks` is a gate ledger, not a work ledger.** A row exists to *park a workflow instance* and
resume it on completion. A delivery task has duration, percent-complete and slack, and it does **not**
block an engine. Reusing `tasks` would make every schedule line a HITL gate holding an instance open.

**`guardrail_config` is sequential stage-gates** (purchase → close → +30d). CLIN periods of
performance **overlap** — 0002 can run concurrent with 0001 and outlast it. A different temporal
model, not a larger one.

**`Step.depends_on` is execution order, not schedule dependency.** It means "run after", with no lag
and no FS/SS/FF/SF distinction. Conflating them makes "runs after" and "scheduled after" one field,
and they diverge the first time a task has a five-day lag.

The house pattern supports segregation: the opportunity-card spine *replaced* Spotlight/Pipeline
rather than extending it, and the legacy tables were dropped in mig 125 once nothing read them.

---

## The central design decision

**Where does the plan live — tables, or a canvas document?**

The canvas system is genuinely attractive here: it brings versioning, undo, autosave, restore, and
`.xlsx` export for free, and a WBS *is* a structured grid.

**Decision: tables are the source of truth; `workplan` is an editing surface over them.**

Reasoning. Four things this capability must do are SQL operations, and none of them can be done
against a JSONB canvas blob without projecting it back into tables anyway:

- **Rollup** — WBS cost and schedule aggregating to CLIN
- **RLS** — per-row tenant isolation
- **Assignment** — intra-tenant scoping to named employees
- **Rebaseline** — comparing a current set against an immutable baseline set

What the canvas contributes is the **interaction model** — the grid, cell editing, `ActOnSelection`
verbs, the overlay layer — and that is the valuable half. So: a new `workplan` canvas format whose
cells are bound to `project_wbs_nodes` rows rather than to a document blob.

**The honest cost of this choice:** the plan does not get `canvas_versions` history for free. Baseline
and audit must therefore be explicit in tables — which is what `process_instance_transitions` already
does for workflow instances, so the pattern exists.

---

## Schema

Every table: `tenant_id uuid NOT NULL`, **force-RLS and a `tenant_isolation` policy applied in the
same migration that creates it.** Migrations 184, 212 and 213 exist because tables shipped without
it and had to be retrofitted; that is not repeated here.

### Anchor — the uploaded artifacts

```sql
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  contract_id     uuid REFERENCES contracts(id),      -- soft link, NOT the anchor
  name            text NOT NULL,
  status          text NOT NULL DEFAULT 'planning',   -- planning|active|closing|closed
  baselined_at    timestamptz,                        -- null until the baseline is set
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_source_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind            text NOT NULL,     -- 'executed_contract' | 'submitted_proposal'
  storage_key     text NOT NULL,     -- via lib/storage driver seam
  filename        text NOT NULL,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  uploaded_at     timestamptz NOT NULL DEFAULT now()
);
```

**The uploaded file is the anchor, even when we authored the proposal.** What lives in
`proposals`/`proposal_sections` is a working copy that stayed editable after submission. A deliverable
tracing to *our* canvas traces to something that can still change; one tracing to the uploaded PDF
traces to what was actually signed. `contract_id` is a convenience link for navigation and is
explicitly **not** the source of truth.

This is the ingest-provenance doctrine applied one domain over: *a value the product did not read
from the source must never look like one it did.*

### CLIN → WBS

```sql
CREATE TABLE project_clins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_number     text NOT NULL,          -- '0001', '0002AA'
  title           text NOT NULL,
  contract_type   text,                   -- FFP | CPFF | T&M | …
  pop_start       date,
  pop_end         date,
  funded_amount   numeric(14,2),
  sort_index      integer NOT NULL DEFAULT 0,
  UNIQUE (project_id, clin_number)
);

CREATE TABLE project_wbs_nodes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,
  parent_id       uuid REFERENCES project_wbs_nodes(id) ON DELETE CASCADE,
  code            text NOT NULL,          -- '1.2.3'
  title           text NOT NULL,
  -- BASELINE: written once when the project is baselined, never updated
  baseline_start  date,
  baseline_end    date,
  baseline_cost   numeric(14,2),
  -- CURRENT: the live plan, freely editable
  planned_start   date,
  planned_end     date,
  planned_cost    numeric(14,2),
  actual_cost     numeric(14,2) NOT NULL DEFAULT 0,
  sort_index      integer NOT NULL DEFAULT 0
);
```

**`sort_index` is an integer, and nothing sorts by `code` as a string.** `1.10` sorts before `1.2`
lexically. This is exactly the bug mig 143 fixed for `proposal_sections.section_number`, and it is
worth not repeating.

**Baseline columns are written once.** Rebaseline is an explicit, audited act that supersedes the
current set — it does **not** overwrite baseline. Variance only means something if you still hold what
you promised; a rebaseline that overwrites destroys the ability to say "fourteen days late against
baseline" forever.

### Milestones and deliverables

```sql
CREATE TABLE project_milestones (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  clin_id         uuid REFERENCES project_clins(id) ON DELETE SET NULL,
  wbs_node_id     uuid REFERENCES project_wbs_nodes(id) ON DELETE SET NULL,
  title           text NOT NULL,
  baseline_date   date,                   -- immutable
  current_date    date,
  status          text NOT NULL DEFAULT 'pending',  -- pending|met|missed|waived
  met_at          timestamptz
);

CREATE TABLE project_deliverables (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  milestone_id    uuid NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  title           text NOT NULL,
  required_by     date,
  storage_key     text,                   -- null until uploaded
  filename        text,
  uploaded_by     uuid REFERENCES users(id),
  uploaded_at     timestamptz,
  accepted_at     timestamptz,            -- marked complete
  accepted_by     uuid REFERENCES users(id)
);
```

**Upload and acceptance are two facts.** A file present is not a deliverable met; someone has to say
so. Collapsing them would make "we uploaded a draft" and "the government accepted it"
indistinguishable — and the second is the one that closes a CLIN.

### Provenance — own table, shared vocabulary

```sql
CREATE TABLE project_provenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  target_table    text NOT NULL,    -- 'project_clins' | 'project_milestones' | …
  target_id       uuid NOT NULL,
  field           text NOT NULL,    -- 'pop_end', 'funded_amount', …
  method          text NOT NULL,    -- hitl | verified | override | pattern_match | ai | default
  source_doc_id   uuid REFERENCES project_source_documents(id),
  page            integer,
  excerpt         text,
  char_offset     integer,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

**Own table, identical vocabulary.** The proposal spine's `field_provenance` hangs off
`solicitation_compliance` with solicitation-shaped fields; contract provenance targets CLIN numbers,
PoP dates and funding. Same trust order, same "Read from source" vs red "Default — unverified" badge,
same rule that **absence is a finding** — a deferral cites where the answer lives rather than
inventing a number.

A contract extractor (Sections B/C/F/G, CLIN tables) is a **sibling of `pattern-extract.ts`, not a
reuse** — same deterministic, DB-free, cites-everything discipline, different grammar. **Phase 2.**
v1 is HITL entry *with* citation, which is already better than most tools manage.

### Assignment — the intra-tenant layer

```sql
CREATE TABLE project_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id),
  project_id      uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  assigned_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);
```

**RLS gives tenant isolation. Assignment is app-enforced, and RLS cannot express it.** This is the
same shape as `listOpenTasksForActor` filtering non-admins by assignee, and CLAUDE.md is blunt about
the risk: *"Treat that belt as load-bearing — a new reader that omits it leaks, and RLS will not catch
it."*

So the assignment predicate gets **its own boundary test**, not just a policy. Access is: assigned
tenant employees, `tenant_admin` (implicit), and descended shadow admins (already carried by
`verifyTenantAccess`, already audited via `shadow.descended`). **No collaborators or `partner_user`
in v1** — which removes cross-tenant entirely, and with it the copy-inward problem.

---

## Progress: three measures, never averaged

| measure | derived from |
|---|---|
| **Cost %** | `Σ actual_cost / Σ planned_cost` over the WBS subtree |
| **Schedule %** | elapsed against `planned_start … planned_end`, weighted by node duration |
| **Deliverables %** | `accepted` count over total, per CLIN |

**Shown side by side, never blended into one number.** Sixty percent of budget against forty percent
of schedule is the single most important thing a PM can see, and averaging them to "50%" destroys
exactly that signal. This is the same rule as *a confident zero reads as a measurement* — a number
that hides its own disagreement is worse than two numbers that argue.

Variance against baseline is a fourth reading, and it is the one that needs the immutable baseline
columns: `current_date − baseline_date` per milestone.

---

## Automation — the `project` namespace

A new event namespace mirroring the proposal build skeleton's **grammar**, not its sentences.
Proposal templates are about section drafting; these are about milestone gates.

**Registry addition required.** The namespace registry is closed
(`finder · capture · identity · proposal · library · system · tool`) and `event-contract.test.ts`
fails on anything else. Adding `project` is a deliberate three-file change: the test's `REGISTRY`,
`lib/events.ts`'s `KNOWN_NAMESPACES`, and `docs/EVENT_CONTRACT.md`.

Initial types:

```
project:project.created:single         a workspace exists, artifacts uploaded
project:baseline.set:start/end         the contractual skeleton is frozen
project:milestone.due:single           cron-driven, from the shared scheduler
project:milestone.met:end
project:deliverable.uploaded:end
project:deliverable.accepted:end
project:project.rebaselined:start/end
```

**Every one of these needs a label in `lib/event-labels.ts`**, or they reach a customer's Activity
feed as de-punctuated identifiers — which is precisely B136 ("Shadow descended") happening again in a
new namespace.

**The bridge from the proposal spine is one event.** `contract.started` already fires on
`outcome=awarded`. It raises a **ToDo** — *"Set up delivery workspace"* — and a human uploads the
executed contract and as-submitted proposal. It does **not** auto-create the project: a workspace
created before its artifacts exist would be anchored to nothing, which is the thing the whole
provenance model forbids.

Milestone nudges ride the existing `nudge_schedule` machinery and the new email interface.

---

## The `workplan` canvas format

A sixth `CanvasFormat` alongside `letter · slide_16_9 · slide_4_3 · custom · spreadsheet`, with cells
bound to `project_wbs_nodes`.

**One integration consequence, and it must be explicit.** `validateCanvasAgainstSpec` checks
fonts, pages, slides and per-section page budgets across *all* canvas types, and `estimatePageCount`
delegates to `paginate()`. **A workplan has no pages.** The floor must exempt `workplan` **with the
reason stated in code** — not silently skip it. A check that quietly does nothing is how
`/admin/storage` shipped a red error banner past every lens (B131).

`.xlsx` export comes largely free from the existing sheet exporter, which is the pragmatic reason a
grid-shaped surface is the right call.

---

## Build order

1. **Schema + RLS + the assignment boundary test.** Nothing renders yet; isolation is provable first.
2. **Project creation, artifact upload, CLIN entry with provenance.** The anchor, before anything
   depends on it.
3. **WBS tables + the `workplan` canvas format + the floor exemption.**
4. **Baseline set / rebaseline**, with baseline immutability enforced by a test that tries to
   overwrite it and expects refusal.
5. **Milestones + deliverables + acceptance.**
6. **The `project` namespace, its templates, labels, and the `contract.started` → ToDo bridge.**
7. **Rollups and the three measures.**

Steps 1–2 are the ones worth being slow about. Everything after them is additive, and step 4's test
is the one that protects the only number in this design that cannot be recomputed after the fact.

---

## Explicitly not in v1

- **Collaborators / subcontractors.** Decided. Removes cross-tenant entirely.
- **Contract auto-extraction.** Phase 2 — HITL entry with citation first.
- **Critical path / float / resource levelling.** "Simple but highly effective." Earned value beyond
  the three measures above is a different product.
- **FS/SS/FF/SF dependency types with lag.** v1 has parent/child rollup and dates. Adding typed
  predecessors later is additive; guessing at them now is not.
- **Invoicing against CLIN funding.** The `funded_amount` column exists so this is possible later.
  Nothing in v1 touches money movement.
