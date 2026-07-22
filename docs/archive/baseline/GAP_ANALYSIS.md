# Baseline → Launch Capability Gap Analysis

**Date:** 2026-06-23
**Branch:** `claude/nice-hamilton-kBqtD`
**Source inputs:** `BASELINE_FINDINGS.md` · `ARCHITECTURE_V9.md §9,14` · `DEPRECATION_CANDIDATES.md` · `TEST_COVERAGE_MATRIX.md` · `LAUNCH_READINESS_REVIEW.md` · `docs/AUDIT_PRELAUNCH_20260428.md` · 8 inventory files

---

## Status after fix pass (2026-06-23)

All 15 P0 gaps are closed. Two were false positives requiring no code change:
- **FE-01 / P0-01** (pdf-reader named import): pdf-parse v2.4.5 exports `PDFParse` as a named export; the import was always correct.
- **FE-07 / P0-07** (ILIKE escaping): `memory-search.ts` and `library-search-atoms.ts` already had `.replace(/[%_\\]/g, '\\$&')` in place.

Most P1 gaps listed above are also closed (see LAUNCH_TODO.md for per-item status). The following tiers remain deferred:
- **Deferred to V2:** TEST-10, TEST-12–14, TEST-17–23; DATA-02; CMS-04–11; AGENT-04; CI-02, CI-04.
- **Note on DATA-02 (RLS):** reality is already documented accurately in ARCHITECTURE_V9; adding real RLS policies requires an app-set tenant GUC — deferred to V2.

**Agent pipeline wired + hardened:** PIPE-12–16 complete — fabric→processor, AI_INVOKE via fabric, task-queue consumer scheduled, OnProposalSectionEdited and OnProposalOutcomeRecorded workflows wired; agents are context-bound (ContextAssembler), injection-delimited (`<untrusted_data>`), and tenant-isolated (all tools). Three deploy-time activation items remain: (1) ANTHROPIC_API_KEY for real Claude invocations; (2) EMBEDDINGS_PROVIDER=openai + OPENAI_API_KEY + backfill for vector search; (3) section-save event enrichment (originalContent/agentRole) to fully activate PIPE-15/DiffAnalyzer. AGENT-02 (tenant isolation tests) done. AGENT-03 vectorization scaffolded default-off.

New test counts after fix pass: pipeline 511 passed / 29 skipped (was 383/29 pre-agent-wiring); frontend 404 passed / 24 files (was 273/17); CMS 100 passed / 2 skipped (was 54/2).

---

## Executive Summary — Gap Counts by Tier

| Tier | Label | Gap count |
|------|-------|-----------|
| P0 | Launch blocker | **14** |
| P1 | High — should fix before launch | **17** |
| P2 | Medium — soon after launch | **22** |
| P3 | Deferred / V2 | **16** |
| **Total** | | **69** |

---

## P0 Launch-Blocker List (must fix before any production traffic)

1. **PDF import crash** — `pdf-reader.ts` named import bug (`{PDFParse}`) → runtime error on every PDF upload
2. **`lifecycle_scheduler` recursive reconnect** → stack overflow under any sustained DB outage (kills the pipeline process)
3. **`invite` route missing transaction** — multi-table write with no `sql.begin`; partial failure leaves user in broken state
4. **`consent` route missing transaction** — same class of problem; inconsistent consent state possible
5. **`portal/profile` missing role floor** — `partner_user` can read `billing_email` + full company profile
6. **`admin/sbir-data/ingest` internal error leak** — raw error text exposed to client; also `sql.unsafe` batch with no `ON CONFLICT`
7. **`invite` double-prefixed event type** — emits `identity.identity.invite_accepted` instead of `identity.invite.accepted`; corrupts event log from day one
8. **Unescaped ILIKE in `memory-search.ts` + `library-search-atoms.ts`** — wildcard-DoS / match-bypass on user input
9. **Stripe webhook entirely untested** — signature bypass and partial-transaction failure have no regression guard on the monetization gatekeeper
10. **`stripe/webhook` has no regression test for `checkout.session.completed` multi-table tx** — same as above; two entries collapsed here
11. **20+ API routes missing inner try/catch on `await sql`** — DB error collapses to unhandled rejection or misleading 500 in routes including `portal/dashboard`, `portal/proposals/[id]/sections`, and core admin routes
12. **`agents/learning/__init__.py` broken absolute imports** — will ImportError at runtime when the package is imported directly; masks deeper wiring problem
13. **4 empty placeholder pipeline tests counted as coverage** — `test_sam_gov`, `test_scoring`, `test_agents`, `test_memory` each contain only `assert True`; CI reports green on 0% coverage for crypto, scoring, dispatcher, and memory
14. **No main-DB migration check in CI** — a migration error surfaces only at deploy time (Railway entrypoint), not in CI; any broken migration ships silently

