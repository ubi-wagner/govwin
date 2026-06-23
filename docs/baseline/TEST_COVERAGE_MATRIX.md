# Test Coverage Matrix — RFP Pipeline Portal

**Generated:** 2026-06-23  
**Source:** Baseline phase-1 file-by-file inventory (`docs/baseline/inventory/`) + direct test-file inspection  
**Legend:** ✅ full · 🟡 partial · ❌ none | Risk: H = high · M = medium · L = low  
**Placeholder tests (4):** `test_sam_gov`, `test_scoring`, `test_agents`, `test_memory` — each contains a single `assert True` and count as **zero real tests**.

---

## Summary Table

| Subsystem | Rough coverage | Real tests | Placeholder files | Test gaps (rows below) |
|-----------|---------------|------------|-------------------|----------------------|
| Pipeline — ingest | ~40% | 2 real files (unit + e2e) | 1 (`test_sam_gov`) | 6 |
| Pipeline — shredder | ~85% | 6 files | 0 | 2 |
| Pipeline — storage | ~95% | 2 files | 0 | 0 |
| Pipeline — dispatcher | 0% | 0 | 0 | 2 |
| Pipeline — scoring | 0% | 0 | 1 (`test_scoring`) | 2 |
| Pipeline — source scout | 0% | 0 | 0 | 2 |
| Pipeline — crypto | 0% | 0 | 0 | 1 |
| Pipeline — lifecycle/memory | ~20% | 2 files (lifecycle only via tasks ledger) | 1 (`test_memory`) | 4 |
| Pipeline — workflow engine | ~75% | 8 files (engine, HITL, force-advance, manager, catalog, todo, timeout, error-gating) | 0 | 2 |
| Pipeline — agents/fabric | 0% | 0 | 1 (`test_agents`) | 3 |
| Pipeline — document agents | 0% | 0 | 0 | 2 |
| Frontend — tools | ~80% | 7 files (registry + 5 domain tool suites + compliance) | 0 | 3 |
| Frontend — libs (rbac, process, tasks, storage, errors) | ~70% | 6 files | 0 | 4 |
| Frontend — API routes (138 total) | ~3% | 1 smoke test covers ~5 routes | 0 | 15 |
| CMS — event listener | ~80% | 4 files (phase, phantom, error-gating, templates) | 0 | 3 |
| CMS — email queue/sweep | 0% | 0 | 0 | 3 |
| CMS — page-blocks | ~60% | 2 files (router unit + integration) | 0 | 2 |
| CMS — drip | 0% | 0 | 0 | 2 |
| CMS — workers general | 0% | 0 | 0 | 3 |
| **Total real tests** | — | Pipeline: ~25 real + 4 placeholder; Frontend: 16 files; CMS: ~10 real (2 require live DB) | 4 | — |

---

## Component × Use Case Matrix

