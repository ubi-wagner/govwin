# ARCHITECTURE_V9.md — RFP Pipeline Portal: As-Built Baseline

**Date:** 2026-06-23
**Status:** As-built baseline; supersedes ARCHITECTURE_V7.md (master) and ARCHITECTURE_V8.md (content-subsystem delta).
**Verification method:** File-by-file analysis of all 908 tracked files.  
**Evidence location:** `docs/baseline/inventory/` (8 subsystem inventories) + `docs/baseline/BASELINE_FINDINGS.md` (reconciled synthesis)

## Status Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Live and wired — actively called at runtime |
| 🟡 | Shipped with gaps — code works but specific paths incomplete |
| 🟦 | Built-but-dormant — code is correct and tested but never called at runtime |
| 🔴 | Broken — code exists but has a confirmed runtime defect |

---

## 0. What Supersedes What

```
ARCHITECTURE_V5 (2026-04-05) — 5-service vision; never built; DEPRECATED
ARCHITECTURE_V6 (2026-05-20) — 3-service V1 launch baseline; SUPERSEDED by V7
ARCHITECTURE_V7 (2026-05-21) — Master system index; SUPERSEDED by V9 (this file)
ARCHITECTURE_V8 (2026-06-02) — Content-subsystem delta only; FOLDED INTO V9
ARCHITECTURE_V9 (2026-06-23) — THIS DOCUMENT — verified by file-by-file analysis
```

---

## 1. Executive Summary

RFP Pipeline Portal is a multi-tenant SaaS platform for government contractors competing for federal R&D
opportunities (SBIR, STTR, BAA, OTA, CSO). Three services share one main PostgreSQL database:

- **Frontend** (Next.js 15): Customer portal, admin workspace, marketing site, 138 API routes.
- **Pipeline** (Python 3.12, asyncio): Ingest, shred, score, scout, workflow engine, memory lifecycle.
- **CMS/CRM** (FastAPI, Python): Email automation, content pipeline, social scheduling, page-block editor.

Key verified-as-of-audit facts that differ from prior docs:

1. **CMS is fully live**, not dormant. It runs 87 HTTP endpoints, 7 worker loops, and a Vite SPA.
2. **Storage is S3-compatible object storage (Cloudflare R2)**, not the Railway `/data` volume.
3. **Product AI works today** — the frontend calls Anthropic directly for draft/review/compliance.
4. **Pipeline agent workforce is built but dormant** — `AgentFabric` is instantiated but never connected to the workflow processor or any event consumer.
5. **HITL resume is implemented** in `WorkflowManager.resume_instance()`; only the legacy fire-and-forget processor path still skips it.
6. **72 tables across 14 domains**; no `solicitation_topics` table (dropped in migration 035).
7. **RLS is enabled on 4 memory tables but zero policies exist** — isolation relies on explicit `WHERE tenant_id` clauses.

---

## 2. Product Vision + Opportunity→Proposal Lifecycle

The platform automates the government contracting lifecycle from opportunity discovery through award learning.

### Stage Map

| Stage | Name | Owner | Key Tables | Key Events |
|-------|------|-------|-----------|------------|
| 1 | Discover | System / admin | `opportunities`, `pipeline_jobs` | `finder:opportunity.ingested` |
| 2 | Triage | rfp_admin | `curated_solicitations`, `triage_actions` | `finder:solicitation.triaged` |
| 3 | Curate | rfp_admin | `solicitation_compliance`, `solicitation_documents`, `solicitation_volumes` | `finder:rfp.uploaded`, `finder:rfp.shredded` |
| 4 | Push | rfp_admin | `curated_solicitations`, `tenant_pipeline_items` | `finder:solicitation.pushed` |
| 5 | Qualify | tenant_user | `tenant_pipeline_items`, `spotlights` | `capture:opportunity.pinned/pursued` |
| 6 | Purchase | tenant_admin | `purchases` | `capture:checkout.started`, `capture:purchase.completed` |
| 7 | Build | tenant/partners | `proposals`, `proposal_sections`, `canvas_versions` | `proposal:proposal.advanced`, `proposal:section.saved` |
| 8 | Submit | tenant_admin | `proposals` (stage=submitted, is_locked=true) | `proposal:proposal.locked` |
| 9 | Learn | System | `library_units`, `library_atom_outcomes`, `agent_task_log` | `proposal:outcome.recorded` |

### Stage 3 (Curate) Detail

The shredder workflow is the core intelligence-building step:

```
rfp_admin uploads PDF
    → OnRfpUploaded workflow fires
    → shred_document ACTION (3 retries): Claude extracts structure → solicitation_compliance, solicitation_documents
    → extract_compliance ACTION (1 retry, depends_on shred)
    → notify_curator NOTIFY
```

Curator then annotates compliance variables → HITL flywheel writes to `episodic_memories`.

### Stage 7 (Build) Detail

Proposal workspace has three concurrent AI paths:

1. **Section drafting** — portal calls `/api/tools/proposal.draft_section` → Claude Sonnet (frontend direct)
2. **Compliance check** — portal calls `/api/portal/.../ai/compliance` → Claude Haiku (frontend direct)
3. **AI review** — portal calls `/api/portal/.../ai/review` (thin — marks sections for review, no inline generation)

---

## 3. Service Topology

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          RFP Pipeline Portal System                              │
│                                                                                  │
│  ┌──────────────────────────┐   ┌──────────────────────────┐                    │
│  │   Frontend (Next.js 15)  │   │   Pipeline (Python 3.12) │                    │
│  │   ─────────────────────  │   │   ─────────────────────  │                    │
│  │   Admin workspace        │   │   asyncio event loop     │                    │
│  │   Customer portal        │   │   Dispatcher / ingesters │                    │
│  │   Marketing site         │   │   Shredder / scorer      │                    │
│  │   138 API routes         │   │   Workflow processor     │                    │
│  │   33-tool registry       │   │   Memory lifecycle       │                    │
│  │   NextAuth v5 / RBAC     │   │   Source scout           │                    │
│  │   Anthropic calls direct │   │   Health server :8080    │                    │
│  └──────────┬───────────────┘   └──────────────┬───────────┘                    │
│             │                                   │                                │
│             │         SHARED DATABASE           │                                │
│             └──────────────────┬────────────────┘                               │
│                                │                                                 │
│              ┌─────────────────▼──────────────┐                                 │
│              │  PostgreSQL 16 — govtech_intel  │                                 │
│              │  (Main Database — 72 tables)    │                                 │
│              │  pgvector extension enabled     │                                 │
│              └─────────────────┬──────────────┘                                 │
│                                │                                                 │
│         ┌──────────────────────┼──────────────────────┐                         │
│         │                      │                      │                          │
│  ┌──────▼──────────┐   ┌───────▼────────┐   ┌────────▼──────────┐             │
│  │  CMS/CRM        │   │ PostgreSQL 16   │   │  S3-Compatible    │             │
│  │  (FastAPI)      │   │ govtech_cms     │   │  Object Storage   │             │
│  │  87 endpoints   │   │ (CMS DB)        │   │  Cloudflare R2    │             │
│  │  7 worker loops │   │ CMS-own tables  │   │  forcePathStyle   │             │
│  │  Vite SPA /cms  │   │                 │   │  Single bucket,   │             │
│  │  ─────────────  │   └────────────────┘   │  3 prefixes       │             │
│  │  Reads shared:  │                         └───────────────────┘             │
│  │  system_events  │                                                             │
│  │  automation_    │                                                             │
│  │  rules, users   │                                                             │
│  │  tenants        │                                                             │
│  │  Writes shared: │                                                             │
│  │  system_events  │                                                             │
│  │  cms_content    │                                                             │
│  └─────────────────┘                                                             │
│                                                                                  │
│  Services coordinate via shared tables, NOT via HTTP-to-HTTP calls.              │
│  Pipeline writes system_events → CMS event_listener polls and reacts.           │
│  Frontend and Pipeline share all 72 tables in govtech_intel directly.           │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Storage note:** `config.STORAGE_ROOT="/data"` is a **dead constant** in `pipeline/src/config.py`. No storage code imports it. The live store is S3/R2 accessed via `pipeline/src/storage/s3_client.py` (boto3) and `frontend/lib/storage/s3-client.ts` (@aws-sdk/client-s3). The CMS service uses the Railway `/data/cms` volume only for its own media files (images/documents uploaded via the CMS admin SPA).

---

## 4. Frontend Service

### 4.1 Surfaces

| Surface | Path prefix | Guard | Description |
|---------|-------------|-------|-------------|
| Marketing | `/(marketing)/` | None — public | Landing, pricing, about, resources, legal pages |
| Auth | `/(auth)/` | None or session | Login, change-password, forgot/reset-password |
| Admin | `/admin/` | rfp_admin+ (middleware) | RFP triage, curation, sources, workflow monitor, CMS editor, system |
| Portal | `/portal/[tenantSlug]/` | partner_user+ (middleware + layout) | Opportunities, proposals, library, team, billing |
| Shared | `/api/health`, `/api/waitlist`, `/api/applications` | None — public | Probes, signup |