---

## P0 — Launch Blockers (detailed)

| # | Gap | Evidence (file:area) | Impact | Effort |
|---|-----|---------------------|--------|--------|
| P0-01 | **PDF import crash**: `lib/import/pdf-reader.ts` uses `{ PDFParse }` named import; `pdf-parse` has only a default export → runtime `TypeError` on first PDF import call | `frontend/lib/import/pdf-reader.ts` (BASELINE_FINDINGS §3, TEST_MATRIX rank-10) | Every PDF upload fails silently with a JS runtime error; document import feature is completely broken | S |
| P0-02 | **`lifecycle_scheduler` recursive reconnect**: reconnect callback calls itself recursively → unbounded stack growth → process crash under any sustained DB outage | `pipeline/src/lifecycle_scheduler.py` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §14.1) | Under a DB hiccup the pipeline process crashes entirely, taking ingest, shredder, and workflow processor offline | S |
| P0-03 | **`invite` route: no transaction + double-prefixed event**: multi-table write (users + collaborators) has no `sql.begin`; emits `identity.identity.invite_accepted` (should be `identity.invite.accepted`) | `frontend/app/api/invite/route.ts` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §13.4) | Partial failure during invite leaves user row updated but collaborator record missing; double-prefixed event corrupts event log and breaks any automation_rule matching on invite acceptance | S |
| P0-04 | **`consent` route: no transaction**: multi-table write (consent_records + users) has no `sql.begin` | `frontend/app/api/consent/route.ts` (BASELINE_FINDINGS §3) | Partial failure during consent leaves `consent_records` inserted but `users.consent_given` not updated (or vice versa); legal/compliance risk | S |
| P0-05 | **`portal/profile` missing role floor**: `GET` has no `hasRoleAtLeast(tenant_user)` check → `partner_user` can read `billing_email` + full company profile | `frontend/app/api/portal/[tenantSlug]/profile/route.ts` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §10.4) | Information disclosure of billing email and tenant profile to external collaborators | S |
| P0-06 | **`admin/sbir-data/ingest` error leak + unsafe batch**: outer catch leaks raw internal error string to client; `sql.unsafe` batch insert has no `ON CONFLICT` guard | `frontend/app/api/admin/sbir-data/ingest/route.ts` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §13.5) | Internal DB error details exposed to client; duplicate ingest runs may fail with unhandled constraint errors | S |
| P0-07 | **Unescaped ILIKE on user input**: `memory-search.ts` and `library-search-atoms.ts` pass raw user strings into ILIKE pattern without `.replace(/[%_\\]/g, '\\$&')` | `frontend/lib/tools/memory-search.ts`, `frontend/lib/tools/library-search-atoms.ts` (BASELINE_FINDINGS §4, AUDIT_PRELAUNCH §Audit2) | Wildcard DoS (user sends `%` → full table scan) and match-bypass (`%` matches all records regardless of intent) | S |
| P0-08 | **`stripe/webhook` zero test coverage**: HMAC verification, `checkout.session.completed` handler, `sql.begin` transaction on purchase completion — all untested | `frontend/app/api/stripe/webhook/route.ts` (TEST_MATRIX rank-1) | Signature bypass and partial transaction failure have no regression guard; monetization correctness is unknown | M |
| P0-09 | **20+ API routes missing inner try/catch on `await sql`**: includes `portal/dashboard`, `portal/proposals/[id]/sections` (GET), `portal/proposals/[id]/compliance`, `portal/proposals/[id]/dropbox`, `portal/proposals/[id]/collaborators` (POST), `admin/analytics`, `admin/pipeline`, `admin/tenants`, `admin/workflows/*`, `admin/sources/[profileId]/scout`, `admin/storage`, `admin/waitlist` | ARCHITECTURE_V9 §13.5, BASELINE_FINDINGS §4 | A DB error in any of these routes causes an unhandled promise rejection or generic 500 that leaks no useful error code; admin and portal routes lose observability | M |
| P0-10 | **`agents/learning/__init__.py` broken absolute imports**: `from pipeline.src.agents.learning.X import X` fails as ImportError at runtime; masked only because `lifecycle_scheduler.py` imports directly by module path | `pipeline/src/agents/learning/__init__.py` (BASELINE_FINDINGS §3) | Any code that imports from the package (rather than by direct module path) will fail silently; indicates the learning module package structure is broken | S |
| P0-11 | **4 empty placeholder pipeline tests**: `test_sam_gov.py`, `test_scoring.py`, `test_agents.py`, `test_memory.py` each contain `assert True`; CI reports green on 0% real coverage for crypto, scoring, dispatcher, and memory | `pipeline/tests/` (TEST_MATRIX summary, DEPRECATION_CANDIDATES §A) | CI green on critical-path gaps; silent regressions on SAM.gov key ingest, scoring, and dispatcher will never be caught | S |
| P0-12 | **No main-DB migration check in CI**: `ci.yml` has a `migrate-crm` job (CMS DB) but no equivalent for `govtech_intel`; main-DB migrations only run at Railway deploy via `entrypoint.sh` | ARCHITECTURE_V9 §12.2 (DOCS_INFRA inventory) | A migration syntax error or constraint violation ships without any CI gate; only caught when Railway deploy fails, potentially corrupting the live DB | M |
| P0-13 | **`auth/[...nextauth]` route completely untested**: authorize() DB query path, session callbacks, login failure, bcrypt comparison | `frontend/app/api/auth/[...nextauth]/route.ts` (TEST_MATRIX rank-13) | Any regression in auth breaks all logins; failure mode invisible until production | M |
| P0-14 | **`portal/proposals/create` (6-table sql.begin tx) untested**: purchase gate, portal provisioning, founding-cohort bypass, 6-table transaction — zero coverage | `frontend/app/api/portal/[tenantSlug]/proposals/create/route.ts` (TEST_MATRIX rank-6) | Most complex single route; a partial-transaction failure leaves proposals in an inconsistent state; no regression guard | M |

