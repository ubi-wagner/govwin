# Launch Master ToDo — RFP Pipeline Portal

**Date:** 2026-06-23
**Source:** `GAP_ANALYSIS.md` · `BASELINE_FINDINGS.md` · `TEST_COVERAGE_MATRIX.md` · `ARCHITECTURE_V9.md §9,14` · `DEPRECATION_CANDIDATES.md` · 8 inventory files
**Legend:** ID format: `PIPE-NN` `FE-NN` `DATA-NN` `CMS-NN` `AGENT-NN` `TEST-NN` `CI-NN` `DOC-NN`
**Effort:** S = < half-day · M = 1–2 days · L = 3+ days

---

## P0 Launch Blockers (Cross-Area Summary)

All items in this section are **must-fix before production traffic**. They are also listed in their area sections below.

| ID | Title | Area | Effort |
|----|-------|------|--------|
| FE-01 | Fix `pdf-reader.ts` `{PDFParse}` named import bug | Frontend | S |
| PIPE-01 | Fix `lifecycle_scheduler` recursive reconnect → stack overflow | Pipeline | S |
| FE-02 | Add `sql.begin` transaction to `invite` route | Frontend | S |
| FE-03 | Add `sql.begin` transaction to `consent` route | Frontend | S |
| FE-04 | Add role floor (`tenant_user`) to `portal/profile` GET | Frontend | S |
| FE-05 | Fix `admin/sbir-data/ingest` error leak + add `ON CONFLICT` to batch insert | Frontend | S |
| FE-06 | Fix `invite` double-prefixed event type (`identity.identity.invite_accepted` → `identity.invite.accepted`) | Frontend | S |
| FE-07 | Escape ILIKE patterns in `memory-search.ts` + `library-search-atoms.ts` | Frontend | S |
| FE-08 | Add inner try/catch on all `await sql` calls (20+ routes) | Frontend | M |
| PIPE-02 | Fix `agents/learning/__init__.py` broken absolute imports | Pipeline | S |
| TEST-01 | Replace 4 empty pipeline placeholder tests with real stubs (or delete) | Testing | S |
| CI-01 | Add main-DB migration smoke-check job to `ci.yml` | CI/Infra | M |
| TEST-02 | Write `stripe/webhook` HMAC + `checkout.session.completed` transaction test | Testing | M |
| TEST-03 | Write `auth/[...nextauth]` authorize() DB path test | Testing | M |
| TEST-04 | Write `portal/proposals/create` 6-table sql.begin transaction test | Testing | M |

---

## Pipeline

### P0

- [ ] **[PIPE-01]** Fix `lifecycle_scheduler` recursive reconnect — replace recursive callback with iterative or bounded-retry loop · `pipeline/src/lifecycle_scheduler.py` · P0 · S · acceptance: sustained DB-unavailable simulation does not stack-overflow; process survives and resumes on DB return · source: BASELINE_FINDINGS §3 / PIPELINE_CORE inventory

- [ ] **[PIPE-02]** Fix `agents/learning/__init__.py` broken absolute imports — change `from pipeline.src.agents.learning.X import X` to relative imports `from .X import X` · `pipeline/src/agents/learning/__init__.py` · P0 · S · acceptance: `python -c "from pipeline.src.agents.learning import *"` succeeds; no ImportError in any test · source: BASELINE_FINDINGS §3

### P1

- [ ] **[PIPE-03]** Fix double-emit of `finder:topics.expanded` — remove the duplicate emit from `dispatcher.py::_run_expand_topics_job`; keep emit in `topic_expander.py::_emit_topics_expanded` only · `pipeline/src/ingest/topic_expander.py`, `pipeline/src/ingest/dispatcher.py` · P1 · S · acceptance: a single expand_topics job produces exactly one `finder:topics.expanded` event in `system_events`; regression test added · source: BASELINE_FINDINGS §3

- [ ] **[PIPE-04]** Fix `shredder/extractor.py` sync boto3 in async — wrap `boto3` S3 call with `asyncio.get_event_loop().run_in_executor(None, ...)` or replace with `aioboto3` · `pipeline/src/shredder/extractor.py` · P1 · M · acceptance: `extract_text_from_s3_key()` does not block event loop; other asyncio tasks (dispatcher tick, workflow poll) continue during S3 download · source: BASELINE_FINDINGS §3

- [ ] **[PIPE-05]** Add subprocess timeout to `document/converter.py::convert_format()` — add `timeout=` parameter to subprocess call (e.g. 60s); handle `TimeoutExpired` exception and raise a typed error · `pipeline/src/document/converter.py` · P1 · S · acceptance: a mock hung subprocess is killed at timeout; error is raised with clear message · source: BASELINE_FINDINGS §3

- [ ] **[PIPE-06]** Remove dead `_run_expand_topics_job` event duplicate (see PIPE-03); also fix `_run_expand_topics_job` to not re-emit after topic_expander already emits · `pipeline/src/ingest/dispatcher.py` · P1 · S · acceptance: dispatcher integration test confirms no duplicate event · source: BASELINE_FINDINGS §3

### P2

- [ ] **[PIPE-07]** Deprecate `pipeline/src/scoring/engine.py::ScoringEngine` — confirm zero callers (grep), then remove the class and file · `pipeline/src/scoring/engine.py` · P2 · S · acceptance: `grep -rn ScoringEngine` returns zero results; live scoring path `match_tenants()` confirmed in `workflows/actions/score_tenants.py` · source: BASELINE_FINDINGS §6 / DEPRECATION_CANDIDATES §A

