# API Reference

Complete listing of all API routes in the govwin platform: Frontend (Next.js) and CMS (FastAPI).

_Generated: 2026-07-15._ For the OPP → purchase → curation → proposal (V0→V1) flow that most of
the new portal/admin surface implements, see **docs/MASTER_MIRROR_OPP_DESIGN.md**.

---

## Frontend API Routes

All routes live under `frontend/app/api/`. Standard response shape: `{ data: T }` on success,
`{ error: string, code: string, details?: unknown }` on failure — **every** failure response carries
both `error` and `code`. Exception: `/api/health` returns its own `{ ok, checks }` shape.

**Auth column:** `public` = no guard · `auth` = any authenticated NextAuth session · `tenant` =
`verifyTenantAccess` (actor's tenant must match `[tenantSlug]`; `master_admin`/`rfp_admin` bypass) ·
`rfp_admin+` = `master_admin` or `rfp_admin`. A `(…)` note marks a stricter requirement
(`(master)` = master_admin only; `(admin)` = tenant_admin within the tenant). Middleware gates every
`/api/admin/*` path to `rfp_admin` minimum, so admin routes are `rfp_admin+` even when the handler
body only reads the session.

> **Card-spine note (2026-07-15):** the canonical customer surface is the opportunity-card spine —
> `/cards` + `/buckets` + `/atoms` + `/library`, drafted into a workspace via `/purchase` →
> `/portals`. The legacy **Spotlight/Pipeline** and per-opportunity APIs (`/spotlights`,
> `/spotlight/pin`, `/opportunities`) are **retired and deleted** (the `/spotlights` and `/pipeline`
> pages redirect to `/cards`; `tenant_pipeline_items` is gone). See CLAUDE.md / ARCHITECTURE_V10.md.

---

### Admin Routes

All admin routes require `master_admin` or `rfp_admin` (enforced by `/api/admin/*` middleware) unless a
stricter `(master)` note appears.

#### Dashboard & Monitoring

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/dashboard` | rfp_admin+ | Dashboard stats: tenant counts, subscriptions, proposals by stage, revenue, recent events, pipeline jobs | 200, 401, 403, 500 |
| GET | `/api/admin/analytics` | rfp_admin+ | Aggregate visitor traffic analytics from `page_views`/`visitor_sessions` | 200, 401, 403, 500 |
| GET | `/api/admin/pipeline` | rfp_admin+ | Pipeline job monitoring: counts by status, recent `pipeline_jobs` with duration, `pipeline_schedules` status | 200, 401, 403, 500 |
| GET | `/api/admin/system` | rfp_admin+ (master) | System snapshot: queue depth, event/error rates, 24h tool stats, recent errors, registered tools | 200, 401, 403, 500 |
| GET | `/api/admin/purchases` | rfp_admin+ | Cross-tenant purchase list (tenant, product_type, amount, status). Query: `?start=&end=&limit=` | 200, 401, 403, 500 |

#### Agents, AI Budget & Guardrails

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/agents` | rfp_admin+ | Agent monitoring: task-queue depth by status, tasks by role, recent failures, recent tool events | 200, 401, 403, 500 |
| GET | `/api/admin/agents/usage` | rfp_admin+ | Agent usage dashboard: summary, per-archetype + per-tenant breakdown, daily trend, pricing. Query: `?period=7d\|30d\|90d` | 200, 401, 403, 422, 500 |
| GET | `/api/admin/agents/platform-config` | rfp_admin+ (master) | Read the singleton `platform_agent_config` (default budget/rate-limit, platform cap, master switch) | 200, 401, 403, 500 |
| PATCH | `/api/admin/agents/platform-config` | rfp_admin+ (master) | Update platform AI defaults / cap / master switch | 200, 400, 401, 403, 422, 500 |
| GET | `/api/admin/guardrail-defaults` | rfp_admin+ | Global default portal guardrail template + hard limits (`guardrail_templates`, tenant NULL) | 200, 401, 403, 404, 500 |
| PATCH | `/api/admin/guardrail-defaults` | rfp_admin+ | Update default guardrails/limits. Body: `{ limits?, defaults? }` | 200, 400, 401, 403, 404, 500 |
| GET | `/api/admin/tenants/[tenantId]/agent-config` | rfp_admin+ | Per-tenant AI limits (`tenant_agent_config`; NULL = inherit platform default) | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/tenants/[tenantId]/agent-config` | rfp_admin+ | Set per-tenant monthly budget + rate limit (budget 0 disables AI) | 200, 400, 401, 403, 404, 422, 500 |

#### Tenant Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/tenants` | rfp_admin+ | **501 stub** — list all tenants with stats (V1_TODO P2-23) | 401, 403, 501 |
| POST | `/api/admin/tenants` | rfp_admin+ | **501 stub** — create tenant manually, bypass application flow (V1_TODO P2-23) | 401, 403, 501 |
| GET | `/api/admin/tenants/[tenantId]` | rfp_admin+ | Single tenant detail | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/tenants/[tenantId]` | rfp_admin+ | Update tenant fields | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/tenants/[tenantId]/backfill-cards` | rfp_admin+ | Replay the whole opportunity bridge into a tenant's pipeline (new-customer backfill; idempotent) | 200, 400, 401, 403, 500 |

#### Application Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/applications/[id]/accept` | rfp_admin+ | Accept application: create tenant + user, send welcome email | 200, 400, 401, 403, 404, 409, 500 |
| POST | `/api/admin/applications/[id]/reject` | rfp_admin+ | Reject application: send rejection email | 200, 400, 401, 403, 404, 409, 422, 500 |
| POST | `/api/admin/applications/[id]/status` | rfp_admin+ (master) | Toggle application status (testing) | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/admin/waitlist` | rfp_admin+ | Waitlist entries with status/email/created_at. Query: `?search=&limit=` | 200, 401, 403, 500 |

#### RFP Intake & Curation

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/intake` | rfp_admin+ | Stage a found/uploaded opportunity notice into the review queue (staged opportunity + `curated_solicitation` status `new`) | 200, 400, 401, 403, 500 |
| GET | `/api/admin/rfp-curation` | rfp_admin+ | List curated solicitations (triage queue). Query: `?status=new,claimed,...` | 200, 401, 403, 500 |
| GET | `/api/admin/rfp-curation/[solId]` | rfp_admin+ | Full solicitation detail: opportunity, topics, documents, volumes, compliance | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/rfp-curation/[solId]` | rfp_admin+ | Update solicitation curation fields | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/rfp-curation/[solId]/claim` | rfp_admin+ | Claim solicitation for curation (atomic transition) | 200, 400, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/start-curation` | rfp_admin+ | Transition `claimed` → `curation_in_progress` (compare-and-swap) | 200, 400, 401, 403, 404, 409, 500 |
| POST | `/api/admin/rfp-curation/[solId]/triage` | rfp_admin+ | Triage action (claim, dismiss, release). Body: `{ action, notes? }` | 200, 400, 401, 403, 404, 409, 422, 500 |
| POST | `/api/admin/rfp-curation/[solId]/push` | rfp_admin+ | Push approved solicitation live via the `solicitation.push` tool. **Gated on both `submission_format` and `spotlight_summary`** plus required compliance vars; fans onto the bridge | 200, 400, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/force-release` | rfp_admin+ (master) | Reset a stale claimed solicitation back to `new`, clear claim, log to `triage_actions` | 200, 400, 401, 403, 404, 409, 500 |
| GET | `/api/admin/rfp-curation/[solId]/revisions` | rfp_admin+ | Curation revision history. Query: `?type=&limit=` | 200, 400, 401, 403, 404, 500 |
| GET | `/api/admin/rfp-curation/[solId]/annotations` | rfp_admin+ | List annotations (highlights, boxes, tags) | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/rfp-curation/[solId]/annotations` | rfp_admin+ | Create annotation | 200, 400, 401, 403, 404, 422, 500 |
| PATCH | `/api/admin/rfp-curation/[solId]/annotations/[annotationId]` | rfp_admin+ | Update annotation classification (section type, side tags, accept) in `payload` | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/compliance` | rfp_admin+ | Get solicitation compliance variables | 200, 400, 401, 403, 422, 500 |
| POST | `/api/admin/rfp-curation/[solId]/compliance` | rfp_admin+ | Save compliance variable value | 200, 400, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/outline` | rfp_admin+ | Get solicitation outline JSON | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/rfp-curation/[solId]/outline` | rfp_admin+ | Save/update outline | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/templates` | rfp_admin+ | List template documents (`solicitation_documents` where `document_type='template'`) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/rfp-curation/[solId]/apply-preset` | rfp_admin+ | Apply compliance preset to topics. Body: `{ topicIds, presetId }` or `{ topicIds, compliance, volumes }` | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/rfp-curation/[solId]/apply-to-all-topics` | rfp_admin+ | Mass-copy the solicitation baseline compliance/volumes/items (incl. template links) onto every topic | 200, 400, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Resolved topic compliance (topic → solicitation → defaults) | 200, 400, 401, 403, 404, 500 |
| PUT | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Save topic-level compliance overrides | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Remove topic overrides (revert to baseline) | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/topics/[id]` | rfp_admin+ | Update topic fields | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/admin/compliance-presets` | rfp_admin+ | List compliance presets (system + custom) | 200, 400, 401, 403, 422, 500 |
| POST | `/api/admin/compliance-presets` | rfp_admin+ | Create custom preset from a topic's compliance | 201, 400, 401, 403, 422, 500 |
| GET | `/api/admin/compliance-suggest` | rfp_admin+ | Suggest compliance values from curation memory (`episodic_memories`). Query: `?namespace=&variableName=` | 200, 400, 401, 403, 500 |

#### RFP Documents & Topic Extraction

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/rfp-upload` | rfp_admin+ | Upload RFP files (multipart): create opportunity + solicitation + documents, enqueue shred job | 201, 400, 401, 403, 404, 409, 413, 422, 500 |
| POST | `/api/admin/rfp-document/[id]/set-primary` | rfp_admin+ | Mark document primary for its solicitation | 200, 400, 401, 403, 404, 500 |
| GET | `/api/admin/rfp-document/[id]/signed-url` | rfp_admin+ | 15-minute signed S3 URL for a document | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/extract-topics` | rfp_admin+ | Extract topics from a solicitation document. Body: `{ solicitationId }` | 200, 400, 401, 403, 500 |
| POST | `/api/admin/upload-topic-files` | rfp_admin+ | Upload topic-specific files | 201, 400, 401, 403, 404, 422, 500 |

#### Opportunities & Lifecycle

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/opportunities/[oppId]/lifecycle` | rfp_admin+ | Lifecycle action on an opportunity (set_stage, close_date_change, ...); logs to `opportunity_lifecycle_actions` | 200, 400, 401, 403, 404, 409, 500 |
| POST | `/api/admin/opportunities/[oppId]/publish` | rfp_admin+ | Publish an opportunity card version onto the bridge + fan out to subscribed tenants. Body: `{ eventType?: 'published'\|'updated'\|'closed'\|'reopened' }` | 200, 400, 401, 403, 404, 500 |

#### Source Profiles (Source Scout)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/sources` | rfp_admin+ | List active source profiles with visit counts | 200, 400, 401, 403, 422, 500 |
| POST | `/api/admin/sources` | rfp_admin+ | Create source profile | 201, 400, 401, 403, 422, 500 |
| PATCH | `/api/admin/sources/[profileId]` | rfp_admin+ | Update source profile settings | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/admin/sources/[profileId]/diffs` | rfp_admin+ | List `source_diffs` (recent), with region name | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/admin/sources/[profileId]/diffs` | rfp_admin+ | Mark a source diff reviewed | 200, 400, 401, 403, 404, 500 |
| GET | `/api/admin/sources/[profileId]/regions` | rfp_admin+ | List regions for a source profile | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/sources/[profileId]/regions` | rfp_admin+ | Create region annotation | 201, 400, 401, 403, 404, 422, 500 |
| DELETE | `/api/admin/sources/[profileId]/regions/[regionId]` | rfp_admin+ | Soft-delete a region (`is_active=false`) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/sources/[profileId]/scout` | rfp_admin+ | Trigger manual scout run (enqueue pipeline job) | 201, 400, 401, 403, 404, 500 |
| POST | `/api/admin/sources/[profileId]/expand-topics` | rfp_admin+ | Enqueue DSIP topic-URL expansion (`pipeline_jobs` kind `expand_topics`) | 201, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/sources/[profileId]/visit` | rfp_admin+ | Log a source visit/action | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/admin/sources/[profileId]/paste-import` | rfp_admin+ | Parse pasted content, create topic records | 200, 400, 401, 403, 404, 413, 422, 500 |

#### SBIR Data

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/sbir-data/ingest` | rfp_admin+ | Ingest SBIR company/award CSV (up to ~5 min) | 200, 400, 401, 403, 404, 409, 500 |
| GET | `/api/admin/sbir-data/ingest` | rfp_admin+ | Recent SBIR ingest uploads / status (`sbir_data_uploads`) | 200, 400, 401, 403, 404, 500 |
| GET | `/api/admin/sbir-data/lookup` | rfp_admin+ | Search SBIR companies/awards. Query: `?company=&uei=&domain=` | 200, 400, 401, 403, 500 |

#### Documents (Admin Document Builder)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/documents` | rfp_admin+ | List documents from S3 index | 200, 400, 401, 403, 500 |
| POST | `/api/admin/documents` | rfp_admin+ | Create document from preset | 201, 400, 401, 403, 500 |
| GET | `/api/admin/documents/[documentId]` | rfp_admin+ | Load full document JSON | 200, 400, 401, 403, 404, 500 |
| PUT | `/api/admin/documents/[documentId]` | rfp_admin+ | Save/update document | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/admin/documents/[documentId]` | rfp_admin+ | Delete document | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/documents/[documentId]/export` | rfp_admin+ | Export document to DOCX/PPTX/XLSX | 200, 400, 401, 403, 500 |
| POST | `/api/admin/documents/upload-image` | rfp_admin+ | Upload image for document builder | 200, 401, 403, 413, 422, 500 |

#### Templates (Template Studio)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/templates` | rfp_admin+ | List `document_templates` (no bodies). Query: `?templateType=&programType=&agency=` | 200, 400, 403, 404, 500 |
| POST | `/api/admin/templates` | rfp_admin+ | Create a template, or "save as new" from `sourceTemplateId` | 201, 400, 403, 404, 500 |
| GET | `/api/admin/templates/[templateId]` | rfp_admin+ | Full template incl. `canvas_preset` + `canvas_document` | 200, 400, 403, 404, 500 |
| PATCH | `/api/admin/templates/[templateId]` | rfp_admin+ | Edit a non-system template (system templates are read-only) | 200, 400, 403, 404, 500 |

#### Section Standards

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/section-standards` | rfp_admin+ | List the section-standards taxonomy (standard section/sub-section headers) | 200, 400, 401, 403, 500 |
| POST | `/api/admin/section-standards` | rfp_admin+ | Add a standard | 201, 400, 401, 403, 409, 422, 500 |
| DELETE | `/api/admin/section-standards/[id]` | rfp_admin+ | Deactivate a standard (soft delete; keeps existing `section_type` tags) | 200, 400, 401, 403, 404, 500 |

#### Proposal Admin

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| PUT | `/api/admin/proposals/[proposalId]/sections/[sectionId]` | rfp_admin+ | Save canvas document JSON, create version | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/proposals/[proposalId]/sections/[sectionId]/export` | rfp_admin+ | Export section to DOCX | 200, 400, 401, 403, 422, 500 |

#### Workflows, Processes & Tasks

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/workflows` | rfp_admin+ | List workflow instances (active + recent). Query: `?status=&hours=&limit=` | 200, 400, 401, 403, 500 |
| POST | `/api/admin/workflows` | rfp_admin+ | Launch a workflow template by raw overlay | 200, 400, 401, 403, 500 |
| GET | `/api/admin/workflows/[instanceId]` | rfp_admin+ | Instance detail with transitions | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/workflows/[instanceId]/advance` | rfp_admin+ | Force-advance a paused (HITL-waiting) process. Body: `{ note? }` | 200, 400, 401, 403, 500 |
| POST | `/api/admin/workflows/[instanceId]/cancel` | rfp_admin+ | Cancel a running/paused instance | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/workflows/[instanceId]/retry` | rfp_admin+ | Retry a failed instance (new instance recovering from the failed one) | 201, 400, 401, 403, 404, 409, 500 |
| POST | `/api/admin/workflows/launch-collaboration` | rfp_admin+ | Launch a ProjectCollaboration HITL gate by hand (guarded fields + UUID shape) | 200, 400, 401, 403, 500 |
| GET | `/api/admin/processes` | rfp_admin+ | Cross-tenant process ledger: active `process_instances` across all tenants + open-task count | 200, 401, 403, 500 |
| GET | `/api/admin/tasks` | rfp_admin+ | Admin task queue (admin-scoped + all tenants) | 200, 400, 401, 403, 500 |
| POST | `/api/admin/tasks` | rfp_admin+ | Complete a task. Body: `{ taskId, result? }` | 200, 400, 401, 403, 500 |

#### Automation Rules

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/automation` | rfp_admin+ | List automation rules. Query: `?active=` | 200, 400, 401, 403, 500 |
| POST | `/api/admin/automation` | rfp_admin+ | Create an automation rule | 201, 400, 401, 403, 409, 422, 500 |
| GET | `/api/admin/automation/[ruleId]` | rfp_admin+ | Get one automation rule | 200, 400, 401, 403, 404, 422, 500 |
| PATCH | `/api/admin/automation/[ruleId]` | rfp_admin+ | Toggle active / update config, description, trigger | 200, 400, 401, 403, 404, 422, 500 |

#### Site & Content (Page/Doc Editor)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/site/docs` | rfp_admin+ | List all postings (`blog_post`/`resource`/`guide`/`testimonial`/`team_member`) | 200, 500 |
| GET | `/api/admin/site/docs/[type]/[slug]` | rfp_admin+ | Active + latest draft of a posting | 200, 500 |
| POST | `/api/admin/site/docs/[type]/[slug]/save` | rfp_admin+ | Save a posting draft (emits `content.document_saved`) | 200, 400, 422, 500 |
| POST | `/api/admin/site/docs/[type]/[slug]/publish` | rfp_admin+ | Promote latest draft + revalidate (emits `content.document_published`) | 200, 409, 500 |
| POST | `/api/admin/site/docs/[type]/[slug]/status` | rfp_admin+ | Archive (retire) or restore a posting. Body: `{ action: 'archive'\|'restore' }`; revalidates + emits `content.document_archived`/`content.document_restored` | 200, 400, 409, 500 |
| GET | `/api/admin/site/pages` | rfp_admin+ | List content pages (active version + draft flag) | 200, 500 |
| GET | `/api/admin/site/pages/[pageKey]` | rfp_admin+ | Active + latest draft version of a page | 200, 500 |
| POST | `/api/admin/site/pages/[pageKey]/save` | rfp_admin+ | Save a whole-page draft snapshot (emits `content.page_saved`) | 200, 400, 404, 422, 500 |
| POST | `/api/admin/site/pages/[pageKey]/publish` | rfp_admin+ | Promote latest draft to active + revalidate (emits `content.page_published`) | 200, 404, 409, 500 |
| GET | `/api/admin/site/pages/[pageKey]/versions` | rfp_admin+ | Full page version history, newest first | 200, 500 |
| POST | `/api/admin/site/upload-image` | rfp_admin+ | Upload a CMS image; returns a stable public URL (`/api/uploads/cms/…`) | 200, 400, 413, 422, 500 |

#### Storage

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/storage` | rfp_admin+ | S3 file manager: list objects/sub-prefixes, or presigned download. Query: `?prefix=&download=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/admin/storage` | rfp_admin+ | Upload file (multipart) to a writable prefix | 201, 400, 401, 403, 413, 422, 500 |
| PATCH | `/api/admin/storage` | rfp_admin+ | Rename/move an object | 200, 400, 401, 403, 404, 500 |
| PUT | `/api/admin/storage` | rfp_admin+ | Create/replace an object | 200, 400, 401, 403, 500 |
| DELETE | `/api/admin/storage` | rfp_admin+ | Delete an object | 200, 400, 401, 403, 404, 500 |

---

### Portal Routes

All portal routes are under `/api/portal/[tenantSlug]/`. They require authentication and verify tenant
access (actor's `tenantSlug` must match the URL param; `master_admin`/`rfp_admin` bypass). `(admin)` in
the Auth column marks routes/methods that additionally require `tenant_admin` within the tenant.

#### Dashboard & Notifications

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/dashboard` | tenant | Dashboard: proposal counts, matched opportunity cards, library units, team, recent activity | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/notifications` | tenant | Notification feed derived from `system_events`. Query: `?limit=&offset=` | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/profile` | tenant | Get tenant profile | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/profile` | tenant (admin) | Update tenant profile | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/purchases` | tenant (admin) | Tenant purchase history | 200, 401, 403, 404, 500 |

#### Cards (Opportunity Spine)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/cards` | tenant | Denormalized opportunity cards (`tenant_opportunity_cards`), RLS-scoped from the bridge. Query: `?pinned=&includeClosed=` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/cards/[opportunityId]/pin` | tenant | Pin a card = full copy of the global opp folder into tenant space. `?action=resync` re-copies after an update | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/portal/[tenantSlug]/cards/[opportunityId]/pin` | tenant | Unpin a card (forward-looking) | 200, 400, 401, 403, 404, 500 |

#### Buckets (Spotlight Buckets)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/buckets` | tenant | List the tenant's spotlight buckets (`tenant_spotlight_buckets`) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/buckets` | tenant | Create a bucket. Body: `{ name, description?, criteria? }` | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/buckets/[bucketId]` | tenant | Ranked cards for a bucket (`tenant_bucket_scores`) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/buckets/[bucketId]` | tenant | `?action=rank` — (re)rank the local pipeline now | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/buckets/[bucketId]` | tenant | Edit name/description/criteria (re-ranks) | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/portal/[tenantSlug]/buckets/[bucketId]` | tenant | Deactivate a bucket | 200, 400, 401, 403, 404, 500 |

#### Atoms (Unified Library Atoms)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/atoms` | tenant | List/facet the tenant's atoms. Query: `?dimension=&value=&grain=&status=&q=&limit=&mine=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/atoms` | tenant | Create an atom (primitive \| group \| reference) | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/atoms/[atomId]` | tenant | Atom + tags + members + lineage | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/atoms/[atomId]` | tenant | Confirm/add tags, or set status | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/atoms/select` | tenant | Scored atom selector for a section mold. Query: `?vol=&sectionId=&limit=` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/atoms/upload` | tenant | Upload → deconstruct → register a `reference` atom; returns chunks + suggested tags for the atomizer | 200, 400, 401, 403, 404, 413, 422, 500 |
| GET | `/api/portal/[tenantSlug]/taxonomy` | tenant | Curated tag vocabulary (`taxonomy_terms`). Query: `?dimension=&program=` | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/section-standards` | tenant | Read-only section-standards taxonomy `{key,label}` for classification rails | 200, 401, 403, 404, 500 |

#### Library (Units)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/library` | tenant | List library units (filtered, paginated). Many query facets: `?q=&category=&agency=&program=&namespace=&sectionType=&seminal=&outcome=&limit=&offset=…` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library` | tenant (admin) | Bulk ops: approve, archive, delete, set_category, add_tags | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/library/[unitId]` | tenant | Get one library unit | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/library/[unitId]` | tenant (admin) | Update a library unit | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/portal/[tenantSlug]/library/[unitId]` | tenant (admin) | Delete a library unit (blocked for seminal) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library/[unitId]` | tenant (admin) | Re-atomize a seminal document | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/library/similar` | tenant | Find library units similar to a section/proposal. Query: `?proposalId=&sectionId=&sort=&limit=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library/upload` | tenant | Upload files to the library (multipart) → `library_units` (`status=draft`) | 201, 400, 401, 403, 404, 413, 422, 500 |
| POST | `/api/portal/[tenantSlug]/library/atomize` | tenant | Atomize uploaded draft documents (S3 fetch → format-aware reader → atoms) | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/uploads` | tenant | List uploaded library units | 200, 400, 401, 403, 404, 413, 500 |
| POST | `/api/portal/[tenantSlug]/uploads` | tenant | Upload file to S3 + create `library_units` row | 201, 400, 401, 403, 404, 413, 500 |
| POST | `/api/portal/[tenantSlug]/uploads/image` | tenant | Upload a canvas image (stored under `customers/<slug>/images/`) | 200, 401, 403, 404, 413, 422, 500 |
| GET | `/api/portal/[tenantSlug]/storage` | tenant | Presigned download URL for the tenant's own object (`customers/<slug>/…`). Query: `?download=` | 200, 400, 401, 403, 404, 500 |

#### Purchase & Workspace Portals

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/portal/[tenantSlug]/purchase` | tenant (admin) | **Comp-code purchase.** Body: `{ opportunityId, promoCode, label? }`. A valid `promo_codes` comp code (`rfppipelinetest`) records a completed $0 `purchases` row, opens `proposal_portals` at `curation_pending` (72h SLA), grants the shadow-admin, emits `capture:purchase.completed`. Percent/amount codes + real Stripe are out of scope. See docs/MASTER_MIRROR_OPP_DESIGN.md | 200, 400, 401, 403, 404, 409, 500 |
| GET | `/api/portal/[tenantSlug]/portals` | tenant | List this tenant's portals (all builds) | 200, 400, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/portals` | tenant | Create a portal for a card (`guardrails_pending`) + assume T&C shadow-admin. Body: `{ opportunityId, proposalId?, label? }` | 200, 400, 401, 403, 404, 409, 500 |
| GET | `/api/portal/[tenantSlug]/portals/[portalId]` | tenant | Portal detail + shadow-admin grants | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=accept` | tenant (admin) | Accept guardrail config → launch the workspace (provision build + instantiate ToDos). Body: `{ guardrailConfig, revokeShadow? }` | 200, 400, 401, 403, 409, 422, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=release` | rfp_admin+ | Release from curation (`curation_pending → launched`): provision build unlocked + instantiate ToDos, emit `capture:workspace.released`. Body: `{ guardrailConfig? }` | 200, 400, 401, 403, 409, 422, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=advance-stage` | tenant (admin) | Advance the portal workflow stage. Body: `{ force? }` | 200, 400, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=revoke-shadow` | tenant (admin) | Revoke the shadow-admin grant | 200, 401, 403, 500 |
| PATCH | `/api/portal/[tenantSlug]/portals/[portalId]` | tenant (admin) | Set portal status (`executing`, `closeout`, `archived`, …) | 200, 400, 401, 403, 500 |

#### Proposals

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals` | tenant | List proposals. Query: `?stage=&sort=&limit=&offset=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/create` | tenant (admin) | Create a proposal from opportunity + template (instantiates sections, compliance matrix, molds) | 201, 400, 401, 402, 403, 404, 409, 422, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]` | tenant | Proposal detail with sections, compliance, supporting docs, stage snapshots | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/advance` | tenant (admin) | Advance proposal stage | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/stage` | tenant (admin) | Current stage + stage history | 200, 400, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/proposals/[proposalId]/stage` | tenant (admin) | Set proposal stage | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/lock` | tenant | Lock proposal workspace (harvests content to library; emits `proposal.ready_for_customer`) | 200, 400, 401, 403, 404, 409, 422, 500 |
| DELETE | `/api/portal/[tenantSlug]/proposals/[proposalId]/lock` | tenant | Unlock proposal workspace | 200, 400, 401, 403, 404, 409, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/outcome` | tenant (admin) | Record outcome: awarded, rejected, withdrawn (feeds `library_atom_outcomes`) | 200, 400, 401, 403, 404, 409, 422, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/activity` | tenant | Proposal activity log. Query: `?type=&actor=&limit=&offset=` | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/compliance` | tenant | Proposal compliance matrix data | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/gates` | tenant | Stage-gate requirements. Query: `?stage=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/gates` | tenant | Create a custom stage-gate requirement | 201, 400, 401, 403, 404, 422, 500 |
| PATCH | `/api/portal/[tenantSlug]/proposals/[proposalId]/gates` | tenant | Toggle a stage-gate requirement | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/package` | tenant | Generate full proposal package. `?format=json` (default) or `?format=docx` download; proposal must be locked | 200, 400, 401, 403, 404, 500 |

#### Proposal Sections

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections` | tenant | List proposal sections | 200, 401, 403, 404, 500 |
| PUT | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` | tenant | Save section canvas content + create version | 200, 400, 401, 403, 404, 409, 413, 423, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/lock` | tenant (admin) | Accept + lock a section (`status=approved`, frozen; advances compliance matrix) | 200, 400, 401, 403, 404, 500 |
| DELETE | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/lock` | tenant (admin) | Unlock a section | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions` | tenant | Section canvas version history. Query: `?version=&limit=` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export` | tenant | Export section to DOCX/PPTX/XLSX | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/atomize-node` | tenant | Accept a single canvas node into the tenant library (`harvestNodeToLibrary`) | 200, 400, 401, 403, 404, 422, 500 |

#### Proposal AI

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft` | tenant | Queue AI draft for section(s). Body: `{ sectionId?, instructions? }` (emits `proposal.draft_requested`) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review` | tenant | Queue AI review for section(s). Body: `{ sectionId?, reviewType?: 'quality'\|'compliance'\|'both' }` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance` | tenant | Inline AI compliance check vs solicitation variables (pass/fail + excerpts). Body: `{ sectionId? }` | 200, 400, 401, 403, 404, 422, 500, 502, 503 |

#### Proposal Collaboration & Reviews

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators` | tenant | List proposal collaborators | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators` | tenant (admin) | Invite collaborator (creates `partner_user` + stage access) | 201, 400, 401, 403, 404, 409, 500 |
| DELETE | `/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/[collaboratorId]` | tenant (admin) | Revoke all stage access for a collaborator | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments` | tenant | List proposal comments. Query: `?nodeId=` | 200, 400, 401, 403, 404, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments` | tenant | Create a comment | 201, 400, 401, 403, 404, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments/[commentId]/resolve` | tenant | Resolve a comment | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/reviews` | tenant | List color-team review rounds (pink/red/gold) | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/reviews` | tenant (admin) | Create a review round | 201, 400, 401, 403, 404, 500 |

#### Proposal Supporting Docs & Dropbox

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs` | tenant | List supporting documents | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs` | tenant | Upload a supporting document | 201, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]` | tenant | Get one supporting document | 200, 400, 401, 403, 404, 422, 500 |
| PATCH | `/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]` | tenant | Update supporting-doc status/metadata | 200, 400, 401, 403, 404, 422, 500 |
| DELETE | `/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]` | tenant | Delete a supporting document | 200, 400, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox` | tenant (admin) | List dropbox files | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox` | tenant (admin) | Upload to dropbox | 200, 400, 401, 403, 404, 413, 423, 500 |
| DELETE | `/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox` | tenant (admin) | Delete a dropbox file | 200, 400, 401, 403, 404, 500 |

#### Team, Tasks & Processes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/team` | tenant | List team members | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/team` | tenant (admin) | Invite a team member | 201, 400, 401, 403, 404, 409, 500 |
| GET | `/api/portal/[tenantSlug]/tasks` | tenant | My open task queue for this tenant | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/tasks` | tenant | Complete a task. Body: `{ taskId, result? }` | 200, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/tasks/assign` | tenant | Delegate a task to a role/member with completion criteria | 201, 400, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/processes/[instanceId]/advance` | tenant (admin) | Tenant-side force-advance of a paused (HITL-waiting) process. Body: `{ note? }` | 200, 400, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/automation-preferences` | tenant | The tenant's milestone-automation choices | 200, 400, 401, 403, 404, 422, 500 |
| PATCH | `/api/portal/[tenantSlug]/automation-preferences` | tenant (admin) | Set automation preferences | 200, 400, 401, 403, 404, 422, 500 |

#### Agents (Tenant View)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/agents/memories` | tenant (admin) | View tenant agent memories (episodic + semantic; RLS-scoped). Query: `?agent_role=&limit=` | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/agents/performance` | tenant (admin) | Aggregate agent performance metrics from `agent_task_queue` | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/agents/usage` | tenant (admin) | Tenant agent usage (no pricing): call counts, budget utilization, rate-limit status. Query: `?period=7d\|30d\|90d` | 200, 401, 403, 404, 422, 500 |

