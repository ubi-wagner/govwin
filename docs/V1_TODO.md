# V1 Launch — Comprehensive TODO Plan

**Generated:** 2026-05-20
**Source:** ARCHITECTURE_V6.md Section 10 (Gap Analysis) + TODO.md audit
**Status:** Active — tracks all remaining work for V1 launch

---

## Summary

- **Total tasks:** 68
- **Estimated effort:** 28 dev-days (4 weeks)
- **Critical path:** Pipeline wiring → Shredder → Export → Email → Portal APIs

| Priority | Tasks | Effort | Theme |
|----------|-------|--------|-------|
| Phase 1 | 14 | 8 days | Pipeline wiring, shredder, export, email |
| Phase 2 | 30 | 10 days | Portal + Admin API stubs, scoring, AI routes |
| Phase 3 | 14 | 6 days | Canvas enhancements, collaboration, templates |
| Phase 4 | 10 | 4 days | Integration testing, infrastructure, go-live |

---

## Phase 1: Pipeline Wiring (Week 1)

The workflow processor is already wired to `main.py` via `asyncio.gather`. The gap is
that the ACTION step targets (the Python functions that steps reference) do not exist
as importable modules. Every workflow will fail at runtime with `ImportError`.

### 1.1 Workflow ACTION Targets

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P1-01 | Create actions package | Create `pipeline/src/workflows/actions/` package with `__init__.py` that exports all action functions for clean import paths. | `pipeline/src/workflows/actions/__init__.py` | None | S | Yes |
| P1-02 | Implement shred action wrapper | Thin wrapper around `shredder.runner.shred_solicitation` so `pipeline.shredder.shred` is importable. Takes `conn`, `solicitation_id`, `document_ids` from workflow input_map. Must instantiate Anthropic client from env. | `pipeline/src/workflows/actions/shred.py` | None | S | Yes |
| P1-03 | Implement extract_compliance action | Wrapper that calls the existing shredder compliance extraction as a standalone step. Used by `on_rfp_uploaded` step 2. The runner already does this inline, so this may be a no-op pass-through or a separate re-extraction path. | `pipeline/src/workflows/actions/shred.py` | P1-02 | S | Yes (same file) |
| P1-04 | Implement score_tenants action | Create `pipeline.scoring.match_tenants` — queries all tenants with active subscriptions, runs scoring engine against the pushed solicitation, writes `tenant_pipeline_items` rows, returns `{tenantIds: [...]}` for the NOTIFY step. | `pipeline/src/workflows/actions/score_tenants.py` | P1-10 | M | Yes |
| P1-05 | Implement create_default_categories | Create `pipeline.library.create_default_categories` — inserts standard library categories (Past Performance, Key Personnel, Technical Approach, etc.) for a newly accepted tenant. | `pipeline/src/workflows/actions/create_library_defaults.py` | None | S | Yes |
| P1-06 | Implement generate_preview | Create `pipeline.export.generate_preview` — generates a preview DOCX/PDF for a proposal entering the "final" stage. Calls the frontend export endpoint or uses the DocxAgent directly. | `pipeline/src/workflows/actions/generate_preview.py` | P2-15 | M | Yes |
| P1-07 | Implement create_drafts_from_scout | Create `finder.create_drafts_from_scout` — takes Source Scout region results, creates draft `curated_solicitations` rows from extracted opportunity data. | `pipeline/src/workflows/actions/create_drafts_from_scout.py` | None | M | Yes |

### 1.2 Shredder Execution Path

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P1-08 | Wire shredder worker to Claude | The shredder runner (`runner.py`) has Claude calling built in. The gap is the shredder worker (`workers/rfp_shredder.py`) must create the Anthropic client and pass it to `shred_solicitation`. Verify the worker correctly instantiates `anthropic.AsyncAnthropic` and calls the runner. | `pipeline/src/workers/rfp_shredder.py` | None | S | No (edit existing) |
| P1-09 | Topic auto-extraction via Claude | Currently regex-only topic extraction. Add Claude-based structured extraction from BAA full text for better topic identification. | `pipeline/src/shredder/runner.py`, new prompt file | P1-08 | M | No (edit existing) |

