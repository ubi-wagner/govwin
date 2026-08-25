# Capability reconciliation — 2026-08-25

**What has been built and never surfaced?**

Every other instrument in this repo asks whether what the product does, it does *correctly*. The four
lenses drive pages that exist, the contract lens grades routes something calls, the rulers measure
artifacts we write. None of them can see a feature nobody can reach: no page renders it, so no page
sweep misses it; no route is called, so no contract lens grades it; no test asserts it, because
nobody writes a test for something with no way in.

It only appears when you put the two inventories side by side. That is what
`frontend/scripts/reconcile-capability.mjs` does — five joins between something the system HAS and
something the UI USES — run against the image corpus captured in `docs/ui-atlas/`, `docs/ui-states/`
and `docs/ui-canvas/`, which is what turned two of the joins from a list of paths into a proven
customer-facing defect.

```
cd frontend && node scripts/reconcile-capability.mjs          # full report
node scripts/reconcile-capability.mjs --check                 # self-test the joins only
node scripts/verify-surfaced-capability.mjs                   # photograph the two things it surfaced
```

---

## The headline

Of 250 API routes, **8 had no way in**. Two of those were real, customer-visible capability with a
working implementation and data behind it:

| Finding | What existed | What the customer saw |
|---|---|---|
| **Purchase history named nothing** | `/api/portal/[slug]/purchases` LEFT JOINs `proposals` + `opportunities` and returns `proposal_title` / `opportunity_title` | Three rows reading `Proposal Portal (Phase I) · $0.00 · Completed`, two on the same date, indistinguishable |
| **Page version history was invisible** | `getVersions()` + `GET …/pages/[pageKey]/versions` return the full publish history | The editor could only ever say "Live v7 · Draft v8" |

Both are fixed and proven live (`docs/ui-surfaced/`). A third finding — **thirteen event types
reaching a customer's Activity feed as internal vocabulary**, most starkly "Shadow descended" for an
RFP administrator entering their account — is fixed in `lib/event-labels.ts`.

The remaining six unsurfaced routes are dispositioned below. **None of them wants a button.**

---

## 1 · API routes ↔ UI callers

`250 routes · 209 called · 8 external · 19 duplicated · 5 second door · 8 unsurfaced`

The first draft of this join had two buckets, called and uncalled, and it was useless: it reported
most of the API as unreachable. Getting to a trustworthy answer took **five** categories, four of
which were discovered by a self-test failing or by reading the output and disbelieving it.

- **called** — a UI fetch, `<a href>`, or any API-shaped literal names it.
- **external** — a webhook, scheduler, crawler, or the agent tool adapter calls it. Annotated with
  the reason, never silently dropped, so the count stays honest about what was measured.
- **duplicated** — a server page renders the same data. Not unsurfaced: served *twice*, by two
  implementations that can drift on filters, ordering, RLS scoping and response shape.
- **second door** — uncalled, but the capability is reachable through another route that shares its
  domain function. `POST …/rfp-curation/[solId]/complete-buildout` has no caller; `completeBuildOut()`
  runs every time the provisioning cockpit hits `…/provisioning/[portalId]/release`.
- **UNSURFACED** — nothing calls it and no page covers it.

### The eight, dispositioned

| Route | Disposition |
|---|---|
| `GET /api/portal/[slug]/purchases` | **FIXED** — titles now rendered. See below. |
| `GET /api/admin/site/pages/[pageKey]/versions` | **FIXED** — history now shown in the editor. |
| `POST /api/admin/opportunities/[oppId]/publish` | Manual admin override for close/reopen/award re-fan. The normal path is automatic on curation push, and `/lifecycle` (which the UI *does* call) fans out on every stage transition. No button needed. |
| `GET/POST /api/admin/sbir-data/ingest` | Real CSV ingest of SBIR award data, `maxDuration = 300`. No UI, no caller anywhere. A genuine admin capability behind curl — worth a button *if* the data is still wanted; not built on spec. |
| `POST /api/consent` | Writes `consent_records`. Zero rows, no UI, no flow that collects consent. A product decision, not a wiring gap. |
| `GET /api/content/[slug]` | Reads `cms_content` — the **legacy** store CLAUDE.md documents as a read-fallback. Superseded by `content_pages`; a stale-source candidate, not missing capability. |
| `GET/POST /api/events` | Its own header calls it "polling-based V1". Superseded by the notification spine. |
| `POST …/proposals/[p]/ai/draft` | **Dead, not unsurfaced.** It emits `proposal.draft_requested`; `section_drafter` handles `proposal.section.draft_requested`. Nothing consumes what it emits, so calling it would draft nothing. Do not build a button for this. |