### PIPELINE: Ingest

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `BaseIngester.run()` | Happy-path insert: new opportunity → `opportunities` + `curated_solicitations` rows | 🟡 partial | `test_ingest_e2e.py` (SAM stub mode only) | H | SBIR, Grants.gov, DSIP paths not exercised in e2e |
| `BaseIngester._hash()` | Determinism, sensitivity, missing fields, cross-source uniqueness | ✅ full | `test_ingest_framework.py` | L | — |
| `BaseIngester.run()` | Dedup on `(source, source_id)` — identical second ingest produces 0 new rows | ✅ full | `test_ingest_e2e.py` | M | — |
| `BaseIngester.run()` | **Content-hash dedup-under-update** (`was_insert=False`, amended path, `finder:opportunity.amended` event) | ❌ none | — | H | No test for the amended/updated branch; `_create_triage_row` asyncpg tag parsing is fragile |
| `SamGovIngester` | `normalize()` mapping (multi-NAICS, missing fields, date parsing) | ✅ full | `test_ingest_framework.py` | L | — |
| `SamGovIngester` | `fetch_page()` — HTTP pagination, rate-limit 429, 502 contract error | ❌ none | `test_sam_gov.py` (placeholder) | H | Rate-limit + contract error paths entirely untested |
| `SamGovIngester` | API-key decryption path (`_resolve_api_key` → crypto round-trip) | ❌ none | — | H | Silently breaks SAM.gov ingest if encryption key rotated |
| `SbirGovIngester` | `normalize()` mapping (Phase I/II, SBIR/STTR, topic-level rows) | ✅ full | `test_ingest_framework.py` | L | — |
| `SbirGovIngester` | Parent BAA row creation (`_ensure_parent_solicitation`) | ❌ none | — | M | No test for the parent-solicitation creation branch |
| `GrantsGovIngester` | `normalize()` mapping (CFDA→classification_code) | ✅ full | `test_ingest_framework.py` | L | — |
| `GrantsGovIngester` | `_is_relevant()` keyword filter | ❌ none | — | M | Filter logic could incorrectly reject valid grants |
| `DsipIngester` | JSON-API path + HTML-scraping fallback | ❌ none | — | M | HTML parser silently fails with class-name changes |
| `topic_expander` | `_derive_source_id()`, `_content_hash()` MD5, `_upsert_topic()` dedup on `(solicitation_id, topic_number)` | ❌ none | — | H | M3 Scouting Spine backbone — zero coverage, bug known (double-emit) |
| `topic_expander` | `render_topic_url()` non-DSIP path + `topic_numbers` list requirement | ❌ none | — | M | Callers unaware of empty result when topic_numbers absent |
| `topic_expander` | `_emit_topics_expanded()` — double-emission with dispatcher (known bug) | ❌ none | — | H | Bug unflagged by any regression test |

### PIPELINE: Dispatcher

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `dispatcher.tick_schedules()` | Reads `pipeline_schedules`, inserts due jobs, updates `next_run_at` | ❌ none | — | H | Job-queue backbone untested |
| `dispatcher.consume_one_job()` | `FOR UPDATE SKIP LOCKED` atomic claim, status transitions pending→running→completed/failed | ❌ none | — | H | Race condition + skip-locked semantics never exercised |
| `dispatcher._run_ingest_job()` | Routes by source string to correct ingester | 🟡 partial | `test_ingest_e2e.py` (SAM path only) | M | Other 3 ingesters never dispatched via dispatcher |
| `dispatcher._run_expand_topics_job()` | Queues and runs expand-topics; double-emit of `finder:topics.expanded` | ❌ none | — | H | Known double-emit bug has no regression guard |
| `dispatcher._run_scout_job()` | Routes to `source_scout.scout_source` / `scout_all_due` | ❌ none | — | M | — |
| `dispatcher._run_shred_job()` | Routes to shredder, writes failed status on missing solicitation_id | 🟡 partial | `test_ingest_e2e.py` (missing-id error path + mock happy path) | M | Real Claude path only via golden fixtures |

### PIPELINE: Shredder

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `shredder/runner.py` | Happy path: section extraction + compliance → `ai_extracted`, `solicitation_compliance` | ✅ full | `test_shredder_runner.py`, `test_shredder_regression.py` | L | — |
| `shredder/runner.py` | Idempotent re-run (UPSERT, single compliance row) | ✅ full | `test_shredder_runner.py` | L | — |
| `shredder/runner.py` | No-text path → `shredder_failed` | ✅ full | `test_shredder_runner.py` | M | — |
| `shredder/runner.py` | Budget exceeded → `ShredderBudgetError` | ✅ full | `test_shredder_runner.py` | M | — |
| `shredder/extractor.py` | `extract_text_from_pdf()` markdown passthrough, cap truncation, pymupdf failure | ✅ full | `test_shredder_extractor.py` | L | — |
| `shredder/extractor.py` | `extract_text_from_s3_key()` — synchronous boto3 inside async | ❌ none | — | M | Blocking event-loop issue untested; boto3 call path never mocked |
| `shredder/compliance_mapping.py` | `_coerce`, `split_matches`, alias, custom_variables | ✅ full | `test_shredder_compliance_mapping.py` | L | — |
| `shredder/namespace.py` | `compute_namespace_key()` — 6 canonical examples, aliases, collapsing | ✅ full | `test_shredder_namespace.py` | L | — |
| `shredder/sync_extract.py` | Happy path, fence-stripping, oversized input, non-list | ✅ full | `test_shredder_sync_extract.py` | L | — |
| `shredder/runner.py` | `_upsert_compliance` dynamic SQL column construction (allowlist guard) | ❌ none | — | M | Column-injection guard logic not independently tested |