### 1.3 Event System Fixes

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P1-10 | CMS event bridge writes to wrong table | CMS event_listener writes to `content_events` instead of `system_events`. Fix the bridge so pipeline workflows can react to CMS-originated events. | `services/cms/src/models/events.py` | None | S | No (edit existing) |
| P1-11 | Automation log audit trail | `_execute_rule()` runs actions but never writes to `automation_log`. Add INSERT for every execution (success or failure) with rule_id, event_id, action, status, error. | `services/cms/src/event_listener.py` | None | S | No (edit existing) |
| P1-12 | Duplicate email dedup | Both workflow NOTIFY steps and automation rules react to same events. Add a `dedup_key` check in CMS email sender — hash(template + recipient + trigger_event_id) — skip if seen within 60 minutes. | `services/cms/src/event_listener.py` | P1-11 | S | No (edit existing) |
| P1-13 | Durable high-water mark | Store `last_processed_event_id` in a DB table instead of in-memory. Prevents missed events on service restart. | `pipeline/src/workflows/processor.py`, `services/cms/src/event_listener.py` | None | S | No (edit existing) |

### 1.4 Email Delivery End-to-End

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P1-14 | End-to-end email test | Verify the full path: workflow NOTIFY → `system:notification.requested` event → CMS polls event → render template → Gmail API → inbox. Fix any broken links in the chain. | `services/cms/src/event_listener.py`, `services/cms/src/gmail.py`, `services/cms/src/templates.py` | P1-10, P1-11 | M | No (test + fix) |

---

## Phase 2: Portal Completion (Week 2)

All portal API routes listed below currently return 501. Each must be implemented
following the canonical pattern in `CLAUDE_CLIFFNOTES.md`: auth check → tenant
lookup → access verification → input validation → business logic → event emit.

### 2.1 Portal API Routes — Core

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-01 | Portal dashboard | Tenant stats: proposal count by stage, recent activity (last 10 events), library unit count, upcoming deadlines. Query proposals, system_events, library_units, opportunities. | `frontend/app/api/portal/[tenantSlug]/dashboard/route.ts` | None | M | No (replace 501) |
| P2-02 | Portal opportunities list | Scored opportunity list for tenant. JOIN tenant_pipeline_items with opportunities and curated_solicitations. Support filters: program_type, agency, close_date range, score threshold. Paginated. | `frontend/app/api/portal/[tenantSlug]/opportunities/route.ts` | P1-04 | M | No (replace 501) |
| P2-03 | Portal opportunity actions | POST pin/unpin, thumb_up/thumb_down, pursue. Update tenant_pipeline_items with user preferences. Emit capture events. | `frontend/app/api/portal/[tenantSlug]/opportunities/[opportunityId]/actions/route.ts` | P2-02 | S | No (replace 501) |
| P2-04 | Portal opportunity documents | GET signed S3 URLs for solicitation_documents linked to this opportunity. Verify tenant has purchase or active subscription. | `frontend/app/api/portal/[tenantSlug]/opportunities/[opportunityId]/documents/route.ts` | None | S | No (replace 501) |
| P2-05 | Portal proposals list | GET paginated list of tenant proposals with stage, title, opportunity title, created_at, section_count. Filter by stage. | `frontend/app/api/portal/[tenantSlug]/proposals/route.ts` | None | S | No (replace 501) |
| P2-06 | Portal spotlights list + create | GET: list tenant spotlights (saved search buckets) with item counts. POST: create a new spotlight with name, filters (program_types, agencies, naics_codes, keywords). | `frontend/app/api/portal/[tenantSlug]/spotlights/route.ts` | None | M | No (replace 501) |
| P2-07 | Portal spotlight detail | GET scored items within a spotlight, applying the spotlight's filters against tenant_pipeline_items. PATCH to update spotlight filters/name. | `frontend/app/api/portal/[tenantSlug]/spotlights/[spotlightId]/route.ts` | P2-06 | S | No (replace 501) |
| P2-08 | Portal purchases | GET purchase history for tenant: product_type, amount, status, created_at. Join with proposals for proposal title. | `frontend/app/api/portal/[tenantSlug]/purchases/route.ts` | None | S | No (replace 501) |
| P2-09 | Portal uploads | POST file upload: accept multipart/form-data, store to S3 under `customers/{tenantId}/uploads/`, create library_units row with source_type='upload'. GET: list uploaded files. | `frontend/app/api/portal/[tenantSlug]/uploads/route.ts` | None | M | No (replace 501) |
| P2-10 | Portal notifications | GET notification feed for tenant user. Query system_events where namespace='system' AND type='notification.requested' AND payload contains tenant_id or user_id. Mark as read via PATCH. | `frontend/app/api/portal/[tenantSlug]/notifications/route.ts` | None | M | No (replace 501) |