---

## 2 · tables with rows ↔ SQL that reads them

`84 tables with rows · 4 unreferenced`

Nothing actionable, which is itself the finding:

- `_migration_history` (213) — migration bookkeeping, read by `migrate.mjs` outside the scan scope.
- `source_health` (3) — **deliberately** not read; the decision and its reasoning are already written
  into `app/admin/scouts/page.tsx` (bug log B53).
- `rate_limit_state` (3) — a stub. `lib/rate-limit.ts` mentions it only as a future migration target
  ("For multi-container: migrate to `rate_limit_state` table or Redis"); the live limiter is
  in-memory. Three stale rows.
- `deploy_baseline` (2) — no reader at all.

---

## 3 · agent archetypes ↔ an invocation path

`36 archetypes · 21 have run on this box · 0 with no workflow path`

**Zero archetypes are unreachable.** Every one of the 36 appears in a workflow template, so each has
a way to start. Fifteen have not run *in this sandbox*, which is a statement about what this box has
exercised, not about capability — `section_drafter` is in that list and CLAUDE.md correctly calls it
live.

---

## 4 · workflow templates ↔ a UI reference

`22 templates · 11 have run · 0 invisible`

**This join originally reported 13 of 22 as never displayed anywhere, seven of which had
demonstrably run.** All thirteen were phantom. `/admin/workflows` renders the whole roster as DAGs
from `fetch('/api/admin/workflows/templates')` — a dynamically-enumerated list contains no template
names in source *by construction*, so a source-literal scan is structurally guaranteed to report
every entry as invisible.

The join now looks for the enumerator first. The same correction applies to the `/admin/agents`
archetype roster.

---

## 5 · events emitted ↔ events a person can read

`46 types have reached a customer's feed · 13 arrived as internal vocabulary`

`describeEvent()` never drops an unrecognised type — it de-punctuates the raw identifier. So a
missing label never *looks* like a bug: the feed is populated, the words are English, and only
someone holding the emit list next to the label map can tell which lines were written for a person
and which are a machine identifier with the punctuation taken out.

The captured Activity feed shows both kinds side by side — "Document atomized into library" (a
written label) next to "Document exported" (the fallback).

Scoping matters here, and the first version got it wrong twice:

1. Comparing *every* emitted type against the map reported **194 of 243** unlabelled. That number is
   real and means nothing — the map's own comment scopes it to "the customer-relevant taxonomy", so
   every admin-facing type is unlabelled by design. It also swept up `widget.frobnicated`, a fixture.
