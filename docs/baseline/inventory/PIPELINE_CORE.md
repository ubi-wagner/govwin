# Pipeline Core — File Inventory
Generated: 2026-06-23. Scope: `pipeline/**/*.py` excluding `agents/` and `workflows/`.

---

## Summary Tables

### Dispatcher job kinds → handlers

| `pipeline_jobs.kind` | Handler | What it does |
|---|---|---|
| `ingest` (default) | `_run_ingest_job` | Routes by `source` to one of the 4 ingesters below |
| `shred_solicitation` | `_run_shred_job` → `shredder.runner.shred_solicitation` | Full PDF→AI→DB shredder |
| `expand_topics` | `_run_expand_topics_job` → `ingest.topic_expander.expand_solicitation_topics` | On-demand per-solicitation topic bulk-fetch |
| `scout_source` | `_run_scout_job` → `workers.source_scout.scout_source` / `scout_all_due` | Web crawl + Claude diff analysis |

### Ingesters → source / status

| Ingester class | Source name | API / URL | Auth | Stub mode | Status |
|---|---|---|---|---|---|
| `SamGovIngester` | `sam_gov` | `https://api.sam.gov/opportunities/v2/search` | API key (DB-encrypted or env) | ✅ 5 synthetic records | ✅ active |
| `SbirGovIngester` | `sbir_gov` | `https://api.www.sbir.gov/public/api/solicitations` | None (public) | ✅ 3 synthetic solicitations with embedded topics | ✅ active |
| `GrantsGovIngester` | `grants_gov` | `https://api.grants.gov/v1/api/search2` (POST) | None | ✅ 3 synthetic records | ✅ active |
| `DsipIngester` | `dsip` | `https://www.dodsbirsttr.mil/topics-app/api/public/topics` | None | ✅ 4 synthetic topics | ✅ active |

---

## Top-level pipeline/src/

### pipeline/src/main.py
- **Use:** Process entrypoint; boots 4 concurrent asyncio loops via `asyncio.gather`
- **Defines:** `handle_signal()`, `main()`
- **Data:** No direct DB writes; passes DATABASE_URL to all loops
- **Runtime:** ✅ wired-active — 4 concurrent tasks:
  1. `run_consumer_loop` (ingester cron + job queue, tick_interval=60s)
  2. `run_workflow_processor` (workflow engine, poll_interval=10s)
  3. `run_health_server` (HTTP :8080)
  4. `run_lifecycle_scheduler` (hourly memory maintenance cron)
  Also boots `AgentFabric` (10 archetypes) and `seed_master_admin` at startup.
- **SOP flags:** none — logging configured, imports deferred, seed error is non-fatal
- **Status:** ✅ active

---

### pipeline/src/config.py
- **Use:** Environment variable loading; validates DATABASE_URL at import time, guards USE_STUB_DATA in production
- **Defines:** Module-level constants — `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL`, `SAM_GOV_API_KEY`, `API_KEY_ENCRYPTION_SECRET`, `STORAGE_ROOT`, `USE_STUB_DATA`
- **Data:** None (pure config)
- **Runtime:** ✅ wired-active
- **SOP flags:** `STORAGE_ROOT` defaults to `/data` — but S3 is the actual store (see storage/ below); this env var is vestigial from an earlier design
- **Status:** ✅ active — `STORAGE_ROOT` constant is defined but not used by storage/ code; mild confusion

---

### pipeline/src/events.py
- **Use:** Event emission layer — writes to `system_events` table; provides `emit_event`, `emit_start`, `emit_end` with start/end phase pairing; two deprecated wrapper functions for legacy compatibility
- **Defines:** `emit_event()`, `emit_start()`, `emit_end()`, `emit_opportunity_event()` (deprecated), `emit_customer_event()` (deprecated)
- **Data:** Writes → `system_events`; reads → `system_events` (for `emit_end` lookup)
- **Runtime:** ✅ wired-active
- **SOP flags:** Legacy `emit_opportunity_event` / `emit_customer_event` still present — callers should migrate to `emit_event` directly; non-fatal swallows errors correctly
- **Status:** ✅ active (legacy wrappers are ♻️ duplicate — kept for compat)

---

### pipeline/src/health.py
- **Use:** Health check HTTP server (port 8080); `GET /health` → `{"status":"ok"}`, `GET /healthz` → composite DB + S3 check
- **Defines:** `check_db()`, `check_s3()`, `full_health()`, `run_health_server()`, `_handle_request()`
- **Data:** Reads DB via `SELECT 1`; calls `storage.s3_client.ping_s3()` (HeadBucket)
- **Runtime:** ✅ wired-active
- **SOP flags:** Uses raw asyncio HTTP (no framework) — intentional; S3 check is synchronous in an async handler (blocking tick, acceptable for health endpoints)
- **Status:** ✅ active

---