### 2.2 Portal API Routes — AI

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-11 | AI draft section | POST: trigger AI draft for a specific section. Read section's requirement_ids, fetch matching compliance items + library atoms, call Claude to generate draft content. Save to proposal_sections.content. Emit proposal:section.drafted event. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft/route.ts` | None | M | No (replace 501) |
| P2-12 | AI review section | POST: run AI quality/compliance review on section content. Claude evaluates against compliance matrix, returns scores + suggestions. Save review to proposal_comments or return inline. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review/route.ts` | None | M | No (replace 501) |
| P2-13 | AI compliance check | POST: check section content against solicitation compliance variables. Return pass/fail per variable with excerpts. More targeted than full review. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance/route.ts` | None | S | No (replace 501) |

### 2.3 Portal API Routes — Proposal Pipeline

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-14 | Proposal reviews (color team) | GET: list review rounds with per-section comments and approval status. POST: create new review round (pink_team, red_team, gold_team). Each round has reviewer assignments, section-level comments, and pass/fail per section. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/reviews/route.ts` | None | L | No (replace 501) |
| P2-15 | Proposal package export | POST: generate complete proposal package as ZIP. For each section, export canvas JSON to DOCX/PPTX/XLSX using existing exporters. Bundle into ZIP with table of contents. Return as binary download. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/package/route.ts` | None | M | No (replace 501) |

### 2.4 Portal API Routes — Agent Monitoring

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-16 | Agent memories | GET agent_memories for tenant, filtered by agent_role, limit. RLS enforced via tenant_id. | `frontend/app/api/portal/[tenantSlug]/agents/memories/route.ts` | None | S | No (replace 501) |
| P2-17 | Agent performance | GET agent performance metrics: task count, avg duration, success rate. Aggregate from agent_task_queue for this tenant. | `frontend/app/api/portal/[tenantSlug]/agents/performance/route.ts` | None | S | No (replace 501) |
| P2-18 | Agent config | GET/PATCH tenant-level agent configuration. Read/write agent_configs for this tenant. | `frontend/app/api/portal/[tenantSlug]/agents/config/route.ts` | None | S | No (replace 501) |

### 2.5 Admin API Routes

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-19 | Admin dashboard | GET real stats: total tenants, active subscriptions, proposals by stage, revenue (sum purchases), recent events (last 20). Replaces placeholder 501. | `frontend/app/api/admin/dashboard/route.ts` | None | M | No (replace 501) |
| P2-20 | Admin pipeline | GET pipeline job stats: queued/running/completed/failed counts, recent jobs with duration. Query pipeline_jobs + pipeline_schedules. | `frontend/app/api/admin/pipeline/route.ts` | None | S | No (replace 501) |
| P2-21 | Admin agents | GET agent monitoring: task queue depth, active tasks, failed tasks, agent memory counts per archetype. | `frontend/app/api/admin/agents/route.ts` | None | M | No (replace 501) |
| P2-22 | Admin purchases | GET all purchases across tenants with tenant name, product_type, amount, status. Support date range filter. | `frontend/app/api/admin/purchases/route.ts` | None | S | No (replace 501) |
| P2-23 | Admin tenants CRUD | GET: list all tenants with stats (user count, proposal count, subscription status). POST: create tenant manually (bypass application flow). PATCH would go on `[tenantId]/route.ts`. | `frontend/app/api/admin/tenants/route.ts` | None | M | No (replace 501) |
| P2-24 | Admin waitlist | GET waitlist entries with status, created_at, email. Support filtering by status. | `frontend/app/api/admin/waitlist/route.ts` | None | S | No (replace 501) |