---

## P1 — High (should fix before launch)

| # | Gap | Evidence (file:area) | Impact | Effort |
|---|-----|---------------------|--------|--------|
| P1-01 | **Double-emit `finder:topics.expanded`**: both `topic_expander.py::_emit_topics_expanded` and `dispatcher.py::_run_expand_topics_job` emit the event for a single job | `pipeline/src/ingest/topic_expander.py`, `pipeline/src/ingest/dispatcher.py` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §14.1) | Every topic-expansion job fires the event twice; any automation_rule or workflow listening on this event executes twice; event log is polluted from M3 regression | S |
| P1-02 | **`shredder/extractor.py` sync boto3 in async**: `extract_text_from_s3_key()` calls synchronous boto3 inside async context → blocks event loop per PDF | `pipeline/src/shredder/extractor.py` (BASELINE_FINDINGS §3, ARCHITECTURE_V9 §5.4) | Shredder blocks the asyncio event loop for the duration of every S3 download; under load, all other tasks (workflow processor, dispatcher) stall | M |
| P1-03 | **`document/converter.py` no subprocess timeout**: `convert_format()` spawns LibreOffice with no timeout; a hung process blocks the async loop indefinitely | `pipeline/src/document/converter.py` (BASELINE_FINDINGS §3) | A single hung LibreOffice process can block the pipeline process permanently; requires manual restart | S |
| P1-04 | **`source-scout.ts` silently swallows Claude errors**: `catch { return null }` in source-scout tool | `frontend/lib/tools/source-scout.ts` (BASELINE_FINDINGS §3, TEST_MATRIX) | Claude API errors are invisible; source-scout results silently return null without any error surfaced to admin or event log | S |
| P1-05 | **`portal/proposals/[id]/advance` (stage gates + OCC) untested**: stage-gate logic, optimistic concurrency check (OCC version), multi-table transaction, `proposal.advanced` event | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/advance/route.ts` (TEST_MATRIX rank-7) | Stage progression is a critical workflow step; OCC conflict behavior and gate-failure modes are completely untested | M |
| P1-06 | **`portal/proposals/[id]/sections/[sectionId]/save` (OCC + collaborator permission) untested**: 409 conflict path, canvas_versions snapshot, collaborator edit permission | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save/route.ts` (TEST_MATRIX rank-8) | Auto-save backbone; concurrent edit conflict (409) path never exercised; collaborator permission check not validated by any test | M |
| P1-07 | **`dispatcher.tick_schedules()` + `consume_one_job()` (SKIP LOCKED) untested**: job-queue backbone with `FOR UPDATE SKIP LOCKED` atomicity never exercised | `pipeline/src/ingest/dispatcher.py` (TEST_MATRIX rank-3, BASELINE_FINDINGS §5) | Race conditions in job claiming and schedule advancement are invisible; job deduplication guarantee untested | M |
| P1-08 | **`workflows/actions/score_tenants.match_tenants()` untested**: fires on every solicitation push; multi-factor scoring weight correctness, `tenant_pipeline_items` upsert | `pipeline/src/workflows/actions/score_tenants.py` (TEST_MATRIX rank-5, BASELINE_FINDINGS §5) | Wrong scoring weights silently corrupt every tenant's pipeline view; this is the primary revenue-value delivery mechanism | M |
| P1-09 | **`admin/rfp-curation/[solId]/push` untested**: solicitation push, tool delegation, `finder:solicitation.pushed` event (which triggers `OnSolicitationPushed` → scoring) | `frontend/app/api/admin/rfp-curation/[solId]/push/route.ts` (TEST_MATRIX rank-14) | Critical admin publish path; solicitation push that triggers scoring is the core admin → tenant delivery chain | M |
| P1-10 | **`topic_expander` entire module untested**: `_derive_source_id()`, `_content_hash()` MD5, `_upsert_topic()` dedup on `(solicitation_id, topic_number)` — zero coverage on M3 Scouting Spine | `pipeline/src/ingest/topic_expander.py` (TEST_MATRIX rank-4, BASELINE_FINDINGS §5) | Known double-emit bug has no regression guard; topic dedup logic and hash stability completely unvalidated | M |
| P1-11 | **`crypto.py` AES-256-GCM round-trip untested**: SAM.gov uses encrypted API key from `api_key_registry`; key rotation silently breaks all SAM.gov ingest | `pipeline/src/storage/crypto.py` (TEST_MATRIX rank-2, BASELINE_FINDINGS §5) | Silent regression risk: any key rotation or environment change breaks SAM.gov ingestion with no visible error | S |
| P1-12 | **7 routes emit events outside try/catch**: event failure throws 500 after the business operation already succeeded | `admin/topics/[id]`, `admin/upload-topic-files`, `stripe/portal`, `portal/library/upload`, `portal/proposals/.../sections/.../export`, `portal/proposals/.../sections/.../save` (ARCHITECTURE_V9 §13.5) | User sees 500 after a successful action; the core operation is committed but the event is lost; event log becomes unreliable | S |
| P1-13 | **4 routes call `auth()`/`requireAdmin()` outside outer try/catch**: if auth itself throws, the error is unhandled | `admin/rfp-document/[id]/set-primary`, `admin/rfp-document/[id]/signed-url`, `admin/rfp-upload`, `admin/site/upload-image` (ARCHITECTURE_V9 §13.5) | Auth exception propagates as unhandled rejection; no error response returned to client | S |
| P1-14 | **`middleware.ts` role guards completely untested**: all path-based role enforcement, tenant slug extraction, temp-password redirect | `frontend/middleware.ts` (TEST_MATRIX rank-15) | Route protection bypass risk never exercised; a regression in middleware silently removes all access control | M |
| P1-15 | **`admin/rfp-curation/[solId]/triage` state machine untested**: triage accept/defer/reject/skip transitions and conflict detection | `frontend/app/api/admin/rfp-curation/[solId]/triage/route.ts` (TEST_MATRIX) | Admin triage state machine is the entry point for the entire curation workflow; invalid transitions are undetected | M |
| P1-16 | **`admin/applications/[id]/accept` onboarding path untested**: tenant + tenant_admin creation in `sql.begin` tx, welcome email trigger | `frontend/app/api/admin/applications/[id]/accept/route.ts` (TEST_MATRIX) | Critical onboarding path; transaction failure during customer creation leaves partial state | M |
| P1-17 | **`lib/process/force-advance.ts` + `lib/tasks/tasks.ts` bare sql calls, no try/catch**: 4 bare `await sql` calls in force-advance; `listOpenTasksForActor` / `completeTask` in tasks.ts | `frontend/lib/process/force-advance.ts`, `frontend/lib/tasks/tasks.ts` (BASELINE_FINDINGS §4, TEST_MATRIX) | DB error in HITL force-advance or task completion propagates as unhandled rejection; partial-failure path untested | S |