### pipeline/src/lifecycle_scheduler.py
- **Use:** Hourly cron that fires memory maintenance jobs on daily/weekly/monthly schedule; delegates to agents in `agents/lifecycle/` and `agents/learning/`
- **Defines:** `run_lifecycle_scheduler()`, `_run_daily_jobs()`, `_run_weekly_jobs()`, `_run_monthly_jobs()`, `_seconds_until_next_hour()`
- **Data:** Reads → `tenants` (active tenant ids); delegates to agents which r/w memory tables
- **Events:** None directly (agents emit their own)
- **Runtime:** ✅ wired-active — hourly loop, each job category wrapped in try/except for isolation
- **SOP flags:** Reconnect on DB loss uses recursion (`return await run_lifecycle_scheduler(...)`) — risk of stack depth accumulation if many consecutive reconnects; non-critical path but worth linearizing
- **Status:** ✅ active

---

### pipeline/src/crypto.py
- **Use:** AES-256-GCM encrypt/decrypt for API keys stored in `api_key_registry.encrypted_key`
- **Defines:** `encrypt_api_key()`, `decrypt_api_key()`, `_get_key()`
- **Data:** None (pure crypto)
- **Runtime:** ✅ wired-active — called from `SamGovIngester._resolve_api_key()`
- **SOP flags:** `cryptography` import is lazily deferred — correct design, noted in file comments
- **Status:** ✅ active

---

### pipeline/src/errors.py
- **Use:** Typed error hierarchy; codes mirror `frontend/lib/errors.ts` for cross-language queryability
- **Defines:** `AppError`, `IngesterRateLimitError` (429), `IngesterContractError` (502), `ShredderBudgetError` (503), `ExternalServiceError` (502), `StateTransitionError` (409), `ClaimConflictError` (409)
- **Data:** None
- **Runtime:** ✅ wired-active
- **SOP flags:** None — all errors have `code` + `http_status`
- **Status:** ✅ active

---

## pipeline/src/ingest/

### pipeline/src/ingest/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/ingest/base.py
- **Use:** Abstract base ingester implementing the outer page/dedupe/insert loop; all concrete ingesters subclass this
- **Defines:** `IngestResult` (dataclass), `BaseIngester` (ABC) with `_hash()`, `_create_triage_row()`, `_emit_event()`, `run()`, `_resolve_api_key()`
- **Data:**
  - Writes → `opportunities` (upsert on `(source, source_id)`)
  - Writes → `curated_solicitations` (auto-triage row on insert, `WHERE NOT EXISTS`)
  - Writes → `system_events` (`finder:ingest.run.start`, `finder:ingest.run.end`, `finder:opportunity.ingested`, `finder:opportunity.amended`, `finder:opportunities.detected`)
- **Pipeline jobs:** Consumed by `ingest` kind jobs via dispatcher
- **Storage:** None
- **Runtime:** ✅ wired-active
- **SOP flags:**
  - `_create_triage_row` returns bool for `was_insert` via asyncpg command tag parsing (`status.rsplit(" ", 1)[-1] != "0"`) — fragile if tag format changes; test coverage would help
  - All `await sql` calls are in try/except blocks — compliant
- **Status:** ✅ active

---

### pipeline/src/ingest/dispatcher.py
- **Use:** Cron scheduler + job consumer loop; `tick_schedules()` reads `pipeline_schedules` and inserts `pipeline_jobs`; `consume_one_job()` atomically claims and dispatches; `run_consumer_loop()` orchestrates both in a while loop
- **Defines:** `INGESTERS` dict, `tick_schedules()`, `consume_one_job()`, `_run_ingest_job()`, `_run_shred_job()`, `_run_expand_topics_job()`, `_run_scout_job()`, `run_consumer_loop()`
- **Data:**
  - Reads → `pipeline_schedules` (enabled, next_run_at)
  - Reads/writes → `pipeline_jobs` (status: pending→running→completed|failed)
  - Updates → `pipeline_schedules` (next_run_at, last_run_at)
  - Writes → `system_events` (`finder:rfp.shredded`, `finder:topics.expanded`)
- **Job kinds:** See summary table above
- **Runtime:** ✅ wired-active
- **SOP flags:**
  - `emit rfp.shredded` event uses raw SQL (not `events.py` helper) — consistent with shredder's own private emit
  - `_run_expand_topics_job` also emits a second `finder:topics.expanded` event at job level (the expander itself already emits one per call — possible double-emission; see topic_expander.py)
  - Missing `ANTHROPIC_CLIENT` reset path in `_run_scout_job` (scout module has its own global)
- **Status:** ✅ active

---

### pipeline/src/ingest/sam_gov.py
- **Use:** SAM.gov Contract Opportunities API v2 ingester; incremental (7-day) and full (365-day) modes
- **Defines:** `_parse_date()`, `_extract_top_level_agency()`, `_detect_program_type()`, `_parse_naics_codes()`, `_generate_stub_opportunities()`, `SamGovIngester`
- **Data:** Inherited from `BaseIngester`; reads `api_key_registry` for encrypted key
- **Events:** Inherited (see base.py)
- **API:** `https://api.sam.gov/opportunities/v2/search` (GET, paginated by offset); handles 429 → `IngesterRateLimitError`, 502/503 → `IngesterContractError`; monitors `X-RateLimit-Remaining`
- **Runtime:** ✅ wired-active
- **SOP flags:** None — error handling complete, rate-limit guarded, stub mode guarded from production
- **Status:** ✅ active

---