### 2.6 Scoring Engine Wiring

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-25 | Implement scoring engine | Flesh out `ScoringEngine.score_all_tenants` — for each tenant with active subscription, compute match score against opportunity (NAICS overlap, tech focus overlap, past performance similarity, close date proximity). Write scored rows to `tenant_pipeline_items`. | `pipeline/src/scoring/engine.py` | None | L | No (edit existing) |
| P2-26 | Trigger scoring on solicitation push | The `OnSolicitationPushed` workflow calls `pipeline.scoring.match_tenants`. Wire the action target (P1-04) to invoke `ScoringEngine` methods. | `pipeline/src/workflows/actions/score_tenants.py` | P1-04, P2-25 | S | Yes (in P1-04) |

### 2.7 Event System Enhancements

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-27 | SSE events endpoint | Implement `/api/events` — Server-Sent Events stream for real-time dashboard updates. Client connects, receives new system_events as they occur. Use pg_notify or polling server-side. | `frontend/app/api/events/route.ts` | None | M | No (replace 501) |
| P2-28 | Webhook automation action | Implement `webhook` action type in CMS event_listener. POST event payload to configured URL with HMAC signature. | `services/cms/src/event_listener.py` | None | S | No (edit existing) |
| P2-29 | Update_status automation action | Implement `update_status` action type. Update target entity status based on rule config (e.g., auto-advance proposal stage). | `services/cms/src/event_listener.py` | None | S | No (edit existing) |

### 2.8 Proposal Template

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P2-30 | SBIR Phase II template | Create `dod-sbir-phase2-technical` template matching Phase II requirements (more detailed sections, commercialization plan, Phase I results). Add to TEMPLATE_MAP. | `frontend/lib/templates/dod-sbir-phase2-technical.ts`, `frontend/lib/templates/index.ts` | None | M | Yes |

---

## Phase 3: Canvas & Collaboration (Week 3)

### 3.1 Canvas Export Enhancements

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P3-01 | DOCX inline format export | Export `inline_formats` (bold, italic, underline, strikethrough, code, link spans) from canvas JSON to DOCX TextRuns. Currently only node-level formatting exports. | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-02 | DOCX image embedding | Replace `[Image: alt]` placeholder with actual `ImageRun` in DOCX export. Fetch image bytes from S3 using presigned URL during export. | `frontend/lib/export/docx-exporter.ts` | None | M | No (edit existing) |
| P3-03 | PPTX image embedding | Same as P3-02 but for PPTX using PptxGenJS image support. | `frontend/lib/export/pptx-exporter.ts` | None | M | No (edit existing) |
| P3-04 | DOCX auto-generated TOC | Replace TOC placeholder with actual `TableOfContents` field code. Scan doc.nodes for headings, generate TOC entries. | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-05 | DOCX footnotes | Replace inline footnote approach with proper `FootnoteReferenceRun` for page-bottom footnotes. | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-06 | DOCX hyperlinks | Use `ExternalHyperlink` wrapper for URLs instead of just blue text. | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-07 | DOCX node-level weight/style | Export `node.style.weight` → bold and `node.style.style` → italics in TextRun properties. | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-08 | DOCX watermark | Add "DRAFT" watermark for proposals in review stages (not final/submitted). | `frontend/lib/export/docx-exporter.ts` | None | S | No (edit existing) |
| P3-09 | XLSX number formatting | Apply `TableCell.number_format` and `cell_type` in xlsx export for currency, percentage, decimal formatting. | `frontend/lib/export/xlsx-exporter.ts` | None | S | No (edit existing) |

### 3.2 Collaboration

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P3-10 | Team invitation end-to-end | Wire invite flow: POST `/api/invite` → create invitation row → send invite email via CMS → accept link → create user → grant tenant access. Test the full path. | `frontend/app/api/invite/route.ts`, `services/cms/src/templates.py` | P1-14 | M | No (edit existing) |
| P3-11 | Stage-scoped access enforcement | Verify and fix: partners with `collaborator_stage_access` entries only see sections/data for their granted stages. Enforce in all portal proposal routes. | Portal proposal routes | None | M | No (audit + fix) |
| P3-12 | Auto-revoke on stage advance | When a proposal advances past a stage, revoke all `collaborator_stage_access` entries for that stage. Implement in the stage advancement route. | `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/advance/route.ts` | P3-11 | S | No (edit existing) |

