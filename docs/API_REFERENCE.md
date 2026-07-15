# API Reference

Complete listing of all API routes in the govwin platform: Frontend (Next.js), and CMS (FastAPI).

---

## Frontend API Routes

All routes live under `frontend/app/api/`. Standard response shape: `{ data: T }` on success, `{ error: string, code: string, details?: unknown }` on failure. Exception: `/api/health` returns its own `{ ok, checks }` shape.

---

### Admin Routes

All admin routes require `master_admin` or `rfp_admin` role unless noted otherwise.

#### Dashboard & Monitoring

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/dashboard` | rfp_admin+ | Dashboard stats: tenant counts, subscriptions, proposals by stage, revenue, recent events, pipeline jobs | 200, 401, 403, 500 |
| GET | `/api/admin/analytics` | rfp_admin+ | Aggregate visitor traffic analytics | 200, 401, 403, 500 |
| GET | `/api/admin/pipeline` | rfp_admin+ | Pipeline job stats: queued/running/completed/failed, recent jobs, schedule status | 501 (not yet implemented) |
| GET | `/api/admin/agents` | rfp_admin+ | Agent monitoring: task queue depth, active/failed tasks, memory counts per archetype | 501 (not yet implemented) |
| GET | `/api/admin/system` | rfp_admin+ | System status | 501 (not yet implemented) |

#### Tenant Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/tenants` | rfp_admin+ | List all tenants with stats | 501 (not yet implemented) |
| POST | `/api/admin/tenants` | rfp_admin+ | Create tenant manually (bypass application flow) | 501 (not yet implemented) |
| GET | `/api/admin/tenants/[tenantId]` | rfp_admin+ | Single tenant detail | 200, 401, 403, 404, 500 |
| PATCH | `/api/admin/tenants/[tenantId]` | rfp_admin+ | Update tenant fields | 200, 401, 403, 404, 422, 500 |

#### Application Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/applications/[id]/accept` | rfp_admin+ | Accept application: creates tenant + user, sends welcome email | 200, 401, 403, 404, 500 |
| POST | `/api/admin/applications/[id]/reject` | rfp_admin+ | Reject application: sends rejection email | 200, 401, 403, 404, 500 |
| POST | `/api/admin/applications/[id]/status` | rfp_admin+ | Toggle application status for testing | 200, 401, 403, 404, 500 |

#### Purchase Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/purchases` | rfp_admin+ | Cross-tenant purchase list with filters | 501 (not yet implemented) |

#### RFP Curation

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/rfp-curation` | rfp_admin+ | List curated solicitations (triage queue). Query: `?status=new,claimed,...` | 200, 401, 403, 500 |
| GET | `/api/admin/rfp-curation/[solId]` | rfp_admin+ | Full solicitation detail with topics, documents, volumes, compliance | 200, 401, 403, 404, 500 |
| POST | `/api/admin/rfp-curation/[solId]/claim` | rfp_admin+ | Claim solicitation for curation (atomic state transition) | 200, 401, 403, 409, 500 |
| POST | `/api/admin/rfp-curation/[solId]/triage` | rfp_admin+ | Triage action (claim, dismiss, release). Body: `{ action, notes? }` | 200, 401, 403, 409, 500 |
| POST | `/api/admin/rfp-curation/[solId]/push` | rfp_admin+ | Push approved solicitation to customer pipeline | 200, 401, 403, 409, 500 |
| GET | `/api/admin/rfp-curation/[solId]/annotations` | rfp_admin+ | List annotations for solicitation | 200, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/annotations` | rfp_admin+ | Create annotation (highlight, text, compliance tag) | 201, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/compliance` | rfp_admin+ | Get solicitation compliance variables | 200, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/compliance` | rfp_admin+ | Save compliance variable value | 200, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/outline` | rfp_admin+ | Get solicitation outline JSON | 200, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/outline` | rfp_admin+ | Save/update outline | 200, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/templates` | rfp_admin+ | List template documents for solicitation | 200, 401, 403, 500 |
| POST | `/api/admin/rfp-curation/[solId]/apply-preset` | rfp_admin+ | Apply compliance preset to topics. Body: `{ topicIds, presetId }` or `{ topicIds, compliance, volumes }` | 200, 401, 403, 422, 500 |
| GET | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Get resolved topic compliance (merged: topic -> solicitation -> defaults) | 200, 401, 403, 500 |
| PUT | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Save topic-level compliance overrides | 200, 401, 403, 422, 500 |
| DELETE | `/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance` | rfp_admin+ | Remove topic overrides (revert to solicitation baseline) | 200, 401, 403, 500 |

#### RFP Documents

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/rfp-upload` | rfp_admin+ | Upload RFP files (multipart). Creates opportunity + solicitation + documents, enqueues shred job | 201, 401, 403, 422, 500 |
| POST | `/api/admin/rfp-document/[id]/set-primary` | rfp_admin+ | Mark document as primary for its solicitation | 200, 401, 403, 404, 500 |
| GET | `/api/admin/rfp-document/[id]/signed-url` | rfp_admin+ | Get 15-minute signed S3 URL for document | 200, 401, 403, 404, 500 |
| POST | `/api/admin/extract-topics` | rfp_admin+ | Extract topics from solicitation document. Body: `{ solicitationId }` | 200, 401, 403, 500 |
| POST | `/api/admin/upload-topic-files` | rfp_admin+ | Upload topic-specific files | 201, 401, 403, 422, 500 |