### pipeline/src/ingest/sbir_gov.py
- **Use:** SBIR.gov public API ingester; each solicitation topic becomes one `opportunities` row; parent BAA curated_solicitations created once per solicitation
- **Defines:** `_parse_date()`, `_detect_program_type()`, `_extract_tech_focus_areas()`, `_generate_stub_opportunities()`, `SbirGovIngester`
- **Data:** Inherited from `BaseIngester`; also reads/writes `curated_solicitations` for parent BAA row; updates `opportunities.solicitation_id`
- **Events:** Inherited
- **API:** `https://api.www.sbir.gov/public/api/solicitations` (GET, offset pagination, no auth)
- **Runtime:** ✅ wired-active
- **SOP flags:** `_create_triage_row` override does NOT return bool (returns None) — this means parent-level triage creation is not counted in `new_solicitations` rollup (only base class path counts); this is intentional by design but worth documenting
- **Status:** ✅ active

---

### pipeline/src/ingest/grants_gov.py
- **Use:** Grants.gov NOFO ingester with SBIR/STTR/BAA keyword filter; stores CFDA numbers in `classification_code` (not `naics_codes`)
- **Defines:** `_parse_date()`, `_is_relevant()`, `_generate_stub_opportunities()`, `GrantsGovIngester`
- **Data:** Inherited from `BaseIngester`
- **Events:** Inherited
- **API:** `https://api.grants.gov/v1/api/search2` (POST, offset pagination, no auth)
- **Runtime:** ✅ wired-active
- **SOP flags:** None significant
- **Status:** ✅ active

---

### pipeline/src/ingest/dsip.py
- **Use:** DoD SBIR/STTR/CSO DSIP portal ingester; tries JSON API first, falls back to HTML scraping; populates topic-level columns
- **Defines:** `_extract_dsip_tech_focus()`, `_generate_stub_topics()`, `_parse_date()`, `_detect_program_type()`, `_extract_agency()`, `_extract_topic_prefix()`, `_DsipTopicHTMLParser`, `DsipIngester`
- **Data:** Inherited from `BaseIngester`
- **Events:** Inherited
- **API:** `https://www.dodsbirsttr.mil/topics-app/api/public/topics` (JSON) with HTML fallback at `https://www.dodsbirsttr.mil/topics-app/`
- **Runtime:** ✅ wired-active
- **SOP flags:** HTML parser (`_DsipTopicHTMLParser`) is minimal and heuristic — will silently produce empty results if DSIP changes class names; no alerting on HTML path fallback beyond a log.warning
- **Status:** ✅ active

---

### pipeline/src/ingest/topic_expander.py
- **Use:** On-demand bulk topic expansion for one solicitation (Scouting Spine M3/T3.1); queries DSIP API or renders per-topic detail URLs; reuses `DsipIngester.normalize()` without modification; idempotent; dedupes by `(solicitation_id, topic_number)`
- **Defines:** `render_topic_url()`, `_derive_source_id()`, `_content_hash()`, `_coerce_dt()`, `_TopicDetailHTMLParser`, `_normalize_status()`, `_map_detail_to_row()`, `_fetch_dsip_topics()`, `_filter_dsip_items()`, `_fetch_topic_detail()`, `_upsert_topic()`, `_load_profile()`, `_emit_topics_expanded()`, `expand_solicitation_topics()`
- **Data:**
  - Reads → `source_profiles`, `curated_solicitations`, `opportunities` (dedupe check)
  - Writes → `opportunities` (upsert), `system_events` (`finder:topics.expanded`)
- **Pipeline jobs:** Consumed by `expand_topics` kind jobs
- **Storage:** None
- **Runtime:** ✅ wired-active
- **SOP flags:**
  - Non-DSIP path (`topic_url_pattern`) requires explicit `topic_numbers` list — will return `no_topics` status if not provided; this is by design but callers must be aware
  - `_content_hash` uses MD5 (not SHA-256) — matches `opportunity.bulk_add_topics` frontend tool intentionally, but MD5 is weaker; not a security issue here (collision resistance for dedup only)
- **Status:** ✅ active

---

## pipeline/src/shredder/

### pipeline/src/shredder/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/shredder/runner.py
- **Use:** Shredder orchestrator; fetches PDF from S3, extracts text, calls Claude twice (section extraction + per-section compliance), writes structured output to DB and S3 artifacts
- **Defines:** `ANTHROPIC_CLIENT` (test override hook), `_load_prompt()`, `_estimate_tokens()`, `_call_claude()`, `_strip_markdown_fence()`, `shred_solicitation()`, `_split_system_and_examples()`, `_emit_event()`, `_update_status()`, `_write_ai_extracted()`, `_upsert_compliance()`
- **Data:**
  - Reads → `curated_solicitations`, `opportunities`, `solicitation_documents`, `compliance_variables`
  - Writes → `curated_solicitations` (ai_extracted, namespace, status, full_text)
  - Writes → `solicitation_compliance` (UPSERT, all named columns + custom_variables)
  - Writes → `solicitation_documents` (extracted_text, extracted_at, page_count)
  - Writes → `system_events` (`finder:rfp.shredding.start`, `finder:rfp.shredding.end`, `finder:artifact.stored`, `finder:artifacts.written`)