### 3.3 Canvas Editor UX (P0)

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P3-13 | Unsaved changes warning | Add `beforeunload` event handler when document has unsaved changes. Prevent accidental data loss on navigation. | `frontend/` canvas-editor.tsx, sheet-editor.tsx | None | S | No (edit existing) |
| P3-14 | Undo/Redo | Implement history stack (snapshot doc state on each `updateDoc` call, limit ~50). Wire Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts. | `frontend/` canvas-editor.tsx, sheet-editor.tsx | None | M | No (edit existing) |

---

## Phase 4: Integration & QA (Week 4)

### 4.1 End-to-End Testing

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P4-01 | Admin E2E test | Execute full admin workflow per TESTING_ADMIN_E2E.md: login → upload RFP → shred → curate → push → verify events. Fix any failures. | All admin routes | Phase 1-3 | L | No |
| P4-02 | Customer E2E test | Execute full customer workflow per TESTING_CUSTOMER_E2E.md: apply → accept → login → browse spotlight → purchase → create proposal → draft → review → export. | All portal routes | Phase 1-3 | L | No |
| P4-03 | Scoring validation | Verify scoring produces sane results: push a solicitation, confirm tenant_pipeline_items populated, check score values are within expected ranges, verify spotlight shows scored items. | Scoring engine + portal routes | P2-25, P2-26 | M | No |

### 4.2 Infrastructure

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P4-04 | Health check enhancement | Upgrade `/api/health` to check real DB connectivity (SELECT 1) and S3 reachability (HEAD on bucket). Return structured status. | `frontend/app/api/health/route.ts` | None | S | No (edit existing) |
| P4-05 | Rate limiting middleware | Enforce rate limits on public endpoints (`/api/applications`, `/api/waitlist`, `/api/auth`). Use `rate_limit_state` table or in-memory sliding window. | `frontend/middleware.ts` or new rate-limit module | None | M | No |
| P4-06 | Stripe live mode | Switch from test keys to live keys. Verify webhook signature works with live secret. Test a real charge flow. | Railway env vars, manual testing | None | S | No (config) |
| P4-07 | Pipeline health check | Add simple HTTP health endpoint to pipeline service so Railway can monitor it. | `pipeline/src/health.py` | None | S | No (edit existing) |

### 4.3 Bug Fixes from Audit

| ID | Title | Description | Files Affected | Dependencies | Effort | Stub Created |
|----|-------|-------------|----------------|--------------|--------|--------------|
| P4-08 | pg_notify consumption | Replace 10-second polling with LISTEN/NOTIFY for near-instant event reactions in both pipeline processor and CMS listener. The trigger already exists on `system_events`. | `pipeline/src/workflows/processor.py`, `services/cms/src/event_listener.py` | None | M | No (edit existing) |
| P4-09 | Auto-save for canvas editors | Save automatically after N seconds of inactivity (debounced). Show "Auto-saved" indicator. | `frontend/` canvas-editor.tsx, sheet-editor.tsx | None | S | No (edit existing) |
| P4-10 | Image presigned URL refresh | URLs expire after 1 hour. Add re-fetch on 403 or on a timer for long editing sessions. | `frontend/` canvas-renderer.tsx | None | S | No (edit existing) |

---

## Task Detail