### PIPELINE: Storage

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `storage/paths.py` | All path helpers — happy paths + validation errors | ✅ full | `test_storage_paths.py` | L | — |
| `storage/s3_client.py` | `put_text`, `put_json`, `copy_object`, `list_keys`, `put_object`, `get_object_bytes`, error wrapping | ✅ full | `test_storage_helpers.py` | L | — |
| `storage/portal_provisioner.py` | Happy path (5 artifacts + manifest), compliance snapshot, missing compliance, missing opportunity | ✅ full | `test_portal_provisioner.py` | L | — |
| `crypto.py` | AES-256-GCM encrypt/decrypt round-trip | ❌ none | — | H | Silent breakage kills SAM.gov key-based ingest |

### PIPELINE: Scoring

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `workflows/actions/score_tenants.py` — `match_tenants()` | Multi-factor scoring (NAICS, keyword, agency, set-aside, program type, timeline); upserts `tenant_pipeline_items` | ❌ none | `test_scoring.py` (placeholder) | H | Fires on every solicitation push; wrong weights silently corrupt tenant pipeline |
| `scoring/engine.py` — `ScoringEngine` | Iterates approved/pushed solicitations, delegates to `match_tenants` | ❌ none | `test_scoring.py` (placeholder) | L | Engine appears dormant; but verify before deleting |

### PIPELINE: Source Scout

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `workers/source_scout.py` — `scout_source()` | Fetch page HTML, SHA-256 hash per region, Claude diff analysis, write `source_snapshots` + `source_diffs` | ❌ none | — | H | Claude diff analysis silently returns null (known bug in frontend tool; backend side also untested) |
| `workers/source_scout.py` — `scout_all_due()` | Sequential iteration of profiles with `auto_crawl_enabled` | ❌ none | — | M | Sequential (no concurrency) performance characteristic untested |
| `workers/source_scout.py` | JS-only page detection heuristic (`__NEXT_DATA__`) | ❌ none | — | M | Silent miss on non-Next SPA frameworks |

### PIPELINE: Lifecycle / Memory / Learning

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `lifecycle_scheduler.py` — recursive reconnect | Stack-overflow risk under sustained DB outage | ❌ none | — | M | Known bug; no regression guard |
| `agents/memory.py` — `MemoryStore` | `store()`, `recall()`, `search()` — write + retrieve episodic/semantic/procedural | ❌ none | `test_memory.py` (placeholder) | H | Used by lifecycle modules (decay, GC, pattern_promoter) — zero direct coverage |
| `agents/lifecycle/decay.py` | Daily decay: `decay_factor` updates, exemptions (recently-accessed, high-importance floor) | ❌ none | — | M | Never tested even via fake-conn |
| `agents/lifecycle/gc.py` | Weekly GC: retention guards (importance ≥ 0.9, evidence_count ≥ 5), hard-delete | ❌ none | — | M | Safety guards could silently break if thresholds change |
| `agents/lifecycle/compactor.py` | Monthly compaction: clustering, compress 5+ → semantic memory | ❌ none | — | L | Dormant but wired to scheduler |
| `agents/lifecycle/contradiction_resolver.py` | Monthly contradiction detection + resolve by confidence | ❌ none | — | L | Writes `tasks` on human-review flag — untested |
| `agents/learning/preference_extractor.py` | Daily: recurring keyword scan → semantic preferences | ❌ none | — | L | Wired to scheduler |
| `agents/learning/pattern_promoter.py` | Weekly: cluster episodic by keyword overlap → semantic | ❌ none | — | L | Wired to scheduler |