- **Storage:** Reads from `rfp-pipeline/{opp_id}/source.{ext}` (S3); writes `rfp-pipeline/{opp_id}/text.md`, `rfp-pipeline/{opp_id}/shredded/{key}.md`, `rfp-pipeline/{opp_id}/metadata.json`
- **Pipeline jobs:** Consumed by `shred_solicitation` kind jobs
- **Runtime:** ✅ wired-active
- **SOP flags:**
  - `_upsert_compliance` builds dynamic SQL with column names validated against regex `^[a-z_][a-z0-9_]*$` — safe, but the INSERT path manually constructs column lists without parameterization of column names (acceptable since names come from `KNOWN_COLUMNS` allowlist)
  - `page_count` estimate in document row update is rough (`len(pdf_bytes) // 40000 + 1`) — cosmetic, not load-bearing
  - Token budget (150K) is enforced pre-flight with a rough `chars/4 * 1.25` estimator
- **Status:** ✅ active

---

### pipeline/src/shredder/extractor.py
- **Use:** PDF-to-markdown converter using `pymupdf4llm`; hard cap 200K chars/document; pure (no DB, no events)
- **Defines:** `MAX_CHARS_PER_DOCUMENT = 200_000`, `ExtractionError`, `extract_text_from_pdf()`, `extract_text_from_s3_key()`
- **Data:** None (pure transform); `extract_text_from_s3_key` uses S3 client
- **Storage:** Reads from S3 key (via `extract_text_from_s3_key`)
- **Runtime:** ✅ wired-active — called by `runner.shred_solicitation`; lazy pymupdf import
- **SOP flags:** `extract_text_from_s3_key` uses synchronous boto3 `get_object` in an async context — single blocking round-trip; acceptable for current usage but would block the event loop under batching
- **Status:** ✅ active

---

### pipeline/src/shredder/compliance_mapping.py
- **Use:** Pure translator: maps Claude-returned compliance variable names to named DB columns + types; handles type coercion; routes unknown variables to `custom_variables` JSONB
- **Defines:** `KNOWN_COLUMNS` dict (25 entries), `ComplianceMappingError`, `_coerce()`, `split_matches()`
- **Data:** None (pure Python)
- **Runtime:** ✅ wired-active
- **SOP flags:** None — well-isolated, fully unit-tested
- **Status:** ✅ active

---

### pipeline/src/shredder/namespace.py
- **Use:** Deterministic `{agency}:{office}:{type}:{phase}` namespace key computation from raw opportunity fields; pure Python; sourced from docs/NAMESPACES.md
- **Defines:** `_THREE_PART_AGENCIES`, `_AGENCY_ALIASES`, `UNKNOWN`, `_normalize_agency()`, `_normalize_office()`, `_normalize_type()`, `_normalize_phase()`, `compute_namespace_key()`
- **Data:** None
- **Runtime:** ✅ wired-active — called from `BaseIngester._create_triage_row()`, `SbirGovIngester._ensure_parent_solicitation()`, and `shredder.runner.shred_solicitation()`
- **SOP flags:** None — well-tested table-driven
- **Status:** ✅ active

---

### pipeline/src/shredder/sync_extract.py
- **Use:** Single-call compliance extraction for the curation UI sidebar (no DB writes, no events); caller owns persistence; 40K char cap per fragment
- **Defines:** `MAX_FRAGMENT_CHARS = 40_000`, `SyncExtractError`, `extract_compliance_from_text()`
- **Data:** None (pure input→output); reuses runner's `_call_claude`, `_load_prompt`, `_split_system_and_examples`
- **Runtime:** 🟦 dormant — defined and tested but no known caller outside the `compliance.extract_from_text` workflow tool (in `agents/`)
- **SOP flags:** None
- **Status:** ✅ active (wired to agent tool, dormant in pipeline core scope)

---

## pipeline/src/storage/

### pipeline/src/storage/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/storage/paths.py
- **Use:** Canonical S3 key construction; all path helpers are pure, validated, raise `StoragePathError` on bad input; must stay in sync with `frontend/lib/storage/paths.ts`
- **Defines:** `rfp_admin_inbox_path()`, `rfp_admin_discarded_path()`, `rfp_pipeline_path()`, `customer_path()` (with `CustomerPathInput` dataclass), `assert_key_belongs_to_tenant()`, `StoragePathError`
- **S3 key prefixes:**
  - `rfp-admin/inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext}` — staging inbox
  - `rfp-admin/discarded/{yyyy}/{mm}/{external_id}.{ext}` — discarded
  - `rfp-pipeline/{opportunity_id}/source.{ext}` — original PDF
  - `rfp-pipeline/{opportunity_id}/text.md` — extracted markdown
  - `rfp-pipeline/{opportunity_id}/metadata.json` — extraction metadata
  - `rfp-pipeline/{opportunity_id}/shredded/{name}.md` — per-section atoms
  - `rfp-pipeline/{opportunity_id}/attachments/{name}.{ext}` — attachments
  - `customers/{tenant_slug}/proposals/{proposal_id}/...` — per-tenant isolated storage
  - `customers/{tenant_slug}/library/...` — library units/assets
- **Runtime:** ✅ wired-active
- **SOP flags:** None — pure, validated, comprehensive
- **Status:** ✅ active

---

