# SCOUTING SPINE — EXECUTION TODO (Agent Work-Breakdown)

> Owner: Eric · Driver: Claude (orchestrator) · Branch: `claude/nice-hamilton-kBqtD`
> Status legend: ⬜ TODO · 🟦 IN PROGRESS · ✅ DONE · ⛔ BLOCKED
> This document is the source of truth for the build. The orchestrator updates task
> status + notes here as each agent reports.

## 0. Goal & spine

Turn the scouting → curation → delivery loop into one solid end-to-end spine:

```
SENSE                         DETECT            ALERT                 CURATE                 PUSH                       DELIVER
ingesters (SAM/SBIR/Grants/   one rollup        notification +        existing lifecycle     activate + score ALL       tenant_pipeline_items
DSIP/AFWERX/xTech/NSF)         signal per run    admin triage ToDo     (claim→…→approve)      topics under a sol         spotlights + tenant notify
scout (region annotations)    finder:opportun-                                                                          
paste / topic-URL expansion   ities.detected
        │                          │                  │                    │                      │                         │
        └──────────────────────────┴──────────────────┴────────────────────┴──────────────────────┴─────────────────────────┘
                          one event contract · one ToDo ledger (tasks) · one scoring path · no TS/Py forks
```

Verified current state (2026-06-14): the spine EXISTS and is largely wired
(4 real ingesters, paste-import, Source Scout with the field-bug fixed, full
curation state machine incl. shred routing, WorkflowManager + events + CMS email
+ `tasks` ledger + HITL resume). The holes are at the two ends + the alerting
nerve. The 4 milestones below close them, highest-leverage first.

---

## 1. Global conventions (apply to EVERY task)

- **Branch / commits:** all work on `claude/nice-hamilton-kBqtD`; one commit per task
  (signed), clear message, pushed. Never push to `main`.
- **File ownership = non-overlap rule:** every task lists the EXACT files it may
  create/edit (its *write-set*). Tasks in the same **parallel group** have
  **disjoint write-sets** — they can run simultaneously without collision. A task
  must not touch any file outside its write-set; cross-task needs go through the
  shared **contracts** defined in each milestone.
- **Migration numbers (reserved to avoid collisions):** M2 → `065`, M3 → `066`,
  M4 → `067`+. Latest applied is `064`. A task adding a migration uses its
  reserved number.
- **Verification harness (per area):**
  - Frontend: `cd frontend && npx tsc --noEmit` (zero errors) + `jest` for any
    `__tests__/*` the task adds/touches.
  - Pipeline: `pytest` for the package(s) the task touches (stub mode:
    `USE_STUB_DATA=true`, no live API/keys).
  - DB/migrations: apply + assert against local pg16 (`postgresql://tester:testpass@127.0.0.1:5432/main_test`;
    start with `sudo pg_ctlcluster --skip-systemctl-redirect 16 main start`).
  - Contracts/events: a field-name + namespace check (see EVENT_CONTRACT_V3).
- **Live-backend caution:** push/scoring/notify are customer-facing. Verify against
  stub + local DB ONLY; never hit prod. Gate each milestone before the next.
- **Standard agent report (every task MUST return this — how the orchestrator
  monitors):**
  1. One-line outcome (DONE / BLOCKED + why).
  2. Files created/modified — must be a subset of the task's write-set.
  3. Tests added/changed + pasted run output (pass/fail counts).
  4. Acceptance-criteria checklist, each ✅/❌ with evidence.
  5. Contract notes (anything another task depends on) + risks.

## 2. Milestone lifecycle (the gate every milestone runs through)

For each milestone M: **A. Develop** (parallel/serial build tasks) → **B. Test**
(unit/component, per task) → **C. Document** (architecture + cliffnotes + this
file) → **D. Test** (integration / end-to-end on local pg + stub) → **E. Refine**
(fix what D found) → **GATE** (orchestrator checklist below) → next milestone.