2. Scoping to types with a real `tenant_id` gave 29 — still wrong, because `describeEvent` answers
   some namespaces *before* consulting the map (every `tool` event renders as "AI tool
   started/completed", so `memory.stored`'s 50 tenant rows were never unlabelled at all).

Correctly scoped: **13**, of which the worst leak internal terms into a customer's own audit trail.
`shadow.descended` is the one that matters — the emit site's comment says the event "belongs to the
customer's audit trail", and it was telling them *a shadow descended*. All 13 now have labels;
`__tests__/event-label-jargon.test.ts` asserts the property (not the fallback) rather than the
strings.

The 12 that remain read acceptably as English ("Document exported", "Task assigned", "Amendment
flagged"). Those are the fallback working as designed, not defects.

---

## What was fixed

### Purchase history names the work

`app/portal/[slug]/billing/page.tsx` and `…/manage/page.tsx` each ran their own bare
`SELECT id, product_type, amount_cents, status, created_at, opportunity_id` and fed the same
`BillingPanel`, which rendered Product / Amount / Status / Date. Three purchases, three identical
rows — visible in `docs/ui-atlas/tenant__portal-tenantSlug-billing.jpg`, captured before any of this
started.

Both queries now carry the joins **copied from `/api/portal/[slug]/purchases`**, the route that had
always computed them, rather than rewritten — so the three implementations cannot drift on scoping
or ordering. The panel renders the proposal title, falling back to the opportunity title (a comp-code
purchase creates the `purchases` row before the portal is provisioned, so `proposal_id` is null and
the opportunity is the only thing that can name it), and renders nothing when a purchase bought no
particular thing.

After: `DoW 2026 STTR — Direct to Phase II: Autonomous Large-Scale Concrete Additive Manufacturing`
and `DoW 2026 SBIR — Navy Phase I: Additive Construction for Expeditionary Basing` — the two
same-day rows, now distinguishable (`docs/ui-surfaced/billing-purchase-history.jpg`).

### The page editor shows its history

`content_pages` stores every version; `getVersions()` returns them newest-first; the route serves
them. Nothing called it, so an editor about to overwrite v8 had no way to see that v6 was live for a
month or who published v4. Now a collapsed **Show version history** disclosure, fetched on first open
(`docs/ui-surfaced/admin-site-version-history.jpg` — v3 active, v2 and v1 archived, with notes and
authors).

---

## What this instrument got wrong, and how

Every one of these produced a confident, wrong finding before being caught. They are recorded because
the next person to extend this join will reach for the same shortcuts.

| The shortcut | What it reported | Why it was wrong |
|---|---|---|
| Compare route paths to `fetch()` arguments | most of the API uncalled | `/api/x` vs `` `/api/${a}/x` `` — both sides need normalising |
| Only scan `fetch()` **arguments** | export, `/api/partner/exit`, every download unreachable | a URL can be a const, an `<a href>`, or a variable |
| Split the URL on a literal `?` | the pin/unpin buttons unreachable | `` `…/pin${qs}` `` has no literal `?` |
| Scan `.tsx` only | `/api/admin/architecture/*` unreachable | `public/architecture/explorer.html` is a real shipped surface |
| Skip `lib/` | `/admin/site/content/[id]` unreachable | ToDo deep-links are built in `lib/tasks/completers.ts` |
| …then scan all of `lib/` | many gated routes read as surfaced | `lib/rbac.ts` names paths in order to **deny** them |
| Require raw `sql` in the mirror page | four CMS editor routes unreachable | those pages read through `getDocument()` / `getPage()` |
| Match any shared import | the vault **download** "duplicated by" a page | they share `isValidUUID` — a validator is not an answer |
| …so require the symbol be async | still matched | `resolveVaultAccess` is an async **authorization** resolver |
| Let a page render "duplicate" a POST | two mutations explained away | a page render cannot stand in for a mutation |
| Require an API literal in the file | the vault download link and "Harvest → library" button unreachable | `nook-detail.tsx` takes `apiBase` as a **prop** — no literal exists in the file |
| Ask "is the name in the source" | 13 of 22 workflow templates invisible | the roster is **fetched**; a dynamic list has no names in source, by construction |
| Compare all events to the label map | 194 of 243 unlabelled | the map is scoped to the customer taxonomy on purpose |
| …then scope to tenant events | 29 unlabelled | `describeEvent` answers whole namespaces before the map |
| `try { … } catch { return null }` on a file read | every route non-duplicated | a silent catch turns a broken lookup into a confident negative |

Two operational traps also recurred, both already documented in the repo and both hit anyway:

- **A stale server.** A `next-server` from a previous drive still held :3000, so the first
  verification run measured the *old* build and reported the new feature missing. Third time this
  class has bitten in this sweep. The verification script now prints the server start time next to
  the build time.
- **A wrong credential reads as a broken feature.** The admin lane failed with `error=invalid` and
  the harness reported "the editor offers no version-history control." The account is
  `eric@rfppipeline.com`, not `admin@rfppipeline.com`.

---

## Self-tests

The join is a claim, so it checks itself against sixteen hand-verified answers before printing a
line of verdict. Six of those exist because the join was wrong in exactly that way first. Any
failure prints `the reconciliation below is not trustworthy`.

Red-first was run for each: the two false-positive classes fixed at the start of this pass were shown
failing on the unfixed instrument before the fix, and the 21 new product tests were run against the
pre-fix product code (20 failed, 1 passed — the "still falls back" guard, correctly) before being run
green on the fixed build.

## Known limits

- **Route granularity, not method.** A route with `GET` and `POST` is classified as one thing. A
  surfaced GET can therefore hide an unsurfaced POST on the same path.
- **Tail matching is weaker evidence.** Three routes are cleared by matching the part of the URL
  after a prop-supplied base. They are listed separately in the report so a reader can disagree.
- **`everRan` describes this box.** An archetype or template that has not run here has not been shown
  to be unreachable — only unexercised.
- **A shared domain function is a claim to check.** "Second door" is inferred from a shared import;
  one entry (`proposals/create`) shares a side-effect rather than its main job.
