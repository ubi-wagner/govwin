# Infrastructure — what to keep, what to change, and what not to touch

**Measured 2026-08-29** against the sandbox at migration head 237.
**Framing:** this is a pre-launch product with a **37 MB** database and no paying customers. The right
infrastructure at this stage is the one that **minimises the number of things that can be wrong** —
not the one that would scale to a thousand tenants. Advice below is sized accordingly.

---

## 0 · The short version

| | |
|---|---|
| **Keep unchanged** | two-layer RLS · the forward-only bridge *pattern* · migrations-in-deployment · the verification apparatus · one canvas model · the event bracket spine |
| **Change** | **collapse `cms-postgres` into the main database** — its boundary no longer means anything |
| **Fix** | the **12 TS↔Python logic mirrors**, starting with the two that already have a known divergence risk |
| **Watch** | 475 indexes / 135 tables, none built concurrently · 43 unexercised tables · 5 event-emit mechanisms |
| **Do not touch** | the three-service split, the storage model, the workflow engine |

---

## 1 · What is structurally right, and should not be relitigated

Stated first because most reviews only list problems, and that misrepresents a codebase.

**Two-layer RLS.** The app runs as `NOBYPASSRLS govtech_app` with per-request `SET app.tenant_id`, 56
FORCE-RLS tables, and the sandbox emulates production exactly. This is genuinely well done — the
isolation is *proven* rather than asserted, including the hardest case (a raw ANN vector search with
no app-layer `WHERE` still returns only in-tenant neighbours). Keep it exactly as is.

**Migrations inside the deployment, failing closed.** Frontend entrypoint under `set -e`, CRM
refusing to boot on an unmigrated schema. Verified to rebuild from zero at head 237 — 237 applied, 0
skipped, coming up with 56 FORCE-RLS tables, 115 policies and 546 grants, all migration-defined.
Better than most production systems of this age.

**The forward-only bridge as a pattern.** Copy-inward, never reference, per-tenant mirror. The flaw
found in `PIPELINE_FRONT_TO_BACK.md` is that the mirror is *thin*, not that mirroring is wrong. Do not
replace the pattern to fix the payload.

**The verification apparatus.** Five lenses, 41 branch drives, the UI atlas and catalog, the
capability reconciler, the coherence audit, the ruler harnesses. This is the product's real moat and
the reason this session could measure claims instead of guessing at them. It is infrastructure, and
it is the best-maintained part of the system.

**One canvas model, three surfaces.** Correct, and the compliance floor delegating to one calibrated
`paginate()` so the editor gauge and the export gate cannot disagree is exactly right.

---

## 2 · The finding: the second database no longer has a boundary

### What `cms-postgres` holds

23 tables across 12 migrations:

| Group | Tables | Status |
|---|---|---|
| **Content** | `cms_config` `cms_events` `cms_generations` `cms_media` `cms_posts` `cms_reviews` | **superseded** — front-facing content moved to the main DB's `content_pages` |
| **Email** | `email_accounts` `email_campaigns` `email_engagement` `email_outbox` `email_queue` `email_sends` `email_templates` `email_threads` `sender_identities` `drip_*` `campaign_execution_log` | live |
| **Social** | `social_accounts` `social_posts` | live |
| **Other** | `admin_todos` · `_crm_metadata` · `deploy_baseline` | `admin_todos` duplicates the main DB's `tasks` |

### Why the boundary stopped meaning anything

The split was drawn for **content**. Content moved out. What remains is email and social — and
**email now straddles the boundary**:

```
mig 215 created  email_send_ledger + email_suppressions   in the MAIN database
cms-postgres holds  email_queue · email_outbox · email_sends · email_engagement

  → the CRM mailer writes the ledger in ONE database and its queue in ANOTHER
  → which is exactly why rfp-crm needs SHARED_DATABASE_URL at all
```

**One send now spans two databases.** The seam was built as *"EVERY outbound email goes through ONE
seam"* — and it does, at the code layer — but underneath it, the reserve-then-dispatch contract that
makes a crash mid-send *visible* is split across two connections with no shared transaction.

> A database boundary buys isolation. This one no longer isolates anything: content left, email
> straddles it, `admin_todos` duplicates a main-DB table, and `system_events` is deliberately shared.
> **It is now purely cost** — two migration chains, two backup regimes, two connection pools, and a
> bridge that can lag.

### Recommendation: collapse the database, keep the service

**Keep `rfp-crm` as a service.** It genuinely needs to be a long-running Python process: the Gmail
inbox sweep with incremental `history_id` sync, the drip engine, the social poster. That is real work
that does not belong in a request-response frontend.

**Move its tables into the main database**, namespaced (`crm_*` or a `crm` schema). Then:

- the email seam becomes **one transaction** — reserve and dispatch in the same connection
- `system_events` stops being a cross-database bridge and becomes a plain table
- one migration chain, one backup, one restore drill
- `admin_todos` can be reconciled against `tasks` rather than shadowing it
- the superseded `cms_*` content tables can be dropped in the same pass — with the drop discipline
  the repo already has: *superseded-with-a-successor AND zero live code refs*

**Cost:** one migration, a config change, and a careful cutover. **Do it before launch**, not after —
this is the cheapest it will ever be, and it removes a whole class of "which database is this in"
from every future change.

---

## 3 · The 12 TS↔Python logic mirrors

Twelve Python modules name a TypeScript counterpart they must stay consistent with:

```
fabric.py            → lib/ai/agent-guard.ts, admin/agents/usage/route.ts   (model pricing)
rescore.py           → lib/bucket-ranking.ts                                (the scorer)
events.py            → lib/events.ts                                        (namespaces)
errors.py            → lib/errors.ts
markdown_to_canvas   → lib/types/canvas-document.ts                         (the canvas model)
project_manager.py   → lib/projects/rollup.ts
status_narrator.py   → lib/projects/status-report.ts, narrative-fidelity.ts
section_drafter.py   → lib/atoms.ts
rfp_ingest_manager   → lib/ingest/provenance-audit.ts
topic_expander.py    → lib/source-url.ts
base.py              → lib/events.ts
```

**This is the largest structural liability in the codebase** — a comment saying *"keep in sync"* is
not a mechanism, and this session found a live instance: `scoreCard` and `rescore.py::_keyword_hit`
faithfully mirror each other **including the abstention bug**, four factors zeroing where one abstains.

Three tiers of response, and they are not the same:

| Tier | Mirrors | Action |
|---|---|---|
| **Must stay mirrored** | the scorer, model pricing, event namespaces | **parity tests** — a fixture set run through both, asserting identical output. M1 is the first. |
| **Should consolidate** | canvas model, errors, source-url | one side owns it; the other calls or is generated |
| **Incidental** | archetype prompts referencing a TS module for context | leave alone — they are documentation, not duplication |

The event namespace registry is the model to copy: it already lives in three runtimes *and*
`__tests__/event-namespace-registry.test.ts` reconciles all three plus the migration SQL and the
docs. **That is what "keep in sync" looks like when it is a mechanism.** Every must-stay mirror
deserves the same.

---

## 4 · Watch items — real, not yet urgent

**475 indexes across 135 tables**, none created `CONCURRENTLY` (impossible today — `migrate.mjs`
wraps each file in a transaction). At 37 MB every build is instant. On a production table with real
volume each one is a write outage for the length of the build. The remedy is already scoped in
`docs/OPERATING_MODEL.md` §6 — the `-- migrate:no-transaction` marker — and it should land **before**
the first table gets large, not after.

**43 of 135 tables hold no rows** — 32%. Almost none are dead; they are recently built and
unexercised: the whole Projects sub-tree, the scout spine, the email ledger, the ingest studio, the
SBIR data tables. That is not a cleanup task, it is a **coverage** one: a third of the schema's
constraints, cascades, RLS policies and indexes have never run against a row.

> Three of those empty tables — `solicitation_documents`, `solicitation_annotations`,
> `scout_findings` — are exactly what Track B of the front-to-back plan is built on. **A1 (shred a
> real BAA) is the task that starts fixing this**, and it is already first in the plan.

**Five event-emit mechanisms, two of which live in the database** (`pipeline_schedules.source`, the
`process_templates.trigger_key` overlay). Documented, audited, and a known trap for source-only
scans. Not a problem — a thing to remember, and `audit-automation-spine.mjs` already remembers it.

**`admin_todos` vs `tasks`.** Two todo tables in two databases. Resolve during the collapse in §2.

---

## 5 · What I would not change

**The three-service split.** Frontend (request/response), pipeline (long-running workers and agents),
rfp-crm (Gmail long-runner and campaign engine). Each has a genuine reason to be its own process, and
the boundaries follow runtime characteristics rather than domain fashion. Collapsing them would trade
clarity for nothing.

**Storage.** One platform-provisioned bucket per environment, credentials injected, copy-inward on
pin. Correct, and §8c of the staging doc explains why the shared display name is expected rather than
alarming.

**The workflow engine.** Declarative trigger+step templates with two stateless reconcilers, 29
templates, 0 dead triggers and 0 dead waits by audit. It is doing real work and doing it plainly.

**The agent fabric's safety contract.** Tenant-bound, advisory → guardrail → land-or-review, injection
fenced, runaway bounds, safe-skip. Proven this session: 11/11 guardrail cases both directions, and a
budget refusal stopping a build cleanly at the first section rather than fourteen times over.

**Do not add:** a queue broker, a cache layer, a search cluster, container orchestration. At 37 MB
with a 10,000-email/month ceiling, every one of those adds a failure mode to solve a problem that does
not exist yet. Postgres is doing all of it adequately and `pg_trgm`/`tsvector` will cover search when
Track B needs it.

---

## 6 · Sequencing against the existing plan

Infrastructure work should ride alongside the front-to-back tracks, not displace them.

| When | Item | Why then |
|---|---|---|
| **Before staging is finalised** | **collapse `cms-postgres`** (§2) | staging is being built now; building it twice is the waste |
| **Before staging is finalised** | `-- migrate:no-transaction` marker | it is a migration-runner change, and the runner is about to run against a new database |
| **With Track A** | parity tests for the three must-stay mirrors (§3) | M1 is already A2; extend it to pricing and namespaces |
| **With Track A/B** | exercise the empty tables (§4) | A1 does this for three of them as a side effect |
| **After production volume exists** | index audit | meaningless before there are rows to lock |
| **Never** | broker · cache · search cluster | (§5) |

---

## 7 · What this review has not covered

- **Cost and capacity modelling** beyond the AI spend already measured. Railway plan sizing, database
  connection limits under real concurrency, and R2 egress are unexamined.
- **Backup and restore.** I confirmed the schema rebuilds from migrations; I did **not** confirm that
  a production *data* restore has ever been rehearsed. That is a gap worth closing before launch, and
  it is exactly the kind of thing that is fine until the day it is not.
- **Security posture beyond RLS.** Rate limiting, secret rotation cadence, dependency-vulnerability
  scanning and the auth surface were not examined here; `docs/SECURITY_AND_SAFETY.md` is the standing
  document and this review does not supersede it.
- **The CRM's forward scope.** Its content role is superseded and its CRM role is *"still to be built
  out"*. What that service is *for* is a product question, and answering it may change §2's shape —
  though not its conclusion, since the database boundary is wrong regardless of what the service
  becomes.