**Gate checklist (all must pass to advance):**
- [ ] every build task reported DONE with write-set respected (no overlap touched)
- [ ] `tsc` clean (frontend) + `pytest` green (pipeline) for touched areas
- [ ] integration test for the milestone's end-to-end behavior passes on local pg/stub
- [ ] docs updated (ARCHITECTURE_V8 / CLAUDE_CLIFFNOTES / this file statuses)
- [ ] committed + pushed; no regression in `npm run build`

## 3. Monitoring & heartbeat protocol

- The orchestrator dispatches a parallel group as **background agents** (one per
  task), each handed: its write-set, the milestone contracts, acceptance criteria,
  and the standard report format.
- A **background heartbeat** runs every 5 min (`while true; do sleep 300; echo
  "[heartbeat] <milestone> — tasks <ids> in flight"; done`) so the session stays
  warm during long agent runs.
- On each agent completion notification, the orchestrator: reads ONLY the agent's
  final report, checks files-changed ⊆ write-set, re-runs the task's acceptance
  test itself, marks the task ✅/⛔ here, and (for serial tasks) releases the next.
- A milestone's serial tasks (integration test, docs) dispatch only after its
  parallel build group is all ✅ and verified.
- Heartbeat is stopped at each gate (idle) and restarted when the next group launches.

---

# MILESTONE 1 — Multi-topic output hop (KEYSTONE)  ✅ DONE (2026-06-14)

> **Status:** T1.1 push (`42b7087`), T1.2 scoring (`f41526d`), T1.3 update_topic
> (`8651aa0`) committed + pushed. T1.4 = per-topic cards already render (confirmed);
> grouping-under-parent deferred (needs `components/portal/spotlight-feed.tsx`, out of
> the task's write-set). SQL e2e on local pg: activate=4, scoring-set=3 (closed topic
> excluded), single-topic=1 (no regression); tsc clean; pipeline syntax/import OK.
> Deferred to HITL/refine: Spotlight grouping; reconcile the `finder:topic.updated`
> payload (`topicId`+`changes` vs `opportunityId`+`changedFields`).

**Why first:** until this lands, a perfectly ingested 65-topic BAA reaches **zero**
customers — `solicitation.push` activates only the primary opportunity and
`score_tenants` scores only that one. This unblocks the value of everything else.

**Contracts (both build tasks implement to these — no shared files):**
- **C1.a Activation set:** "all topics of a solicitation" = `opportunities WHERE
  solicitation_id = <sol.id>` **plus** the landing `opportunities.id =
  cs.opportunity_id` (umbrella may itself be a real opp). Push sets `is_active=true`
  on that whole set, atomically.
- **C1.b Scoring set:** `match_tenants` scores **every active** opportunity in that
  same set (one `tenant_pipeline_items` upsert per (tenant, opportunity) with
  score ≥ threshold), not just `cs.opportunity_id`.
- **C1.c Event payload:** `finder:solicitation.pushed` keeps `solicitationId` +
  `topicCount`; scoring derives the set from `solicitationId` (no need to pass IDs).

**Definition of Done:** pushing a multi-topic solicitation activates and scores all
its topics; each scored topic appears in the customer Spotlight feed; single-topic
solicitations behave exactly as before; topic metadata is editable post-creation.

### Tasks
| ID | Group | Owns (write-set) | Deps | Deliverable |
|----|-------|------------------|------|-------------|
| **T1.1** | A∥ | `frontend/lib/tools/solicitation-push.ts` | — | push activates the full activation set (C1.a) in its txn |
| **T1.2** | A∥ | `pipeline/src/workflows/actions/score_tenants.py`, `pipeline/src/workflows/on_solicitation_pushed.py` | — | scoring iterates the scoring set (C1.b); upsert per topic |
| **T1.3** | A∥ | `frontend/lib/tools/opportunity-update-topic.ts` (new), `frontend/lib/tools/registry.ts` | — | `opportunity.update_topic` tool + registration |
| **T1.4** | A∥ | `frontend/app/portal/[tenantSlug]/spotlights/page.tsx` (+ its spotlight component if separate) | — | confirm/fix per-topic Spotlight render (group topics under parent sol) |
| **T1.5** | B (serial) | `frontend/__tests__/tools-solicitation-push-topics.test.ts` (new), `pipeline/tests/test_score_tenants_topics.py` (new) | T1.1,T1.2 | unit/component tests for activation + scoring sets |
| **T1.6** | D (serial) | `frontend/__tests__/scenarios-multitopic-delivery.test.ts` (new) **or** a pg-harness script | T1.1–T1.4 | e2e: seed sol+N topics → push → assert N active + N scored + N in spotlight |
| **T1.7** | C (serial) | `ARCHITECTURE_V8.md`, `CLAUDE_CLIFFNOTES.md`, this file | T1.1–T1.6 | document the activation/scoring contract + mark statuses |