86 pages total: 33 admin, 17 portal, 20 marketing, 6 auth/misc.

### 4.2 API Routes — 138 Routes by Domain

| Domain | Count | Active | Notes |
|--------|-------|--------|-------|
| `/api/admin/*` | 72 | 71 | 1 stub (agents/config — returns 501) |
| `/api/portal/[tenantSlug]/*` | 47 | 47 | All active |
| `/api/auth/*`, public, stripe | 19 | 18 | 1 dead stub (`/api/system` — 501) |
| **Total** | **138** | **136** | 1 stub, 1 dead |

Key admin sub-domains: rfp-curation (12 routes), sources (8), workflows (5), site/CMS (10), documents (5), agents (3), automation (2).

Key portal sub-domains: proposals (21 routes including sections/ai/collaborators), library (4), opportunities (3), spotlights (3), tasks (1), team (1).

Critical-path routes (tested or documented as critical):
- `POST /api/admin/rfp-upload` — RFP ingestion entry point
- `POST /api/admin/rfp-curation/[solId]/push` — publish to Spotlight
- `POST /api/portal/[tenantSlug]/proposals/create` — proposal creation (sql.begin transaction)
- `POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance` — stage gate check
- `PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` — OCC auto-save
- `POST /api/tools/[name]` — tool gateway (all AI and curation tool calls)
- `POST /api/stripe/webhook` — monetization (HMAC verified)
- `GET /api/auth/[...nextauth]` — NextAuth handler

### 4.3 NextAuth v5 + RBAC

**Auth stack:** NextAuth v5 (beta.25), Credentials provider, bcrypt, postgres.js, JWT/JWE, 8h session.

**JWT payload:** `{ id, role, tenantId, tenantSlug, tempPassword }`

**Edge split:** `auth.config.ts` (edge-safe, no DB/bcrypt) vs `auth.ts` (Node runtime, full provider).

**5 roles + rank ordering:**

```
master_admin  > rfp_admin  > tenant_admin  > tenant_user  > partner_user
     5               4            3               2               1
```

**Middleware role gates (PATH_MIN_ROLE):**

| Path | Minimum role |
|------|-------------|
| `/admin/system`, `/api/admin/system` | master_admin |
| `/admin/*`, `/api/admin/*` | rfp_admin |
| `/portal/*`, `/api/portal/*` | partner_user |
| `/dashboard` | tenant_user |

**Temp-password enforcement:** Middleware forces `/change-password` redirect for any user with `tempPassword=true`; API routes return 403.

**Tenant isolation:** Portal routes resolve `tenantSlug → tenantId` via `getTenantBySlug()` then verify membership via `verifyTenantAccess()`. Partner scoping: partner_user sees only proposals where they are listed in `proposal_collaborators`; portal layout hides Dashboard/Spotlight/Pipeline/Library/Processes/Activity/Team/Documents/Billing nav sections.

### 4.4 Core Library Modules

| Module | Purpose |
|--------|---------|
| `lib/db.ts` | postgres.js singleton; validates DATABASE_URL at import; `.on('error')` handler |
| `lib/events.ts` | `emitEventSingle`, `emitEventStart`, `emitEventEnd` → `system_events` |
| `lib/api-helpers.ts` | `withHandler()` HOF; `requireAdmin()`, `requireAuth()` auth guards |
| `lib/rbac.ts` | `hasRoleAtLeast()`, `isRole()`, role rank constants |
| `lib/errors.ts` | `AppError`, `UnauthenticatedError`, `ForbiddenError`, `NotFoundError`, `ConflictError` |
| `lib/proposal-access.ts` | `resolveUserAccess()` — stage-scoped partner permission model |
| `lib/storage/s3-client.ts` | AWS SDK S3Client wrapper for frontend (`putObject`, `getSignedGetUrl`, etc.) |
| `lib/storage/paths.ts` | Canonical S3 key builders + `assertKeyBelongsToTenant()` guard |
| `lib/content-admin.ts` | `getPage()`, `saveDraft()`, `publishPage()` → `page_content` / `content_pages` |
| `lib/process/force-advance.ts` | HITL force-advance shared by admin + portal routes |
| `lib/tasks/tasks.ts` | Task ledger: `listOpenTasksForActor()`, `completeTask()` |
| `lib/capacity.ts` | `recordInvoke()` → `tool_invocation_metrics` |

### 4.5 32-Tool Registry

All tools are registered in `lib/tools/index.ts` via side-effect imports. Every invocation flows through `POST /api/tools/[name]`:

1. Route → `registry.invoke(name, actor, input)`
2. Registry enforces: (a) role check, (b) tenant scope, (c) Zod validation
3. Registry emits `tool:tool.invoked:start/end` events
4. Tool executes, returns `ToolResult`

Tools by category:

| Category | Tool names |
|----------|-----------|
| Compliance | `compliance.add_variable`, `compliance.list_variables`, `compliance.save_variable_value`, `compliance.extract_from_text` |
| Library | `library.save_atom`, `library.search_atoms` |
| Memory | `memory.search`, `memory.write` |
| Opportunity | `opportunity.add_topic`, `opportunity.bulk_add_topics`, `opportunity.get_by_id`, `opportunity.update_topic` |
| Proposal | `proposal.draft_section` (calls Anthropic Sonnet directly) |
| Solicitation | `solicitation.approve`, `solicitation.claim`, `solicitation.delete_annotation`, `solicitation.dismiss`, `solicitation.push`, `solicitation.reject_review`, `solicitation.release`, `solicitation.request_review` |
| Ingest | `ingest.get_run_detail`, `ingest.list_recent_runs`, `ingest.trigger_manual` |
| Source | `finder.scout_source` |
| Other | `solicitation.get_detail`, `solicitation.list_triage`, `solicitation.save_annotation`, `volume.*` (5), document import/analytics (see `lib/tools/index.ts` for the canonical 33) |
| Other | Additional tools for document import, analytics |

Required role for each tool is checked via `tool.requiredRole` before execution. Zod schemas validate all inputs.

### 4.6 Product-AI Routes (Frontend-Direct Anthropic Calls)

These routes call the Anthropic API directly — they are independent of the dormant pipeline agent workforce:

| Route | Model | Purpose |
|-------|-------|---------|
| `POST /api/portal/.../ai/draft` | claude-sonnet-4-20250514 (via tool) | Queue draft intent; actual drafting is `proposal.draft_section` tool |
| `POST /api/portal/.../ai/compliance` | claude-haiku-4-5-20251001 | Inline compliance check against solicitation requirements |
| `POST /api/portal/.../ai/review` | N/A (thin) | Marks proposal for human review; no Claude call in this route |
| `POST /api/tools/proposal.draft_section` | claude-sonnet-4-20250514 | Full section draft using `@anthropic-ai/sdk` |

The CMS also calls Anthropic: `services/cms` workers use `claude-sonnet-4-20250514` for content generation.

### 4.7 Frontend Stack

| Aspect | Detail |
|--------|--------|
| Framework | Next.js 15.5.14, React 19.2.4, TypeScript (strict) |
| Auth | NextAuth 5.0.0-beta.25, JWT/JWE, Credentials provider |
| DB client | postgres.js 3.4.3 (tagged template SQL, parameterized always) |
| AI | @anthropic-ai/sdk 0.91.1 |
| S3 | @aws-sdk/client-s3 3.1026.0 |
| Payments | stripe 17.0.0 |
| Canvas editor | @tiptap/react 3.22.4 |
| Charts | recharts 2.15.4 |
| Validation | zod 4.3.6 |
| Testing | vitest (16 unit tests), playwright (E2E, count varies) |
| Build | Standalone output, 50MB body size limit for Server Actions |
| Type gate | `npx tsc --noEmit` must pass (zero errors) |

---

## 5. Pipeline Service

### 5.1 Process Architecture

`pipeline/src/main.py` boots 4 concurrent asyncio tasks via `asyncio.gather`:

```python
asyncio.gather(
    run_consumer_loop(DATABASE_URL, tick_interval=60),     # Ingest cron + job queue
    run_workflow_processor(DATABASE_URL, poll_interval=10), # Event-driven workflow engine
    run_health_server(host, port=8080),                    # HTTP liveness/readiness
    run_lifecycle_scheduler(DATABASE_URL),                 # Hourly memory maintenance cron
)
```

On startup, also calls `seed_master_admin()` (idempotent) and instantiates `AgentFabric()` (see §9).

### 5.2 Dispatcher — Job Kinds

`pipeline/src/ingest/dispatcher.py` owns the job queue and cron:

| `pipeline_jobs.kind` | Handler | What it does |
|---------------------|---------|-------------|
| `ingest` (default) | `_run_ingest_job` | Routes by `source` to one of 4 ingesters |
| `shred_solicitation` | `_run_shred_job` | Full PDF→Claude→DB shredder |
| `expand_topics` | `_run_expand_topics_job` | On-demand per-solicitation topic bulk-fetch via DSIP API |
| `scout_source` | `_run_scout_job` | Web crawl + Claude diff analysis |
| `draft_section` | (in CHECK enum, no handler) | 🟦 Defined in pipeline_jobs.kind CHECK (migration 040) but no dispatch handler in dispatcher.py |
| `review_section` | (in CHECK enum, no handler) | 🟦 Same — no handler |