### PIPELINE: Workflow Engine

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `workflows/processor.py` | Dead bypass code absent; HITL_WAIT surface | ✅ full | `test_engine_single_path.py` (structural guard) | L | — |
| `workflows/manager.py` — HITL park/resume | `HITL_WAIT` parks with deadline; event-based resume; timeout sweep emits `workflow.wait_timed_out` | ✅ full | `test_hitl_lifecycle.py` | M | — |
| `workflows/manager.py` — HITL alignment | `EventTrigger.matches()` for proposal-review gate (phase="end" matches producer) | ✅ full | `test_hitl_wait_alignment.py` | M | — |
| `workflows/manager.py` — force-advance | `resume_instance` transitions paused→retrying; skips completed steps | ✅ full | `test_force_advance.py` | M | — |
| `workflows/manager.py` — on_timeout escalation | `on_timeout` step validated; park-deadline sweep runs on_timeout; `workflow.escalation_ran` emitted | ✅ full | `test_on_timeout_escalation.py` | M | — |
| `workflows/base.py` — `EventTrigger.matches()` | Rejects errored events | ✅ full | `test_error_gating.py` | L | — |
| `tasks_ledger` | `StepType.TODO` resolution, task field validation, `complete_task` resume, nudge idempotency | ✅ full | `test_tasks_ledger.py` | M | — |
| `process_templates` catalog | `sync_template_catalog` upsert; launch-gate refuses inactive templates; gate fails open on missing table | ✅ full | `test_template_catalog.py` | M | — |
| `on_proposal_advanced` TODO producer | `OnProposalAdvancedToReview` TODO step for tenant_admin; `OnSourceChangeDetected` TODO for rfp_admin | ✅ full | `test_todo_producers.py` | M | — |
| `workflows/processor.py` — AI_INVOKE | `_execute_ai_invoke` always skips when fabric not wired; `tool.proposal.check_compliance` ImportError path | ❌ none | — | H | AI_INVOKE silently skips in all deployments; no test asserts this contract |
| `workflows/actions/score_tenants.py` | see Scoring section above | ❌ none | — | H | — |

### PIPELINE: Workflow Templates (9 templates)

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `OnApplicationAccepted` | create_library_defaults ACTION + HITL_WAIT parking | 🟡 partial | `test_todo_producers.py` (TODO step only), `test_hitl_lifecycle.py` (generic park) | M | `create_library_defaults` ACTION not unit-tested independently |
| `OnCmsContentRequested` | draft→review TODO→publish→notify full chain | ✅ full | `test_cms_content_vertical.py`, `test_cms_content_integration.py` | L | — |
| `OnOpportunitiesDetected` | NOTIFY + TODO for rfp_admin | 🟡 partial | `test_todo_producers.py` (partial) | L | NOTIFY template render tested in CMS suite; full dispatch untested |
| `OnProposalAdvancedToReview` | AI_INVOKE (skipped) + NOTIFY + TODO parking | 🟡 partial | `test_todo_producers.py` (TODO), `test_hitl_wait_alignment.py` | H | AI_INVOKE always skipped; no test covers what happens when compliance check returns |
| `OnProposalAdvancedToFinal` | generate_preview ACTION + NOTIFY | ❌ none | — | M | `generate_preview` function (ZIP + S3) entirely untested |
| `OnProposalCreated` | NOTIFY-only (docstring/code mismatch) | 🟡 partial | `test_todo_producers.py` (indirectly) | L | Docstring/code mismatch not caught by any test |
| `OnRfpUploaded` | shred_document (3 retries) + extract_compliance + NOTIFY | 🟡 partial | `test_shred_consolidation.py` (importability + event surface), `test_shredder_runner.py` (shredder unit) | H | Retry logic (3 retries, 30 s delay) not tested; extract_compliance fallback path not tested |
| `OnSolicitationPushed` | find_matching_tenants ACTION + NOTIFY | ❌ none | — | H | `match_tenants` entirely untested; see Scoring section |
| `OnSourceChangeDetected` | create_draft_solicitations + NOTIFY + TODO with on_timeout | ✅ full | `test_create_drafts_from_scout.py`, `test_todo_producers.py`, `test_on_timeout_escalation.py` | L | — |

### PIPELINE: Dormant Agents (all 10 archetypes)

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `AgentFabric` + all 10 archetypes | Instantiation, archetype registration, `invoke_agent()`, tool execution loops | ❌ none | `test_agents.py` (placeholder) | M | Fabric is dormant but instantiated at startup; registration failures silently logged |
| `agents/learning/diff_analyzer.py` | `analyze()` — difflib edit classification (STYLE/CONTENT/STRUCTURE/MINOR) | ❌ none | — | L | Dead code (no caller); low risk |
| `agents/learning/outcome_attributor.py` | `attribute()` — win/loss attribution to `agent_performance` | ❌ none | — | L | Dead code (no caller); low risk |
| `agents/tools.py` — `ToolRegistry` | `create_default_registry()`: 9 tool SQL handlers, tenant isolation enforcement | ❌ none | — | H | Tenant-isolation bugs in agent tools would never be caught |