### pipeline/src/storage/s3_client.py
- **Use:** Shared boto3 S3 client singleton; `put_object`, `get_object_bytes`, `object_exists`, `delete_object`, `put_text`, `put_json`, `copy_object`, `list_keys`, `ping_s3`; lazy boto3 import for test isolation
- **Defines:** `BUCKET`, `get_s3_client()`, `put_object()`, `get_object_bytes()`, `object_exists()`, `delete_object()`, `ping_s3()`, `put_text()`, `put_json()`, `copy_object()`, `list_keys()`
- **Storage:** AWS S3 (boto3); bucket name from `AWS_S3_BUCKET_NAME` env, defaults to `rfp-pipeline-local`; endpoint URL from `AWS_ENDPOINT_URL` (for MinIO/local)
- **Runtime:** ✅ wired-active — **CONFIRMED S3/boto3, not /data filesystem**
- **SOP flags:** All errors raise `RuntimeError` wrapping the original — callers lose the boto3 error type; acceptable for an infra layer but limits typed error handling
- **Status:** ✅ active

---

### pipeline/src/storage/portal_provisioner.py
- **Use:** Server-side S3 copy of all RFP artifacts into a customer's isolated proposal sandbox at purchase time; writes manifest.json and compliance.json snapshot
- **Defines:** `provision_portal_artifacts()`
- **Data:**
  - Reads → `curated_solicitations` (opportunity_id), `solicitation_documents` (topic PDFs), `solicitation_compliance` (compliance snapshot)
  - No DB writes
- **Storage:** Reads `rfp-pipeline/{opp_id}/` (all keys), copies to `customers/{tenant_slug}/proposals/{proposal_id}/rfp-snapshot/`; writes `compliance.json` and `manifest.json` to dest prefix
- **Runtime:** 🟦 dormant — function defined and tested but caller is in workflows (proposal purchase flow) which is in agents/workflows scope
- **SOP flags:** `solicitation_id` handling uses `hasattr(solicitation_id, 'bytes')` to detect UUID objects — fragile duck-typing; should just call `str()` uniformly
- **Status:** ✅ active

---

## pipeline/src/scoring/

### pipeline/src/scoring/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/scoring/engine.py
- **Use:** `ScoringEngine.score_all_tenants()` iterates approved/pushed solicitations and delegates per-solicitation scoring to `workflows.actions.score_tenants.match_tenants`
- **Defines:** `ScoringEngine`
- **Data:**
  - Reads → `curated_solicitations` (status IN 'approved', 'pushed_to_pipeline')
  - Delegates DB writes to `match_tenants` workflow action
- **Pipeline jobs:** Not directly consumed by dispatcher — called from workflow actions
- **Runtime:** 🟦 dormant — `ScoringEngine` is defined but no wired caller in pipeline core; `match_tenants` is invoked from workflows scope
- **SOP flags:** No error handling on the outer `conn.fetch()` call; `score_all_tenants` has no try/catch around the `conn.fetch` that reads solicitations
- **Status:** ⚠️ stale — thin wrapper that just delegates to a workflow action; may be a vestige of a previous direct-scoring design

---

## pipeline/src/workers/

### pipeline/src/workers/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/workers/source_scout.py
- **Use:** Crawls `source_profiles` with `auto_crawl_enabled`, fetches page HTML, computes SHA-256 content hash per region, asks Claude to analyze changes, writes `source_snapshots` and `source_diffs`, emits `finder:source.scouted` + `finder:source.change_detected`
- **Defines:** `_content_hash()`, `_html_to_text()`, `_fetch_page()`, `_analyze_with_claude()`, `scout_source()`, `scout_all_due()`
- **Data:**
  - Reads → `source_profiles`, `source_regions`, `source_snapshots`
  - Writes → `source_snapshots`, `source_diffs`, `source_profiles` (last_crawl_at)
  - Writes → `system_events` (`finder:source.scouted`, `finder:source.change_detected`)
- **Pipeline jobs:** Consumed by `scout_source` kind jobs
- **Runtime:** ✅ wired-active
- **SOP flags:**
  - `ANTHROPIC_CLIENT` global is reset to the first instantiated client but never cleaned up between scout runs — could use stale client after config change; mitigated by lazy init
  - JS-only page detection is heuristic (checks `__NEXT_DATA__`); will miss other SPA frameworks silently
  - `scout_all_due` iterates profiles sequentially (no concurrency) — could be slow for many profiles
- **Status:** ✅ active

---

## pipeline/src/seeds/

### pipeline/src/seeds/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/src/seeds/master_admin.py
- **Use:** Bootstrap seed — inserts first `master_admin` user if none exists; idempotent; called on every pipeline boot
- **Defines:** `seed_master_admin()`
- **Data:** Reads → `users` (role=master_admin check); writes → `users` (INSERT ON CONFLICT DO NOTHING)
- **Runtime:** ✅ wired-active
- **SOP flags:** Uses `print()` for the credential banner — intentional (Railway log) but violates "no console.log" SOP for production code; acceptable given the bootstrap context
- **Status:** ✅ active

---

## pipeline/src/document/

### pipeline/src/document/__init__.py
- **Use:** Auto-registers all 4 format agents on import (`_auto_register()`)
- **Runtime:** ✅ wired-active (imported by agents)
- **Status:** ✅ active

---