---

### Public / Marketing Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/health` | public | Liveness probe. Returns `{ ok, version, environment, uptimeMs, checks: { db, s3 } }` | 200, 503 |
| POST | `/api/applications` | public | Submit the /apply form → `applications` (status `pending`); dedupes by email | 201, 400, 409, 422, 500 |
| POST | `/api/waitlist` | public | Join the waitlist. Body: `{ email, companyName?, metadata? }` | 201, 400, 500 |
| GET | `/api/waitlist` | rfp_admin+ | **501 stub** — check if an email is already on the waitlist (use POST to join) | 501 |
| GET | `/api/content/[slug]` | public | Fetch a published article by slug (`cms_content`) | 200, 400, 404, 500 |
| POST | `/api/analytics/pageview` | public | Record a page view / time-on-page (`page_views`, `visitor_sessions`) | 200, 400, 500 |
| POST | `/api/consent` | auth | Record consent acceptance (`consent_records`); requires an authenticated user | 201, 400, 401, 500 |
| GET | `/api/events` | auth | Recent `system_events` for the authenticated user (last 5 min; role-filtered). Query: `?limit=&minutes=` | 200, 401, 500 |
| POST | `/api/events` | rfp_admin+ | Emit a system event manually (admin only, testing/tooling) | 201, 400, 401, 403, 422, 500 |
| GET | `/api/invite` | public | Fetch invite details by token (the token is the credential). Query: `?token=` | 200, 404, 500 |
| POST | `/api/invite` | public | Accept an invite (set password) via token | 200, 400, 409, 500 |
| GET | `/api/uploads/[...key]` | public | Permanent public serving of CMS images (scoped to the `cms/` prefix; traversal rejected) | 200, 404, 500 |
| POST | `/api/cms/revalidate` | rfp_admin+ / secret | ISR revalidation webhook. Service callers use `REVALIDATE_SECRET`; browsers fall back to an admin session | 200, 400, 401, 403, 422, 500 |