### P1-01: Create actions package
- **ID:** P1-01
- **Title:** Create pipeline workflow actions package
- **Description:** Create `pipeline/src/workflows/actions/` package with `__init__.py` that re-exports all action functions. This makes `pipeline.shredder.shred`, `pipeline.scoring.match_tenants`, `pipeline.library.create_default_categories`, `pipeline.export.generate_preview`, and `finder.create_drafts_from_scout` all importable by the workflow processor's `_execute_action` dynamic import logic.
- **Files affected:** `pipeline/src/workflows/actions/__init__.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** `pipeline/src/workflows/actions/__init__.py`

### P1-02: Implement shred action wrapper
- **ID:** P1-02
- **Title:** Shredder action wrapper for workflow processor
- **Description:** The `OnRfpUploaded` workflow calls `pipeline.shredder.shred` as its first ACTION step. Create a thin async function `shred(conn, solicitation_id, document_ids)` that instantiates the Anthropic client from env and delegates to `shredder.runner.shred_solicitation`. Also create `extract_compliance(conn, solicitation_id)` for step 2.
- **Files affected:** `pipeline/src/workflows/actions/shred.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** `pipeline/src/workflows/actions/shred.py`

### P1-03: Implement extract_compliance action
- **ID:** P1-03
- **Title:** Compliance extraction action for workflow processor
- **Description:** The shredder runner already does compliance extraction inline during `shred_solicitation`. This action is for cases where compliance extraction needs to re-run independently (e.g., after admin edits to solicitation text). Delegates to the compliance_mapping module.
- **Files affected:** `pipeline/src/workflows/actions/shred.py` (same file as P1-02)
- **Dependencies:** P1-02
- **Effort:** S
- **Stub created:** Same file as P1-02

### P1-04: Implement score_tenants action
- **ID:** P1-04
- **Title:** Tenant-opportunity matching action
- **Description:** Called by `OnSolicitationPushed` workflow. Queries all tenants with active finder subscriptions, runs scoring engine against the pushed solicitation (NAICS overlap, tech focus match, agency preference), writes `tenant_pipeline_items` rows with scores, and returns `{tenantIds: [...matchingTenantIds]}` for the downstream NOTIFY step.
- **Files affected:** `pipeline/src/workflows/actions/score_tenants.py`
- **Dependencies:** P2-25 (scoring engine implementation)
- **Effort:** M
- **Stub created:** `pipeline/src/workflows/actions/score_tenants.py`

### P1-05: Implement create_default_categories
- **ID:** P1-05
- **Title:** Default library categories for new tenants
- **Description:** Called by `OnApplicationAccepted` workflow. Inserts standard library categories for a new tenant: Technical Approach, Past Performance, Key Personnel, Management Plan, Cost/Pricing, Company Overview, Certifications, Resumes.
- **Files affected:** `pipeline/src/workflows/actions/create_library_defaults.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** `pipeline/src/workflows/actions/create_library_defaults.py`

### P1-06: Implement generate_preview
- **ID:** P1-06
- **Title:** Proposal preview generation for final stage
- **Description:** Called by `OnProposalAdvancedToFinal` workflow. Fetches all proposal sections with their canvas JSON, exports each to DOCX buffer, combines into a single preview document or ZIP, stores to S3 under `customers/{tenantId}/proposals/{proposalId}/preview/`. Updates proposal metadata with preview URL.
- **Files affected:** `pipeline/src/workflows/actions/generate_preview.py`
- **Dependencies:** P2-15 (package export route, for shared export logic)
- **Effort:** M
- **Stub created:** `pipeline/src/workflows/actions/generate_preview.py`

### P1-07: Implement create_drafts_from_scout
- **ID:** P1-07
- **Title:** Draft solicitations from Source Scout detections
- **Description:** Called by `OnSourceChangeDetected` workflow. Takes region_results from Scout payload, creates draft `curated_solicitations` rows with status='draft', links to matching opportunities or creates new ones. Returns `{draftsCreated: N}` for the NOTIFY step.
- **Files affected:** `pipeline/src/workflows/actions/create_drafts_from_scout.py`
- **Dependencies:** None
- **Effort:** M
- **Stub created:** `pipeline/src/workflows/actions/create_drafts_from_scout.py`

### P1-08: Wire shredder worker to Claude
- **ID:** P1-08
- **Title:** Shredder worker Anthropic client instantiation
- **Description:** Verify `workers/rfp_shredder.py` correctly creates `anthropic.AsyncAnthropic()` from `ANTHROPIC_API_KEY` env var and passes it to `shred_solicitation`. The runner already accepts `anthropic_client` parameter.
- **Files affected:** `pipeline/src/workers/rfp_shredder.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** No (edit existing file)