### Task cards
- **T1.1 — push activates all topics.** In `solicitation-push.ts`, replace the
  single `UPDATE opportunities … WHERE id = primary` with an atomic update over the
  activation set (C1.a) inside the existing `sql.begin` txn; keep the status flip,
  triage audit, HITL memory, and `solicitation.pushed` event. Recompute `topicCount`
  from the activated set. **Accept:** unit test — sol with 1 primary + 3 topics →
  4 rows `is_active=true`; status→`pushed_to_pipeline`; event `topicCount=4`;
  single-topic sol still flips exactly 1. `tsc` clean.
- **T1.2 — score all topics.** In `score_tenants.py`, change the fetch (lines
  ~124-151) to load the scoring set (C1.b) and loop scoring per opportunity, upserting
  `tenant_pipeline_items` per (tenant, opportunity). Preserve the existing scoring
  math, threshold, and `scoring.completed` events; return aggregate counts.
  Confirm `on_solicitation_pushed.py` passes only `solicitationId`. **Accept:**
  `pytest` — sol with 3 active topics × 2 matching tenants → 6 upserts; closed/inactive
  topics excluded; avgScore computed.
- **T1.3 — opportunity.update_topic.** New tool mirroring `opportunity-add-topic.ts`
  conventions (zod input, role gate, tenant rules, `finder:topic.updated` event):
  update title/description/techFocusAreas/topicBranch/topicStatus/poc by opportunity
  id; register in `registry.ts`. **Accept:** `pytest`/jest tool test updates a topic
  + emits event; `tsc` clean; tool invokable via registry.
- **T1.4 — Spotlight per-topic render.** Verify the portal Spotlight reads
  `tenant_pipeline_items` and renders each topic; if topics render flat, group them
  under their parent solicitation (title + topic list). Read-only logic + presentational
  only. **Accept:** with seeded multi-topic `tenant_pipeline_items`, the page lists each
  topic under its parent; `tsc` clean.
- **T1.5 — unit tests.** As above; pure tests, no source edits outside `__tests__`/`tests`.
- **T1.6 — e2e delivery test.** pg-harness: seed solicitation + N topics + 2 tenant
  profiles → run push (frontend tool) → run `match_tenants` → assert N `is_active`,
  N×matches `tenant_pipeline_items`, Spotlight query returns them. **Accept:** script exits 0.
- **T1.7 — docs.** Add the activation/scoring contract to ARCHITECTURE_V8 §"Push →
  customer", a CLAUDE_CLIFFNOTES note ("push/scoring operate on the topic SET, not
  the primary opp"), and flip M1 statuses here.

---

# MILESTONE 2 — Detection → notify + ToDo alerting  ⬜