---

### Auth Routes (identity)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| * | `/api/auth/[...nextauth]` | varies | NextAuth v5 catch-all (signin, signout, session, CSRF) | varies |
| POST | `/api/auth/change-password` | auth | Change password. Body: `{ currentPassword, newPassword }` | 200, 401, 422, 500 |
| POST | `/api/auth/forgot-password` | public | Request a self-invalidating HMAC reset token by email | 200, 400, 500 |
| POST | `/api/auth/reset-password` | public | Reset password with token. Body: `{ token, newPassword }` | 200, 400, 500 |

---

### Stripe Routes

Self-serve Stripe checkout is descoped for V1 (the comp code stands in — see the portal `/purchase`
route); these routes exist but are not the live purchase path.

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/stripe/checkout` | tenant (admin) | Create a Stripe checkout session | 200, 400, 401, 403, 404, 500 |
| POST | `/api/stripe/portal` | tenant (admin) | Create a Stripe customer-portal session | 200, 400, 401, 403, 404, 500 |
| POST | `/api/stripe/webhook` | public (Stripe signature) | Webhook handler (checkout complete, invoice paid, subscription started/renewed/canceled) | 200, 400, 500 |

---

### Tool Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/tools/[name]` | auth | Generic HTTP adapter over the tool registry. Body: `{ input: unknown }`; per-tool `requiredRole`/tenant scoping enforced by the registry | 200, 401, 403, 404, 422, 500 |