### P1-09: Topic auto-extraction via Claude
- **ID:** P1-09
- **Title:** Claude-based topic extraction
- **Description:** Replace regex-only topic extraction with Claude call for structured extraction from BAA full text. Create prompt template and parse response into topics array.
- **Files affected:** `pipeline/src/shredder/runner.py`, new prompt file under `pipeline/src/shredder/prompts/v1/`
- **Dependencies:** P1-08
- **Effort:** M
- **Stub created:** No (edit existing + new prompt file)

### P1-10: CMS event bridge table fix
- **ID:** P1-10
- **Title:** Fix CMS writing to wrong events table
- **Description:** CMS event_listener writes to `content_events` (deprecated) instead of `system_events`. Change the INSERT target table so pipeline workflows can react to CMS-originated events.
- **Files affected:** `services/cms/src/models/events.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** No (edit existing file)

### P1-11: Automation log audit trail
- **ID:** P1-11
- **Title:** Write automation_log on every rule execution
- **Description:** Add INSERT to `automation_log` in `_execute_rule()` recording: rule_id, triggered_event_id, action_type, action_config, status (success/failure), error message, execution_ms.
- **Files affected:** `services/cms/src/event_listener.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** No (edit existing file)

### P1-12: Duplicate email dedup
- **ID:** P1-12
- **Title:** Email deduplication in CMS
- **Description:** Hash(template + recipient + trigger_event_id) as dedup_key. Before sending, check if dedup_key exists in `automation_log` within last 60 minutes. Skip if found.
- **Files affected:** `services/cms/src/event_listener.py`
- **Dependencies:** P1-11
- **Effort:** S
- **Stub created:** No (edit existing file)

### P1-13: Durable high-water mark
- **ID:** P1-13
- **Title:** Persist event processing cursor to DB
- **Description:** Create/use a `system_state` table with key-value pairs. Store `workflow_processor_last_event_at` and `cms_listener_last_event_at`. Read on startup, write after each batch.
- **Files affected:** `pipeline/src/workflows/processor.py`, `services/cms/src/event_listener.py`
- **Dependencies:** None
- **Effort:** S
- **Stub created:** No (edit existing files)

### P1-14: End-to-end email delivery test
- **ID:** P1-14
- **Title:** Verify email delivery chain
- **Description:** Test: emit a `capture:application.accepted:end` event manually → verify workflow triggers → verify `system:notification.requested` event created → verify CMS picks it up → verify template rendered → verify Gmail API called → verify email arrives.
- **Files affected:** Multiple (integration test)
- **Dependencies:** P1-10, P1-11
- **Effort:** M
- **Stub created:** No (manual test)

### P2-01 through P2-30
See Phase 2 tables above for complete descriptions. All portal/admin route implementations follow the canonical pattern from `CLAUDE_CLIFFNOTES.md`.

### P3-01 through P3-14
See Phase 3 tables above. Canvas export work is concentrated in the `frontend/lib/export/` directory. Collaboration work touches invite and proposal access routes.

### P4-01 through P4-10
See Phase 4 tables above. Testing follows `TESTING_ADMIN_E2E.md` and `TESTING_CUSTOMER_E2E.md` scripts.

---

## Dependency Graph (Critical Path)

```
P1-01 (actions pkg) ──┬──→ P1-02 (shred) ──→ P1-03 (compliance)
                       ├──→ P1-04 (score_tenants) ──→ P2-25 (scoring engine) ──→ P2-26
                       ├──→ P1-05 (library defaults)
                       ├──→ P1-06 (generate_preview) ──→ P2-15 (package export)
                       └──→ P1-07 (scout drafts)

P1-10 (CMS table fix) ──→ P1-11 (audit log) ──→ P1-12 (dedup) ──→ P1-14 (email e2e)

P2-25 (scoring engine) ──→ P2-02 (portal opportunities) ──→ P2-03 (actions)
P2-06 (spotlights) ──→ P2-07 (spotlight detail)

P3-11 (stage access) ──→ P3-12 (auto-revoke)

Phase 1-3 all ──→ P4-01 (admin E2E) + P4-02 (customer E2E)
```