#### Compliance

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/compliance-presets` | rfp_admin+ | List all compliance presets (system + custom) | 200, 401, 403, 500 |
| POST | `/api/admin/compliance-presets` | rfp_admin+ | Create custom preset from a topic's compliance | 201, 401, 403, 422, 500 |
| GET | `/api/admin/compliance-suggest` | rfp_admin+ | Suggest compliance values from curation memory. Query: `?namespace=...&variableName=...` | 200, 401, 403, 500 |

#### Topics

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| PATCH | `/api/admin/topics/[id]` | rfp_admin+ | Update topic fields | 200, 401, 403, 404, 422, 500 |

#### Source Profiles (Source Scout)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/sources` | rfp_admin+ | List all active source profiles with visit counts | 200, 401, 403, 500 |
| POST | `/api/admin/sources` | rfp_admin+ | Create new source profile | 201, 401, 403, 422, 500 |
| PATCH | `/api/admin/sources/[profileId]` | rfp_admin+ | Update source profile settings | 200, 401, 403, 404, 500 |
| GET | `/api/admin/sources/[profileId]/diffs` | rfp_admin+ | List diffs for a source profile | 200, 401, 403, 500 |
| GET | `/api/admin/sources/[profileId]/regions` | rfp_admin+ | List regions for a source profile | 200, 401, 403, 500 |
| POST | `/api/admin/sources/[profileId]/regions` | rfp_admin+ | Create new region annotation | 201, 401, 403, 422, 500 |
| DELETE | `/api/admin/sources/[profileId]/regions/[regionId]` | rfp_admin+ | Soft-delete a region (set is_active=false) | 200, 401, 403, 404, 500 |
| POST | `/api/admin/sources/[profileId]/scout` | rfp_admin+ | Trigger manual scout run (enqueues pipeline job) | 200, 401, 403, 500 |
| POST | `/api/admin/sources/[profileId]/visit` | rfp_admin+ | Log a source visit/action | 200, 401, 403, 422, 500 |
| POST | `/api/admin/sources/[profileId]/paste-import` | rfp_admin+ | Parse pasted content and create topic records | 200, 401, 403, 422, 500 |

#### SBIR Data

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/sbir-data/ingest` | rfp_admin+ | Ingest SBIR company/award CSV data (up to 5 min) | 200, 401, 403, 422, 500 |
| GET | `/api/admin/sbir-data/lookup` | rfp_admin+ | Search SBIR companies/awards. Query: `?company=...&uei=...&domain=...` | 200, 401, 403, 422, 500 |

#### Documents (Admin Document Builder)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/documents` | rfp_admin+ | List all documents from S3 index | 200, 401, 403, 500 |
| POST | `/api/admin/documents` | rfp_admin+ | Create new document from preset | 201, 401, 403, 422, 500 |
| GET | `/api/admin/documents/[documentId]` | rfp_admin+ | Load full document JSON | 200, 401, 403, 404, 500 |
| PUT | `/api/admin/documents/[documentId]` | rfp_admin+ | Save/update document | 200, 401, 403, 404, 500 |
| DELETE | `/api/admin/documents/[documentId]` | rfp_admin+ | Delete document | 200, 401, 403, 404, 500 |
| POST | `/api/admin/documents/[documentId]/export` | rfp_admin+ | Export document to DOCX/PPTX/XLSX | 200, 401, 403, 404, 500 |
| POST | `/api/admin/documents/upload-image` | rfp_admin+ | Upload image for document builder | 200, 401, 403, 500 |