---

## P2 — Medium (fix soon after launch)

| # | Gap | Evidence (file:area) | Impact | Effort |
|---|-----|---------------------|--------|--------|
| P2-01 | **`AI_INVOKE` workflow steps always skip**: `_execute_ai_invoke()` in `processor.py` always returns `{skipped: True}` → `OnProposalAdvancedToReview` AI compliance check never runs | `pipeline/src/workflows/processor.py` (ARCHITECTURE_V9 §9.4, §14.2) | AI compliance check on review stage advancement is permanently disabled; workflow silently skips this step | L |
| P2-02 | **Agent workforce not wired**: `AgentFabric()` is a dead local var in `main.py:72`; 10 archetypes register but `invoke_agent()` is never called; `process_task_queue()` is never scheduled | `pipeline/src/main.py:72`, `pipeline/src/agents/fabric.py` (ARCHITECTURE_V9 §9.4, BASELINE_FINDINGS §2.6) | The entire pipeline agent workforce (10 archetypes, task queue, human-gate loop) is built but produces zero value at runtime | L |
| P2-03 | **`DiffAnalyzer` + `OutcomeAttributor` have no callers**: no `OnProposalSectionEdited` or `OnProposalOutcomeRecorded` workflow exists | `pipeline/src/agents/learning/diff_analyzer.py`, `pipeline/src/agents/learning/outcome_attributor.py` (ARCHITECTURE_V9 §14.2) | Learning flywheel (edit attribution, outcome scoring) is dead; agent performance metrics never update | M |
| P2-04 | **`draft_section` + `review_section` job kinds defined in CHECK enum but have no dispatch handler**: `pipeline_jobs.kind` CHECK allows them but `dispatcher.py` has no handler | `pipeline/src/ingest/dispatcher.py` (ARCHITECTURE_V9 §5.2) | Jobs of these kinds silently fail or are never routed; future wiring will require schema-to-code alignment check | S |
| P2-05 | **`social_poster` `NotImplementedError` stub**: LinkedIn and Twitter adapters raise `NotImplementedError`; CMS social posting fails for all posts | `services/cms/src/workers/social_poster.py` (ARCHITECTURE_V9 §6.2, BASELINE_FINDINGS §2.5) | All social distribution actions create DB rows but posts never go live; CRM social capability is zero | L |
| P2-06 | **`/api/portal/[tenantSlug]/agents/config` returns 501**: stub route (P2-18 TODO in code); agent config UI unusable | `frontend/app/api/portal/[tenantSlug]/agents/config/route.ts` (ARCHITECTURE_V9 §14.2) | Agent configuration page renders but API returns 501; feature is unusable | M |
| P2-07 | **`GET /api/system` returns 501**: dead stub; `/api/admin/system` does the job but this route remains | `frontend/app/api/system/route.ts` (DEPRECATION_CANDIDATES §A) | Dead stub causes confusion; should be removed or implemented | S |
| P2-08 | **PPTX/XLSX exporters unwired**: `pptx-exporter.ts` and `xlsx-exporter.ts` have no importers; only DOCX export is wired in the export routes | `frontend/lib/export/pptx-exporter.ts`, `frontend/lib/export/xlsx-exporter.ts` (ARCHITECTURE_V9 §14.3, DEPRECATION_CANDIDATES §A) | Users cannot export proposals to PPTX or XLSX despite those exporters existing | M |
| P2-09 | **`scoring/engine.py::ScoringEngine` dead duplicate**: grep-confirmed zero callers; live scoring is `match_tenants()` | `pipeline/src/scoring/engine.py` (BASELINE_FINDINGS §6, DEPRECATION_CANDIDATES §A) | Dead code creates confusion about the live scoring path; maintenance burden | S |
| P2-10 | **`agents/tools.py` ToolRegistry — 9 SQL handlers with tenant isolation untested**: agent tools enforce `tenant_id` but no test verifies isolation | `pipeline/src/agents/tools.py` (TEST_MATRIX rank-11) | Tenant isolation bugs in agent tool SQL handlers would be invisible; when agents are wired these could leak cross-tenant data | M |
| P2-11 | **`email_queue.py` batch dequeue + retry + daily limits untested**: batch SKIP LOCKED, exponential retry, daily send limits | `services/cms/src/workers/email_queue.py` (TEST_MATRIX rank-12) | Email delivery correctness and rate-limit behavior completely untested; retry storm or limit bypass possible | M |
| P2-12 | **`admin/site/upload-image` + `admin/rfp-upload` + related routes: auth outside outer try/catch** | See P1-13 routes expanded | Auth exception unhandled in file upload routes | S |
| P2-13 | **CMS integration tests require live DB but never run in CI**: `test_page_blocks_integration.py` requires `TEST_DATABASE_URL` + `TEST_CMS_DATABASE_URL`; CI runs only `pytest tests/` which skips integration tests | `services/cms/tests/test_page_blocks_integration.py` (TEST_MATRIX, CMS inventory) | Two-DB publish bridge never CI-validated; integration regressions only surface in production | M |
| P2-14 | **`automation_rules` dual schema (`trigger_bus`/`trigger_events` vs. `trigger_namespace`/`trigger_type`)**: legacy columns are dead but remain in the schema; CMS introspects both | ARCHITECTURE_V9 §7.5, BASELINE_FINDINGS §6.3 | Schema maintenance burden; future migrations must account for both column sets; risk of inadvertent write to legacy columns | M |
| P2-15 | **RLS enabled on 4 memory tables with zero policies**: deny-all for restricted DB roles; bypassed by DB owner connection | ARCHITECTURE_V9 §7.4, BASELINE_FINDINGS §2.8 | RLS is misleadingly documented as active isolation; actual isolation relies entirely on `WHERE tenant_id`; if connection role ever changes, all memory tables become inaccessible | M |
| P2-16 | **Dead code blocks in `opportunity-update-topic.ts`, `volume-update-required-item.ts`, `rfp-curation/[solId]/triage/route.ts`**: dynamic SQL builder built and never executed | DEPRECATION_CANDIDATES §A | Dead SQL builder code could be activated accidentally; creates confusion | S |
| P2-17 | **`proposal_sections.content` column is TEXT but written with `::jsonb` cast**: documented in AUDIT_PRELAUNCH as working but non-explicit | `AUDIT_PRELAUNCH_20260428 §Audit4-Break4` | Technical debt; future migration to JSONB type is needed for explicit semantics | S |
| P2-18 | **`OnProposalAdvancedToFinal` `generate_preview` ACTION untested**: ZIP + S3 export entirely untested | `pipeline/src/workflows/actions/generate_preview.py` (TEST_MATRIX) | Preview generation for Final stage is unvalidated | M |
| P2-19 | **`OnRfpUploaded` retry logic (3 retries, 30s delay) untested**: extract_compliance fallback also untested | `pipeline/src/workflows/on_rfp_uploaded.py` (TEST_MATRIX) | Shredder retry behavior under failure untested; compliance extraction fallback path invisible | S |
| P2-20 | **`lib/storage/s3-client.ts::listObjects` bare `s3.send` with no try/catch** | `frontend/lib/storage/s3-client.ts` (BASELINE_FINDINGS §4) | S3 list errors propagate as unhandled rejections | S |
| P2-21 | **`portal/[tenantSlug]/proposals` (POST) immediately returns 400 "use /create"**: redundant endpoint | DEPRECATION_CANDIDATES §A | Minor confusion; route exists only as a guard; could be removed | S |
| P2-22 | **`portal-nav-link.tsx` duplicate of `admin-nav-link.tsx`**: identical logic, different color | DEPRECATION_CANDIDATES §A | Minor duplication; consolidate when touching nav components | S |