### PIPELINE: Document Agents

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `document/docx_agent.py` | Ingest, atomize, export round-trip (python-docx) | ❌ none | — | L | Dormant; low risk currently |
| `document/pptx_agent.py` | Ingest, per-slide atomize, export (chart placeholder silent truncation) | ❌ none | — | L | Dormant; silent chart drop untested |
| `document/xlsx_agent.py` | Ingest (100-row cap), per-sheet atomize, full style export | ❌ none | — | L | Dormant; row-cap truncation silently sets metadata flag |
| `document/pdf_agent.py` | Ingest + atomize only; `export()` raises NotImplementedError | ❌ none | — | L | Dormant |
| `document/converter.py` | `convert_format()` — no timeout (potential hung LibreOffice) | ❌ none | — | M | Timeout bug confirmed; no regression test |

---

### FRONTEND: API Routes (138 total)

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `auth/[...nextauth]` | Login, session, signout, authorize() DB query | ❌ none | `integration/smoke.test.ts` (partial connectivity only) | H | Auth provider completely untested |
| `auth/change-password`, `forgot-password`, `reset-password` | Password flows end-to-end | ❌ none | — | H | Token expiry, bcrypt failure, enumeration defense untested |
| `stripe/webhook` | HMAC verification, `checkout.session.completed`, subscription events, `sql.begin` transaction | ❌ none | — | H | Critical monetization path; signature bypass risk untested |
| `stripe/checkout` | Session creation, purchase gate, tenant lookup | ❌ none | — | H | — |
| `portal/[tenantSlug]/proposals/create` | Purchase gate, transaction covering 6 table writes, founding-cohort bypass | ❌ none | — | H | Most complex single route; sql.begin transaction untested |
| `portal/[tenantSlug]/proposals/[proposalId]/advance` | Stage gate check, OCC, lock, multi-table tx, `proposal.advanced` event | ❌ none | — | H | Stage-gate logic and OCC version check untested |
| `portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` | OCC version conflict, canvas_versions snapshot, collaborator edit permission | ❌ none | — | H | OCC conflict (`409 CONFLICT`) untested |
| `tools/[name]` | Tool gateway routing, ToolNotFoundError, ToolAuthorizationError, ToolValidationError | 🟡 partial | `tools-registry.test.ts` (tool registration only) | H | HTTP dispatch layer untested; error translation untested |
| `admin/rfp-curation/[solId]/push` | Solicitation push, tool delegation, `finder:solicitation.pushed` event | ❌ none | — | H | Critical admin curation step; untested |
| `admin/rfp-curation/[solId]/triage` | State machine transitions (accept/defer/reject/skip), conflict detection | ❌ none | — | H | State machine untested |
| `admin/applications/[id]/accept` | Tenant + tenant_admin creation in sql.begin tx, welcome email | ❌ none | — | H | Onboarding critical path untested |
| `invite` | Token validation, password set, collaborator join — dual partial-failure bugs | ❌ none | — | H | Known double-prefixed event + missing tx; both untested |
| `consent` | Multi-table write without transaction (known bug) | ❌ none | — | M | Partial-failure state inconsistency untested |
| `portal/[tenantSlug]/profile` GET | `partner_user` can read `billing_email` (known auth gap) | ❌ none | — | M | Role-floor gap untested |
| `admin/sbir-data/ingest` | `sql.unsafe` batch insert, internal error leak to client | ❌ none | — | M | Error-leak confirmed; no regression |