- [ ] **[PIPE-08]** Remove dead `emit_opportunity_event` / `emit_customer_event` wrapper functions · `pipeline/src/events.py` · P2 · S · acceptance: `grep -rn emit_opportunity_event\|emit_customer_event` returns zero callers; file deleted or functions removed · source: DEPRECATION_CANDIDATES §A

- [ ] **[PIPE-09]** Remove dead `STORAGE_ROOT="/data"` constant from `pipeline/src/config.py` · `pipeline/src/config.py` · P2 · S · acceptance: `grep -rn STORAGE_ROOT` shows no callers after removal; storage code continues to use S3/R2 · source: DEPRECATION_CANDIDATES §A

- [ ] **[PIPE-10]** Remove dead code blocks in `topic_expander.py` — dead `setParts` builder in `opportunity-update-topic.ts` and `volume-update-required-item.ts`; dead `updateFields` in `rfp-curation/[solId]/triage/route.ts` · `frontend/lib/tools/opportunity-update-topic.ts`, `frontend/lib/tools/volume-update-required-item.ts`, `frontend/app/api/admin/rfp-curation/[solId]/triage/route.ts` · P2 · S · acceptance: dead blocks removed; static SQL path continues to work; `tsc --noEmit` passes · source: DEPRECATION_CANDIDATES §A

- [ ] **[PIPE-11]** Clarify / decide fate of `draft_section` + `review_section` job kinds: these are in `pipeline_jobs.kind` CHECK constraint but have no dispatch handler in `dispatcher.py`; either add handlers or remove from CHECK · `pipeline/src/ingest/dispatcher.py`, relevant migration · P2 · M · acceptance: CHECK enum matches dispatcher's handled cases; no undispatchable job kinds remain · source: ARCHITECTURE_V9 §5.2

### P3

- [ ] **[PIPE-12]** Wire pipeline agent workforce (Step 1 of 6 per ARCHITECTURE_V9 §9.4): pass `fabric` object from `main.py` into `run_workflow_processor()` — currently a dead local var at `main.py:72` · `pipeline/src/main.py`, `pipeline/src/workflows/processor.py` · P3 · M · acceptance: `fabric` is accessible inside `run_workflow_processor`; no change in behavior yet but wiring is in place · source: ARCHITECTURE_V9 §9.4

- [ ] **[PIPE-13]** Wire pipeline agent workforce (Step 2): replace importlib fallback in `_execute_ai_invoke()` with `fabric.invoke_agent(archetype_role, event_payload)` · `pipeline/src/workflows/processor.py` · P3 · M · acceptance: AI_INVOKE step calls fabric; test with mock fabric confirms no ImportError path · source: ARCHITECTURE_V9 §9.4

- [ ] **[PIPE-14]** Wire pipeline agent workforce (Step 3): schedule `fabric.process_task_queue()` as a 5th asyncio task in `main.py::asyncio.gather(...)` · `pipeline/src/main.py` · P3 · S · acceptance: `process_task_queue()` runs as concurrent task; task log shows processing activity · source: ARCHITECTURE_V9 §9.4

- [ ] **[PIPE-15]** Wire pipeline agent workforce (Step 4a): implement `OnProposalSectionEdited` workflow template → calls `DiffAnalyzer.analyze()` · `pipeline/src/workflows/`, `pipeline/src/agents/learning/diff_analyzer.py` · P3 · M · acceptance: new workflow template registered; `proposal:section.saved` event triggers diff analysis; `agent_task_log` records result · source: ARCHITECTURE_V9 §9.4

- [ ] **[PIPE-16]** Wire pipeline agent workforce (Step 4b): implement `OnProposalOutcomeRecorded` workflow template → calls `OutcomeAttributor.attribute()` · `pipeline/src/workflows/`, `pipeline/src/agents/learning/outcome_attributor.py` · P3 · M · acceptance: new workflow; `proposal:outcome.recorded` event triggers attribution; `agent_performance` rows updated · source: ARCHITECTURE_V9 §9.4

- [ ] **[PIPE-17]** Archive or remove `diff_analyzer.py` + `outcome_attributor.py` if PIPE-15/PIPE-16 are deferred past V2 · `pipeline/src/agents/learning/diff_analyzer.py`, `pipeline/src/agents/learning/outcome_attributor.py` · P3 · S · acceptance: decision documented; files archived or wired · source: DEPRECATION_CANDIDATES §A

---

## Frontend

### P0

- [ ] **[FE-01]** Fix `lib/import/pdf-reader.ts` `{PDFParse}` named import — change to default import: `import PDFParse from 'pdf-parse'` · `frontend/lib/import/pdf-reader.ts` · P0 · S · acceptance: `import` succeeds at runtime; PDF text extraction returns non-null result for a valid PDF; regression test added · source: BASELINE_FINDINGS §3 / FRONTEND_LIB_COMPONENTS inventory

- [ ] **[FE-02]** Add `sql.begin` transaction to `invite` POST route — wrap user update + collaborator insert in single transaction · `frontend/app/api/invite/route.ts` · P0 · S · acceptance: a simulated failure mid-route leaves no partial state (both writes commit or both roll back) · source: BASELINE_FINDINGS §3

- [ ] **[FE-03]** Add `sql.begin` transaction to `consent` POST route — wrap `consent_records` insert + `users.consent_given` update · `frontend/app/api/consent/route.ts` · P0 · S · acceptance: consent_records and users.consent_given are always in sync; partial state is impossible · source: BASELINE_FINDINGS §3

- [ ] **[FE-04]** Add role floor to `portal/profile` GET — add `hasRoleAtLeast('tenant_user')` check before returning billing_email and company profile · `frontend/app/api/portal/[tenantSlug]/profile/route.ts` · P0 · S · acceptance: a `partner_user` session receives 403; a `tenant_user` session receives 200 with full profile · source: BASELINE_FINDINGS §3 / ARCHITECTURE_V9 §10.4