#### Proposal Admin

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| PUT | `/api/admin/proposals/[proposalId]/sections/[sectionId]` | rfp_admin+ | Save canvas document JSON, create version | 200, 401, 403, 404, 500 |
| POST | `/api/admin/proposals/[proposalId]/sections/[sectionId]/export` | rfp_admin+ | Export section to DOCX | 200, 401, 403, 404, 500 |

#### Content Management

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/content` | public (GET) | List published content, filterable by type and tags | 200, 500 |
| POST | `/api/admin/content` | rfp_admin+ | Create/update content (upsert on slug) | 201, 401, 403, 422, 500 |
| DELETE | `/api/admin/content` | rfp_admin+ | Delete content by slug | 200, 401, 403, 404, 500 |
| POST | `/api/admin/content/generate` | rfp_admin+ | Auto-generate content metadata from URL (uses Claude) | 200, 401, 403, 422, 500 |

#### Site Postings

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/admin/site/docs/[type]/[slug]/status` | rfp_admin+ | Archive (retire) or restore a published posting (`type` in `blog_post`, `resource`, `guide`, `testimonial`, `team_member`). Body: `{ action: 'archive' \| 'restore' }`. Revalidates the public list path and emits `system:content.document_archived` / `content.document_restored`. | 200, 400, 401, 403, 409, 500 |

#### Storage

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/storage` | rfp_admin+ | S3 file manager operations | 200, 401, 403, 500 |

#### Waitlist (Admin)

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/admin/waitlist` | rfp_admin+ | Check waitlist entries | 200, 401, 403, 500 |

---

### Portal Routes