### pipeline/src/document/base.py
- **Use:** Abstract `DocumentAgent` base class defining the full document lifecycle (INGEST → ATOMIZE → CANVAS → EDIT → COLLABORATE → ACCEPT → ADVANCE → EXPORT); `CanvasBundle`, `CanvasNode`, `AtomGroup`, `ComplianceConstraints`, `EditOperation`, `ExportResult` interchange types
- **Defines:** `LifecycleStage` enum, `AgentCapability` enum, `CanvasNode`, `ComplianceConstraints`, `CanvasBundle`, `AtomGroup`, `EditOperation`, `ExportResult`, `DocumentAgent` (ABC)
- **Data:** None (pure types + abstract interface)
- **Runtime:** ✅ wired-active — all format agents subclass this
- **SOP flags:** None
- **Status:** ✅ active

---

### pipeline/src/document/registry.py
- **Use:** Format-dispatch registry; `get_agent()`, `get_agent_for_file()`, `list_agents()`, `dispatch()` for cross-agent handoff; auto-registers DOCX/PPTX/XLSX/PDF agents on import
- **Defines:** `register()`, `get_agent()`, `get_agent_for_file()`, `list_agents()`, `dispatch()`, `_auto_register()`
- **Data:** None
- **Runtime:** ✅ wired-active
- **SOP flags:** `_auto_register` silently swallows registration failures — if python-docx/openpyxl/etc. are missing the agent is simply absent; no warning emitted to operators
- **Status:** ✅ active

---

### pipeline/src/document/converter.py
- **Use:** LibreOffice headless wrapper for PDF rendering and format conversion; `convert_to_pdf()` and `convert_format()` spawn `soffice` subprocess
- **Defines:** `is_soffice_available()`, `convert_to_pdf()`, `convert_format()`
- **Data:** Filesystem (tempdir for soffice input/output); no DB or S3
- **Runtime:** 🟦 dormant — called from `DocumentAgent._convert_to_pdf()` which is called from format agents' `export_pdf()`; agents are not currently invoked from pipeline core (only from agents/ scope)
- **SOP flags:** `convert_format` has no timeout on `wait_for` — possible hang if soffice stalls (unlike `convert_to_pdf` which has `asyncio.wait_for`)
- **Status:** ⚠️ stale — `convert_format` missing timeout; also LibreOffice not confirmed installed on Railway deployment

---

### pipeline/src/document/docx_agent.py
- **Use:** Full DOCX lifecycle agent — ingest (python-docx), atomize (by headings), export (reconstruct docx with formatting, headers/footers, watermark, page numbers), export_pdf (via soffice)
- **Defines:** `DocxAgent` (format_id="docx"), helpers `_node_text()`, `_interpolate()`, `_render_formatted_paragraph()`, `_add_page_number_field()`, `_add_num_pages_field()`, `_add_watermark()`
- **Data:** None (pure bytes transform)
- **Runtime:** 🟦 dormant — agents not yet called from pipeline core; wired in agents/ scope
- **SOP flags:** `ingest` reads all paragraphs + tables but skips images (silently); no warning emitted
- **Status:** ✅ active (infrastructure ready)

---

### pipeline/src/document/pdf_agent.py
- **Use:** Read-only PDF agent using pymupdf4llm markdown extraction; ingest and atomize only (by headings or page breaks); `export()` raises NotImplementedError by design
- **Defines:** `_parse_markdown_to_nodes()`, `PdfAgent` (format_id="pdf"), `_DsipTopicHTMLParser` (minimal parser)
- **Data:** None (pure bytes transform)
- **Runtime:** 🟦 dormant — not called from pipeline core; used in agents/ scope
- **SOP flags:** `PdfAgent.__init__` raises ImportError if pymupdf not installed — `_auto_register` in registry silently swallows this, so if pymupdf is missing there's no agent registered and callers get `KeyError` on `get_agent("pdf")` rather than a clear error
- **Status:** ✅ active (infrastructure ready)

---

### pipeline/src/document/pptx_agent.py
- **Use:** Full PPTX lifecycle agent — ingest (python-pptx), per-slide atomize, export (reconstruct presentation with layouts, speaker notes, tables, charts placeholder)
- **Defines:** `PptxAgent` (format_id="pptx"), slide helpers
- **Data:** None (pure bytes transform)
- **Runtime:** 🟦 dormant — not called from pipeline core
- **SOP flags:** Chart export renders only a text placeholder `[Chart: ...]` — actual chart data is dropped on round-trip; no warning in ExportResult.warnings
- **Status:** ✅ active (infrastructure ready)

---

### pipeline/src/document/xlsx_agent.py
- **Use:** Full XLSX lifecycle agent — ingest (openpyxl, merged cells, styles, 100-row cap per sheet), per-sheet atomize, export (full style reconstruction including borders, merged cells, column widths)
- **Defines:** `XlsxAgent` (format_id="xlsx"), `_cell_style_dict()`, `_infer_category()`, `_tags_from_sheet()`
- **Data:** None (pure bytes transform)
- **Runtime:** 🟦 dormant — not called from pipeline core
- **SOP flags:** `_MAX_INGEST_ROWS = 100` truncates large sheets silently (metadata.truncated flag is set in CanvasNode.content but no warning in ExportResult.warnings)
- **Status:** ✅ active (infrastructure ready)