**Why:** scheduled ingest **silently** fills the triage queue today — no signal, no
ToDo. New finds must announce themselves (your "new solicitation + topic notification
+ subsequent admin ToDos"), and notifications must fail **loud**, not silent.

**Contracts:**
- **C2.a Detection event:** an ingest/scout run that created ≥1 new
  `curated_solicitations(status='new')` emits ONE rollup
  `finder:opportunities.detected:single` with `{ source, runId, newSolicitations,
  newTopics, sampleTitles[] }`.
- **C2.b ToDo:** the workflow creates one `tasks` row (`assignee_role='rfp_admin'`,
  `task_type='triage_new_opportunities'`, `entity_type='source'`, params=counts) +
  one notification (template `new_opportunities_to_triage`).
- **C2.c Loud notify:** a missing/å unrenderable template emits
  `system:notification.failed` + logs ERROR (never a silent return).

**Definition of Done:** an ingest run that finds new opportunities produces exactly
one admin ToDo + one email; the ToDo shows on the admin dashboard and completing it
is auditable; a misnamed template surfaces a loud error event.

### Tasks
| ID | Group | Owns (write-set) | Deps | Deliverable |
|----|-------|------------------|------|-------------|
| **T2.1** | A∥ | `pipeline/src/ingest/base.py` | — | count new triage rows per run; emit `finder:opportunities.detected` (C2.a) |
| **T2.2** | A∥ | `pipeline/src/workflows/on_opportunities_detected.py` (new), `pipeline/src/workflows/registry.py` (or equivalent template registry), `db/migrations/065_seed_detected_workflow.sql` (new) | — | workflow: detected → NOTIFY + TODO (C2.b); register + seed template-catalog row |
| **T2.3** | A∥ | `services/cms/src/templates.py`, `services/cms/src/event_listener.py` | — | add `new_opportunities_to_triage` template; make render-miss loud (C2.c) |
| **T2.4** | A∥ | `frontend/app/admin/_components/triage-todos.tsx` (new) + mount in `frontend/app/admin/rfp-curation/page.tsx`; read via `frontend/lib/tasks/tasks.ts` (add a read fn if needed) | — | admin "Open triage ToDos" panel from `tasks` |
| **T2.5** | B/D (serial) | `pipeline/tests/test_detection_alert.py` (new) | T2.1–T2.3 | unit + integration: run with new opps → 1 event → 1 ToDo + 1 notify; missing template → failed event |
| **T2.6** | C (serial) | `ARCHITECTURE_V8.md`, `docs/EVENT_CONTRACT_V3.md`, `CLAUDE_CLIFFNOTES.md`, this file | T2.1–T2.5 | document the detected→alert contract + statuses |

### Task cards
- **T2.1 — detection rollup.** In `base.py` run loop, track count of NEW
  `curated_solicitations` created this run (already auto-created per opp) + new topic
  count; after the run, if >0, emit C2.a. Do NOT change ingest/upsert behavior.
  **Accept:** `pytest` stub run creating 3 new → emits one detected event with
  newSolicitations=3; zero-new run emits none.
- **T2.2 — OnOpportunitiesDetected workflow.** New process template triggered by C2.a:
  step 1 NOTIFY (`new_opportunities_to_triage`, to_role `rfp_admin`); step 2 TODO
  (`triage_new_opportunities`). Register in the pipeline template registry; seed a
  `process_templates` row via migration `065`. **Accept:** `pytest` — emitting C2.a
  creates a process_instance that parks a TODO in `tasks` + posts
  `system:notification.requested`.
- **T2.3 — template + loud notify.** Add the email template; change
  `event_listener._handle_notification_requested` so an empty render emits
  `system:notification.failed` (payload: template, event id) + ERROR log + optional
  plaintext fallback. **Accept:** known template renders; unknown template → failed
  event (pytest on the handler).
- **T2.4 — admin ToDo panel.** Server component reading open `tasks` for
  `rfp_admin/master_admin` (status open/in_progress); render count + list with links to
  the entity; mount atop `/admin/rfp-curation`. Reuse `completeTask` path. **Accept:**
  with seeded tasks, panel lists them; `tsc` clean.
- **T2.5 — tests** (serial). Component + integration as above.
- **T2.6 — docs** (serial). Event contract entry for `finder:opportunities.detected`
  + `system:notification.failed`; statuses.

---

# MILESTONE 3 — DSIP topic-URL ingestion (sensory)  ⬜

**Why:** your headline case — paste a solicitation's topic list (or number), have the
scout **learn the URL convention** and download/ingest **all** its topics (detail +
PDFs), instead of flat paste rows. Built on `source_profiles.topic_url_pattern`
(exists, unused).

**Contracts:**
- **C3.a URL render:** `renderTopicUrl(profile.topic_url_pattern, { topicNumber,
  solicitationNumber, … })` → absolute URL; DSIP also supports its public JSON API
  (`/topics-app/api/public/topics`) filtered by solicitation.
- **C3.b Expansion job:** admin trigger enqueues `pipeline_jobs(kind='expand_topics',
  metadata={ solicitationId, sourceProfileId, topicNumbers[]|solicitationNumber })`.
- **C3.c Ingest:** the expander fetches each topic, parses detail (title, description,
  dates, POC, PDF link), and upserts via the SAME opportunity/topic shape as
  `opportunity.bulk_add_topics` (dedupe by `(solicitation_id, topic_number)`).

**Definition of Done:** from a solicitation page, "Import all topics from source" (or
paste a topic list) ingests every topic with detail; a DSIP BAA's full topic set lands
as deduped, customer-pushable topics; re-runs are idempotent.

### Tasks
| ID | Group | Owns (write-set) | Deps | Deliverable |
|----|-------|------------------|------|-------------|
| **T3.1** | A∥ | `pipeline/src/ingest/topic_expander.py` (new) | — | fetch+parse+upsert all topics for a solicitation (C3.c); reuse dsip API where source=dsip |
| **T3.2** | A∥ | `pipeline/src/ingest/dispatcher.py` | — | route `kind='expand_topics'` → topic_expander (mirror `_run_shred_job`) |
| **T3.3** | A∥ | `frontend/app/api/admin/sources/[profileId]/expand-topics/route.ts` (new) + a button in `frontend/components/rfp-curation/curation-workspace.tsx` | — | admin trigger enqueues C3.b |
| **T3.4** | A∥ | `frontend/lib/source-url.ts` (new), `db/migrations/066_seed_topic_url_patterns.sql` (new) | — | `renderTopicUrl` helper (C3.a) + seed patterns for DSIP/AFWERX/SBIR |
| **T3.5** | B/D (serial) | `pipeline/tests/test_topic_expander.py` (new) | T3.1–T3.4 | unit (stub fixture of a topic page/API) + idempotent re-run |
| **T3.6** | C (serial) | `ARCHITECTURE_V8.md`, `CLAUDE_CLIFFNOTES.md`, this file | T3.1–T3.5 | document the expansion path + statuses |

### Task cards
- **T3.1 — topic_expander.** Given a solicitation + source: if source=dsip, query the
  DSIP public API filtered to the solicitation and map topics (reuse `dsip.py` parsing
  helpers WITHOUT editing that file — import them); else render per-topic URLs (C3.a),
  fetch (plain HTTP for now; M4 adds headless), parse, and upsert each as a topic
  opportunity (C3.c). Per-topic error isolation; emit `finder:topics.expanded` rollup.
  **Accept:** `pytest` with a fixture → N topics upserted; re-run skips duplicates.
- **T3.2 — dispatcher route.** Add `elif kind == "expand_topics": await
  _run_expand_topics_job(...)` alongside shred/scout; new private runner calls
  topic_expander. **Accept:** `pytest` dispatcher routes an `expand_topics` job and
  marks it completed.
- **T3.3 — admin trigger.** API route (rfp_admin only) validates the solicitation +
  source and inserts the C3.b job; add an "Import all topics from source" button on the
  curation workspace that calls it and shows job status. **Accept:** route inserts a
  well-formed job; `tsc` clean.
- **T3.4 — url helper + seed.** `renderTopicUrl` with token substitution + tests; a
  migration seeding `topic_url_pattern` for DSIP/AFWERX/SBIR profiles. **Accept:** jest
  for the helper; migration applies on local pg and patterns are non-null.
- **T3.5/T3.6** — tests + docs (serial).

---

# MILESTONE 4 — New portals (AFWERX / xTech / NSF) + headless fetch  ⬜

**Why:** those profiles are seeded but have no ingester, and plain-HTTP can't read JS
portals — so AFWERX/xTech NOFO/RFI/RFP never auto-arrive.

**Contracts:**
- **C4.a Fetch util:** `fetch_rendered(url) -> html` (headless when needed; falls back
  to plain HTTP), one shared module; ingesters/scout call it (no duplicate fetch logic).
- **C4.b Ingester shape:** each new ingester subclasses the existing `base.py` ingester
  (run → normalize → upsert + auto triage row), with a stub-mode fixture; registered in
  `INGESTERS` + a `pipeline_schedules` seed.

**Definition of Done:** AFWERX, xTech, and NSF each ingest (stub-verified) into the
same opportunity/triage pipeline; JS-rendered pages return content; new sources flow
through Detection→Alert (M2) and Push→Deliver (M1) unchanged.

### Tasks
| ID | Group | Owns (write-set) | Deps | Deliverable |
|----|-------|------------------|------|-------------|
| **T4.1** | A (serial-first) | `pipeline/src/ingest/fetch_rendered.py` (new) | — | shared headless/plain fetch util (C4.a) |
| **T4.2** | B∥ | `pipeline/src/ingest/afwerx.py` (new) | T4.1 | AFWERX ingester (C4.b) + stub fixture |
| **T4.3** | B∥ | `pipeline/src/ingest/xtech.py` (new) | T4.1 | xTech ingester (C4.b) + stub fixture |
| **T4.4** | B∥ | `pipeline/src/ingest/nsf.py` (new) | T4.1 | NSF ingester (C4.b) + stub fixture |
| **T4.5** | C (serial) | `pipeline/src/ingest/dispatcher.py`, `db/migrations/067_seed_new_source_schedules.sql` (new) | T4.2–T4.4 | register the 3 ingesters in `INGESTERS` + seed schedules |
| **T4.6** | D (serial) | `pipeline/tests/test_new_ingesters.py` (new) | T4.1–T4.5 | each ingester (stub) yields opps + a triage row; headless util smoke test |
| **T4.7** | C (serial) | `ARCHITECTURE_V8.md`, `CLAUDE_CLIFFNOTES.md`, `RAILWAY.md` (headless dep note), this file | T4.1–T4.6 | document new sources + ops notes + statuses |

### Task cards
- **T4.1 — fetch_rendered.** One util: try plain HTTP; if the page needs JS (heuristic
  or per-profile flag) use a headless renderer (Playwright/Chromium) behind a clean
  interface + timeout; note the runtime dependency for Railway. **Accept:** `pytest`
  smoke (mock) + returns HTML for a static fixture.
- **T4.2/4.3/4.4 — ingesters.** Each subclasses `base.py`, pulls its source (API where
  available, else `fetch_rendered` + parse), normalizes to the opportunity shape,
  detects program_type/tech focus, stub mode with a small fixture. They do NOT edit
  shared files. **Accept:** `pytest` stub run → ≥1 opportunity + auto triage row each.
- **T4.5 — register + schedule.** Add the 3 classes to `INGESTERS`; migration `067`
  seeds `pipeline_schedules` (daily). **Accept:** dispatcher resolves each source;
  migration applies on local pg.
- **T4.6/T4.7** — tests + docs (serial).

---

## 4. Cross-cutting "later / nice-to-have" (not milestones; fold opportunistically)
- Collapse the TS↔Python scout fork to one canonical implementation (the field-drift
  source). Track separately; do NOT bundle into a milestone task's write-set.
- `invoke()` timeout/retry wrapper (frontend tool registry) — resilience.
- Auto-scout cron: confirm `scout_source` jobs are scheduled from `crawl_cron`
  (dispatcher has the `kind`; verify a scheduler enqueues them).

## 5. Sequencing summary
M1 (keystone) → gate → M2 (alerting) → gate → M3 (DSIP expansion) → gate → M4 (new
portals) → gate → cross-cutting. Within each milestone, Group A∥ build agents run in
parallel (disjoint write-sets), then serial test → docs. Orchestrator monitors via the
heartbeat + per-task reports, updating statuses in this file and committing per task.