---

## CMS API Routes (FastAPI)

All CMS routes are served by the FastAPI service at `services/cms/`. Authentication is via
`X-CMS-API-Key` header (constant-time comparison against `CMS_API_KEY` env var) or a signed session
cookie for SPA users. Health, docs, and SPA routes bypass auth.

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | none | CMS service health check |

### Email Accounts

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/email/accounts` | API key | List email accounts. Query: `?active_only=false` |
| GET | `/api/email/accounts/{account_id}` | API key | Get single account detail |
| POST | `/api/email/accounts` | API key | Create email account |
| PATCH | `/api/email/accounts/{account_id}` | API key | Update account fields |

### Email Templates

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/email/templates` | API key | List templates. Query: `?category=...&search=...` |
| GET | `/api/email/templates/categories` | API key | List template categories |
| GET | `/api/email/templates/{template_id}` | API key | Get single template |
| POST | `/api/email/templates` | API key | Create template |
| PATCH | `/api/email/templates/{template_id}` | API key | Update template |
| POST | `/api/email/templates/draft` | API key | AI-draft a template using Claude |
| POST | `/api/email/templates/{template_id}/preview` | API key | Preview rendered template with variables |
| POST | `/api/email/templates/{template_id}/test-send` | API key | Send test email |

### Email Campaigns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/email/campaigns` | API key | List campaigns |
| GET | `/api/email/campaigns/{campaign_id}` | API key | Get campaign detail |
| POST | `/api/email/campaigns` | API key | Create campaign |
| PATCH | `/api/email/campaigns/{campaign_id}` | API key | Update campaign |
| POST | `/api/email/campaigns/{campaign_id}/action` | API key | Campaign action: activate, pause, complete, archive |
| GET | `/api/email/campaigns/{campaign_id}/stats` | API key | Campaign statistics |