---

## pipeline/src/shredder/prompts/ (referenced but not Python files)

The runner loads `pipeline/src/shredder/prompts/v1/section_extraction.txt` and `compliance_extraction.txt` via `_load_prompt()`. These are not Python files; they define the Claude prompt format (`---SYSTEM---`, `---FEW_SHOT_N---`, `---END---` markers).

---

## pipeline/scripts/

### pipeline/scripts/extract_golden_text.py
- **Use:** Dev tool — extracts text from a PDF and writes it to `golden_fixtures/{name}/extracted.md` for use by regression tests
- **Runtime:** 🟦 dormant — manual developer script, not wired to any automated run
- **Status:** ✅ active (utility)

### pipeline/scripts/record_golden_output.py
- **Use:** Dev tool — runs shredder against a golden fixture with a real Anthropic key and records the output to `expected.json`
- **Runtime:** 🟦 dormant — manual; requires `ANTHROPIC_API_KEY` and `TEST_DATABASE_URL`
- **Status:** ✅ active (utility)

### pipeline/scripts/seed_golden_fixtures.py
- **Use:** Dev tool — seeds golden fixture data into a test DB for regression tests
- **Runtime:** 🟦 dormant — manual
- **Status:** ✅ active (utility)

---

## pipeline/tests/

### pipeline/tests/__init__.py
- **Use:** Empty package marker
- **Status:** ✅ active

---

### pipeline/tests/conftest.py
- **Covers:** Sets `DATABASE_URL` env so `config.py` doesn't crash during collection; auto-applies `asyncio` mark to coroutine test functions
- **Status:** ✅ active

---

### pipeline/tests/test_ingest_framework.py
- **Covers:**
  - `errors.py` — all 6 error classes (code, http_status, details)
  - `ingest.base.BaseIngester._hash` — determinism, sensitivity, description truncation, missing fields, cross-instance stability, source differentiation
  - `ingest.sam_gov.SamGovIngester.normalize` — basic mapping, multi-NAICS, missing fields
  - `ingest.sbir_gov.SbirGovIngester.normalize` — Phase I/II, SBIR/STTR
  - `ingest.grants_gov.GrantsGovIngester.normalize` — basic mapping, CFDA→classification_code
  - `ingest.base.IngestResult` — duration_ms computation
- **DB required:** No
- **Status:** ✅ active — solid unit coverage

---

### pipeline/tests/test_ingest_e2e.py
- **Covers:**
  - SAM.gov dispatcher stub-mode consumption → opportunities + events
  - Dedup idempotency (second ingest of same data produces 0 new rows)
  - `shred_solicitation` dispatcher path with mock Anthropic client (full chain to DB)
  - Missing `solicitation_id` in shred job → `failed` status with error payload
  - Empty queue → `consume_one_job` returns False
- **DB required:** Yes (`TEST_DATABASE_URL`); skips if unreachable
- **Status:** ✅ active — critical integration coverage

---

### pipeline/tests/test_sam_gov.py
- **Covers:** Placeholder only (`assert True`)
- **Status:** 💀 dead (placeholder) — `SamGovIngester.fetch_page` / rate-limit / date-parsing helpers completely untested

---

### pipeline/tests/test_scoring.py
- **Covers:** Placeholder only (`assert True`)
- **Status:** 💀 dead (placeholder) — `ScoringEngine` completely untested

---

### pipeline/tests/test_shredder_runner.py
- **Covers:**
  - Happy path: section extraction + compliance → ai_extracted, namespace, status=ai_analyzed, solicitation_compliance row with named columns
  - Idempotent re-run overwrites cleanly (UPSERT, single compliance row)
  - No-text path → shredder_failed
  - Budget exceeded path → ShredderBudgetError + shredder_failed + event payload
  - Start/end events with correlated parent_event_id
- **DB required:** Yes; skips if unreachable
- **Status:** ✅ active — strong coverage

---

### pipeline/tests/test_shredder_extractor.py
- **Covers:**
  - Markdown passthrough, cap truncation, non-string output error, pymupdf open failure — all via monkeypatched fake modules
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_shredder_namespace.py
- **Covers:**
  - 6 canonical NAMESPACES.md examples (parametrized)
  - Agency normalization, alias resolution (DOD, DoW→DOD), lowercase, punctuation
  - Office collapsing when equal to agency, null office for 4-part agency
- **DB required:** No
- **Status:** ✅ active — table-driven, thorough

---

### pipeline/tests/test_shredder_compliance_mapping.py
- **Covers:**
  - `_coerce` — all type paths (bool, int, float, str, None, edge cases including bool-to-int rejection)
  - `split_matches` — confidence threshold, known column routing, custom_variables fallback, coercion failures in skipped
  - `KNOWN_COLUMNS` — alias `margin_inches → margins` verified
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_shredder_sync_extract.py
- **Covers:**
  - Happy path returns matches list
  - Markdown-fenced JSON stripping
  - Empty/oversized input → SyncExtractError
  - Non-list matches field → SyncExtractError
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_shredder_regression.py
- **Covers:**
  - Golden fixture regression tests against `pipeline/src/shredder/golden_fixtures/`
  - Mock mode (default CI): replays expected.json through runner via fake Anthropic client
  - Live mode (`SHREDDER_LIVE=1`): real Claude API call, compares to expected.json
  - Discovers fixtures dynamically from filesystem