### FRONTEND: Lib Layer

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `lib/rbac.ts` | Role hierarchy, `hasRoleAtLeast`, `verifyTenantAccess` | ✅ full | `rbac.test.ts` | L | — |
| `lib/errors.ts` | Error class hierarchy, codes | ✅ full | `errors.test.ts` | L | — |
| `lib/storage/paths.ts` | All path builders + `assertKeyBelongsToTenant` | ✅ full | `storage-paths.test.ts` | L | — |
| `lib/process/health.ts` | `classifyProcessHealth`, `filterAndSortProcesses` | ✅ full | `process-health.test.ts` | L | — |
| `lib/process/filter` | Process filtering/sorting | ✅ full | `process-filter.test.ts` | L | — |
| `lib/tasks/urgency.ts` | `urgencyOf`, `sortByUrgency` | ✅ full | `task-urgency.test.ts` | L | — |
| `lib/process/force-advance.ts` | 4 bare `await sql` calls — no inner try/catch (known SOP gap) | ❌ none | — | H | Bare SQL under transaction has no test; partial-failure path untested |
| `lib/tasks/tasks.ts` | `listOpenTasksForActor`, `completeTask` (bare sql calls, no try/catch) | ❌ none | — | M | Same SOP gap; untested |
| `lib/tools/memory-search.ts` | Unescaped ILIKE on user input (known bug) | ❌ none | — | H | Wildcard-DoS / match-bypass; no regression |
| `lib/tools/library-search-atoms.ts` | Unescaped ILIKE on user input (known bug) | ❌ none | — | H | Same; no regression |
| `lib/tools/source-scout.ts` | Silent Claude error swallow (`catch { return null }`) | ❌ none | — | M | Error swallow confirmed; untested |
| `lib/import/pdf-reader.ts` | `{ PDFParse }` named import vs. default export (known runtime bug) | ❌ none | — | H | PDF ingestion likely broken on first call; no test |
| `lib/api-helpers/withHandler` | Handler wrapper, error translation, auth ordering | ❌ none | — | M | Used in `tools/[name]` and `admin/system`; behavior untested |
| `middleware.ts` | Auth guards, tenant slug extraction, role-based route protection | ❌ none | — | H | All route guards bypass-risk untested |

### FRONTEND: Tools (lib/tools/)

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| Tool registry | All tools registered, `requiredRole`, `schema` shape | ✅ full | `tools-registry.test.ts` | L | — |
| Solicitation read tools | `solicitation.get`, `solicitation.search`, `solicitation.get_documents` | ✅ full | `tools-solicitation-read.test.ts` | L | — |
| Solicitation state tools | `solicitation.claim`, `solicitation.push`, `solicitation.release` | ✅ full | `tools-solicitation-state.test.ts` | M | — |
| Solicitation review tools | `solicitation.save_annotation`, `solicitation.get_annotations` | ✅ full | `tools-solicitation-review.test.ts` | L | — |
| Compliance tools | `compliance.save_variable_value`, `compliance.extract_from_text`, `compliance.check` | ✅ full | `tools-compliance.test.ts` | M | — |
| Volume/section tools | Volume management, section read/write tools | ✅ full | `tools-volumes.test.ts` | M | — |
| Ingest + extra tools | `opportunity.bulk_add_topics`, `sbir_data.lookup`, `source_url.renderTopicUrl` | ✅ full | `tools-ingest-and-extra.test.ts` | M | — |
| `source_url.renderTopicUrl` | URL pattern rendering for topic expansion | 🟡 partial | `tools-ingest-and-extra.test.ts` | M | Edge cases (missing topic_number, bad pattern) not exercised |
| `memory-search.ts` ILIKE | Unescaped ILIKE on user input | ❌ none | — | H | See lib gap above |
| `library-search-atoms.ts` ILIKE | Unescaped ILIKE on user input | ❌ none | — | H | See lib gap above |
| `source-scout.ts` | Claude error silent swallow | ❌ none | — | M | — |

### FRONTEND: Pages / Middleware

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `portal/[tenantSlug]/*` pages | Tenant isolation via `tenantSlug` resolution | ❌ none | — | H | No portal page rendering tests |
| `middleware.ts` | Role guards on portal/admin routes | ❌ none | — | H | Route guard bypass never tested |
| Full curation flow scenario | Triage → claim → annotate → push | 🟡 partial | `scenarios-full-curation-flow.test.ts` (tool-layer only) | M | No API-layer or DB-layer coverage; tools mocked |
| Validation helpers | Input validation utilities | ✅ full | `validation.test.ts` | L | — |
| Smoke integration | DB connectivity, basic route response shapes | 🟡 partial | `integration/smoke.test.ts` | M | Only ~5 routes exercised; no auth flow |