---

## P3 — Deferred / V2

| # | Gap | Evidence | Impact | Effort |
|---|-----|----------|--------|--------|
| P3-01 | **Full pipeline agent workforce wiring** (all 4 steps per ARCHITECTURE_V9 §9.4): pass `fabric` to processor, wire `_execute_ai_invoke`, schedule `process_task_queue`, implement `OnProposalSectionEdited` + `OnProposalOutcomeRecorded` workflows | ARCHITECTURE_V9 §9.4 | Agent-assisted proposals, compliance review, opportunity analysis, scoring strategy — all dormant | L |
| P3-02 | **Vector embeddings for memory retrieval**: V1 uses zero-vector placeholders; ILIKE text-only; pgvector HNSW indexes unused | ARCHITECTURE_V9 §9.3 | Memory search quality is keyword-only; semantic similarity search disabled | L |
| P3-03 | **Wire PPTX/XLSX exporters**: implement export route dispatch to existing exporters | ARCHITECTURE_V9 §14.2 | PPTX/XLSX export feature gap | M |
| P3-04 | **Social poster OAuth implementation**: LinkedIn + Twitter OAuth adapters needed to replace `NotImplementedError` stubs | `services/cms/src/workers/social_poster.py` | Social distribution permanently broken | L |
| P3-05 | **Recurring CMS campaign true cron**: `campaign_executor.py:342` defers recurring campaigns to V2 | `services/cms/src/workers/campaign_executor.py` | Recurring email campaigns cannot be scheduled | M |
| P3-06 | **Implement `agents/config` routes** (501 stub): agent configuration UI for tenant_admin | `frontend/app/api/portal/[tenantSlug]/agents/config/` | Agent config feature unusable | M |
| P3-07 | **`legacy event buses` (`opportunity_events`, `customer_events`, `content_events`) retirement**: write-path grep + retention decision + migration to drop | DEPRECATION_CANDIDATES §B | Schema clutter; NOTIFY triggers still active | M |
| P3-08 | **Deprecate `trigger_bus`/`trigger_events` columns from `automation_rules`**: write-path confirmed dead | DEPRECATION_CANDIDATES §B, ARCHITECTURE_V9 §7.5 | Schema debt from dual-schema migration history | S |
| P3-09 | **Deprecate `pipeline/src/scoring/engine.py::ScoringEngine`**: zero callers confirmed | DEPRECATION_CANDIDATES §A | Dead code | S |
| P3-10 | **Archive stale docs**: `docs/EVENT_CONTRACT.md`, `docs/NAMESPACES.md`, `docs/phase-1/*`, `docs/PHASE_0_5_*.md`, `docs/IMPLEMENTATION_PLAN_V2.md`, `docs/HITL_TEST_PLAN.md`, `docs/AUTOMATION_WORKFLOWS.md` → `docs/archive/` | DEPRECATION_CANDIDATES §C | Navigation hazard; stale guidance may mislead developers | S |
| P3-11 | **Fix stale text in live docs**: `CLAUDE.md` (points to V5, says CMS dormant, says /data storage), `docker-compose.yml` (CMS V1 dormant comment), `.env.example` (CMS V1 dormant), `docs/FOLDER_STRUCTURE.md` | DEPRECATION_CANDIDATES §D | Developers follow stale SOPs; new team members are misinformed | S |
| P3-12 | **Delete `docs/CLAUDE_CLIFFNOTES.md`** (stale 2026-04-27 duplicate of root CLIFFNOTES): navigation hazard | DEPRECATION_CANDIDATES §C | Developers read outdated schema and SOP guidance | S |
| P3-13 | **Delete or rename `scripts/migrate.sh`** (no tracking table; CLIFFNOTES marks it "NEVER USE") | DEPRECATION_CANDIDATES §C | Risk of accidental untracked migration run | S |
| P3-14 | **Resolve suspected-dead DB tables** (`solicitation_templates`, `solicitation_outlines`, `library_atom_outcomes`, `spotlights`): write-path grep + retention decision | DEPRECATION_CANDIDATES §B | Schema debt | M |
| P3-15 | **Standardize API convention** (`withHandler()` vs. raw `NextResponse.json`): `API_CONVENTIONS.md` mandates `withHandler()`; CLIFFNOTES shows raw pattern; codebase uses both | BASELINE_FINDINGS §4, ARCHITECTURE_V9 §13.5 | Inconsistent error handling shape; harder to audit | L |
| P3-16 | **`CMS memory lifecycle module tests`**: `MemoryStore`, decay, GC, compactor, contradiction_resolver, preference_extractor, pattern_promoter — all at 0% or <15% | TEST_MATRIX §lifecycle | Learning system reliability unvalidated (low immediate risk since wired but dormant) | L |