- **DB required:** Yes; skips if unreachable
- **Status:** ✅ active (but only as meaningful as the fixtures present; golden_fixtures/ directory may be empty)

---

### pipeline/tests/test_shred_consolidation.py
- **Covers:**
  - `workflows.actions.shred` is importable with `shred` and `extract_compliance`
  - Dead `workers.rfp_shredder` module is confirmed removed (ModuleNotFoundError)
  - `finder:shred.executed` event surface unchanged in canonical job
- **DB required:** No
- **Status:** ✅ active — architectural guard

---

### pipeline/tests/test_storage_paths.py
- **Covers:**
  - All path helpers (`rfp_admin_inbox_path`, `rfp_admin_discarded_path`, `rfp_pipeline_path`, `customer_path`, `assert_key_belongs_to_tenant`) — happy paths and validation errors
  - Extension lowercasing, source validation, UUID validation, slug validation
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_storage_helpers.py
- **Covers:**
  - `put_text`, `put_json`, `copy_object`, `list_keys`, `put_object`, `get_object_bytes` via mocked boto3
  - Content-type headers, metadata pass-through, error wrapping to RuntimeError
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_portal_provisioner.py
- **Covers:**
  - `provision_portal_artifacts` happy path: all 5 master artifacts copied + manifest.json written
  - Compliance snapshot written when compliance row exists
  - Topic document copied when topic_id provided
  - Missing compliance row → no snapshot (no crash)
  - Missing opportunity (fetchval returns None) → ValueError
- **DB required:** No (fake conn + mocked boto3)
- **Status:** ✅ active

---

### pipeline/tests/test_agents.py
- **Covers:** Placeholder only
- **Status:** 💀 dead (placeholder) — `AgentFabric` and all 10 archetypes untested

---

### pipeline/tests/test_memory.py
- **Covers:** Placeholder only
- **Status:** 💀 dead (placeholder) — memory tables/lifecycle completely untested

---

### pipeline/tests/test_tasks_ledger.py
- **Covers:** `StepType.TODO` step resolution, task field validation, `complete_task` resume, nudge sweep idempotency — all against fake asyncpg
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_error_gating.py
- **Covers:** `EventTrigger.matches()` rejects errored events; falsy error field passes
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_engine_single_path.py
- **Covers:** Structural source inspection — dead bypass code patterns absent from `_run_workflow`; HITL_WAIT surface unchanged; managed engine parks at HITL
- **DB required:** No
- **Status:** ✅ active — architectural guard

---

### pipeline/tests/test_hitl_lifecycle.py
- **Covers:** HITL park-and-wait: deadline from binding timeout, event-based resume (paused→retrying), wait-deadline sweep emits `workflow.wait_timed_out`
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_hitl_wait_alignment.py
- **Covers:** `EventTrigger.matches()` for proposal-review gate (phase="end" aligns with real producer); source-change gate is force-advance only; dead `stage:before_approval` condition removed
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_on_timeout_escalation.py
- **Covers:** `validate()` rejects dangling on_timeout refs; park-deadline sweep runs on_timeout step; `workflow.escalation_ran` event emitted
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_force_advance.py
- **Covers:** `resume_instance` marks paused step completed + status retrying; `execute_instance` skips completed steps; frontend contract preserved
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_todo_producers.py
- **Covers:** `OnProposalAdvancedToReview` has TODO step for tenant_admin with proposal_review task type; `OnSourceChangeDetected` has TODO step for rfp_admin; both carry wait_for (dual resume)
- **DB required:** No
- **Status:** ✅ active

---

### pipeline/tests/test_cms_content_integration.py
- **Covers:** Real-DB integration for draft/publish cycle against `content_pages` table; version snapshot model; publish promotes draft to active, archives siblings; re-publish is no-op
- **DB required:** Yes (`TEST_DATABASE_URL`); skips if not set
- **Status:** ✅ active

---

### pipeline/tests/test_cms_content_vertical.py
- **Covers:** `OnCmsContentRequested` template wiring (draft→review TODO→publish→notify); `draft_content` action writes DRAFT version; `publish_content` promotes to active; review TODO writes task for rfp_admin
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_content_pages_integration.py
- **Covers:** Real-DB integration for content_pages versioned save→publish lifecycle; isolates test under a unique page_key; CREATE TABLE IF NOT EXISTS DDL runs inline
- **DB required:** Yes (`TEST_DATABASE_URL`)
- **Status:** ✅ active

---

### pipeline/tests/test_create_drafts_from_scout.py
- **Covers:** `REGION_OPPORTUNITIES_KEY` resolves to `extractedOpportunities` (not legacy `opportunities`); feeding canonical key creates drafts; legacy key creates none; confirms INC-2 fix
- **DB required:** No (fake conn)
- **Status:** ✅ active

---

### pipeline/tests/test_template_catalog.py
- **Covers:** `all_registered_workflows()` returns distinct classes; `sync_template_catalog` upserts without overwriting admin-owned columns; launch gate refuses inactive templates; gate fails open on missing table/row
- **DB required:** No (fake conn)
- **Status:** ✅ active