---

### CMS: Event Listener

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `event_listener._rule_matches()` | Phase guard: start-phase never fires; terminal phases (end/single/unphased) fire exactly once; both schema variants | ✅ full | `test_rule_matching_phase.py` | L | — |
| `event_listener._do_action_inner()` | Every action type in dedup tuple has dispatch branch; `unpublish_content` wired | ✅ full | `test_no_phantom_executors.py` | M | — |
| `event_listener._handle_notification_requested()` | Direct fast-path for `system:notification.requested`; template render + fallback | ✅ full | `test_notify_templates.py` | M | — |
| `event_listener` | `_action_send_email`, `_action_notify_admin`, `_action_create_todo` full dispatch | ❌ none | — | H | Action handlers never exercised end-to-end |
| `event_listener` | `_action_enroll_drip` — creates `drip_enrollments` + `drip_sequences` | ❌ none | — | M | Drip enrollment path untested |
| `event_listener` | `_action_publish_content` / `_action_unpublish_content` bridge to shared DB `cms_content` | 🟡 partial | `test_no_phantom_executors.py` (structural only — confirms handler exists) | M | Actual DB write never exercised |
| `event_listener` | Error gating: skips events with truthy `error` field | ✅ full | `test_error_gating.py` | L | — |

### CMS: Workers

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `email_queue.py` | SKIP LOCKED batch dequeue, exponential retry, daily limits, trigger-flag embed | ❌ none | — | H | Email delivery path entirely untested |
| `email_sweep.py` | Gmail History API sweep, reply match by thread_id, auto-draft HITL, content-request detection | ❌ none | — | M | Complex sweep logic untested |
| `campaign_executor.py` | Audience enumeration (all_active/tier_based/segment), one-time vs. recurring (no true cron) | ❌ none | — | M | Campaign execution untested |
| `drip_engine.py` | Enrollment step advance, delay computation, `completed` status on last step | ❌ none | — | M | Drip cadence logic untested |
| `social_poster.py` | NotImplementedError caught → `failed` status (all posts fail) | ❌ none | — | L | Stub behavior; low risk |
| `content_generator.py` | 5 source types (prompt/url/email/screenshot/repackage), Claude API, status machine | ❌ none | — | M | AI generation pipeline untested |

### CMS: Page Blocks & Routing

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `routers/page_blocks.py` | `_row_to_block()` serializer, router logic (mocked DB) | ✅ full | `test_page_blocks_router.py` | L | — |
| Page-blocks two-DB publish bridge | Draft in CMS DB → publish to shared `cms_content`, editing metadata stripped, idempotent | ✅ full | `test_page_blocks_integration.py` (requires TEST_DATABASE_URL + TEST_CMS_DATABASE_URL) | M | — |
| `routers/email.py` | CRUD for accounts/templates/campaigns/sends/outbox (87 endpoints) | ❌ none | — | M | Largest router; untested |
| `routers/drip.py` | Sequence + enrollment CRUD | ❌ none | — | M | — |
| `templates.py` | Jinja2 rendering, trigger flag embed/extract round-trip, `build_trigger_metadata` | ✅ full | `test_templates.py` | L | — |
| `sender_identity.py` | Precedence order (explicit > DB > namespace > template > default), env override, error-safe | ✅ full | `test_sender_identity.py` | L | — |

### CMS: Auth & Health

| Component | Use case | Coverage | Existing test file(s) | Risk | Gap note |
|-----------|----------|----------|-----------------------|------|----------|
| `routers/health.py` | GET /health → 200 always | ✅ full | `test_health.py` | L | — |
| `routers/auth.py` | JWT cookie issuance, bcrypt check, last_login_at update, login_failed event | ❌ none | — | M | CMS auth flow untested |
| `middleware/auth.py` | API-key vs. JWT session vs. Basic fallback; fail-closed on missing key | ❌ none | — | M | Auth middleware logic untested |

---

## Top 15 Untested Critical Paths (ranked by risk)