All portal routes are under `/api/portal/[tenantSlug]/`. They require authentication and verify tenant access (actor's tenantSlug must match URL param; master_admin and rfp_admin bypass this).

> **Card-spine note (2026-07-15):** the canonical customer surface is now the opportunity-card spine — the workspace **Purchase -> curation -> release** flow (`/purchase`, `/portals/[portalId]`, documented under "Purchase & Workspace Portals" below) drafted from `/cards`. The **Opportunities** and **Spotlights** sections further down predate it and read the **retired** `tenant_pipeline_items` surface (see CLAUDE.md / ARCHITECTURE_V10.md); treat them as legacy pending a fuller rewrite.

#### Dashboard

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/dashboard` | tenant_user+ | Tenant dashboard: proposal counts, matched opportunities, library units, team, recent activity | 200, 401, 403, 404, 500 |

#### Opportunities

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/opportunities` | tenant_user+ | Scored opportunity list. Query: `?status=...&sort=...&search=...&limit=...&offset=...` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/opportunities` | tenant_user+ | Bulk actions (pin/unpin/pass) | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/opportunities/[opportunityId]/actions` | tenant_user+ | Single opportunity action: pin, unpin, thumb_up, thumb_down, pursue | 501 (partially implemented) |
| GET | `/api/portal/[tenantSlug]/opportunities/[opportunityId]/documents` | tenant_user+ | Signed S3 URLs for solicitation documents | 501 (not yet implemented) |

#### Spotlights

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/spotlights` | tenant_user+ | List saved search spotlights | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/spotlights` | tenant_admin+ | Create new spotlight | 201, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/spotlights/[spotlightId]` | tenant_user+ | Spotlight detail with scored items | 501 (not yet implemented) |
| PATCH | `/api/portal/[tenantSlug]/spotlights/[spotlightId]` | tenant_admin+ | Update spotlight filters/name | 501 (not yet implemented) |
| POST | `/api/portal/[tenantSlug]/spotlight/pin` | tenant_user+ | Pin a topic. Body: `{ opportunityId }` | 200, 401, 403, 404, 500 |
| DELETE | `/api/portal/[tenantSlug]/spotlight/pin` | tenant_user+ | Unpin a topic. Body: `{ opportunityId }` | 200, 401, 403, 404, 500 |

#### Proposals

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals` | tenant_user+ | List proposals. Query: `?stage=...&sort=...&limit=...&offset=...` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/create` | tenant_admin+ | Create new proposal from opportunity + template | 201, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]` | tenant_user+ | Proposal detail with sections, compliance, collaborators | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/advance` | tenant_admin+ | Advance proposal stage | 200, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/stage` | tenant_admin+ | Set proposal stage | 200, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/lock` | tenant_admin+ | Lock proposal workspace (harvests content to library) | 200, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/outcome` | tenant_admin+ | Record outcome: awarded, rejected, withdrawn | 200, 401, 403, 404, 422, 500 |

#### Proposal Sections

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections` | tenant_user+ | List proposal sections | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` | tenant_user+ | Save section canvas content + create version | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export` | tenant_user+ | Export section to DOCX/PPTX/XLSX | 200, 401, 403, 404, 500 |

#### Proposal AI

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft` | tenant_user+ | Queue AI draft for section(s). Body: `{ sectionId?, instructions? }` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review` | tenant_user+ | Queue AI review for section(s). Body: `{ sectionId?, reviewType? }` | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance` | tenant_user+ | AI compliance check. Body: `{ sectionId }` | 501 (not yet implemented) |

#### Proposal Collaboration

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators` | tenant_user+ | List proposal collaborators | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators` | tenant_admin+ | Invite collaborator (creates partner_user) | 201, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments` | tenant_user+ | List proposal comments | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments` | tenant_user+ | Create comment | 201, 401, 403, 404, 422, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/comments/[commentId]/resolve` | tenant_user+ | Resolve comment | 200, 401, 403, 404, 500 |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/reviews` | tenant_user+ | List color team review rounds | 501 (not yet implemented) |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/reviews` | tenant_admin+ | Create review round | 501 (not yet implemented) |

#### Proposal Export & Package

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/compliance` | tenant_user+ | Get proposal compliance data | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/package` | tenant_user+ | Generate full proposal ZIP package | 501 (not yet implemented) |
| GET | `/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox` | tenant_user+ | List dropbox files | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox` | tenant_user+ | Upload to dropbox | 201, 401, 403, 404, 500 |

#### Library

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/library` | tenant_user+ | List library units (filtered, paginated) | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library` | tenant_admin+ | Bulk operations: approve, archive, delete, set_category, add_tags | 200, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/library/[unitId]` | tenant_user+ | Get one library unit | 200, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/library/[unitId]` | tenant_admin+ | Update library unit | 200, 401, 403, 404, 422, 500 |
| DELETE | `/api/portal/[tenantSlug]/library/[unitId]` | tenant_admin+ | Delete library unit (blocked for seminal) | 200, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/library/[unitId]` | tenant_admin+ | Re-atomize a seminal document | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library/upload` | tenant_user+ | Upload files to library (multipart) | 201, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/library/atomize` | tenant_admin+ | Trigger atomization of uploaded documents | 200, 401, 403, 404, 500 |

#### Uploads

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/uploads` | tenant_user+ | List uploaded library units | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/uploads` | tenant_user+ | Upload file to S3 + create library_unit | 201, 401, 403, 404, 500 |

#### Team

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/team` | tenant_user+ | List team members | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/team` | tenant_admin+ | Invite team member | 201, 401, 403, 404, 422, 500 |

#### Profile & Purchases

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/profile` | tenant_user+ | Get tenant profile | 200, 401, 403, 404, 500 |
| PATCH | `/api/portal/[tenantSlug]/profile` | tenant_admin+ | Update tenant profile | 200, 401, 403, 404, 422, 500 |
| GET | `/api/portal/[tenantSlug]/purchases` | tenant_admin+ | Tenant purchase history | 200, 401, 403, 404, 500 |

#### Purchase & Workspace Portals

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/portal/[tenantSlug]/purchase` | tenant_admin+ | Buy a proposal workspace for a pinned opportunity. Body: `{ opportunityId, promoCode, label? }`. A `comp` promo code records a completed $0 purchase, opens the portal in `curation_pending` with a 72h SLA, grants the T&C shadow-admin, and emits `capture:purchase.completed`. Percent/amount codes + real Stripe checkout are out of scope here (the modal still offers the Stripe redirect). | 200, 400, 401, 403, 404, 409, 500 |
| GET | `/api/portal/[tenantSlug]/portals/[portalId]` | tenant_user+ | Portal detail + shadow-admin grants | 200, 401, 403, 404, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=accept` | tenant_admin+ | Accept guardrail config -> launch the workspace (provision build + instantiate ToDos). Body: `{ guardrailConfig, revokeShadow? }` | 200, 400, 401, 403, 409, 422, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=release` | rfp_admin (expert, via global tenant access) | Release a purchased workspace from curation (`curation_pending -> launched`): `releaseFromCuration` + provision the build unlocked + instantiate ToDos, then emit `capture:workspace.released`. Body: `{ guardrailConfig? }` | 200, 400, 401, 403, 409, 422, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=advance-stage` | tenant_admin+ | Advance the portal workflow stage. Body: `{ force? }` | 200, 401, 403, 404, 409, 500 |
| POST | `/api/portal/[tenantSlug]/portals/[portalId]?action=revoke-shadow` | tenant_admin+ | Revoke the shadow-admin (expert) grant | 200, 401, 403, 500 |
| PATCH | `/api/portal/[tenantSlug]/portals/[portalId]` | tenant_admin+ | Set portal status (`executing`, `closeout`, `archived`, ...) | 200, 400, 401, 403, 500 |

#### Notifications

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/notifications` | tenant_user+ | Notification feed from system_events | 200, 401, 403, 404, 500 |

#### Agents

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/portal/[tenantSlug]/agents/config` | tenant_admin+ | Agent configuration | 501 (not yet implemented) |
| GET | `/api/portal/[tenantSlug]/agents/memories` | tenant_admin+ | Agent memory viewer | 501 (not yet implemented) |
| GET | `/api/portal/[tenantSlug]/agents/performance` | tenant_admin+ | Agent performance metrics | 501 (not yet implemented) |

---

### Public Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| GET | `/api/health` | none | Liveness probe. Returns `{ ok, version, environment, uptimeMs, checks: { db, s3 } }` | 200, 503 |
| POST | `/api/applications` | none | Submit application. Validates with zod schema, writes to `applications` table | 201, 400, 422, 409, 500 |
| POST | `/api/waitlist` | none | Join waitlist. Body: `{ email, companyName?, metadata? }` | 201, 409, 500 |
| GET | `/api/content/[slug]` | none | Get published content by slug | 200, 404, 500 |
| POST | `/api/analytics/pageview` | none | Record page view | 200, 500 |
| POST | `/api/consent` | none | Record consent | 200, 422, 500 |
| POST | `/api/events` | none | Client-side event tracking | 200, 422, 500 |
| POST | `/api/invite` | none | Accept invite (set password) | 200, 400, 422, 500 |

---

### Auth Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| * | `/api/auth/[...nextauth]` | varies | NextAuth v5 catch-all (signin, signout, session, CSRF) | varies |
| POST | `/api/auth/change-password` | authenticated | Change password. Body: `{ currentPassword, newPassword }` | 200, 401, 422, 500 |
| POST | `/api/auth/forgot-password` | none | Request password reset email | 200, 422, 500 |
| POST | `/api/auth/reset-password` | none | Reset password with token. Body: `{ token, newPassword }` | 200, 400, 422, 500 |

---

### Stripe Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/stripe/checkout` | tenant_admin+ | Create Stripe checkout session | 200, 401, 403, 500 |
| POST | `/api/stripe/portal` | tenant_admin+ | Create Stripe customer portal session | 200, 401, 403, 500 |
| POST | `/api/stripe/webhook` | none (Stripe signature) | Stripe webhook handler (checkout complete, invoice paid, subscription canceled) | 200, 400 |

---

### Tool Routes

| Method | Path | Auth | Description | Status Codes |
|--------|------|------|-------------|--------------|
| POST | `/api/tools/[name]` | authenticated | Generic tool adapter. Body: `{ input: unknown }`. Routes to tool registry by name. | 200, 401, 403, 404, 422, 500 |

---

## CMS API Routes (FastAPI)

All CMS routes are served by the FastAPI service at `services/cms/`. Authentication is via `X-CMS-API-Key` header (constant-time comparison against `CMS_API_KEY` env var) or a signed session cookie for SPA users. Health, docs, and SPA routes bypass auth.

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