---

## Stub Files Created

| # | File | Purpose |
|---|------|---------|
| 1 | `pipeline/src/workflows/actions/__init__.py` | Package init, exports all action functions |
| 2 | `pipeline/src/workflows/actions/shred.py` | Shredder wrapper + extract_compliance |
| 3 | `pipeline/src/workflows/actions/score_tenants.py` | Tenant-opportunity matching/scoring |
| 4 | `pipeline/src/workflows/actions/create_library_defaults.py` | Default library categories for new tenants |
| 5 | `pipeline/src/workflows/actions/generate_preview.py` | Proposal preview document generation |
| 6 | `pipeline/src/workflows/actions/create_drafts_from_scout.py` | Draft solicitations from Scout detections |
| 7 | `frontend/lib/templates/dod-sbir-phase2-technical.ts` | SBIR Phase II proposal template |

Portal API stubs (501 → skeleton with auth/tenant/validation/TODO):
| # | File | Purpose |
|---|------|---------|
| 8 | `portal/[tenantSlug]/dashboard/route.ts` | Tenant dashboard stats |
| 9 | `portal/[tenantSlug]/opportunities/route.ts` | Scored opportunity list |
| 10 | `portal/[tenantSlug]/opportunities/[id]/actions/route.ts` | Pin/thumb/pursue actions |
| 11 | `portal/[tenantSlug]/opportunities/[id]/documents/route.ts` | RFP document download |
| 12 | `portal/[tenantSlug]/proposals/route.ts` | Tenant proposal list |
| 13 | `portal/[tenantSlug]/spotlights/route.ts` | Spotlight CRUD |
| 14 | `portal/[tenantSlug]/spotlights/[id]/route.ts` | Spotlight detail |
| 15 | `portal/[tenantSlug]/purchases/route.ts` | Purchase history |
| 16 | `portal/[tenantSlug]/uploads/route.ts` | File upload handling |
| 17 | `portal/[tenantSlug]/notifications/route.ts` | Notification feed |
| 18 | `portal/[tenantSlug]/proposals/[id]/ai/draft/route.ts` | AI section drafting |
| 19 | `portal/[tenantSlug]/proposals/[id]/ai/review/route.ts` | AI quality review |
| 20 | `portal/[tenantSlug]/proposals/[id]/ai/compliance/route.ts` | AI compliance check |
| 21 | `portal/[tenantSlug]/proposals/[id]/reviews/route.ts` | Color team reviews |
| 22 | `portal/[tenantSlug]/proposals/[id]/package/route.ts` | Full proposal export |
| 23 | `portal/[tenantSlug]/agents/memories/route.ts` | Agent memory viewer |
| 24 | `portal/[tenantSlug]/agents/performance/route.ts` | Agent metrics |
| 25 | `portal/[tenantSlug]/agents/config/route.ts` | Agent configuration |

Admin API stubs (501 → skeleton with auth/TODO):
| # | File | Purpose |
|---|------|---------|
| 26 | `admin/dashboard/route.ts` | Admin stats aggregation |
| 27 | `admin/pipeline/route.ts` | Pipeline job monitoring |
| 28 | `admin/agents/route.ts` | Agent monitoring |
| 29 | `admin/purchases/route.ts` | Purchase management |
| 30 | `admin/tenants/route.ts` | Tenant CRUD |
| 31 | `admin/waitlist/route.ts` | Waitlist management |
| 32 | `api/events/route.ts` | SSE event stream |

---

## Notes

- **V2 deferred items:** Agent fabric (archetypes, learning, lifecycle), real-time
  collaborative editing, Tiptap rich text, FOMO signals, Sentry integration, pg_notify
  agent subscribers, tool dispatcher full implementation.
- **Not V1:** Table rowSpan/colSpan editor, nested list children, copy/paste nodes,
  optimistic locking, cell formulas in spreadsheet editor.
- The workflow processor IS already wired to main.py (confirmed in code). The gap is
  solely the missing ACTION target functions.
- All 7 workflow classes exist and validate. They will execute once the action targets
  are importable.