| Rank | Path | Subsystem | Why critical | Unit-testable now? |
|------|------|-----------|-------------|-------------------|
| 1 | `stripe/webhook` — HMAC verify + `checkout.session.completed` tx | Frontend API | Monetization gatekeeper; sig bypass = free access | Yes (mock Stripe payload) |
| 2 | `crypto.py` AES-256-GCM round-trip | Pipeline | Silent breakage kills SAM.gov key ingest | Yes (pure Python, no DB) |
| 3 | `dispatcher.tick_schedules()` + `consume_one_job()` SKIP LOCKED | Pipeline | Job-queue backbone; race condition never exercised | Needs live DB |
| 4 | `topic_expander._derive_source_id()`, `_content_hash()`, `_upsert_topic()` dedup | Pipeline | M3 Scouting Spine; known double-emit bug has no regression | Yes (fake conn + mock HTTP) |
| 5 | `workflows/actions/score_tenants.match_tenants()` | Pipeline | Fires on every push; wrong weights silently corrupt pipeline | Needs live DB (complex multi-join) |
| 6 | `portal/proposals/create` (6-table sql.begin tx) | Frontend API | Proposal creation; transaction failure leaves partial state | Needs live DB |
| 7 | `portal/proposals/[id]/advance` (stage gates + OCC) | Frontend API | Stage-gate logic; OCC conflict never tested | Needs live DB |
| 8 | `portal/proposals/[id]/sections/[sectionId]/save` (OCC + collaborator permission) | Frontend API | Auto-save backbone; 409 conflict path untested | Needs live DB |
| 9 | `lib/tools/memory-search.ts` + `library-search-atoms.ts` ILIKE escaping | Frontend lib | Wildcard-DoS / match-bypass; `%` or `_` in input matches everything | Yes (unit test input→SQL) |
| 10 | `lib/import/pdf-reader.ts` `{ PDFParse }` named-import bug | Frontend lib | PDF upload immediately crashes; no test catches broken import | Yes (import + invoke) |
| 11 | `agents/tools.py` ToolRegistry — 9 SQL handlers, tenant isolation | Pipeline | Agent tools enforce tenant_id; isolation bugs invisible without tests | Needs live DB or fake conn |
| 12 | `email_queue.py` batch dequeue + exponential retry + daily limits | CMS | Email delivery; retry storm or limit bypass under test | Yes (fake DB + fake Gmail) |
| 13 | `auth/[...nextauth]` authorize() DB query path | Frontend API | Auth provider; DB error propagation to login page untested | Needs live DB |
| 14 | `admin/rfp-curation/[solId]/push` tool delegation + event | Frontend API | Admin publish gating; untested critical admin path | Yes (mock tool + fake sql) |
| 15 | `middleware.ts` role guards | Frontend | Route protection; bypass risk never exercised | Yes (mock session) |

---

## Coverage % by Subsystem (rough, real tests only)

| Subsystem | Estimated coverage | Key untested area |
|-----------|--------------------|-------------------|
| Pipeline ingest (normalize) | 75% | fetch_page, rate-limits, topic_expander, dedup-under-update |
| Pipeline dispatcher | 10% | tick_schedules, consume_one_job (SKIP LOCKED), all non-SAM routes |
| Pipeline shredder | 85% | sync boto3 in async, dynamic column guard |
| Pipeline storage | 95% | — (well covered) |
| Pipeline scoring | 0% | match_tenants, engine.py |
| Pipeline source scout | 0% | Claude diff, all paths |
| Pipeline crypto | 0% | AES round-trip |
| Pipeline workflow engine | 75% | AI_INVOKE skip contract, score_tenants |
| Pipeline agents/fabric | 0% | Archetypes, ToolRegistry, fabric wiring |
| Pipeline lifecycle/memory | 15% | MemoryStore, all lifecycle workers |
| Frontend tools | 80% | ILIKE escaping, source-scout error swallow |
| Frontend libs | 65% | force-advance, tasks, middleware, pdf-reader bug |
| Frontend API routes | 3% | 133/138 routes have zero coverage |
| CMS event listener | 80% | Action handlers end-to-end, DB bridge |
| CMS workers | 0% | email_queue, sweep, campaign, drip, content_gen |
| CMS routers (non-health, non-page-blocks) | 5% | 84 of 87 endpoints untested |