Job claiming uses `FOR UPDATE SKIP LOCKED` for safe concurrent dispatch.

### 5.3 Ingesters

| Class | Source name | API | Auth | Stub | Status |
|-------|------------|-----|------|------|--------|
| `SamGovIngester` | `sam_gov` | api.sam.gov/opportunities/v2 (GET, paginated) | DB-encrypted API key (AES-256-GCM) | 5 synthetic records | ✅ |
| `SbirGovIngester` | `sbir_gov` | api.www.sbir.gov/public/api/solicitations (GET) | None (public) | 3 synthetic solicitations | ✅ |
| `GrantsGovIngester` | `grants_gov` | api.grants.gov/v1/api/search2 (POST) | None | 3 synthetic records | ✅ |
| `DsipIngester` | `dsip` | dodsbirsttr.mil/topics-app/api (JSON+HTML fallback) | None | 4 synthetic topics | ✅ |

All ingesters extend `BaseIngester` (abstract). `BaseIngester.run()` handles paging, content-hash dedup, and upsert to `opportunities` + auto-creation of `curated_solicitations` triage rows. `SamGovIngester` reads AES-256-GCM encrypted API keys from `api_key_registry` via `pipeline/src/crypto.py`.

### 5.4 Shredder

`pipeline/src/shredder/runner.py`:

1. Fetches PDF from S3 (`rfp-pipeline/{opp_id}/source.{ext}`)
2. Extracts text via `pymupdf4llm` (200K char cap per `extractor.py`)
3. Calls Claude twice (section extraction prompt + compliance variable extraction prompt)
4. Writes structured output to `curated_solicitations.ai_extracted`, `solicitation_compliance` (UPSERT), `solicitation_documents` (extracted_text), plus S3 artifacts (`text.md`, `shredded/*.md`, `metadata.json`)
5. Emits `finder:rfp.shredding.start/end` events

Prompts live in `pipeline/src/shredder/prompts/v1/section_extraction.txt` and `compliance_extraction.txt`.

**Known issue:** `extractor.py` calls synchronous boto3 inside async context — blocks event loop per PDF (🟡).

**Known issue:** `converter.py::convert_format()` has no subprocess timeout — hung LibreOffice will block (🟡). LibreOffice is dormant anyway (document agents not invoked).

### 5.5 Scoring (Live Path)

`pipeline/src/workflows/actions/score_tenants.py::match_tenants()` is the live scoring path. Called by `OnSolicitationPushed` workflow when admin pushes a solicitation.

Scoring factors:
- NAICS overlap (30 pts max)
- Keyword + tech focus match (25 pts)
- Agency preference match (20 pts)
- Set-aside type match (15 pts)
- Program type match (5 pts)
- Timeline feasibility (5 pts)
- Optional LLM adjustment (-15 to +15 pts)

Results upserted to `tenant_pipeline_items` ON CONFLICT for each matched tenant. Tenants above `min_surface_score` threshold (from `tenant_profiles.min_surface_score`, default 40) appear in Spotlight.

**Dormant dead code:** `pipeline/src/scoring/engine.py::ScoringEngine` is a standalone scoring class with **no caller anywhere** (grep confirms only its class definition exists — it does not call, and is not called by, the live path). The live scoring path is `match_tenants` (invoked by `OnSolicitationPushed`). `ScoringEngine` is a vestige — deprecate. (See §14.)

### 5.6 Source Scout (Workers)

`pipeline/src/workers/source_scout.py`:
- Crawls `source_profiles` with `auto_crawl_enabled=true`
- Fetches page HTML per region, computes SHA-256 content hash
- Asks Claude to analyze changes: extracts `extractedOpportunities` list from diff
- Writes `source_snapshots` and `source_diffs`
- Emits `finder:source.scouted` and `finder:source.change_detected` events
- Triggers `OnSourceChangeDetected` workflow → `create_draft_solicitations` ACTION → `OnOpportunitiesDetected` chain

### 5.7 Memory Lifecycle (Wired)

`pipeline/src/lifecycle_scheduler.py` runs hourly and fires:

| Frequency | Class | What it does |
|-----------|-------|-------------|
| Daily | `MemoryDecay` | Time-based decay factor on all episodic memories |
| Daily | `PreferenceExtractor` | Scans recent episodic memories → new semantic preferences |
| Weekly | `PatternPromoter` | Clusters episodic memories → promotes to semantic |
| Weekly | `MemoryGC` | Hard-deletes expired memories (6mo episodic, 3mo semantic, 12mo procedural) |
| Monthly | `Calibrator` | Recalibrates agent performance metrics from `agent_task_log` |
| Monthly | `MemoryCompactor` | Compresses old episodic clusters → semantic |
| Monthly | `ContradictionResolver` | Detects contradictions in semantic memories; flags close calls for review |

**Broken import:** `pipeline/src/agents/learning/__init__.py` uses absolute import paths (`pipeline.src.agents.learning.*`) that fail at runtime. Non-fatal because `lifecycle_scheduler.py` imports each class directly by module path and does NOT use this `__init__.py`.

### 5.8 Pipeline Stack

| Aspect | Detail |
|--------|--------|
| Language | Python 3.12 |
| Async | asyncio; httpx for HTTP client |
| DB | asyncpg (raw SQL) |
| S3 | boto3 (synchronous — called in async context in some places) |
| AI | anthropic async client |
| PDF | pymupdf4llm for text extraction |
| Health | Raw asyncio HTTP server, port 8080 |
| Testing | pytest (~25 real tests + 4 empty placeholders) |

---

## 6. CMS/CRM Service

### 6.1 Two Live CMS Systems

There are two distinct "CMS" implementations that coexist:

**System A — Next.js-native content admin (Frontend)**

| Component | Path | Purpose |
|-----------|------|---------|
| Admin pages | `frontend/app/admin/site/*` | CMS page editor, doc editor for marketing site |
| API routes | `frontend/app/api/admin/site/*` | Save draft, publish, list pages, list docs |
| Library | `frontend/lib/content-admin.ts` | `getPage()`, `saveDraft()`, `publishPage()` |
| DB table | `content_pages` | Versioned page content; active/draft/archived status |
| Public API | `GET /api/content/[slug]` | Serves published content to marketing pages |

Marketing pages (homepage, about, pricing, etc.) read their editable content from `page_content` (via `content_pages`) at `revalidate: 60s`. Admins edit pages in the `/admin/site/[pageKey]` editor. Publishing triggers `Next.js revalidatePath`.

**System B — FastAPI CRM/CMS service (`services/cms`)**

The separate FastAPI service at `services/cms/` is fully deployed and operational. CLAUDE.md's claim that it is "Dormant V1, placeholder" is **incorrect as of this baseline**.

### 6.2 services/cms — FastAPI Service Detail

**Startup sequence (`main.py:64–91`):**
1. `init_db()` — connects to `govtech_cms` (CMS-own DB) via `CMS_DATABASE_URL`
2. `init_event_bridge()` — connects to `govtech_intel` (shared DB) via `SHARED_DATABASE_URL`
3. `start_event_listener()` — polls `system_events` every 10s
4. 6 worker task loops launched

**87 HTTP endpoints by router:**

| Router prefix | Count | Purpose |
|--------------|-------|---------|
| `/health` | 1 | Liveness probe |
| `/api/auth/*` | 3 | JWT session for CMS SPA |
| `/api/email/*` | 33 | Accounts, templates, campaigns, sends, engagement, threads, outbox |
| `/api/content/*` | 12 | Post CRUD, workflow actions, AI generation management |
| `/api/media/*` | 6 | Image/doc upload and serve |
| `/api/social/*` | 7 | Social account registration + post scheduling |
| `/api/drip/*` | 9 | Drip campaign sequences and enrollments |
| `/api/todos` | 3 | Admin TODO CRUD |
| `/api/page-blocks/*` | 13 | Visual page-block editor + publish bridge to shared DB |
| **Total** | **87** | |

**7 worker loops:**

| Worker | Poll | Status |
|--------|------|--------|
| `content_generator` | 30s | ✅ Active — calls Claude to generate content from prompt/URL/email/screenshot |
| `email_queue` | 15s | ✅ Active — dequeues and sends via Gmail API |
| `email_sweep` | 300s | ✅ Active — Gmail inbox sweep, reply classification, HITL auto-draft |
| `campaign_executor` | 60s | ✅ Active — resolves campaign audience and creates sends |
| `drip_engine` | 60s | ✅ Active — advances drip enrollment steps |
| `social_poster` | 60s | 🟡 Runs but all posts fail — LinkedIn and Twitter adapters raise `NotImplementedError` |
| `event_listener` | 10s | ✅ Active — polls `system_events`, matches `automation_rules`, executes actions |

**Event listener actions:**