### Email Sends

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/email/sends` | API key | Create email send directly |
| GET | `/api/email/sends` | API key | List sends with filters |
| GET | `/api/email/sends/{send_id}` | API key | Get send detail |

### Email Engagement & Threads

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/email/engagement` | API key | List engagement events (opens, clicks, replies) |
| GET | `/api/email/threads` | API key | List email threads |
| GET | `/api/email/threads/{thread_id}` | API key | Get thread detail |

### HITL Outbox

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/email/outbox` | API key | List outbox items. Query: `?status=...&category=...&claimed_by=...` |
| GET | `/api/email/outbox/stats` | API key | Outbox statistics (counts by status) |
| GET | `/api/email/outbox/{outbox_id}` | API key | Get outbox item detail |
| POST | `/api/email/outbox/{outbox_id}/claim` | API key | Claim outbox item for review |
| POST | `/api/email/outbox/{outbox_id}/unclaim` | API key | Release claim on outbox item |
| PATCH | `/api/email/outbox/{outbox_id}/modify` | API key | Modify email before approval |
| POST | `/api/email/outbox/{outbox_id}/approve` | API key | Approve and queue for delivery |
| POST | `/api/email/outbox/bulk-approve` | API key | Bulk approve multiple outbox items |
| POST | `/api/email/outbox/{outbox_id}/reject` | API key | Reject outbox item |

### Drip Campaigns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/drip/campaigns/{campaign_id}/sequences` | API key | List drip sequence steps |
| POST | `/api/drip/campaigns/{campaign_id}/sequences` | API key | Create drip sequence step |
| PATCH | `/api/drip/sequences/{sequence_id}` | API key | Update sequence step |
| DELETE | `/api/drip/sequences/{sequence_id}` | API key | Delete sequence step |
| GET | `/api/drip/campaigns/{campaign_id}/enrollments` | API key | List drip enrollments |
| POST | `/api/drip/campaigns/{campaign_id}/enroll` | API key | Enroll recipient in drip campaign |
| POST | `/api/drip/enrollments/{enrollment_id}/pause` | API key | Pause enrollment |
| POST | `/api/drip/enrollments/{enrollment_id}/resume` | API key | Resume enrollment |
| POST | `/api/drip/enrollments/{enrollment_id}/cancel` | API key | Cancel enrollment |