---

## Cross-Reference: LAUNCH_READINESS_REVIEW vs. AUDIT_PRELAUNCH vs. As-Built Conflicts

The `LAUNCH_READINESS_REVIEW.md` is scoped exclusively to **marketing site conversion** (public pages, copy, CTAs, pricing narrative). It does not address backend, API, pipeline, or security readiness. It correctly declares itself "soft-launch GO for warm/referral traffic" and notes several items as shipped (migrations 059/060, `/federal-rd-101`, analytics instrumentation). This scope is coherent and does not conflict with the engineering gap analysis — these are orthogonal concerns.

The `docs/AUDIT_PRELAUNCH_20260428.md` (dated 2026-04-28, ~55 days before this baseline) declared "All 12 critical issues fixed" and noted major issues as "documented, non-blocking." The as-built baseline reveals the following **conflicts between the April audit's assertions and the June as-built reality**:

| Conflict | April audit claim | June as-built truth |
|----------|------------------|---------------------|
| ILIKE escaping | "Fixed: `sbir-data/lookup/route.ts` escapes ILIKE wildcards" | `memory-search.ts` and `library-search-atoms.ts` still have unescaped ILIKE (different files, same class of bug) |
| Routes missing `{code}` field | "8+ routes non-blocking major; 18+ return 501" | 20+ routes missing inner try/catch (partly overlapping, partly new); stub count may have changed |
| `invite` route event + transaction | Not mentioned in April audit | Double-prefixed event + no transaction is a confirmed bug in current code |
| `consent` route transaction | Not mentioned in April audit | Missing transaction confirmed in current code |
| `portal/profile` role floor | Not mentioned in April audit | Confirmed missing in current code |
| Agent workforce | Not audited (was out-of-scope in April) | Built-but-dormant (not a regression — not yet wired) |
| PDF reader import | Not audited in April | `{PDFParse}` named import bug exists in current code |
| `lifecycle_scheduler` recursive reconnect | Not audited in April | Confirmed in current code |
| CMS status | April audit scoped to frontend only | CMS is fully live (87 endpoints, 7 workers) — not a regression but a knowledge gap in April scope |

**Net assessment:** The April audit addressed the right critical issues for its date and scope. The June baseline reveals a second wave of bugs (primarily introduced in M3 / post-April work) and documents gaps that were always out of scope for the April audit. No April-fixed issue appears to have regressed.