| Action type | Status |
|------------|--------|
| `send_email` | ✅ Working |
| `notify_admin` | ✅ Working |
| `create_todo` | ✅ Working |
| `enroll_drip` | ✅ Working |
| `distribute_social` | 🟡 Creates DB rows; `social_poster` then fails to post |
| `publish_content` | ✅ Working (INC-8 fix) |
| `unpublish_content` | ✅ Working (was broken before baseline, now fixed) |
| `system:notification.requested` | ✅ Fast-path, bypasses automation_rules |

**Database connections:**
- `CMS_DATABASE_URL` → `govtech_cms` (all CMS-own tables)
- `SHARED_DATABASE_URL` → `govtech_intel` (reads: `system_events`, `automation_rules`, `users`, `tenants`; writes: `system_events`, `cms_content`)

**CMS SPA:** React + Vite, served at `/cms/` path. Pages: Dashboard, ContentPipeline, ContentEditor, EmailAccounts, EmailCampaigns, EmailOutbox, DripCampaigns, SocialAccounts, SocialPosts, Todos, PageEditor.

### 6.3 CMS Bugs — Fixed vs. Open

| Issue | Status |
|-------|--------|
| Phase double-fire (`start` events matching automation_rules) | ✅ Fixed (`_rule_matches` phase guard) |
| Unpublish no-op (handler was absent) | ✅ Fixed (`_action_unpublish_content` wired) |
| Template render None → silent no-send | ✅ Fixed (emits `notification.failed` + plaintext fallback) |
| Social posting (LinkedIn/Twitter) | 🔴 Open — both raise `NotImplementedError` |
| Recurring campaign no true cron | 🟡 Open — deferred to V2 (per comment in campaign_executor.py:342) |

---

## 7. Data Layer

### 7.1 72 Tables / 14 Domains

| Domain | Table Count | Key Tables |
|--------|------------|-----------|
| 1. Auth & Tenancy | 9 | `tenants`, `users`, `accounts`, `sessions`, `tenant_profiles`, `invitations`, `consent_records` |
| 2. Opportunities & Pipeline | 4 | `opportunities`, `tenant_pipeline_items`, `tenant_actions`, `spotlights` |
| 3. RFP Curation | 12 | `curated_solicitations`, `compliance_variables`, `solicitation_compliance`, `solicitation_documents`, `solicitation_volumes`, `volume_required_items`, `triage_actions`, `solicitation_annotations`, `compliance_presets`, `curation_revisions`, `solicitation_templates`, `solicitation_outlines` |
| 4. Proposals & Workspace | 14 | `proposals`, `proposal_sections`, `proposal_collaborators`, `collaborator_stage_access`, `proposal_stage_history`, `proposal_comments`, `proposal_reviews`, `proposal_compliance_matrix`, `proposal_activity_log`, `stage_gate_requirements`, `stage_completion_snapshots`, `proposal_supporting_docs`, `canvas_versions`, `audit_log` |
| 5. Content Library | 5 | `library_units`, `library_harvest_log`, `library_atom_outcomes`, `tenant_uploads`, `document_templates` |
| 6. Agent Fabric | 9 | `agent_archetypes`, `episodic_memories`, `semantic_memories`, `procedural_memories`, `agent_task_log`, `agent_task_queue`, `agent_task_results`, `tenant_agent_config`, `agent_performance` |
| 7. Event Bus & Automation | 6 | `system_events`, `opportunity_events`*, `customer_events`*, `content_events`*, `automation_rules`, `automation_log` |
| 8. Control Plane | 11 | `pipeline_jobs`, `pipeline_schedules`, `pipeline_runs`, `api_key_registry`, `rate_limit_state`, `source_health`, `system_config`, `process_instances`, `process_instance_transitions`, `process_templates`, `tasks` |
| 9. SBIR Reference | 3 | `sbir_companies`, `sbir_awards`, `sbir_data_uploads` |
| 10. Source Scout | 5 | `source_profiles`, `source_visits`, `source_regions`, `source_snapshots`, `source_diffs` |
| 11. Applications & CRM | 3 | `applications`, `waitlist`, `purchases` |
| 12. Monitoring & Analytics | 4 | `tool_invocation_metrics`, `system_health_snapshots`, `visitor_sessions`, `page_views` |
| 13. CMS / Marketing Content | 2 | `cms_content` (legacy), `content_pages` (primary, V8) |
| 14. Infrastructure | 3 | `deploy_baseline`, `_migration_history` (runner), `system_config` |

*Legacy event buses (opportunity_events, customer_events, content_events) predate `system_events` (migration 007). Active code should not write to these; they remain in the schema.

### 7.2 Key CHECK Enums

| Table.Column | Final Allowed Values |
|-------------|---------------------|
| `pipeline_jobs.kind` | `ingest`, `shred_solicitation`, `scout_source`, `draft_section`, `review_section`, `expand_topics` |
| `curated_solicitations.status` | `new`, `claimed`, `released`, `released_for_analysis`, `ai_analyzed`, `shredder_failed`, `curation_in_progress`, `review_requested`, `approved`, `pushed_to_pipeline`, `dismissed`, `rejected_review` |
| `proposals.stage` | `draft`, `review`, `final`, `submitted`, `archived` |
| `users.role` | `master_admin`, `rfp_admin`, `tenant_admin`, `tenant_user`, `partner_user` |
| `tasks.status` | `open`, `in_progress`, `completed`, `cancelled`, `expired` |
| `process_instances.status` | `pending`, `running`, `paused`, `completed`, `failed`, `cancelled`, `retrying` |
| `automation_rules.action_type` | `log_only`, `queue_notification`, `queue_job`, `emit_event`, `send_email`, `notify_admin`, `webhook`, `update_status`, `create_todo`, `distribute_social`, `publish_content`, `unpublish_content`, `enroll_drip` |
| `purchases.product_type` | `finder_subscription`, `proposal_phase1`, `proposal_phase2`, `expert_consulting` |
| `content_pages.status` | `draft`, `active`, `archived` |
| `opportunities.topic_status` | `open`, `pre_release`, `closed`, `awarded`, `withdrawn` |
| `opportunities.phase_type` | `phase_1`, `phase_2`, `direct_to_phase_2`, `phase_3`, `cso`, `ota`, `baa`, `other` |
| `canvas_versions.source` | `ai_draft`, `human_edit`, `ai_revision`, `library_import`, `template`, `system` |

### 7.3 No solicitation_topics Table

The `solicitation_topics` table was created in migration 001, superseded by the 013 "topics-as-opportunities" refactor (topics are now rows in `opportunities` with `solicitation_id` set), and physically dropped in migration 035 (confirmed in 030a). References to `solicitation_topics` in any code or document are stale.

### 7.4 RLS Reality

Four tables have `ALTER TABLE … ENABLE ROW LEVEL SECURITY` applied (migration 001):
- `episodic_memories`
- `semantic_memories`
- `procedural_memories`
- `agent_task_log`

**Zero `CREATE POLICY` statements exist in any of the 69 migrations.** With RLS enabled and no policies, PostgreSQL defaults to deny-all for non-superusers. In practice this is bypassed because both services connect as the database owner (bypasses RLS). Tenant isolation is implemented exclusively via explicit `WHERE tenant_id = $1` clauses in all queries. The CLAUDE.md statement "Row-Level Security on all tenant-scoped agent memory tables" is accurate about RLS being enabled, but misleading about policies existing.

### 7.5 automation_rules Dual Schema

`automation_rules` has two parallel trigger-column schemas due to a migration history issue (019 DDL rolled back, 030a bridge re-applied it):

| Era | Columns | Used by |
|-----|---------|---------|
| Legacy (001) | `trigger_bus TEXT`, `trigger_events TEXT[]` | Old code (no active callers identified) |
| Current (019/028/030a) | `trigger_namespace TEXT`, `trigger_type TEXT` | CMS `event_listener.py`, frontend admin routes |