- [ ] **[FE-05]** Fix `admin/sbir-data/ingest` error leak — replace outer `catch(e) { return error: e.message }` with generic error response; add `ON CONFLICT DO NOTHING` (or `DO UPDATE`) to the `sql.unsafe` batch insert · `frontend/app/api/admin/sbir-data/ingest/route.ts` · P0 · S · acceptance: internal DB error returns `{error: "Ingest failed", code: "INGEST_ERROR"}`; no stack trace or SQL text in response; duplicate ingest run completes without constraint error · source: BASELINE_FINDINGS §3

- [ ] **[FE-06]** Fix `invite` double-prefixed event type — change emission from `identity.identity.invite_accepted` to `identity.invite.accepted` · `frontend/app/api/invite/route.ts` · P0 · S · acceptance: event recorded in `system_events` has `namespace=identity`, `type=invite.accepted`; no `identity.identity.*` type in event log · source: BASELINE_FINDINGS §3

- [ ] **[FE-07]** Escape ILIKE user input in `memory-search.ts` and `library-search-atoms.ts` — apply `.replace(/[%_\\]/g, '\\$&')` before interpolating into ILIKE pattern · `frontend/lib/tools/memory-search.ts`, `frontend/lib/tools/library-search-atoms.ts` · P0 · S · acceptance: input `%secret%` returns only exact results; input `_` does not match single-character strings wildly; unit test added covering `%`, `_`, `\` characters · source: BASELINE_FINDINGS §4 / AUDIT_PRELAUNCH_20260428 §Audit2

- [ ] **[FE-08]** Add inner try/catch to all `await sql` calls in 20+ routes — each catch block must return `{error: string, code: string}` per CLAUDE.md SOP · `admin/analytics`, `admin/pipeline`, `admin/tenants` (list), `admin/automation` (GET), `admin/rfp-curation/[solId]/outline`, `admin/rfp-curation/[solId]/topics/[topicId]/compliance`, `admin/rfp-curation/[solId]/triage`, `admin/sources/[profileId]/regions/[regionId]`, `admin/sources/[profileId]/scout`, `admin/storage`, `admin/waitlist`, `admin/workflows/[instanceId]`, `admin/workflows` (GET), `admin/workflows/[instanceId]/cancel`, `admin/workflows/[instanceId]/retry`, `portal/[tenantSlug]/dashboard`, `portal/[tenantSlug]/proposals/[proposalId]/collaborators` (POST), `portal/[tenantSlug]/proposals/[proposalId]/compliance`, `portal/[tenantSlug]/proposals/[proposalId]/dropbox`, `portal/[tenantSlug]/proposals/[proposalId]/sections` (GET) · P0 · M · acceptance: `npx tsc --noEmit` passes; each amended route returns `{error, code}` on a mocked DB failure rather than unhandled rejection · source: BASELINE_FINDINGS §4 / ARCHITECTURE_V9 §13.5

### P1

- [ ] **[FE-09]** Move `auth()`/`requireAdmin()` calls inside outer try/catch for 4 routes · `frontend/app/api/admin/rfp-document/[id]/set-primary/route.ts`, `frontend/app/api/admin/rfp-document/[id]/signed-url/route.ts`, `frontend/app/api/admin/rfp-upload/route.ts`, `frontend/app/api/admin/site/upload-image/route.ts` · P1 · S · acceptance: an exception in auth() returns a valid JSON error response rather than propagating as unhandled · source: ARCHITECTURE_V9 §13.5

- [ ] **[FE-10]** Wrap `emitEventSingle`/`emitEventEnd` calls in try/catch in 6 routes — event failure should log but not return 500 after a successful business op · `admin/topics/[id]`, `admin/upload-topic-files`, `stripe/portal`, `portal/library/upload`, `portal/proposals/[id]/sections/[id]/export`, `portal/proposals/[id]/sections/[id]/save` · P1 · S · acceptance: a mocked event emission failure does not change the HTTP response code from 200 · source: ARCHITECTURE_V9 §13.5 / BASELINE_FINDINGS §4

- [ ] **[FE-11]** Fix `source-scout.ts` silent Claude error swallow — change `catch { return null }` to `catch(e) { console.error('[source-scout] Claude error:', e); throw e }` or return a typed error result · `frontend/lib/tools/source-scout.ts` · P1 · S · acceptance: a mocked Claude API error is surfaced in the tool result or propagated as an error event; not silently null · source: BASELINE_FINDINGS §3

- [ ] **[FE-12]** Add try/catch to `lib/process/force-advance.ts` (4 bare `await sql` calls) and `lib/tasks/tasks.ts` (`listOpenTasksForActor`, `completeTask`) · `frontend/lib/process/force-advance.ts`, `frontend/lib/tasks/tasks.ts` · P1 · S · acceptance: mocked DB error returns typed error; `tsc --noEmit` passes · source: BASELINE_FINDINGS §4 / TEST_MATRIX

- [ ] **[FE-13]** Add try/catch to `lib/storage/s3-client.ts::listObjects` bare `s3.send` call · `frontend/lib/storage/s3-client.ts` · P1 · S · acceptance: S3 error returns typed error rather than unhandled rejection · source: BASELINE_FINDINGS §4

### P2

- [ ] **[FE-14]** Remove `GET /api/system` 501 stub — confirm no client fetches it (grep), then delete the route file · `frontend/app/api/system/route.ts` · P2 · S · acceptance: `grep -rn "/api/system"` shows no fetch callers; route file deleted; `next build` passes · source: DEPRECATION_CANDIDATES §A

- [ ] **[FE-15]** Decide and action PPTX/XLSX exporter fate — either wire `pptx-exporter.ts` + `xlsx-exporter.ts` into the export routes, or delete them and document as V2 · `frontend/lib/export/pptx-exporter.ts`, `frontend/lib/export/xlsx-exporter.ts` · P2 · M · acceptance: either exporters are reachable via an export route, or files are deleted with a V2 note in the gap tracker · source: DEPRECATION_CANDIDATES §A / ARCHITECTURE_V9 §14.3

- [ ] **[FE-16]** Remove dead `POST /api/portal/[tenantSlug]/proposals` immediately-400 endpoint — confirm no callers, remove · `frontend/app/api/portal/[tenantSlug]/proposals/route.ts` · P2 · S · acceptance: grep confirms no client calls the endpoint; route removed; `next build` passes · source: DEPRECATION_CANDIDATES §A

- [ ] **[FE-17]** Consolidate `portal-nav-link.tsx` + `admin-nav-link.tsx` into one themed component · `frontend/components/portal/portal-nav-link.tsx`, `frontend/components/admin/admin-nav-link.tsx` · P2 · S · acceptance: single component with a `variant` or `colorScheme` prop; both admin and portal nav render identically to before · source: DEPRECATION_CANDIDATES §A

- [ ] **[FE-18]** Remove dead `setParts` dynamic SQL builder blocks in `opportunity-update-topic.ts` and `volume-update-required-item.ts`; remove dead `updateFields` object in `rfp-curation/[solId]/triage/route.ts` · relevant files · P2 · S · acceptance: dead code removed; routes continue to use static SQL path; `tsc --noEmit` passes · source: DEPRECATION_CANDIDATES §A

- [ ] **[FE-19]** Implement or remove `GET,PATCH /api/portal/[tenantSlug]/agents/config` 501 stubs — if implementing, add basic agent preference persistence; if deferring, remove stub and hide UI · `frontend/app/api/portal/[tenantSlug]/agents/config/route.ts` · P2 · M · acceptance: either route returns data or route and its UI entry point are removed · source: ARCHITECTURE_V9 §14.2 / DEPRECATION_CANDIDATES §A

- [ ] **[FE-20]** Add migration to change `proposal_sections.content` column type from TEXT to JSONB for explicit semantics (currently written with `::jsonb` cast; works but non-explicit) · `db/migrations/` · P2 · S · acceptance: new migration applies cleanly; existing rows round-trip; shredder + section save + canvas load verified · source: AUDIT_PRELAUNCH_20260428 §Audit4-Break4

---

## Data / Migrations

### P2

- [ ] **[DATA-01]** Deprecate `trigger_bus`/`trigger_events` columns from `automation_rules` — add migration to DROP the two legacy columns after confirming zero writes (grep across all 3 services) · `db/migrations/` · P2 · M · acceptance: `grep -rn trigger_bus\|trigger_events` shows no active writes; migration applied; CMS `event_listener.py` introspection path confirmed to work with `trigger_namespace`/`trigger_type` only · source: ARCHITECTURE_V9 §7.5 / DEPRECATION_CANDIDATES §B

- [ ] **[DATA-02]** Add RLS policies to 4 memory tables (`episodic_memories`, `semantic_memories`, `procedural_memories`, `agent_task_log`) or document the isolation model and remove the RLS-enabled-but-no-policies footgun · `db/migrations/` (new migration) · P2 · M · acceptance: either: (a) at least one `CREATE POLICY` per table with tenant_id scoping, or (b) a migration that `ALTER TABLE … DISABLE ROW LEVEL SECURITY` with a comment explaining app-layer isolation; CLAUDE.md updated to reflect reality · source: ARCHITECTURE_V9 §7.4 / BASELINE_FINDINGS §2.8

- [ ] **[DATA-03]** Remove dead `agent` namespace from `system_events.namespace` column CHECK constraint and comment — add migration to update CHECK to the 7 canonical namespaces · `db/migrations/` · P2 · S · acceptance: `system_events.namespace` CHECK does not include `agent`; ARCHITECTURE_V9 §8.2 is the reference; zero runtime emissions of `agent` namespace confirmed · source: ARCHITECTURE_V9 §8.2 / BASELINE_FINDINGS §6.2

### P3

- [ ] **[DATA-04]** Investigate and decide fate of suspected-dead tables: `solicitation_templates`, `solicitation_outlines`, `library_atom_outcomes`, `spotlights` — write-path grep across all 3 services; if dead, create DROP migration · `db/migrations/` · P3 · M · acceptance: write-path grep documented; either retention reason documented or DROP migration created with backup/retention decision noted · source: DEPRECATION_CANDIDATES §B

- [ ] **[DATA-05]** Investigate and retire legacy event bus tables (`opportunity_events`, `customer_events`, `content_events`) — grep all inserts across all 3 services; if confirmed dead, drop tables and NOTIFY triggers · `db/migrations/` · P3 · M · acceptance: insert grep shows no active writers; DROP migration applied in staging; NOTIFY triggers removed · source: DEPRECATION_CANDIDATES §B

---

## CMS

### P1

- [ ] **[CMS-01]** Investigate and fix `social_poster` NotImplementedError stubs — at minimum wrap `NotImplementedError` in a catch that sets post status to `failed` with a clear reason (it currently crashes the worker loop rather than handling gracefully); OAuth implementation is P3 · `services/cms/src/workers/social_poster.py` · P1 · S · acceptance: social_poster worker loop does not crash on NotImplementedError; post records get status `failed` with `reason=oauth_not_configured`; social_poster error does not affect other workers · source: ARCHITECTURE_V9 §6.2 / BASELINE_FINDINGS §2.5

- [ ] **[CMS-02]** Add CMS auth flow tests: JWT cookie issuance, bcrypt check, `last_login_at` update, `login_failed` event · `services/cms/tests/` · P1 · M · acceptance: pytest passes for login success, wrong password, expired session scenarios · source: TEST_MATRIX §CMS Auth

- [ ] **[CMS-03]** Add CMS event listener action handler end-to-end tests: `_action_send_email`, `_action_notify_admin`, `_action_create_todo` dispatch with mocked dependencies · `services/cms/tests/` · P1 · M · acceptance: pytest confirms each action handler dispatches correctly; no live Gmail/DB required (fake conn) · source: TEST_MATRIX §CMS Event Listener

### P2

- [ ] **[CMS-04]** Add `email_queue.py` tests: SKIP LOCKED batch dequeue, exponential retry logic, daily send limit enforcement · `services/cms/tests/` · P2 · M · acceptance: pytest with fake DB + fake Gmail confirms retry backoff, daily limit stops sends, batch dequeue is atomic · source: TEST_MATRIX rank-12

- [ ] **[CMS-05]** Add `content_generator.py` tests: 5 source types (prompt/url/email/screenshot/repackage), status machine transitions · `services/cms/tests/` · P2 · M · acceptance: pytest with mocked Claude API covers all 5 source types and `pending→generating→published` status transitions · source: TEST_MATRIX §CMS Workers

- [ ] **[CMS-06]** Add `drip_engine.py` tests: enrollment step advance, delay computation, `completed` status on last step · `services/cms/tests/` · P2 · M · acceptance: pytest covers step advance, delay logic, final-step completion · source: TEST_MATRIX §CMS Workers

- [ ] **[CMS-07]** Confirm and document `cms_content` table retention decision — legacy CMS bridge may still write to it; confirm before any drop · `services/cms/src/`, `db/migrations/` · P2 · S · acceptance: write-path grep documented; either confirmed dead (and DATA-05 schedules DROP) or retained with documented reason · source: DEPRECATION_CANDIDATES §B

- [ ] **[CMS-08]** Add CMS email router tests (`routers/email.py`): CRUD for accounts/templates/campaigns/sends/outbox (the largest CMS router, 33 endpoints, currently 0% coverage) · `services/cms/tests/` · P2 · L · acceptance: pytest covers create/read/update/delete for all major email entity types with mocked DB · source: TEST_MATRIX §CMS Page Blocks

- [ ] **[CMS-09]** Wire CMS integration tests to run in CI — `test_page_blocks_integration.py` requires `TEST_DATABASE_URL` + `TEST_CMS_DATABASE_URL`; add a CI job that spins up both Postgres instances and runs integration tests · `.github/workflows/ci.yml` · P2 · M · acceptance: CI `crm` job or new `cms-integration` job runs `test_page_blocks_integration.py` against a live test DB; passes without `TEST_DATABASE_URL` skip flag · source: TEST_MATRIX / ARCHITECTURE_V9 §12.2

### P3

- [ ] **[CMS-10]** Implement recurring campaign true cron in `campaign_executor.py` — replace the V2-deferred comment with an actual cron-like schedule loop · `services/cms/src/workers/campaign_executor.py` · P3 · L · acceptance: a campaign with `recurrence=weekly` sends at the configured interval without manual trigger · source: ARCHITECTURE_V9 §6.3

- [ ] **[CMS-11]** Implement LinkedIn + Twitter OAuth adapters in `social_poster.py` — replace `NotImplementedError` stubs with real OAuth flow · `services/cms/src/workers/social_poster.py` · P3 · L · acceptance: a test social account successfully posts to LinkedIn sandbox; Twitter adapter sends to sandbox API · source: ARCHITECTURE_V9 §6.3

---

## Agents

### P2

- [ ] **[AGENT-01]** Add `AgentFabric` + archetype registration smoke test — confirm all 10 archetypes register without error on startup; confirm `AgentFabric()` instantiates cleanly · `pipeline/src/agents/fabric.py`, `pipeline/tests/` · P2 · M · acceptance: `test_agents.py` (replacing placeholder) tests `AgentFabric()` init, confirms `len(fabric.archetypes) == 10`; runs in CI · source: TEST_MATRIX §Pipeline Agents / DEPRECATION_CANDIDATES §A (PIPE-11 placeholder)

- [ ] **[AGENT-02]** Add `agents/tools.py` ToolRegistry tenant isolation tests — 9 SQL handlers; confirm each enforces `tenant_id` filter · `pipeline/src/agents/tools.py`, `pipeline/tests/` · P2 · M · acceptance: pytest with fake conn confirms each tool handler adds `WHERE tenant_id = $tenant_id` to its query; cross-tenant queries are rejected · source: TEST_MATRIX rank-11

### P3

- [ ] **[AGENT-03]** Add pgvector embeddings to memory store — implement embedding generation (Anthropic text-embeddings API or equivalent) and replace zero-vector placeholders · `pipeline/src/agents/memory.py`, `pipeline/src/agents/lifecycle/` · P3 · L · acceptance: `MemoryStore.store()` generates a real embedding vector; `recall()` uses cosine similarity (not ILIKE); HNSW index is used in query plan · source: ARCHITECTURE_V9 §9.3

- [ ] **[AGENT-04]** Add memory lifecycle module tests: `MemoryStore.store()` + `recall()`, `decay.py`, `gc.py` retention guards · `pipeline/tests/`, `pipeline/src/agents/` · P3 · L · acceptance: `test_memory.py` (replacing placeholder) covers store/recall round-trip, decay factor update, GC retention guard (importance ≥ 0.9 threshold) · source: TEST_MATRIX §Pipeline Lifecycle / DEPRECATION_CANDIDATES §A

---

## Testing

### P0

- [ ] **[TEST-01]** Replace 4 empty pipeline placeholder test files with meaningful stubs or delete them — `test_sam_gov.py`, `test_scoring.py`, `test_agents.py`, `test_memory.py` each contain only `assert True` · `pipeline/tests/test_sam_gov.py`, `pipeline/tests/test_scoring.py`, `pipeline/tests/test_agents.py`, `pipeline/tests/test_memory.py` · P0 · S · acceptance: pytest no longer reports any test file with zero real tests; each file either has ≥1 real test or is deleted; CI total real test count is documented · source: TEST_MATRIX summary / DEPRECATION_CANDIDATES §A

- [ ] **[TEST-02]** Write `stripe/webhook` test — HMAC signature verification, `checkout.session.completed` handler, `sql.begin` multi-table tx rollback on failure · `frontend/__tests__/` or `e2e/` · P0 · M · acceptance: test confirms: (a) invalid signature returns 400, (b) valid `checkout.session.completed` creates `purchases` row + emits `capture:purchase.completed`, (c) DB error during tx does not leave partial state · source: TEST_MATRIX rank-1

- [ ] **[TEST-03]** Write `auth/[...nextauth]` test — `authorize()` happy path (DB lookup, bcrypt match, JWT payload), wrong password (login_failed event), DB error propagation · `frontend/__tests__/` · P0 · M · acceptance: test covers login success, wrong password, DB error; events confirmed in system_events · source: TEST_MATRIX rank-13

- [ ] **[TEST-04]** Write `portal/proposals/create` test — purchase gate check, 6-table sql.begin transaction, portal provisioner S3 call, founding-cohort bypass · `frontend/__tests__/` · P0 · M · acceptance: test covers: (a) success creates proposal + sections + collaborators rows, (b) purchase-gate rejection returns 403, (c) mocked DB failure mid-tx leaves no partial state · source: TEST_MATRIX rank-6

### P1

- [ ] **[TEST-05]** Write `portal/proposals/[id]/advance` test — stage gate check, OCC version conflict (409), multi-table tx, `proposal.advanced` event · `frontend/__tests__/` · P1 · M · acceptance: test covers gate check pass/fail, 409 on stale version, event emission on success · source: TEST_MATRIX rank-7

- [ ] **[TEST-06]** Write `portal/proposals/[id]/sections/[id]/save` test — OCC version check (409), canvas_versions snapshot, collaborator edit permission check · `frontend/__tests__/` · P1 · M · acceptance: test covers: (a) 409 on version mismatch, (b) canvas_versions row created, (c) partner_user without edit permission receives 403 · source: TEST_MATRIX rank-8

- [ ] **[TEST-07]** Write `pipeline/src/storage/crypto.py` AES-256-GCM round-trip test — encrypt, decrypt, wrong key, tampered ciphertext · `pipeline/tests/test_crypto.py` (replacing placeholder or new file) · P1 · S · acceptance: encrypt→decrypt produces original plaintext; wrong key raises error; tampered GCM tag raises error · source: TEST_MATRIX rank-2

- [ ] **[TEST-08]** Write `dispatcher.tick_schedules()` + `consume_one_job()` SKIP LOCKED tests — schedule advancement + atomic job claiming · `pipeline/tests/test_dispatcher.py` · P1 · M · acceptance: test with live test DB: (a) `tick_schedules()` inserts job for due schedule and updates `next_run_at`, (b) two concurrent `consume_one_job()` calls claim different jobs without duplication · source: TEST_MATRIX rank-3

- [ ] **[TEST-09]** Write `topic_expander` tests: `_derive_source_id()`, `_content_hash()` MD5 determinism, `_upsert_topic()` dedup on `(solicitation_id, topic_number)` · `pipeline/tests/test_topic_expander.py` · P1 · M · acceptance: hash is deterministic for same input; dedup prevents duplicate rows on re-ingest; double-emit regression test added · source: TEST_MATRIX rank-4

- [ ] **[TEST-10]** Write `workflows/actions/score_tenants.match_tenants()` test — multi-factor scoring, weight correctness, `tenant_pipeline_items` upsert · `pipeline/tests/test_scoring.py` (replacing placeholder) · P1 · M · acceptance: known-input opportunity produces expected scores for each factor; upsert creates/updates `tenant_pipeline_items`; above/below threshold filtering confirmed · source: TEST_MATRIX rank-5

- [ ] **[TEST-11]** Write `middleware.ts` role guard tests — portal route protection, admin route protection, partner_user scope, temp-password redirect · `frontend/__tests__/middleware.test.ts` · P1 · M · acceptance: test covers: (a) unauthenticated → 401, (b) insufficient role → 403, (c) `tempPassword=true` → redirect /change-password, (d) partner_user blocked from admin routes · source: TEST_MATRIX rank-15

- [ ] **[TEST-12]** Write `admin/rfp-curation/[solId]/push` test — tool delegation, event emission, `OnSolicitationPushed` trigger · `frontend/__tests__/` · P1 · M · acceptance: test confirms solicitation push emits `finder:solicitation.pushed:single` event; tool delegation to `solicitation.push` tool confirmed · source: TEST_MATRIX rank-14

- [ ] **[TEST-13]** Write `admin/rfp-curation/[solId]/triage` state machine test — valid transitions (accept/defer/reject/skip), conflict detection · `frontend/__tests__/` · P1 · M · acceptance: test covers all valid state transitions; invalid transition (e.g. skip an already-accepted solicitation) returns 409 or 400 · source: TEST_MATRIX

- [ ] **[TEST-14]** Write `admin/applications/[id]/accept` onboarding test — tenant + tenant_admin creation tx, welcome email trigger · `frontend/__tests__/` · P1 · M · acceptance: success creates tenant + user rows in transaction; mocked email sender called; partial-failure leaves no partial state · source: TEST_MATRIX

- [ ] **[TEST-15]** Write `invite` route test — token validation, password set, collaborator join, confirm no double-prefixed event, confirm transaction · `frontend/__tests__/` · P1 · M · acceptance: success emits `identity.invite.accepted` (not `identity.identity.invite_accepted`); all writes in one transaction · source: TEST_MATRIX / BASELINE_FINDINGS §3

### P2

- [ ] **[TEST-16]** Write regression test for `finder:topics.expanded` double-emit — confirms exactly one event per expand_topics job after PIPE-03 fix · `pipeline/tests/test_topic_expander.py` · P2 · S · acceptance: a single `expand_topics` job produces exactly one `finder:topics.expanded` row in the test DB · source: TEST_MATRIX §Pipeline Dispatcher

- [ ] **[TEST-17]** Write `source_scout.py` tests: fetch page HTML, SHA-256 hash per region, Claude diff analysis (mocked), `source_snapshots` + `source_diffs` writes · `pipeline/tests/test_source_scout.py` · P2 · M · acceptance: pytest with mocked HTTP + mocked Claude confirms snapshot written, diff written on change, `finder:source.scouted` event emitted · source: TEST_MATRIX §Pipeline Source Scout

- [ ] **[TEST-18]** Write `BaseIngester.run()` dedup-under-update test: content-hash change path (`was_insert=False`, amended path, `finder:opportunity.amended` event) · `pipeline/tests/test_ingest_e2e.py` or new file · P2 · S · acceptance: second ingest run with changed content produces `finder:opportunity.amended` event and updates the existing row (not insert) · source: TEST_MATRIX §Pipeline Ingest

- [ ] **[TEST-19]** Write `portal/[tenantSlug]/profile` role floor test — confirm `partner_user` receives 403 after FE-04 fix · `frontend/__tests__/` · P2 · S · acceptance: test is the regression guard for FE-04 · source: TEST_MATRIX / BASELINE_FINDINGS §3

- [ ] **[TEST-20]** Write `memory-search.ts` + `library-search-atoms.ts` ILIKE escaping tests — confirm `%` and `_` are escaped before SQL · `frontend/__tests__/` · P2 · S · acceptance: inputs `%`, `_`, `\`, `%secret%` all escape correctly; test is regression guard for FE-07 · source: TEST_MATRIX rank-9

- [ ] **[TEST-21]** Write `lib/import/pdf-reader.ts` import + invocation test — confirm default import works and extraction returns text · `frontend/__tests__/` · P2 · S · acceptance: test imports the module (regression guard for FE-01 named-import fix) and calls extraction on a minimal PDF fixture · source: TEST_MATRIX rank-10

- [ ] **[TEST-22]** Write `OnProposalAdvancedToFinal` `generate_preview` action test — ZIP creation + S3 upload · `pipeline/tests/` · P2 · M · acceptance: action creates a ZIP with the expected files; mocked S3 confirms `put_object` called with correct key · source: TEST_MATRIX

- [ ] **[TEST-23]** Write `OnRfpUploaded` retry logic test — 3 retries with 30s delay; `extract_compliance` fallback path · `pipeline/tests/` · P2 · M · acceptance: workflow retries shred_document up to 3 times; compliance extraction fallback runs when primary fails · source: TEST_MATRIX

---

## CI / Infra

### P0

- [ ] **[CI-01]** Add main-DB migration check job to `ci.yml` — spin up PostgreSQL 16 + pgvector, run `db/migrations/migrate.mjs`, verify expected table count or specific critical tables exist · `.github/workflows/ci.yml` · P0 · M · acceptance: a broken migration SQL causes the `migrate` CI job to fail before merge; test verifies tables including `proposals`, `system_events`, `pipeline_jobs` exist after migration · source: ARCHITECTURE_V9 §12.2 / DOCS_INFRA inventory

### P2

- [ ] **[CI-02]** Add CMS integration test job to `ci.yml` — spin up both `govtech_intel` and `govtech_cms` Postgres instances; run `services/cms/tests/test_page_blocks_integration.py` with both `TEST_DATABASE_URL` and `TEST_CMS_DATABASE_URL` · `.github/workflows/ci.yml` · P2 · M · acceptance: page-blocks two-DB publish bridge is CI-validated; integration test is no longer skipped in CI · source: TEST_MATRIX / CMS-09

- [ ] **[CI-03]** Delete `scripts/migrate.sh` (no tracking table, CLIFFNOTES marks it "NEVER USE") — or rename to `scripts/migrate.DANGEROUS.NO_TRACKING.sh` with header warning · `scripts/migrate.sh` · P2 · S · acceptance: file renamed or deleted; CLIFFNOTES updated to remove any reference; confirmed git history preserves the file if ever needed · source: DEPRECATION_CANDIDATES §C

- [ ] **[CI-04]** Verify `IPINFO_TOKEN` and migration 058 are live in Railway production for analytics capture · Railway environment variables · P2 · S · acceptance: cold traffic from launch generates `page_views` rows with geo data · source: LAUNCH_READINESS_REVIEW §Phase0

---

## Docs / Deprecation

### P2

- [ ] **[DOC-01]** Update `CLAUDE.md` stale text — repoint architecture reference from `ARCHITECTURE_V5.md` to `ARCHITECTURE_V9.md`; update storage claim from "one DB + `/data` volume" to "two DBs (govtech_intel + govtech_cms) + R2/S3 object storage"; update CMS description from "Dormant V1, placeholder" to "Live FastAPI service (87 endpoints, 7 workers)" · `CLAUDE.md` · P2 · S · acceptance: CLAUDE.md passes a review against ARCHITECTURE_V9 §1 executive summary; no stale facts remain · source: DEPRECATION_CANDIDATES §D

- [ ] **[DOC-02]** Update `docs/FOLDER_STRUCTURE.md` — mark CMS service as live · `docs/FOLDER_STRUCTURE.md` · P2 · S · acceptance: `services/cms` description reflects live status · source: DEPRECATION_CANDIDATES §D

- [ ] **[DOC-03]** Update `docker-compose.yml` — remove stale "V1 dormant" comment from CMS service section · `docker-compose.yml` · P2 · S · acceptance: CMS service in docker-compose reflects live status; `CMS_DATABASE_URL` documented · source: DEPRECATION_CANDIDATES §D

- [ ] **[DOC-04]** Update `.env.example` — CMS section should document `CMS_DATABASE_URL` as required (not optional V2-deferred) · `.env.example` · P2 · S · acceptance: `.env.example` lists `CMS_DATABASE_URL` as required with explanation · source: DEPRECATION_CANDIDATES §D

- [ ] **[DOC-05]** Remove `docs/CLAUDE_CLIFFNOTES.md` (stale 2026-04-27 duplicate of root `CLAUDE_CLIFFNOTES.md`) — replace with a redirect notice pointing to root · `docs/CLAUDE_CLIFFNOTES.md` · P2 · S · acceptance: file deleted or replaced with one-line pointer; no developer navigates to the stale version · source: DEPRECATION_CANDIDATES §C

### P3

- [ ] **[DOC-06]** Archive superseded architecture docs — move `ARCHITECTURE_V5.md` and `docs/ARCHITECTURE_V6.md` to `docs/archive/` · `ARCHITECTURE_V5.md`, `docs/ARCHITECTURE_V6.md` · P3 · S · acceptance: files in `docs/archive/`; no links to them from active docs · source: DEPRECATION_CANDIDATES §C

- [ ] **[DOC-07]** Archive stale event docs — move `docs/EVENT_CONTRACT.md` and `docs/NAMESPACES.md` to `docs/archive/` after confirming ARCHITECTURE_V9 §8 is the authoritative namespace reference · `docs/EVENT_CONTRACT.md`, `docs/NAMESPACES.md` · P3 · S · acceptance: files archived; ARCHITECTURE_V9 §8.2 is the single namespace reference · source: DEPRECATION_CANDIDATES §C

- [ ] **[DOC-08]** Archive completed phase docs — move `docs/phase-1/*` (10 files), `docs/PHASE_1_PLAN.md`, `docs/PHASE_0_5_CHECKLIST.md`, `docs/PHASE_0_5_VERIFICATION.md`, `docs/IMPLEMENTATION_PLAN_V2.md` to `docs/archive/` · `docs/` · P3 · S · acceptance: `docs/` root cleaned of completed-phase files · source: DEPRECATION_CANDIDATES §C

- [ ] **[DOC-09]** Archive superseded workflow + testing docs — move `docs/HITL_TEST_PLAN.md`, `docs/AUTOMATION_WORKFLOWS.md` to `docs/archive/` after confirming `docs/WORKFLOW_REFERENCE.md` supersedes them · `docs/HITL_TEST_PLAN.md`, `docs/AUTOMATION_WORKFLOWS.md` · P3 · S · acceptance: files archived; WORKFLOW_REFERENCE.md is the single workflow reference · source: DEPRECATION_CANDIDATES §C

- [ ] **[DOC-10]** Consolidate and standardize API convention docs — `docs/API_CONVENTIONS.md` mandates `withHandler()`; `CLAUDE_CLIFFNOTES.md §2` shows raw `NextResponse.json`; resolve which pattern is canonical and update both docs · `docs/API_CONVENTIONS.md`, `CLAUDE_CLIFFNOTES.md` · P3 · M · acceptance: one canonical API pattern documented; all new route authoring follows it · source: BASELINE_FINDINGS §4 / ARCHITECTURE_V9 §13.5

- [ ] **[DOC-11]** Remove `agent` namespace from `system_events.namespace` column comment and any doc references — ARCHITECTURE_V9 §8.2 confirms zero runtime emissions · docs and DB migration · P3 · S · acceptance: `agent` namespace appears nowhere in active docs or schema comments; DATA-03 migration handles the DB side · source: ARCHITECTURE_V9 §8.2 / BASELINE_FINDINGS §6.2

- [ ] **[DOC-12]** Update `docs/EVENT_CONTRACT_V3.md` stale content — document marks the HITL resume as broken (bug); ARCHITECTURE_V9 §14 confirms HITL resume is implemented; update to reflect current state · `docs/EVENT_CONTRACT_V3.md` · P3 · S · acceptance: V3 doc accurately describes implemented HITL resume path · source: BASELINE_FINDINGS §2.4

---

## Summary: Task Count by Area

| Area | P0 | P1 | P2 | P3 | Total |
|------|----|----|----|----|-------|
| Pipeline | 2 | 3 | 5 | 6 | **16** |
| Frontend | 8 | 8 | 8 | — | **24** |
| Data/Migrations | — | — | 3 | 2 | **5** |
| CMS | — | 3 | 6 | 2 | **11** |
| Agents | — | — | 2 | 2 | **4** |
| Testing | 4 | 11 | 8 | — | **23** |
| CI/Infra | 1 | — | 3 | — | **4** |
| Docs/Deprecation | — | — | 5 | 7 | **12** |
| **Total** | **15** | **25** | **40** | **19** | **99** |