### Social Media

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/social/accounts` | API key | List social accounts |
| POST | `/api/social/accounts` | API key | Create social account |
| PATCH | `/api/social/accounts/{account_id}` | API key | Update social account |
| GET | `/api/social/posts` | API key | List social posts |
| POST | `/api/social/posts` | API key | Create social post |
| POST | `/api/social/posts/{post_id}/publish` | API key | Publish post immediately |
| PATCH | `/api/social/posts/{post_id}` | API key | Update post |

### Content

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/content/posts` | API key | List CMS posts |
| GET | `/api/content/posts/{post_id}` | API key | Get post detail |
| POST | `/api/content/posts` | API key | Create post |
| PATCH | `/api/content/posts/{post_id}` | API key | Update post |
| POST | `/api/content/posts/{post_id}/action` | API key | Post action: publish, unpublish, archive |
| POST | `/api/content/posts/{post_id}/revise` | API key | AI-revise post content |
| GET | `/api/content/posts/{post_id}/reviews` | API key | Get post review history |
| GET | `/api/content/generations` | API key | List AI generations |
| POST | `/api/content/generations` | API key | Create generation request |
| POST | `/api/content/generations/from-url` | API key | Generate from URL |
| POST | `/api/content/generations/from-email/{send_id}` | API key | Generate from email thread |
| POST | `/api/content/generations/{gen_id}/action` | API key | Generation action: approve, reject, regenerate |

### Todos

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/todos` | API key | List todos |
| POST | `/api/todos` | API key | Create todo |
| PATCH | `/api/todos/{todo_id}` | API key | Update todo |

### Media

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/media/upload` | API key | Upload media file |
| GET | `/api/media/list` | API key | List media files |
| GET | `/api/media/file/{path}` | API key | Serve media file |
| PATCH | `/api/media/{media_id}` | API key | Update media metadata |
| DELETE | `/api/media/{media_id}` | API key | Delete media file |
| GET | `/api/media/stats` | API key | Media storage statistics |