The CMS `event_listener.py` dynamically introspects `information_schema.columns` to handle both schemas. In practice, all seeded rules use `trigger_namespace` + `trigger_type`. The legacy columns are nullable and effectively dead. Resolution: deprecate `trigger_bus` and `trigger_events` columns (see §14, Open Reconciliation #3).

### 7.6 Migration Runner

**Live runner:** `db/migrations/run.sh` → `db/migrations/migrate.mjs` (Node.js)

Mechanics:
- Creates `_migration_history` table on first run
- Iterates `db/migrations/*.sql` sorted by filename
- Skips files already recorded in `_migration_history` (keyed by filename, NOT checksum)
- Wraps each file in a transaction (`BEGIN … COMMIT` / `ROLLBACK on error`)
- Records successful files in `_migration_history`

**Migration 030a note:** A "bridge migration" that re-applies all DDL from migrations 007–035 as a full `IF NOT EXISTS` idempotent sweep, created because migration 019's DDL rolled back in a production deploy. 030a is 1,345 lines. It creates a maintenance burden: future migrations adding columns must account for 030a's conditional DDL.

**Migration 063/064 note:** NOT duplicates. 063 was applied to production. The content was then updated (adding `metadata.icon` values). Because the runner skips by filename, a new 064 was required. This is the correct approach.

**Dead runner:** `scripts/migrate.sh` — has NO tracking table. CLAUDE_CLIFFNOTES.md explicitly marks it "NEVER USE." Do not run it.

---

## 8. Event System + Automation

### 8.1 system_events Schema

```sql
CREATE TABLE system_events (
    id           UUID PRIMARY KEY,
    namespace    TEXT NOT NULL,          -- 7 canonical values
    type         TEXT NOT NULL,          -- entity.action_past_tense format
    phase        TEXT NOT NULL,          -- CHECK: start | end | single
    actor_type   TEXT NOT NULL,          -- CHECK: user | system | pipeline | agent
    actor_id     TEXT NOT NULL,
    actor_email  TEXT,
    tenant_id    UUID REFERENCES tenants(id),  -- NULL for admin events
    parent_event_id UUID REFERENCES system_events(id),
    payload      JSONB NOT NULL DEFAULT '{}',
    error        JSONB,
    duration_ms  INTEGER,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Trigger: system_events_notify → pg_notify('events:{namespace}', ...)
```

### 8.2 Canonical Event Namespaces

| Namespace | Owner | Scope |
|-----------|-------|-------|
| `finder` | Admin/pipeline | RFP discovery, curation, sources |
| `capture` | Portal/Stripe | Customer opportunity pursuit, purchases |
| `identity` | Auth | Login, password change, consent |
| `proposal` | Portal | Proposal lifecycle, sections, collaborators |
| `library` | Portal/pipeline | Content library, CMS content |
| `system` | All | Infrastructure, emails, notifications, workflows |
| `tool` | Tool registry | Tool invocations (start/end pairs) |

**`agent` namespace:** Appears in `system_events.namespace` column comment and older docs (EVENT_CONTRACT.md, NAMESPACES.md). **Confirmed (grep across all 3 services): zero runtime emissions of an `agent` namespace.** It is a stale schema/doc artifact, not a runtime namespace — agent/tool activity emits under `tool` (e.g. `tool:tool.invoked`). The canonical 7 are as listed above; recommend removing `agent` from the schema comment.

**Admin events:** `tenant_id = NULL`
**Portal events:** `tenant_id = actual tenant UUID`

### 8.3 Event Phases

`start` + `end` pairs are used for long operations (correlated by `parent_event_id`). `single` is used for point-in-time events that have no meaningful duration. The CMS `_rule_matches()` fires only on terminal phases (`end`, `single`, or unphased) — never on `start` — to prevent double-execution (fixed, tested).

### 8.4 Workflow Engine — Jobs → Templates → Instances

```
system_events (new row)
    ↓
run_workflow_processor() polls every 10s
    ↓
get_workflow_for_event(namespace, type, phase) → Workflow class (if match)
    ↓
_run_workflow_managed() → WorkflowManager.create_instance() → process_instances row
    ↓
WorkflowManager.execute_instance() → step-by-step execution
    ↓
Step types: ACTION | AI_INVOKE | NOTIFY | HITL_WAIT | TODO | CONDITION | API_CALL
```

`process_templates` table is the catalog; `process_instances` is the execution ledger; `process_instance_transitions` is the audit trail; `tasks` is the HITL ToDo ledger.

### 8.5 9 Workflow Templates

| Template | Trigger | Steps | Status |
|----------|---------|-------|--------|
| `OnApplicationAccepted` | `capture:application.accepted:end` | ACTION (create_library_defaults) → HITL_WAIT (TODO) | ✅ Live |
| `OnCmsContentRequested` | `library:content.requested:single` | ACTION (draft) → TODO (rfp_admin, 72h) → ACTION (publish) → NOTIFY | ✅ Live |
| `OnOpportunitiesDetected` | `finder:opportunities.detected:single` | NOTIFY → TODO (rfp_admin, 72h) | ✅ Live |
| `OnProposalAdvancedToReview` | `proposal:proposal.advanced:end` (targetStage==review) | AI_INVOKE (routes via fabric, activates on deploy) → NOTIFY → TODO (tenant_admin, 72h) | ✅ wired (PIPE-12–13); real Claude activates on-deploy |
| `OnProposalAdvancedToFinal` | `proposal:proposal.advanced:end` (targetStage==final) | ACTION (generate_preview) → NOTIFY | ✅ Live |
| `OnProposalCreated` | `proposal:proposal.created:end` | NOTIFY only | ✅ Live (docstring mismatch — claims AI_INVOKE, code is NOTIFY-only) |
| `OnRfpUploaded` | `finder:rfp.uploaded:end` | ACTION (shred, 3 retries) → ACTION (extract_compliance) → NOTIFY | ✅ Live |
| `OnSolicitationPushed` | `finder:solicitation.pushed:single` | ACTION (match_tenants scoring) → NOTIFY | ✅ Live |
| `OnSourceChangeDetected` | `finder:source.change_detected:single` | ACTION (create_drafts) → NOTIFY → TODO (rfp_admin, 24h, wait_for source_diff.reviewed, on_timeout=notify) | ✅ Live |

### 8.6 Two Event Consumers

**Consumer 1 — Pipeline workflow processor** (`run_workflow_processor`):
- Polls `system_events` every 10s
- Matches triggers against registered workflow templates
- Dispatches step types; manages `process_instances` via `WorkflowManager`
- Falls back to fire-and-forget (no `process_instances`) if table doesn't exist (legacy path — currently dead since migration 043)

**Consumer 2 — CMS event listener** (`services/cms/src/event_listener.py`):
- Polls `system_events` (shared DB) every 10s
- Matches events against `automation_rules` table
- Executes email, todo, drip, social, and content publish/unpublish actions
- Fast-paths `system:notification.requested` events directly (bypasses automation_rules)

---

## 9. AI & Agents

### 9.1 Two AI Systems

**System A — Product AI (Frontend Direct) — ✅ LIVE**

The frontend makes direct calls to the Anthropic API (`api.anthropic.com`), allowed by the Next.js CSP `connect-src` whitelist:

| Route / Tool | Model | Purpose |
|-------------|-------|---------|
| `proposal.draft_section` tool | claude-sonnet-4-20250514 | Draft proposal section from library + compliance context |
| `/api/portal/.../ai/compliance` | claude-haiku-4-5-20251001 | Compliance check against requirements |
| CMS `content_generator` worker | claude-sonnet-4-20250514 | Generate marketing content |
| CMS `template_drafter` | claude-sonnet-4-20250514 | Draft email templates |
| Pipeline `shredder/runner.py` | ANTHROPIC_API_KEY (env) / model configurable | Extract structure from RFP PDFs |
| Pipeline `source_scout.py` | ANTHROPIC_API_KEY (env) | Analyze web page diffs |

**System B — Pipeline Agent Workforce — ✅ wired + context-bound + injection-hardened + tenant-isolated (PIPE-12–16); advisory output; real Claude + embeddings activate on-deploy**

The pipeline agent infrastructure is now connected to the execution path (PIPE-12–16):

```
main.py     → fabric = AgentFabric()     ← instantiated and passed to run_workflow_processor()
               10 archetypes register successfully
               fabric passed to workflow processor (PIPE-12)
               process_task_queue() scheduled as 5th asyncio task (PIPE-14)
processor.py → _execute_ai_invoke() → fabric.invoke_agent(archetype_role, event_payload) (PIPE-13)
               AI_INVOKE now routes via fabric (no importlib fallback)
               ContextAssembler pre-loads proposal/RFP/atoms before each call
               User content delimited by <untrusted_data> (injection hardened)
               All agent tools enforce tenant_id (tenant isolated)
               Output is advisory only — surfaced via NOTIFY, never auto-applied
OnProposalSectionEdited  → DiffAnalyzer.analyze()     (PIPE-15; wired)
OnProposalOutcomeRecorded → OutcomeAttributor.attribute() (PIPE-16; wired)
```

AI_INVOKE now routes via fabric; `process_task_queue` scheduled; vectorization scaffolded (default-off). Activate on deploy: ANTHROPIC_API_KEY for real Claude; EMBEDDINGS_PROVIDER=openai + OPENAI_API_KEY + backfill for vector search.

### 9.2 10 Agent Archetypes (All Dormant)

| Archetype | Role | Model | human_gate | Handles |
|-----------|------|-------|-----------|---------|
| `CaptureStrategistArchetype` | capture_strategist | Sonnet | True | `capture.pursuit.evaluation_requested`, `capture.purchase.completed` |
| `ColorTeamReviewerArchetype` | color_team_reviewer | Sonnet | True | `proposal.review_requested` |
| `ComplianceReviewerArchetype` | compliance_reviewer | Haiku | False | `proposal.section.content_updated`, `proposal.stage.advanced` |
| `LibrarianArchetype` | librarian | Haiku | False (DRAFT status) | `library.unit.created`, `library.bulk_import.completed` |
| `OpportunityAnalystArchetype` | opportunity_analyst | Haiku | True | `finder.opportunity.ingested` |
| `PackagingSpecialistArchetype` | packaging_specialist | Haiku | True | `proposal.stage.advanced` |
| `PartnerCoordinatorArchetype` | partner_coordinator | Haiku | True | `proposal.partner.added`, collaborator events |
| `ProposalArchitectArchetype` | proposal_architect | Sonnet | True | `proposal.created`, stage changes |
| `ScoringStrategistArchetype` | scoring_strategist | Haiku | False | `finder.scoring.completed`, outcomes |
| `SectionDrafterArchetype` | section_drafter | Sonnet | True | `proposal.section.draft_requested` |

### 9.3 Memory Model

Three memory types in `govtech_intel` (pgvector, HNSW indexes):

| Type | Table | Purpose | V1 retrieval |
|------|-------|---------|-------------|
| Episodic | `episodic_memories` | Observations, interactions, decisions, outcomes per tenant+agent | ILIKE text search (pgvector cosine planned V4) |
| Semantic | `semantic_memories` | Generalized patterns promoted from episodic | ILIKE text search |
| Procedural | `procedural_memories` | Step-by-step procedures | ILIKE text search |

Memory embedding column: `vector(1536)` with HNSW index (`m=16 ef_construction=128` for episodic/procedural; `m=24 ef_construction=200` for semantic). V1 uses zero-vector placeholders — similarity search is text-only. Vector embeddings are planned for Phase 4.

Memory lifecycle: decay → preference extraction (daily) → pattern promotion → GC (weekly) → compaction → calibration (monthly). All wired via `lifecycle_scheduler.py`.

### 9.4 Agent Workforce Wiring Status (PIPE-12–16 complete)

All code wiring is complete. Remaining items are deploy-time activation:

1. ✅ `fabric` passed to `run_workflow_processor()` (PIPE-12)
2. ✅ `_execute_ai_invoke()` calls `fabric.invoke_agent(archetype_role, event_payload)` (PIPE-13)
3. ✅ `fabric.process_task_queue()` scheduled as 5th asyncio task (PIPE-14)
4. ✅ `OnProposalSectionEdited` → `DiffAnalyzer` workflow wired (PIPE-15); needs section-save event to emit `originalContent`/`agentRole` to fully activate (follow-up)
5. ✅ `OnProposalOutcomeRecorded` → `OutcomeAttributor` workflow wired (PIPE-16)
6. 🔲 Deploy-time: set `ANTHROPIC_API_KEY` to activate real Claude invocations
7. 🔲 Deploy-time: set `EMBEDDINGS_PROVIDER=openai` + `OPENAI_API_KEY` and run `MemoryStore.backfill_embeddings` per table for vector search (Voyage needs vector(1536)→1024 migration first)

---

## 10. Roles & Multi-Tenancy

### 10.1 Role Hierarchy

```
master_admin  (rank 5) — Full system: migrations, Railway management, system config
    │
rfp_admin     (rank 4) — RFP triage/curation, customer onboarding, CMS admin
    │
tenant_admin  (rank 3) — Manages their tenant, invites team, purchases proposals
    │
tenant_user   (rank 2) — Access per admin grant (all proposals or per-proposal)
    │
partner_user  (rank 1) — Stage-scoped access per proposal (view/comment/edit)
```

### 10.2 App-Level Isolation

Tenant isolation is enforced at three layers:

1. **Middleware** — Path-based role minimum via `PATH_MIN_ROLE` map before any DB access.
2. **Route layer** — `getTenantBySlug(slug)` + `verifyTenantAccess(userId, tenantId)` on every portal route. Admin routes use `requireAdmin()` or `hasRoleAtLeast(rfp_admin)`.
3. **Query layer** — All tenant-scoped queries include `WHERE tenant_id = $tenantId`. The `assertKeyBelongsToTenant()` helper enforces S3 key prefix isolation.

### 10.3 Partner Scoping

`partner_user` is a proposal-scoped external collaborator:
- Invited via `POST /api/portal/.../proposals/[id]/collaborators`
- Access record in `proposal_collaborators` with `collaborator_stage_access` per stage
- Can view/comment/edit only the sections and stages they are granted
- Portal layout hides all non-proposal navigation sections
- Opportunities list shows only proposals where they are listed as collaborator

### 10.4 Known Role Gap

`GET /api/portal/[tenantSlug]/profile` has **no role minimum** — a `partner_user` can read `billing_email` and full company profile. This is a confirmed bug (BASELINE_FINDINGS §3). (🟡)

---

## 11. Storage

### 11.1 S3/R2 Object Storage

**Backend:** Cloudflare R2 (S3-compatible, `forcePathStyle: true`)
**Bucket:** Single bucket (name from `AWS_S3_BUCKET_NAME` env; defaults to `rfp-pipeline-local` in Pipeline, accessed via `AWS_ENDPOINT_URL` for R2 endpoint)
**Auth:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY`

### 11.2 Key Scheme — Three Prefixes

```
rfp-admin/
├── inbox/{yyyy}/{mm}/{dd}/{source}/{external_id}.{ext}    ← Raw RFP files from admin upload
└── discarded/{yyyy}/{mm}/{external_id}.{ext}             ← Discarded drafts

rfp-pipeline/
└── {opportunity_id}/
    ├── source.{ext}           ← Original PDF
    ├── text.md                ← Extracted markdown
    ├── metadata.json          ← Extraction metadata
    ├── shredded/{name}.md     ← Per-section AI atoms
    └── attachments/{name}.ext ← Supporting attachments

customers/
└── {tenant_slug}/
    ├── proposals/{proposal_id}/
    │   ├── rfp-snapshot/      ← Portal provisioning copy (at purchase)
    │   ├── compliance.json    ← Snapshot at purchase time
    │   ├── manifest.json
    │   └── dropbox/           ← Tenant working files
    └── library/               ← Library unit source files
```

Additionally:
- `cms/images/` — CMS image uploads (from `admin/site/upload-image` route)
- `reference/documents/{id}.json` — Admin canvas reference documents
- `reference/images/` — Admin reference document images
- `customers/{slug}/proposal-export/{id}.zip` — Preview export ZIP

### 11.3 Path Helpers (Canonical Files)

- **Frontend:** `frontend/lib/storage/paths.ts` — `rfpAdminInboxPath()`, `rfpAdminDiscardedPath()`, `rfpPipelinePath()`, `customerPath()`, `assertKeyBelongsToTenant()`
- **Pipeline:** `pipeline/src/storage/paths.py` — matching Python helpers with same logic and validation

Both must be kept in sync with each other.

### 11.4 CMS Media Storage

The CMS service (`services/cms`) uses the Railway persistent volume at `CMS_STORAGE_ROOT` (default `/data/cms`) for its **own** media files (images uploaded through the CMS admin SPA). This is the only legitimate use of local disk storage in the system. All RFP Pipeline business data (RFP documents, proposals, library) uses S3/R2.

---

## 12. Deployment & Infrastructure

### 12.1 Railway

Three services + two Postgres instances + one CMS volume:

```
Railway Project
├── govtech-frontend          (Next.js 15, standalone build)
├── govtech-pipeline          (Python 3.12, asyncio)
├── govtech-cms               (FastAPI + Vite SPA)
├── govtech-db                (PostgreSQL 16 + pgvector → govtech_intel)
├── govtech-cms-db            (PostgreSQL 16 → govtech_cms)
└── govtech-cms-volume        (Persistent volume → /data/cms)
```

Services coordinate via shared tables in `govtech_intel`, not via HTTP calls.

### 12.2 CI Workflows

**`.github/workflows/ci.yml`** — Runs on push/PR to main:

| Job | What it does |
|-----|-------------|
| `frontend` | `npm ci` → type-check (`tsc --noEmit`) → lint → vitest unit tests → `next build` (with fake DATABASE_URL) |
| `pipeline` | `pip install -r requirements.txt` → `pytest tests/` |
| `crm` | `py_compile` checks → pytest CMS tests → CMS SPA `npm build` |
| `migrate-crm` | Spins up Postgres 16 → runs `services/cms/db/run.sh` → verifies `cms_posts`, `email_accounts`, `email_outbox` tables exist |

**Gap:** No main-DB migration check in CI. Main DB migrations run via `entrypoint.sh` on Railway deploy (not validated in CI). A migration error only surfaces at deployment time.

**`.github/workflows/migrate.yml`** — Manual `workflow_dispatch` only:
- Runs ad-hoc migrations against production or staging main DB and/or CMS DB
- Supports dry-run mode
- Calls `db/migrations/run.sh` (tracked runner)

### 12.3 Migrations at Deploy

**Frontend:** `package.json` `start` script calls `node db/migrations/migrate.mjs` before `next start`.
**Pipeline:** `Dockerfile` or Railway entrypoint runs `migrate.mjs` before starting the asyncio loop.
**CMS:** `services/cms/db/run.sh` runs the CMS migrations before starting FastAPI.

### 12.4 Key Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Frontend, Pipeline | PostgreSQL `govtech_intel` connection |
| `CMS_DATABASE_URL` | CMS | PostgreSQL `govtech_cms` connection |
| `SHARED_DATABASE_URL` | CMS | PostgreSQL `govtech_intel` for event bridge |
| `ANTHROPIC_API_KEY` | All three | Claude API key |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_ENDPOINT_URL`, `AWS_S3_BUCKET_NAME` | Frontend, Pipeline | S3/R2 access |
| `NEXTAUTH_SECRET` | Frontend | JWT signing |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Frontend | Stripe integration |
| `CMS_JWT_SECRET` or `CMS_API_KEY` | CMS | CMS SPA session auth |
| `GOOGLE_SERVICE_ACCOUNT_JSON` or OAuth vars | CMS | Gmail API for email sending |
| `REVALIDATE_SECRET` | Frontend, CMS | Next.js ISR revalidation |
| `API_KEY_ENCRYPTION_SECRET` | Pipeline | AES-256-GCM key for `api_key_registry` |
| `CLAUDE_MODEL` | Pipeline | Configurable model override (default: claude-sonnet-4-20250514) |

---

## 13. Cross-Cutting Conventions and SOPs

### 13.1 Error Handling SOP

- Server components: `try/catch` all DB queries; re-throw `NEXT_REDIRECT`; log with tagged prefix.
- API routes: `try/catch` returning `NextResponse.json` with proper status codes; validate inputs first.
- Client components: check `res.ok`; parse JSON safely; set error/loading states.
- Database: validate `DATABASE_URL` at load; `.on('error')` handlers on pools.
- Auth: `try/catch` around DB queries in `authorize()`; wrap non-critical updates separately.
- Every error response MUST include both `error` (string) and `code` (string) fields.
- Every `await sql` call MUST be inside `try/catch`.

### 13.2 API Response Shapes

```typescript
// Success:
{ data: T }

// Error:
{ error: string, code: string }
// Documented exceptions: /api/health returns {ok,version,...}; /api/analytics/pageview returns {ok:true}
```

### 13.3 SQL Conventions

- Parameterize all SQL via postgres.js tagged templates.
- Escape ILIKE patterns: `input.replace(/[%_\\]/g, '\\$&')`
- Verify column names in `CLAUDE_CLIFFNOTES.md §1` before writing SQL.
- Portal routes: always verify tenant access before returning tenant-specific data.
- Multi-table writes: use `sql.begin()` transaction.

### 13.4 Event SOP

- Type format: `entity.action_past_tense` (snake_case)
- Namespace: one of the 7 canonical values (see §8.2)
- Admin events: `tenantId = null`
- Portal events: `tenantId = actual tenant UUID`
- Never use: `admin`, `cms`, `spotlight` as namespaces

### 13.5 SOP Hygiene Gaps (Confirmed in Codebase)

These are deviations from CLAUDE.md confirmed by the file-by-file audit:

**Missing inner `try/catch` on `await sql` (20+ routes):**
`admin/analytics`, `admin/pipeline`, `admin/tenants` (list), `admin/automation` (GET), `admin/rfp-curation/[solId]/outline`, `admin/rfp-curation/[solId]/topics/[topicId]/compliance`, `admin/rfp-curation/[solId]/triage`, `admin/sources/[profileId]/regions/[regionId]`, `admin/sources/[profileId]/scout`, `admin/storage`, `admin/waitlist`, `admin/workflows/[instanceId]`, `admin/workflows` (GET), `admin/workflows/[instanceId]/cancel`, `admin/workflows/[instanceId]/retry`, `portal/[tenantSlug]/dashboard`, `portal/[tenantSlug]/proposals/[proposalId]/collaborators` (POST), `portal/[tenantSlug]/proposals/[proposalId]/compliance`, `portal/[tenantSlug]/proposals/[proposalId]/dropbox`, `portal/[tenantSlug]/proposals/[proposalId]/sections` (GET).

**`auth()` / `requireAdmin()` called outside outer `try/catch`:**
`admin/rfp-document/[id]/set-primary`, `admin/rfp-document/[id]/signed-url`, `admin/rfp-upload`, `admin/site/upload-image`.

**`emitEventSingle` / `emitEventEnd` not in `try/catch` (event failure → 500 after success):**
`admin/topics/[id]`, `admin/upload-topic-files`, `stripe/portal`, `portal/library/upload`, `portal/proposals/.../sections/.../export`, `portal/proposals/.../sections/.../save`.

**Missing transaction for multi-table writes:**
`invite` (POST) — user + collaborator update; `consent` (POST) — consent_records + users update.

**Unescaped ILIKE on user input:**
`lib/tools/memory-search.ts`, `lib/tools/library-search-atoms.ts` — CLAUDE.md requires `.replace(/[%_\\]/g, '\\$&')`. Wildcard-DoS / match-bypass risk.

**Internal error text exposed to client:**
`admin/sbir-data/ingest` — outer catch leaks internal error string to client.

**API convention conflict:**
`docs/API_CONVENTIONS.md` mandates `withHandler()`; `CLAUDE_CLIFFNOTES.md §2` shows raw `NextResponse.json`. Codebase uses both. Standardize to `withHandler()` as the P4 target.

---

## 14. Known Gaps & Technical Debt

### 14.1 Confirmed Bugs

| Sev | Bug | Location |
|-----|-----|---------|
| ✅ fixed (fix pass) | **Double-emit** of `finder:topics.expanded` — both `topic_expander.py::_emit_topics_expanded` and `dispatcher.py::_run_expand_topics_job` emit for one job (M3 regression) | `pipeline/src/ingest/topic_expander.py`, `dispatcher.py` |
| not a bug — pdf-parse v2.4.5 named export (false positive) | ~~`pdf-reader.ts` uses `{ PDFParse }` named import but `pdf-parse` only has a default export~~ — pdf-parse v2.4.5 exports `PDFParse` as a named export; `tsc` resolves it correctly. Named import is CORRECT. | `frontend/lib/import/pdf-reader.ts` |
| ✅ fixed (fix pass) | `lifecycle_scheduler` reconnect loop is **recursive** → stack overflow under sustained DB outage | `pipeline/src/lifecycle_scheduler.py` |
| ✅ fixed (fix pass) | `shredder/extractor.py` calls **synchronous boto3 inside async** — blocks event loop per PDF | `pipeline/src/shredder/extractor.py` |
| ✅ fixed (fix pass) | `agents/learning/__init__.py` has broken absolute imports (`pipeline.src.agents.learning.*`) → ImportError (masked because scheduler imports directly) | `pipeline/src/agents/learning/__init__.py` |
| ✅ fixed (fix pass) | `invite` POST emits double-prefixed type `identity.identity.invite_accepted` (should be `invite.accepted`) and does multi-table writes with no transaction | `frontend/app/api/invite/route.ts` |
| ✅ fixed (fix pass) | `consent` POST: multi-table writes with no transaction | `frontend/app/api/consent/route.ts` |
| ✅ fixed (fix pass) | `portal/[tenantSlug]/profile` GET has no role floor — `partner_user` can read `billing_email` + company profile | `frontend/app/api/portal/[tenantSlug]/profile/route.ts` |
| ✅ fixed (fix pass) | `admin/sbir-data/ingest` leaks internal error text to client; `sql.unsafe` batch with no `ON CONFLICT` | `frontend/app/api/admin/sbir-data/ingest/route.ts` |
| ✅ fixed (fix pass) | `document/converter.py::convert_format()` has no subprocess timeout — hung LibreOffice blocks loop | `pipeline/src/document/converter.py` |
| ✅ fixed (fix pass) | `tools/source-scout.ts` silently swallows Claude errors (`catch { return null }`) | `frontend/lib/tools/source-scout.ts` |

### 14.2 Dormant Items

| Item | Status | Notes |
|------|--------|-------|
| Pipeline agent workforce | ✅ wired + context-bound + injection-hardened + tenant-isolated (PIPE-12–16); advisory output; real Claude + embeddings activate on-deploy | fabric→processor wired; AI_INVOKE routes via fabric; process_task_queue scheduled; vectorization scaffolded (default-off) |
| `AI_INVOKE` workflow steps | ✅ routes via fabric (PIPE-13) | `_execute_ai_invoke()` now calls `fabric.invoke_agent()`; context-assembled + injection-hardened + tenant-isolated; real Claude activates on deploy |
| `agent_task_queue` consumer | ✅ scheduled (PIPE-14) | `process_task_queue()` now a 5th asyncio task in main.py |
| `DiffAnalyzer` | ✅ wired (PIPE-15) | `OnProposalSectionEdited` workflow wired; needs section-save event to emit originalContent/agentRole to fully activate |
| `OutcomeAttributor` | ✅ wired (PIPE-16) | `OnProposalOutcomeRecorded` workflow wired; triggers on `proposal:outcome.recorded` |
| `scoring/engine.py::ScoringEngine` | 💀 No caller | Standalone class, grep-confirmed zero callers; live path is `OnSolicitationPushed` → `match_tenants` |
| `pptx-exporter.ts` | 💀 No callers | Frontend PPTX export unwired; only DOCX export is wired |
| `xlsx-exporter.ts` | 💀 No callers | Frontend XLSX export unwired |
| `document/converter.py` (LibreOffice) | 🟦 Dormant | Called from document agents which are themselves never invoked |
| PPTX/XLSX pipeline document agents | 🟦 Dormant | Format agents ready but never called from pipeline core |
| Social poster (LinkedIn/Twitter) | 🔴 Stub | `NotImplementedError` — OAuth pending |
| `/api/portal/[tenantSlug]/agents/config` | 🟦 501 stub | P2-18 TODO — no implementation |

### 14.3 Open Reconciliations

**Resolved this pass (via targeted code grep):**

1. **Scoring path — RESOLVED:** `scoring/engine.py::ScoringEngine` has zero callers (only its class definition exists). Live scoring is `workflows/actions/score_tenants.py::match_tenants`, called by `on_solicitation_pushed.py`. → `ScoringEngine` is dead; deprecate.
2. **`agent` namespace — RESOLVED:** zero runtime emissions across all 3 services. Exists only in the `system_events.namespace` CHECK/comment and superseded docs. Canon = the 7 namespaces in §8.2. → remove `agent` from the schema comment.
3. **`automation_rules` dual schema — RESOLVED:** CMS `event_listener.py` introspects `information_schema` and matches on `trigger_namespace`/`trigger_type` when present (variant 1), falling back to legacy `trigger_bus`/`trigger_events` (variant 2). All seeded rules use variant 1; legacy columns are dead. → deprecate `trigger_bus`/`trigger_events`.
4. **`agent_task_queue`/`agent_task_results` — RESOLVED (not orphaned):** the frontend writes (`lib/agent-client.ts::requestAgentTask`) and reads for monitoring (`capacity.ts`, `admin/agents`); the pipeline consumer `AgentFabric.process_task_queue()` is simply never scheduled, so queued tasks aren't processed. These are the **interface to the dormant agent workforce** — keep; they activate when the §9.4 wiring lands.

**Remaining open:**

5. **PPTX/XLSX exporters:** `pptx-exporter.ts` and `xlsx-exporter.ts` are unwired in the frontend export routes (only DOCX is wired). Decide: intended capability gap (formats not shipped) or dead code to remove — clarify before the next export feature sprint.

### 14.4 Untested Critical Paths

Highest-risk untested paths:

1. `pipeline/src/ingest/topic_expander.py` — no test at all; `_derive_source_id`, `_content_hash` (MD5), `_upsert_topic` dedup on `(solicitation_id, topic_number)`.
2. `pipeline/src/ingest/dispatcher.py::tick_schedules()` and `consume_one_job()` (`FOR UPDATE SKIP LOCKED`) — the job-queue backbone.
3. `pipeline/src/storage/crypto.py` — AES-256-GCM round-trip; regression silently breaks SAM.gov key-based ingest.
4. Content-hash dedup-under-update (`base.py run()` amended path, `was_insert=False`).
5. `workflows/actions/score_tenants.py` — live scoring (multi-topic, fires every push).
6. `pipeline/src/workers/source_scout.py` — Claude diff analysis + `source_diffs` writes.
7. Frontend: `auth/[...nextauth]`, `stripe/webhook`, `proposals/create`, `proposals/[id]/advance` (stage gates), `sections/[id]/save` (OCC), `tools/[name]`.

---

## 15. What Changed Since V7 / V8

| Topic | V7 (2026-05-21) claim | V8 (2026-06-02) claim | V9 (2026-06-23) verified truth |
|-------|----------------------|----------------------|-------------------------------|
| CMS/CRM status | "Dormant V1 placeholder" | V8 reduced CMS to CRM-only (email/social); still described as email-CRM | **Fully live**: 87 endpoints, 7 workers, Vite SPA, email + content pipeline + social scheduler |
| Storage backend | "Shared Railway /data volume (S3-compatible in future)" | Not addressed | **S3/R2 is live today.** `STORAGE_ROOT=/data` is a dead constant. Railway volume is only for CMS media |
| AI / Agent workforce | "AI agent workforce assists at every stage" | Not addressed | **Split reality**: Product AI = frontend direct (✅ live); Pipeline agents = built-but-dormant (🟦) |
| HITL resume | "Fire-and-forget — resume broken (1h deadline)" | Not addressed | **Implemented**: `WorkflowManager.resume_instance()` exists and works. Only fire-and-forget path skips HITL |
| Table count | ~53 tables mentioned | Not addressed | **72 tables confirmed** across 14 domains |
| solicitation_topics | Referenced as a table | Not addressed | **Does not exist** — dropped migration 035; topics are opportunities rows |
| RLS | "RLS on tenant tables" | Not addressed | **RLS enabled on 4 tables, zero policies** — deny-all for restricted roles, bypassed by DB owner connection |
| CMS bugs | "Phase double-fire + unpublish no-op bugs" | Not addressed | **Fixed**: Both bugs have code fixes and regression tests |
| Content architecture | Not addressed | V8: `content_pages` table introduced; dual editor (CMS + native frontend) | **Confirmed**: `content_pages` is primary; CMS page-blocks bridge writes to shared DB; both editors live |
| Canonical architecture doc | "V5 / V8" | "V7 (master) + V8 (delta)" | **V9 supersedes V7 + V8** |

---

## 16. Appendix

### A. Inventory Files (docs/baseline/inventory/)

| File | Subsystem | Lines |
|------|-----------|-------|
| `FRONTEND_API.md` | 138 API routes (auth/validation/tables/response/tenant-scope) | ~1398 |
| `FRONTEND_PAGES.md` | 86 pages/layouts + middleware + config | 757 |
| `FRONTEND_LIB_COMPONENTS.md` | 148 lib + component files | — |
| `PIPELINE_AGENTS_WORKFLOWS.md` | 47 agents/workflows modules | 561 |
| `PIPELINE_CORE.md` | 74 core modules (dispatcher, ingest, shredder, storage) | 752 |
| `CMS.md` | 69 files (live verdict + endpoints + workers) | 782 |
| `DB_SCHEMA_CURRENT.md` | 69 migrations → 72-table consolidated schema + lineage | 1745 |
| `DOCS_INFRA.md` | 105 docs + CI + infra (canonical/stale classification) | 766 |

### B. 14 Data Domains

1. Auth & Tenancy (9 tables)
2. Opportunities & Pipeline (4 tables)
3. RFP Curation (12 tables)
4. Proposals & Workspace (14 tables)
5. Content Library (5 tables)
6. Agent Fabric (9 tables)
7. Event Bus & Automation (6 tables)
8. Control Plane / Pipeline (11 tables)
9. SBIR Reference Data (3 tables)
10. Source Scout (5 tables)
11. Applications & CRM (3 tables)
12. Monitoring & Analytics (4 tables)
13. CMS / Marketing Content (2 tables)
14. Infrastructure (3 tables)

**Total: 72 tables** (note: the 030a bridge migration note means 030a's `IF NOT EXISTS` DDL overlaps with some earlier migrations — no tables are double-counted; the count reflects distinct live tables).

### C. Canonical Document Map

| Topic | File |
|-------|------|
| System architecture (this doc) | `ARCHITECTURE_V9.md` |
| Content management delta | `ARCHITECTURE_V8.md` (folded into V9) |
| Engineering SOPs (session guide) | `CLAUDE_CLIFFNOTES.md` (root) |
| DB schema (full column listing) | `docs/DB_SCHEMAS.md` |
| Event type catalog | `docs/EVENT_CONTRACT_V2.md` |
| Automation execution model | `docs/EVENT_CONTRACT_V3.md` |
| Workflow/process template definitions | `docs/WORKFLOW_REFERENCE.md` |
| Agent architecture | `docs/AGENT_FRAMEWORK.md` |
| Memory system | `docs/MEMORY_MANAGEMENT.md` |
| S3 storage layout | `docs/STORAGE_LAYOUT.md` |
| Deployment (Railway) | `RAILWAY.md` |
| Local dev | `docker-compose.yml` + `Makefile` |
| Environment variables | `.env.example` |
| CI/CD | `.github/workflows/ci.yml` |
| Tool authoring | `frontend/lib/tools/README.md` |

### D. Stale / Misleading Docs to Update

| File | Problem |
|------|---------|
| `CLAUDE.md` (root) | ~~Points to `ARCHITECTURE_V5.md`~~ — fixed (now points to V9); says "one Postgres + one /data volume"; says "CMS dormant V1" |
| `docs/CLAUDE_CLIFFNOTES.md` (in docs/) | OLDER version (2026-04-27) of the root CLIFFNOTES; navigation hazard — delete or rename |
| `scripts/migrate.sh` | No tracking — marked "NEVER USE" in CLIFFNOTES; delete or rename to `_DANGEROUS_NO_TRACKING.sh` |
| `docker-compose.yml` | CMS section comment says "V1 dormant" — stale |
| `.env.example` | CMS section says "V1 dormant, deferred to V2+" — stale |
| `docs/AUTOMATION_WORKFLOWS.md` | Superseded by `WORKFLOW_REFERENCE.md`; archived → `docs/archive/AUTOMATION_WORKFLOWS.md` |

---

*This document was generated 2026-06-23 as part of the Phase 2 baseline exercise. Source of truth for all facts is `docs/baseline/BASELINE_FINDINGS.md` and the 8 inventory files in `docs/baseline/inventory/`. When facts conflict between this document and the inventories, the inventories win.*
