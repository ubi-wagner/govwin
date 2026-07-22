# Frontend API Route Inventory
Generated: 2026-06-23 | Routes enumerated from `git ls-files 'frontend/app/api/**/route.ts'` | Total: 138 routes

---

## Legend
- Response shapes: `{data}✓` = success always wrapped; `{error,code}✓` = every error includes both fields
- Tenant scope: `verified` = tenantSlug resolved → tenantId used in all queries; `N/A` = admin or public; `⚠️MISSING` = gap found
- Status: ✅active | ♻️duplicate | ⚠️stale | 💀dead | 🗑️deprecated-candidate

---

## DOMAIN: admin/*

### GET /api/admin/agents   (file: frontend/app/api/admin/agents/route.ts)
- Use: Agent monitoring — task queue depth, status by role, recent failures, recent tool events
- Auth/Role: rfp_admin+
- Validation: none (no input)
- Data: agent_task_queue (r), system_events (r); no events emitted; no jobs enqueued
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/agents/usage   (file: frontend/app/api/admin/agents/usage/route.ts)
- Use: Admin agent usage dashboard — summary stats, by-archetype, by-tenant, daily trend
- Auth/Role: rfp_admin+
- Validation: manual — ?period param validated against whitelist {7d,30d,90d}
- Data: agent_task_log (r), tenants (r), tenant_agent_config (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/analytics   (file: frontend/app/api/admin/analytics/route.ts)
- Use: Visitor traffic analytics — 24h/7d visitors+pageviews, top pages, referrers, device breakdown
- Auth/Role: rfp_admin or master_admin
- Validation: none (no input)
- Data: visitor_sessions (r), page_views (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ All 7 parallel sql calls are inside a single shared try/catch (not individual per SOP)

### POST /api/admin/applications/[id]/accept   (file: frontend/app/api/admin/applications/[id]/accept/route.ts)
- Use: Accept a pending application — creates tenant + tenant_admin user, sends welcome email with temp password
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID format on id; optional reviewNotes
- Data: applications (r/w), tenants (w), users (r/w); event: capture.application.accepted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (tenantId=null on event)
- Status: ✅active (critical path — onboarding)
- Notes: Uses sql.begin() transaction correctly

### POST /api/admin/applications/[id]/reject   (file: frontend/app/api/admin/applications/[id]/reject/route.ts)
- Use: Reject a pending application with reason; sends rejection email
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; reason required (min 10 chars)
- Data: applications (r/w); event: capture.application.rejected; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/applications/[id]/status   (file: frontend/app/api/admin/applications/[id]/status/route.ts)
- Use: Manual status override for applications (pending/under_review/rejected/withdrawn)
- Auth/Role: master_admin only
- Validation: manual — UUID; status whitelist; note min 5 chars
- Data: applications (r/w); event: capture.application.status_changed; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/automation   (file: frontend/app/api/admin/automation/route.ts)
- Use: List/create automation rules
- Auth/Role: rfp_admin or master_admin
- Validation: manual — name, triggerNamespace, triggerType, actionType required; actionType validated against whitelist
- Data: automation_rules (r/w); event: system.rule.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ POST GET sql branches (lines 60–74) are bare — no inner try/catch on automation_rules SELECT

### GET, PATCH /api/admin/automation/[ruleId]   (file: frontend/app/api/admin/automation/[ruleId]/route.ts)
- Use: Get single rule with execution logs; toggle/update rule fields
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID regex; body fields type-checked
- Data: automation_rules (r/w), automation_log (r); event: system.rule.toggled/updated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/compliance-presets   (file: frontend/app/api/admin/compliance-presets/route.ts)
- Use: List all compliance presets; create custom preset (optionally from a source topic)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — name, phaseType required; sourceTopicId UUID validated if provided
- Data: compliance_presets (r/w), solicitation_compliance (r), solicitation_volumes (r), volume_required_items (r); event: finder.compliance_preset.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/compliance-suggest   (file: frontend/app/api/admin/compliance-suggest/route.ts)
- Use: Returns auto-complete suggestions for compliance variable values (memory-based + well-known defaults)
- Auth/Role: any authenticated user (no role minimum — rfp_admin implied by context)
- Validation: manual — variableName required; namespace optional
- Data: episodic_memories (r); no events; no jobs
- Response: {data}✓ ; errors: only outer 401 has {error,code}; no error returned from memory query failure (swallows, logs)
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Missing role check — any authenticated user can query compliance memory. {error,code} shape incomplete — memory query failure is silently swallowed

### GET /api/admin/dashboard   (file: frontend/app/api/admin/dashboard/route.ts)
- Use: Admin home dashboard — tenant counts, proposals by stage, solicitation count, revenue, recent events, pipeline jobs
- Auth/Role: rfp_admin+
- Validation: none
- Data: tenants (r), proposals (r), curated_solicitations (r), purchases (r), system_events (r), pipeline_jobs (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path — admin home)

### POST /api/admin/documents/[documentId]/export   (file: frontend/app/api/admin/documents/[documentId]/export/route.ts)
- Use: Export canvas document to docx/pptx/xlsx binary download
- Auth/Role: rfp_admin or master_admin
- Validation: manual — documentId presence; format whitelist {docx,pptx,xlsx}; document object required
- Data: no SQL (export is in-memory); no events; no jobs; reads from request body
- Response: binary file on success; {error,code}✓ on errors
- Tenant scope: N/A admin
- Status: ✅active

### GET, PUT, DELETE /api/admin/documents/[documentId]   (file: frontend/app/api/admin/documents/[documentId]/route.ts)
- Use: Load/save/delete a canvas reference document; GET also supports ?history and ?version queries
- Auth/Role: rfp_admin or master_admin
- Validation: manual — documentId presence; document object required for PUT
- Data: no SQL; S3 storage (reference/documents/{id}.json + _index.json); events: finder.document.saved, finder.document.deleted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (document builder is admin-only)
- Status: ✅active
- Notes: Uses S3 storage (confirms storage is S3, not local /data volume)

### GET, POST /api/admin/documents   (file: frontend/app/api/admin/documents/route.ts)
- Use: List all reference documents (from S3 index); create new document from preset
- Auth/Role: rfp_admin or master_admin
- Validation: manual — title and preset required for POST
- Data: no SQL; S3 storage; events: finder.document.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/documents/upload-image   (file: frontend/app/api/admin/documents/upload-image/route.ts)
- Use: Upload an image into reference/images/ in S3 for use in document builder
- Auth/Role: rfp_admin or master_admin
- Validation: manual — file type whitelist, 10MB limit
- Data: no SQL; S3 storage; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/extract-topics   (file: frontend/app/api/admin/extract-topics/route.ts)
- Use: Extract structured topics from a solicitation's document text (TOC scan + full scan fallback)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — solicitationId required string
- Data: curated_solicitations/solicitation_documents (r, via lib); no events; no jobs (synchronous extraction)
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/pipeline   (file: frontend/app/api/admin/pipeline/route.ts)
- Use: Pipeline monitoring — job counts by status, recent 50 jobs with duration, schedule status
- Auth/Role: rfp_admin+
- Validation: none
- Data: pipeline_jobs (r), pipeline_schedules (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ All sql calls only guarded by outer try/catch (no inner per-query catch)

### GET /api/admin/processes   (file: frontend/app/api/admin/processes/route.ts)
- Use: Cross-tenant process ledger — running/paused/pending process_instances with tenant name and open task count
- Auth/Role: rfp_admin+
- Validation: none
- Data: process_instances (r), tenants (r), tasks (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (cross-tenant read)
- Status: ✅active

### POST /api/admin/proposals/[proposalId]/sections/[sectionId]/export   (file: frontend/app/api/admin/proposals/[proposalId]/sections/[sectionId]/export/route.ts)
- Use: Admin export of a proposal section canvas to docx/pptx/xlsx; requires proposal to be locked
- Auth/Role: rfp_admin or master_admin
- Validation: manual — format whitelist; document+nodes required
- Data: proposals (r/w — lock check + download_count); event: proposal.section.exported; no jobs
- Response: binary file on success; {error,code}✓ on errors
- Tenant scope: N/A admin
- Status: ✅active

### PUT /api/admin/proposals/[proposalId]/sections/[sectionId]   (file: frontend/app/api/admin/proposals/[proposalId]/sections/[sectionId]/route.ts)
- Use: Admin save of canvas JSON to proposal_sections; creates canvas_versions snapshot
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID format for both IDs; content object required
- Data: proposal_sections (r/w), canvas_versions (w); event: proposal.section.saved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (bypasses tenant scope — admin can edit any proposal section)
- Status: ✅active

### GET /api/admin/purchases   (file: frontend/app/api/admin/purchases/route.ts)
- Use: Cross-tenant purchase management — all purchases with optional date range filter
- Auth/Role: rfp_admin+
- Validation: manual — ?start/?end/?limit params sanitized
- Data: purchases (r), tenants (r), proposals (r), opportunities (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (cross-tenant)
- Status: ✅active

### GET /api/admin/rfp-curation   (file: frontend/app/api/admin/rfp-curation/route.ts)
- Use: List curated solicitations with filtering by status array
- Auth/Role: rfp_admin or master_admin
- Validation: manual — ?statuses query param parsed as comma-separated array
- Data: curated_solicitations (r), opportunities (r join); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path — curator home)

### GET /api/admin/rfp-curation/[solId]   (file: frontend/app/api/admin/rfp-curation/[solId]/route.ts)
- Use: Full solicitation detail for curation workspace — solicitation + opportunity + topics + documents + volumes + compliance
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID regex on solId
- Data: curated_solicitations (r), opportunities (r), solicitation_documents (r), solicitation_volumes (r), volume_required_items (r), solicitation_compliance (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path — curation workspace)

### GET, POST /api/admin/rfp-curation/[solId]/annotations   (file: frontend/app/api/admin/rfp-curation/[solId]/annotations/route.ts)
- Use: List/create solicitation annotations (highlights, text boxes, compliance tags)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; kind whitelist; sourceLocation required
- Data: solicitation_annotations (r/w), curated_solicitations (r); event: finder.annotation.saved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/rfp-curation/[solId]/apply-preset   (file: frontend/app/api/admin/rfp-curation/[solId]/apply-preset/route.ts)
- Use: Apply a compliance preset (or raw compliance+volumes) to one or more topics
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; topicIds array validated; topic ownership verified against solicitation
- Data: compliance_presets (r), solicitation_compliance (r/w), solicitation_volumes (r/w), volume_required_items (r/w), opportunities (r); event: finder.compliance.preset_applied; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/rfp-curation/[solId]/claim   (file: frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts)
- Use: Claim a solicitation for curation (sets claimed_by, transitions status)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; delegates to solicitation.claim tool
- Data: via tool (curated_solicitations w); events via tool; no direct jobs
- Response: {data}✓ ; {error,code}✓ (AppError translated)
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/rfp-curation/[solId]/compliance   (file: frontend/app/api/admin/rfp-curation/[solId]/compliance/route.ts)
- Use: Get/save compliance variable values for a solicitation (HITL flywheel write side)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; POST delegates to compliance.save_variable_value tool
- Data: solicitation_compliance (r in GET); via tool in POST (episodic_memories w); event: finder.compliance_value.saved
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ POST: emitEventEnd not called on AppError path in catch block (dangling start event)

### POST /api/admin/rfp-curation/[solId]/force-release   (file: frontend/app/api/admin/rfp-curation/[solId]/force-release/route.ts)
- Use: Force-release a claimed solicitation back to 'new' status (safety valve)
- Auth/Role: master_admin only (strictest)
- Validation: manual — UUID; 24h staleness check
- Data: curated_solicitations (r/w), triage_actions (w); event: finder.solicitation.force_released; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/rfp-curation/[solId]/outline   (file: frontend/app/api/admin/rfp-curation/[solId]/outline/route.ts)
- Use: Get/save proposal outline for a solicitation
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; POST requires content
- Data: solicitation_outlines (r/w), curated_solicitations (r); event: finder.outline.saved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Multiple bare await sql calls (GET lines 58–76, POST lines 167–203) not in individual try/catch

### POST /api/admin/rfp-curation/[solId]/push   (file: frontend/app/api/admin/rfp-curation/[solId]/push/route.ts)
- Use: Push a curated solicitation to the portal (makes it visible as opportunity)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; delegates to solicitation.push tool
- Data: via tool; events via tool; no direct jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path — publish to portal)

### GET /api/admin/rfp-curation/[solId]/revisions   (file: frontend/app/api/admin/rfp-curation/[solId]/revisions/route.ts)
- Use: List revision history for a solicitation (optional ?type filter)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; typeParam passed safely into parameterized query
- Data: curated_solicitations (r), curation_revisions (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/rfp-curation/[solId]/templates   (file: frontend/app/api/admin/rfp-curation/[solId]/templates/route.ts)
- Use: List document templates associated with a solicitation (document_type='template')
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID
- Data: curated_solicitations (r), solicitation_documents (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, PUT, DELETE /api/admin/rfp-curation/[solId]/topics/[topicId]/compliance   (file: frontend/app/api/admin/rfp-curation/[solId]/topics/[topicId]/compliance/route.ts)
- Use: Get/save/clear topic-level compliance override (overrides solicitation-level compliance)
- Auth/Role: rfp_admin or master_admin (via shared authCheck helper)
- Validation: manual — UUIDs; PUT content validated; topic ownership verified
- Data: solicitation_compliance (r/w), solicitation_volumes (r/w), volume_required_items (r/w), opportunities (r); events: finder.compliance.topic_override_saved/cleared; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ GET has 3 bare await sql calls (lines 76–122) not in individual try/catch; DELETE also has multiple unguarded sql calls

### POST /api/admin/rfp-curation/[solId]/triage   (file: frontend/app/api/admin/rfp-curation/[solId]/triage/route.ts)
- Use: Triage a solicitation (accept/defer/reject/skip) with state machine transitions
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID; action whitelist; conflict detection
- Data: curated_solicitations (r/w), triage_actions (w); event: finder.solicitation.triaged; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path)
- Notes: ⚠️ Multiple bare await sql calls (lines 110–183) not in individual try/catch; dead code: updateFields object built but never used

### POST /api/admin/rfp-document/[id]/set-primary   (file: frontend/app/api/admin/rfp-document/[id]/set-primary/route.ts)
- Use: Mark a solicitation document as the primary document
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID
- Data: solicitation_documents (r/w); event: finder.document.primary_set; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ auth() call is OUTSIDE outer try/catch — if auth() throws, propagates unhandled

### GET /api/admin/rfp-document/[id]/signed-url   (file: frontend/app/api/admin/rfp-document/[id]/signed-url/route.ts)
- Use: Generate a signed S3 URL for a solicitation document (for PDF viewer)
- Auth/Role: rfp_admin or master_admin
- Validation: manual — UUID
- Data: solicitation_documents (r); no events; no jobs; S3 signed URL
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ auth() call is OUTSIDE outer try/catch — same unhandled-throw risk

### POST /api/admin/rfp-upload   (file: frontend/app/api/admin/rfp-upload/route.ts)
- Use: Upload RFP PDF — creates/attaches curated_solicitation and opportunity, extracts text, parses topics
- Auth/Role: rfp_admin or master_admin
- Validation: manual — file type/size; solicitation_number uniqueness; dedup by hash
- Data: solicitation_documents (r/w), curated_solicitations (r/w), opportunities (r/w); events: finder.rfp.uploaded/attached; enqueues pipeline_jobs (implicit via text extraction); S3 storage
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (critical path — RFP ingestion)
- Notes: ⚠️ auth() call outside outer try/catch; dead imports (ForbiddenError, UnauthenticatedError never used); uses sql.begin() transaction correctly

### POST, GET /api/admin/sbir-data/ingest   (file: frontend/app/api/admin/sbir-data/ingest/route.ts)
- Use: POST — ingest SBIR CSV/XML data file; GET — list prior uploads
- Auth/Role: master_admin or rfp_admin
- Validation: manual — file type whitelist; CSV/XML parsing
- Data: sbir_data_uploads (r/w), sbir_companies (w via sql.unsafe upsert), sbir_awards (w via sql.unsafe insert); event: finder.sbir_data.ingested; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Uses sql.unsafe() for batch inserts (intentional, values are parameterized via $N placeholders); outer catch leaks internal error message to client: `error: \`Ingest failed: ${msg.slice(0,500)}\`` — violates "never expose internal error details"

### GET /api/admin/sbir-data/lookup   (file: frontend/app/api/admin/sbir-data/lookup/route.ts)
- Use: Look up a company in SBIR data by name or DUNS; returns company record + awards + summary stats
- Auth/Role: master_admin or rfp_admin
- Validation: manual — q or duns required; ILIKE patterns correctly escaped
- Data: sbir_companies (r), sbir_awards (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/site/docs/[type]/[slug]/publish   (file: frontend/app/api/admin/site/docs/[type]/[slug]/publish/route.ts)
- Use: Publish a documentation page draft to live
- Auth/Role: master_admin (via requireAdmin helper)
- Validation: manual — type validated against DOC_TYPES allowlist
- Data: delegated to publishDocument() lib; event: system.content.document_published; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/site/docs/[type]/[slug]   (file: frontend/app/api/admin/site/docs/[type]/[slug]/route.ts)
- Use: Get a documentation page (draft or published)
- Auth/Role: master_admin (via requireAdmin)
- Validation: none on type/slug params (no allowlist check unlike save)
- Data: delegated to getDocument() lib; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ No type/slug validation; not-found throws return 500 not 404 (depends on lib behavior)

### POST /api/admin/site/docs/[type]/[slug]/save   (file: frontend/app/api/admin/site/docs/[type]/[slug]/save/route.ts)
- Use: Save a documentation page draft
- Auth/Role: master_admin (via requireAdmin)
- Validation: manual — type validated against DOC_TYPES
- Data: delegated to saveDocumentDraft() lib; event: system.content.document_saved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/site/docs   (file: frontend/app/api/admin/site/docs/route.ts)
- Use: List all documentation pages
- Auth/Role: master_admin (via requireAdmin)
- Validation: none
- Data: delegated to listDocuments() lib; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/site/pages/[pageKey]/publish   (file: frontend/app/api/admin/site/pages/[pageKey]/publish/route.ts)
- Use: Publish a CMS page draft to live; triggers Next.js revalidation
- Auth/Role: master_admin (via requireAdmin)
- Validation: manual — pageKey validated against SEED_PAGE_KEYS
- Data: delegated to publishPage() lib; event: system.content.page_published; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active (CMS is ACTIVE, not dormant — contradicts "CMS dormant V1" claim)

### GET /api/admin/site/pages/[pageKey]   (file: frontend/app/api/admin/site/pages/[pageKey]/route.ts)
- Use: Get a CMS page (draft or published)
- Auth/Role: master_admin (via requireAdmin)
- Validation: none — no pageKey allowlist check
- Data: delegated to getPage() lib; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/site/pages/[pageKey]/save   (file: frontend/app/api/admin/site/pages/[pageKey]/save/route.ts)
- Use: Save a CMS page draft
- Auth/Role: master_admin (via requireAdmin)
- Validation: manual — pageKey against SEED_PAGE_KEYS; content required
- Data: delegated to saveDraft() lib; event: system.content.page_saved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/site/pages/[pageKey]/versions   (file: frontend/app/api/admin/site/pages/[pageKey]/versions/route.ts)
- Use: List version history for a CMS page
- Auth/Role: master_admin (via requireAdmin)
- Validation: none — no pageKey allowlist
- Data: delegated to getVersions() lib; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET /api/admin/site/pages   (file: frontend/app/api/admin/site/pages/route.ts)
- Use: List all CMS pages with draft/published status
- Auth/Role: master_admin (via requireAdmin)
- Validation: none
- Data: delegated to listPages() lib; no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/site/upload-image   (file: frontend/app/api/admin/site/upload-image/route.ts)
- Use: Upload image to S3 under cms/ prefix for CMS page builder
- Auth/Role: master_admin (via requireAdmin)
- Validation: manual — file type whitelist, 10MB limit
- Data: no SQL; S3 storage (cms/images/); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ requireAdmin() called OUTSIDE outer try/catch

### GET /api/admin/sources/[profileId]/diffs   (file: frontend/app/api/admin/sources/[profileId]/diffs/route.ts)
- Use: List content diffs for a source profile (new/changed solicitations found by scout)
- Auth/Role: master_admin or rfp_admin
- Validation: manual — profileId UUID
- Data: source_diffs (r/w), source_regions (r); event: finder.source_diff.reviewed (PATCH only); no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: Route file supports GET and PATCH (filename says diffs but PATCH reviews/dismisses diffs)

### POST /api/admin/sources/[profileId]/expand-topics   (file: frontend/app/api/admin/sources/[profileId]/expand-topics/route.ts)
- Use: Queue a pipeline job to expand/re-scan topics for a source profile
- Auth/Role: master_admin or rfp_admin
- Validation: manual — profileId UUID
- Data: source_profiles (r), curated_solicitations (r), opportunities (r), pipeline_jobs (w); event: finder.source.topics_expand_triggered; jobs: enqueues pipeline_job (kind=expand_topics)
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/sources/[profileId]/paste-import   (file: frontend/app/api/admin/sources/[profileId]/paste-import/route.ts)
- Use: Import topics from pasted text/structured data into a source profile
- Auth/Role: master_admin or rfp_admin
- Validation: manual — profileId UUID; body structure validated
- Data: source_profiles (r), curated_solicitations (r), opportunities (r/w), source_visits (w); event: finder.topic.imported; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: Per-row insert failures silently skipped to skipped[] array — partial failures invisible to caller

### DELETE /api/admin/sources/[profileId]/regions/[regionId]   (file: frontend/app/api/admin/sources/[profileId]/regions/[regionId]/route.ts)
- Use: Soft-delete a source region
- Auth/Role: master_admin or rfp_admin
- Validation: manual — both UUIDs
- Data: source_regions (w); event: finder.source_region.deleted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ sql UPDATE (line 56) NOT inside try/catch — only outer handler catches it

### GET, POST /api/admin/sources/[profileId]/regions   (file: frontend/app/api/admin/sources/[profileId]/regions/route.ts)
- Use: List/create regions (URL patterns) within a source profile
- Auth/Role: master_admin or rfp_admin
- Validation: manual — UUID; url and name required for POST
- Data: source_regions (r/w), source_profiles (r); event: finder.source_region.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### PATCH /api/admin/sources/[profileId]   (file: frontend/app/api/admin/sources/[profileId]/route.ts)
- Use: Update a source profile (name, url, schedule, settings)
- Auth/Role: master_admin or rfp_admin
- Validation: manual — UUID; partial update via COALESCE pattern
- Data: source_profiles (r/w); event: finder.source.updated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/sources/[profileId]/scout   (file: frontend/app/api/admin/sources/[profileId]/scout/route.ts)
- Use: Trigger a scout pipeline job for a source profile
- Auth/Role: master_admin or rfp_admin
- Validation: manual — UUID
- Data: source_profiles (r), pipeline_jobs (w); event: finder.source.scout_triggered; jobs: enqueues pipeline_job (kind=scout)
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Both sql calls (lines 59, 83) NOT inside try/catch; dangling emitEventStart if DB fails

### POST /api/admin/sources/[profileId]/visit   (file: frontend/app/api/admin/sources/[profileId]/visit/route.ts)
- Use: Record a manual admin visit to a source profile URL
- Auth/Role: master_admin or rfp_admin
- Validation: manual — UUID
- Data: source_profiles (r/w), source_visits (w); event: finder.source.visited; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/sources   (file: frontend/app/api/admin/sources/route.ts)
- Use: List all source profiles (with stats); create new source profile
- Auth/Role: master_admin or rfp_admin
- Validation: manual — name and url required for POST
- Data: source_profiles (r/w), source_visits (r), source_diffs (r), source_regions (r); event: finder.source.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST, PUT, PATCH, DELETE /api/admin/storage   (file: frontend/app/api/admin/storage/route.ts)
- Use: S3 file browser — list/upload/rename/move/delete files in S3; auto-ingest SBIR uploads
- Auth/Role: master_admin or rfp_admin
- Validation: manual — prefix sanitization; file type; 500MB limit; dedup hash check
- Data: system_events (r — dedup check); S3 storage; event: system.file.uploaded/renamed/deleted/ingested; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ POST dedup hash sql query (line 220) not in try/catch; PATCH second HeadObject not in try/catch

### GET /api/admin/system   (file: frontend/app/api/admin/system/route.ts)
- Use: System capacity metrics — queue depth, event rates, recent errors, tool stats
- Auth/Role: master_admin (strict)
- Validation: none
- Data: via capacity lib (agent_task_queue, system_events, etc.); no events; no jobs
- Response: {data}✓ (via withHandler) ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, POST /api/admin/tasks   (file: frontend/app/api/admin/tasks/route.ts)
- Use: List open tasks for admin actor; mark a task complete
- Auth/Role: rfp_admin+
- Validation: manual — taskId required for POST
- Data: delegated to listOpenTasksForActor/completeTask lib; no direct SQL; no events directly
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active

### GET, PATCH /api/admin/tenants/[tenantId]   (file: frontend/app/api/admin/tenants/[tenantId]/route.ts)
- Use: Get tenant detail with counts; update tenant status/settings
- Auth/Role: rfp_admin+
- Validation: manual — UUID; PATCH fields type-checked
- Data: tenants (r/w), users (r), proposals (r), tenant_pipeline_items (r), purchases (r); event: finder.tenant.updated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin (admin viewing any tenant)
- Status: ✅active

### GET /api/admin/tenants   (file: frontend/app/api/admin/tenants/route.ts)
- Use: List all tenants with optional search/status filter and user/proposal counts
- Auth/Role: rfp_admin+
- Validation: manual — ILIKE patterns correctly escaped; POST is 501 stub
- Data: tenants (r), users (r subquery), proposals (r subquery); no events; no jobs
- Response: {data}✓ ; {error,code}✓ ; POST returns {error,code} 501
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ GET: all 4 sql branches NOT inside try/catch (only outer catch)

### PATCH /api/admin/topics/[id]   (file: frontend/app/api/admin/topics/[id]/route.ts)
- Use: Update a topic/opportunity record (title, tech_focus_areas, etc.)
- Auth/Role: master_admin or rfp_admin
- Validation: manual — UUID; partial update
- Data: opportunities (w); event: finder.topic.updated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ request.json() NOT in try/catch (unguarded JSON parse); emitEventSingle NOT in try/catch

### POST /api/admin/upload-topic-files   (file: frontend/app/api/admin/upload-topic-files/route.ts)
- Use: Upload files (templates/attachments) for a specific topic under a solicitation
- Auth/Role: master_admin or rfp_admin
- Validation: manual — solicitationId UUID; file type; size limit
- Data: curated_solicitations (r), solicitation_documents (r/w); event: finder.topic_file.uploaded; S3 storage; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ emitEventSingle NOT in try/catch — emission failure causes 500 after successful upload

### GET /api/admin/waitlist   (file: frontend/app/api/admin/waitlist/route.ts)
- Use: List waitlist entries with optional search; total count
- Auth/Role: rfp_admin+
- Validation: manual — ILIKE pattern escaped; limit clamped 1–500
- Data: waitlist (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Both sql branches NOT inside try/catch (only outer catch)

### POST /api/admin/workflows/[instanceId]/advance   (file: frontend/app/api/admin/workflows/[instanceId]/advance/route.ts)
- Use: Admin force-advance a process instance to next step
- Auth/Role: rfp_admin+
- Validation: manual — UUID
- Data: delegated to forceAdvanceProcess lib (process_instances w, transitions w); no direct events
- Response: {data}✓ ; {error,code}✓ (uses ADVANCE_ERROR code on 500)
- Tenant scope: N/A admin
- Status: ✅active

### POST /api/admin/workflows/[instanceId]/cancel   (file: frontend/app/api/admin/workflows/[instanceId]/cancel/route.ts)
- Use: Cancel a running process instance
- Auth/Role: rfp_admin+
- Validation: manual — UUID
- Data: process_instances (w), process_instance_transitions (w) via sql.begin; event: system.workflow.instance_cancelled; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ sql.begin() NOT in inner try/catch

### POST /api/admin/workflows/[instanceId]/retry   (file: frontend/app/api/admin/workflows/[instanceId]/retry/route.ts)
- Use: Retry a failed/errored process instance
- Auth/Role: rfp_admin+
- Validation: manual — UUID
- Data: process_instances (r/w), process_instance_transitions (w) via sql.begin; event: system.workflow.instance_retried; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ sql.begin() NOT in inner try/catch

### GET /api/admin/workflows/[instanceId]   (file: frontend/app/api/admin/workflows/[instanceId]/route.ts)
- Use: Get process instance detail with transition history
- Auth/Role: rfp_admin+
- Validation: manual — UUID
- Data: process_instances (r), process_instance_transitions (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ Both sql calls NOT inside try/catch (only outer catch)

### GET, POST /api/admin/workflows   (file: frontend/app/api/admin/workflows/route.ts)
- Use: List active/recent process instances; launch a workflow template
- Auth/Role: rfp_admin+
- Validation: manual — ?active=true / ?hours param (clamped 1–168); POST requires templateId
- Data: process_instances (r); delegated to launchTemplate lib for POST; no direct events
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A admin
- Status: ✅active
- Notes: ⚠️ GET sql calls NOT inside try/catch; `${hours} hours` string interpolation in interval (safe due to clamping but unidiomatic)

---

## DOMAIN: portal/*

### GET, PATCH /api/portal/[tenantSlug]/agents/config   (file: frontend/app/api/portal/[tenantSlug]/agents/config/route.ts)
- Use: Get/update tenant agent configuration (STUB — returns 501)
- Auth/Role: tenant_admin
- Validation: N/A (stub)
- Data: none (stub — TODO P2-18)
- Response: {data}✗ (stub returns error); {error,code}✓
- Tenant scope: verified (getTenantBySlug + verifyTenantAccess)
- Status: ⚠️stale (P2-18 TODO stub — no implementation)

### GET /api/portal/[tenantSlug]/agents/memories   (file: frontend/app/api/portal/[tenantSlug]/agents/memories/route.ts)
- Use: List tenant agent memories (episodic + semantic) for admin view
- Auth/Role: tenant_admin
- Validation: none
- Data: episodic_memories (r), semantic_memories (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET /api/portal/[tenantSlug]/agents/performance   (file: frontend/app/api/portal/[tenantSlug]/agents/performance/route.ts)
- Use: Agent task queue metrics for tenant (counts by status)
- Auth/Role: tenant_admin
- Validation: none
- Data: agent_task_queue (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET /api/portal/[tenantSlug]/agents/usage   (file: frontend/app/api/portal/[tenantSlug]/agents/usage/route.ts)
- Use: Tenant agent usage stats — summary, by-agent, recent activity
- Auth/Role: tenant_admin
- Validation: manual — ?period whitelist {7d,30d,90d}
- Data: agent_task_log (r), tenant_agent_config (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET /api/portal/[tenantSlug]/dashboard   (file: frontend/app/api/portal/[tenantSlug]/dashboard/route.ts)
- Use: Tenant portal home — tenant info, proposal stats, recent proposals, recent activity
- Auth/Role: tenant_user+
- Validation: none
- Data: tenants (r), proposals (r), tenant_pipeline_items (r), library_units (r), users (r), system_events (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active (critical path — portal home)
- Notes: ⚠️ All 6 sql calls inside single try/catch (not individual per SOP)

### GET, PATCH, DELETE, POST /api/portal/[tenantSlug]/library/[unitId]   (file: frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts)
- Use: Get/update/delete/re-atomize a library unit
- Auth/Role: GET/PATCH: tenant_user; DELETE/POST: tenant_admin
- Validation: manual — UUID; PATCH content validated; POST trigger validated
- Data: library_units (r/w); events: library.unit.updated/deleted/document.reatomized; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (all queries include tenant_id)
- Status: ✅active
- Notes: ⚠️ Re-atomize parent UPDATE (step 6) has no tenant_id guard in WHERE clause (minor — unitId already tenant-verified)

### POST /api/portal/[tenantSlug]/library/atomize   (file: frontend/app/api/portal/[tenantSlug]/library/atomize/route.ts)
- Use: Atomize a library document into semantic chunks (library units)
- Auth/Role: tenant_user+
- Validation: manual — unitId UUID
- Data: library_units (r/w); event: library.document.atomized; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/library   (file: frontend/app/api/portal/[tenantSlug]/library/route.ts)
- Use: List library units with filters/search; bulk operations (approve/archive/delete/categorize/tag)
- Auth/Role: GET: tenant_user; POST: tenant_admin
- Validation: manual — ILIKE escaped; action whitelist; unitIds array validated
- Data: library_units (r/w), proposals (r); events: library.unit.approved/archived/deleted/categorized/tagged; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST /api/portal/[tenantSlug]/library/upload   (file: frontend/app/api/portal/[tenantSlug]/library/upload/route.ts)
- Use: Upload files to tenant library (creates library_unit records + S3 upload)
- Auth/Role: tenant_user+
- Validation: manual — file type, size
- Data: library_units (w); event: library.file.uploaded; S3 storage; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ emitEventSingle NOT in try/catch; S3 success + DB failure orphans S3 file

### GET /api/portal/[tenantSlug]/notifications   (file: frontend/app/api/portal/[tenantSlug]/notifications/route.ts)
- Use: Tenant notification feed — recent events from system_events filtered to tenant
- Auth/Role: tenant_user+
- Validation: none
- Data: system_events (r); no events emitted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: is_read hardcoded false (V1 limitation documented)

### POST /api/portal/[tenantSlug]/opportunities/[opportunityId]/actions   (file: frontend/app/api/portal/[tenantSlug]/opportunities/[opportunityId]/actions/route.ts)
- Use: Single opportunity action (pin/unpin/thumb_up/thumb_down/pursue)
- Auth/Role: tenant_user+
- Validation: manual — UUID; action whitelist
- Data: tenant_pipeline_items (r/w); events: capture.opportunity.pinned/unpinned/thumbed_up/thumbed_down/pursued; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: 'pursue' action returns early before event emission — no event emitted for pursue (inconsistency with map)

### GET /api/portal/[tenantSlug]/opportunities/[opportunityId]/documents   (file: frontend/app/api/portal/[tenantSlug]/opportunities/[opportunityId]/documents/route.ts)
- Use: List solicitation documents for an opportunity (access-gated by purchase or pin)
- Auth/Role: tenant_user+
- Validation: manual — UUID
- Data: tenant_pipeline_items (r), purchases (r), solicitation_documents (r), opportunities (r); no events; no jobs; S3 signed URLs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/opportunities   (file: frontend/app/api/portal/[tenantSlug]/opportunities/route.ts)
- Use: List tenant opportunities with filters; bulk pin/unpin/pursue/pass/monitor
- Auth/Role: tenant_user+
- Validation: manual — ILIKE escaped; action whitelist for POST bulk
- Data: tenant_pipeline_items (r/w), opportunities (r), curated_solicitations (r); no events on bulk POST; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active (critical path — opportunity browser)
- Notes: ⚠️ POST bulk emits no events (inconsistent with single-action /actions endpoint)

### POST /api/portal/[tenantSlug]/processes/[instanceId]/advance   (file: frontend/app/api/portal/[tenantSlug]/processes/[instanceId]/advance/route.ts)
- Use: Tenant-scoped force-advance of a process instance (delegates to lib)
- Auth/Role: tenant_admin
- Validation: manual — UUID
- Data: delegated to forceAdvanceProcess lib; events delegated; no direct jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (tenantId passed into lib actor)
- Status: ✅active

### GET, PATCH /api/portal/[tenantSlug]/profile   (file: frontend/app/api/portal/[tenantSlug]/profile/route.ts)
- Use: Get/update tenant profile (company info, billing email, description)
- Auth/Role: GET: any tenant member (no minimum); PATCH: tenant_admin (manual string check)
- Validation: manual — string lengths checked for PATCH fields
- Data: tenants (r/w), tenant_profiles (r/w upsert); event: capture.profile.updated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ GET has no role minimum (partner_user can read billing_email); PATCH uses manual role string comparison instead of hasRoleAtLeast; GET tenant query missing ::uuid cast

### GET /api/portal/[tenantSlug]/proposals/[proposalId]/activity   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/activity/route.ts)
- Use: Proposal activity feed with optional type/actor filters
- Auth/Role: tenant_user+
- Validation: manual — UUID; ?type/?actor query params
- Data: proposals (r), proposal_collaborators (r), proposal_activity_log (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/advance/route.ts)
- Use: Advance proposal stage with gate requirement check; auto-locks on submitted stage
- Auth/Role: tenant_admin
- Validation: manual — UUID; targetStage whitelist; gate checks
- Data: proposals (r/w), stage_gate_requirements (r), proposal_sections (r/w), stage_completion_snapshots (w), canvas_versions (w), proposal_stage_history (w), proposal_activity_log (w) — all in sql.begin tx; event: proposal.proposal.advanced; no jobs
- Response: {data}✓ ; {error,code}✓ including GATE_REQUIREMENTS_NOT_MET with details.unmet
- Tenant scope: verified
- Status: ✅active (critical path — proposal lifecycle)

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/compliance/route.ts)
- Use: AI-powered compliance check of a proposal section against solicitation requirements
- Auth/Role: tenant_user+
- Validation: manual — UUID; sectionId; ANTHROPIC_API_KEY check
- Data: proposals (r), proposal_sections (r), solicitation_compliance (r), compliance_variables (r); event: proposal.compliance.checked; calls Anthropic API (claude-haiku-4-5-20251001)
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ Claude response status field not validated before counting; model ID hardcoded (claude-haiku-4-5-20251001)

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft/route.ts)
- Use: Queue a draft generation request for proposal sections (thin — actual drafting is client-side)
- Auth/Role: tenant_user+
- Validation: manual — UUIDs; sectionIds array
- Data: proposals (r), proposal_sections (r), proposal_activity_log (w); event: proposal.proposal.draft_requested; no jobs enqueued directly
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/review   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/ai/review/route.ts)
- Use: Queue an AI review request for proposal sections
- Auth/Role: tenant_user+
- Validation: manual — UUIDs; sectionIds array
- Data: proposals (r), proposal_sections (r), proposal_activity_log (w); event: proposal.proposal.review_requested; no jobs enqueued directly
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ event emission failure returns code:'DB_ERROR' — wrong code for event failure

### DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/[collaboratorId]   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/[collaboratorId]/route.ts)
- Use: Revoke all stage access for a collaborator and remove from proposal
- Auth/Role: tenant_admin
- Validation: manual — UUIDs; proposal ownership verified
- Data: proposal_collaborators (r/w), proposals (r), collaborator_stage_access (w); event: proposal.collaborator.access_revoked; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (proposal JOIN on tenant_id)
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/collaborators/route.ts)
- Use: List collaborators; invite a partner collaborator with stage-scoped access
- Auth/Role: GET: any tenant member; POST: tenant_admin
- Validation: manual — UUIDs; email validated; stage access array
- Data: proposals (r), proposal_collaborators (r/w), collaborator_stage_access (r/w), users (r/w), proposal_activity_log (w); events: proposal.collaborator.invited, system.email.invite_delivered; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ POST proposal lookup (line 235) and existing-collaborator check (line 245) are outside try/catch

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/comments/[commentId]/resolve   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/comments/[commentId]/resolve/route.ts)
- Use: Mark a comment as resolved
- Auth/Role: any tenant member (isRole check, no minimum)
- Validation: manual — UUIDs
- Data: proposals (r), proposal_comments (w), proposal_activity_log (w); event: proposal.comment.resolved; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/proposals/[proposalId]/comments   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/comments/route.ts)
- Use: List/add comments on a proposal section
- Auth/Role: any tenant member (isRole check, no minimum)
- Validation: manual — UUIDs; content required
- Data: proposals (r), proposal_comments (r/w), users (r), proposal_activity_log (w); event: proposal.comment.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (proposal scoped by tenant_id)
- Status: ✅active

### GET /api/portal/[tenantSlug]/proposals/[proposalId]/compliance   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/compliance/route.ts)
- Use: Get compliance matrix for a proposal (from S3 snapshot or DB fallback)
- Auth/Role: any tenant member (isRole check, no minimum)
- Validation: manual — UUIDs
- Data: proposals (r), proposal_compliance_matrix (r fallback); no events; no jobs; S3 read
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ Primary proposal lookup (line 49) outside try/catch — unguarded await sql

### GET, POST, DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/dropbox   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/dropbox/route.ts)
- Use: Tenant file dropbox for a proposal — list/upload/delete working documents in S3
- Auth/Role: any tenant member
- Validation: manual — UUIDs; key prefix scoping (cross-tenant guard)
- Data: proposals (r); events: proposal.proposal.dropbox_file_uploaded/deleted; S3 storage; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ POST proposal lookup (line 161) outside try/catch

### GET, POST, PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/gates   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/gates/route.ts)
- Use: Manage stage gate requirements — list gates; create custom gate; toggle gate completion
- Auth/Role: GET: tenant_user+; POST/PATCH: tenant_admin
- Validation: manual — UUIDs; stage whitelist; title required
- Data: proposals (r), stage_gate_requirements (r/w), proposal_collaborators (r); events: proposal.gate_requirement.created/toggled; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST, DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/lock   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/lock/route.ts)
- Use: Lock (finalize) / unlock a proposal; lock_count>=2 requires rfp_admin escalation; unlock notifies team
- Auth/Role: POST: tenant_admin (escalates to rfp_admin for lock_count>=2); DELETE: tenant_admin
- Validation: manual — UUID on POST; DELETE missing isValidUUID check
- Data: proposals (r/w), opportunities (r), proposal_stage_history (w), proposal_activity_log (w), users (r), tenants (r), process_instances (w); events: proposal.proposal.locked/unlocked/ready_for_customer; no jobs (process_instance created)
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (all proposal queries include tenant_id)
- Status: ✅active (critical path — finalization)
- Notes: ⚠️ DELETE proposalId not validated with isValidUUID

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/outcome   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/outcome/route.ts)
- Use: Record a proposal outcome (won/lost/no_bid) with feedback; creates library atom outcomes
- Auth/Role: tenant_admin
- Validation: manual — UUID; outcome whitelist; OCC version check
- Data: proposals (r/w), proposal_stage_history (w), library_units (w), library_atom_outcomes (w), proposal_activity_log (w); event: proposal.outcome.recorded; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (all queries include tenant_id)
- Status: ✅active

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/package   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/package/route.ts)
- Use: Export full proposal package — all sections combined into a DOCX bundle or JSON manifest
- Auth/Role: tenant_user+
- Validation: manual — UUIDs; format whitelist; auth NOT strictly first (format/UUID checked before session)
- Data: proposals (r/w), proposal_sections (r), solicitation_compliance (r), proposal_supporting_docs (r), proposal_activity_log (w); events: proposal.package.export_started/exported; no jobs; S3 or binary output
- Response: {data} or binary; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ Auth check is not strictly first — input params parsed before session check

### GET, POST /api/portal/[tenantSlug]/proposals/[proposalId]/reviews   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/reviews/route.ts)
- Use: List/create color-team reviews for a proposal
- Auth/Role: GET: tenant_user+; POST: tenant_admin
- Validation: manual — UUIDs; reviewType whitelist
- Data: proposals (r), proposal_comments (r), users (r), proposal_stage_history (r/w); event: proposal.review.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET /api/portal/[tenantSlug]/proposals/[proposalId]   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/route.ts)
- Use: Get full proposal detail — proposal + opportunity + sections + collaborators + supporting docs + stage snapshots
- Auth/Role: any tenant member (isRole check)
- Validation: manual — UUIDs
- Data: proposals (r), opportunities (r), curated_solicitations (r), proposal_sections (r), users (r), proposal_supporting_docs (r), stage_completion_snapshots (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active (critical path — proposal workspace)

### POST /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export/route.ts)
- Use: Export a single proposal section to docx/pptx/xlsx binary
- Auth/Role: any role with tenant access (no minimum)
- Validation: manual — UUIDs; format whitelist; document object required
- Data: proposals (r/w — download_count), proposal_sections (r); event: proposal.section.exported; no jobs
- Response: binary on success; {error,code}✓ on errors
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ emitEventSingle (line 182) NOT in try/catch; no minimum role check (partner_user can export)

### PUT /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save/route.ts)
- Use: Save canvas JSON content to a proposal section; OCC version check; creates canvas_versions snapshot
- Auth/Role: any tenant member; non-admins must have collaborator edit permission on current stage
- Validation: manual — UUIDs; content object required; OCC version validated
- Data: proposals (r), proposal_sections (r/w), canvas_versions (w), proposal_collaborators (r), collaborator_stage_access (r), proposal_activity_log (w); event: proposal.section.saved; no jobs
- Response: {data}✓ ; {error,code}✓ including CONFLICT with currentVersion
- Tenant scope: verified
- Status: ✅active (critical path — auto-save)
- Notes: ⚠️ emitEventSingle (line 300) NOT in try/catch

### GET /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/versions/route.ts)
- Use: List canvas version history for a section; includes author info
- Auth/Role: tenant_user+; non-admins additionally checked as collaborator
- Validation: manual — UUIDs
- Data: proposals (r), proposal_sections (r), canvas_versions (r), users (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET /api/portal/[tenantSlug]/proposals/[proposalId]/sections   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/route.ts)
- Use: List all sections for a proposal
- Auth/Role: any tenant member (isRole check)
- Validation: manual — UUIDs
- Data: proposals (r), proposal_sections (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ Two sql calls (lines 49, 62) NOT inside try/catch (only outer catch)

### GET, PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/stage   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/stage/route.ts)
- Use: Get current proposal stage; PATCH manual stage transition (alternative to /advance)
- Auth/Role: GET: any tenant member; PATCH: tenant_admin
- Validation: manual — UUIDs; targetStage whitelist; OCC version check
- Data: proposals (r/w), proposal_stage_history (r/w); event: proposal.proposal.stage_advanced; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ PATCH: stage history INSERT failure causes misleading 500 even though stage was already updated; overlap in purpose with /advance route

### GET, PATCH, DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/[docId]/route.ts)
- Use: Get/update-status/delete a single supporting document with state machine transitions
- Auth/Role: GET/DELETE: tenant_user+; PATCH: tenant_user+ (tenant_admin for approved/waived)
- Validation: manual — UUIDs; status transition whitelist
- Data: proposal_supporting_docs (r/w), proposal_collaborators (r); events: proposal.supporting_doc.status_changed/deleted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (all queries include tenant_id AND proposal_id)
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs   (file: frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/route.ts)
- Use: List/upload supporting documents for a proposal
- Auth/Role: tenant_user+
- Validation: manual — UUIDs; MIME type allowlist
- Data: proposals (r), proposal_supporting_docs (r/w), proposal_collaborators (r), solicitation_compliance (r); event: proposal.supporting_doc.uploaded; S3 storage; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST /api/portal/[tenantSlug]/proposals/create   (file: frontend/app/api/portal/[tenantSlug]/proposals/create/route.ts)
- Use: Create a new proposal (checks purchase gate, creates all child records in transaction)
- Auth/Role: tenant_admin
- Validation: manual — UUID; opportunityId required; duplicate check; FOUNDING_COHORT_BYPASS gate
- Data: proposals (w), proposal_sections (w), proposal_supporting_docs (w), opportunities (r), solicitation_compliance (r), solicitation_documents (r), users (r), process_instances (w), purchases (r/w), proposal_activity_log (w) via sql.begin tx; events: proposal.proposal.created, system.email.admin_alert_delivered; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active (critical path — proposal creation)

### GET /api/portal/[tenantSlug]/proposals   (file: frontend/app/api/portal/[tenantSlug]/proposals/route.ts)
- Use: List tenant proposals with optional stage/search filter; POST is stub returning 400
- Auth/Role: GET: tenant_user+
- Validation: manual — ILIKE escaped; stage whitelist
- Data: proposals (r), opportunities (r), proposal_sections (r subquery count); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active (critical path — proposal list)

### GET /api/portal/[tenantSlug]/purchases   (file: frontend/app/api/portal/[tenantSlug]/purchases/route.ts)
- Use: List tenant purchases with proposal/opportunity details
- Auth/Role: tenant_admin
- Validation: none
- Data: purchases (r), proposals (r), opportunities (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### POST, DELETE /api/portal/[tenantSlug]/spotlight/pin   (file: frontend/app/api/portal/[tenantSlug]/spotlight/pin/route.ts)
- Use: Pin/unpin an opportunity to a spotlight (adds/removes from tenant_pipeline_items)
- Auth/Role: tenant_user+
- Validation: zod — body schema validated; UUID validated
- Data: opportunities (r), tenant_pipeline_items (w); events: capture.topic.pinned/unpinned; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ Main SQL operations not in individual try/catch (only outer catch); uses zod (only route in portal/* that does)

### GET, PATCH, DELETE /api/portal/[tenantSlug]/spotlights/[spotlightId]   (file: frontend/app/api/portal/[tenantSlug]/spotlights/[spotlightId]/route.ts)
- Use: Get/update/delete a saved search spotlight
- Auth/Role: GET: tenant_user+; PATCH/DELETE: tenant_admin
- Validation: manual — UUID; PATCH field type checks
- Data: spotlights (r/w); events: capture.spotlight.updated/deleted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified (all queries include tenant_id)
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/spotlights   (file: frontend/app/api/portal/[tenantSlug]/spotlights/route.ts)
- Use: List/create saved search spotlights
- Auth/Role: GET: tenant_user+; POST: tenant_admin
- Validation: manual — name and criteria required
- Data: spotlights (r/w); event: capture.saved_search.created; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/tasks   (file: frontend/app/api/portal/[tenantSlug]/tasks/route.ts)
- Use: List open tasks for tenant actor; complete a task
- Auth/Role: tenant_user+
- Validation: manual — taskId for POST
- Data: delegated to lib functions; events delegated; tenantId passed in actor
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active

### GET, POST /api/portal/[tenantSlug]/team   (file: frontend/app/api/portal/[tenantSlug]/team/route.ts)
- Use: List team members; invite a new team member (creates user, sends invite email)
- Auth/Role: GET: tenant_user+; POST: tenant_admin
- Validation: manual — email; role whitelist
- Data: users (r/w); events: capture.team_member.invited, system.email.team_invite_delivered; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ GET returns `{ data: members[] }` (flat array) instead of `{ data: { members: [] } }` — shape inconsistency with rest of portal

### POST /api/portal/[tenantSlug]/uploads   (file: frontend/app/api/portal/[tenantSlug]/uploads/route.ts)
- Use: Upload documents to tenant library via portal (creates library_unit + S3 upload)
- Auth/Role: tenant_user+
- Validation: manual — file type, size
- Data: library_units (r/w); event: library.unit.uploaded; S3 storage; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: verified
- Status: ✅active
- Notes: ⚠️ DB failure after S3 success returns STORAGE_ERROR (wrong code); emitEventSingle inside STORAGE_ERROR catch block (wrong error code if event fails)

---

## DOMAIN: public/* and shared/*

### POST /api/analytics/pageview   (file: frontend/app/api/analytics/pageview/route.ts)
- Use: Record a page view event and upsert visitor session (anonymous analytics)
- Auth/Role: none — public
- Validation: manual — sanitize path/referrer
- Data: page_views (r/w), visitor_sessions (r/w); no events; no jobs
- Response: {ok:true} (not {data} wrapper); {error,code}✓ on errors
- Tenant scope: N/A public
- Status: ✅active
- Notes: Documented exception — returns {ok:true} not {data}

### POST /api/applications   (file: frontend/app/api/applications/route.ts)
- Use: Public application submission (company applies for platform access)
- Auth/Role: none — public
- Validation: manual — required fields; email format; ILIKE domain escaped; duplicate detection
- Data: users (r), applications (r/w); event: capture.application.submitted; no jobs
- Response: {data:{id}}✓ ; {error,code}✓ including details on validation
- Tenant scope: N/A public
- Status: ✅active

### GET, POST /api/auth/[...nextauth]   (file: frontend/app/api/auth/[...nextauth]/route.ts)
- Use: NextAuth.js authentication handlers (login, session, signout, callbacks)
- Auth/Role: N/A — is the auth provider
- Validation: delegated to NextAuth + @/auth config
- Data: delegated to @/auth internals (users table)
- Response: delegated
- Tenant scope: N/A
- Status: ✅active (critical path)

### POST /api/auth/change-password   (file: frontend/app/api/auth/change-password/route.ts)
- Use: Change password for authenticated user (requires current password)
- Auth/Role: any authenticated user (via withHandler + requireAuth)
- Validation: manual — currentPassword, newPassword required; strength check
- Data: users (r/w); event: identity.user.password_changed; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A identity
- Status: ✅active

### POST /api/auth/forgot-password   (file: frontend/app/api/auth/forgot-password/route.ts)
- Use: Initiate password reset — always returns success to prevent email enumeration
- Auth/Role: none — public
- Validation: manual — email format
- Data: users (r); event: identity.password.reset_requested; no jobs
- Response: {data:{sent:true}} always (intentional for enumeration defense); {error,code}✓ only outer 500
- Tenant scope: N/A public
- Status: ✅active

### POST /api/auth/reset-password   (file: frontend/app/api/auth/reset-password/route.ts)
- Use: Complete password reset using a token
- Auth/Role: none — token-based
- Validation: manual — token and password required; token expiry check
- Data: users (r/w); event: identity.password.reset_completed; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A public
- Status: ✅active

### POST /api/cms/revalidate   (file: frontend/app/api/cms/revalidate/route.ts)
- Use: Trigger Next.js on-demand revalidation for a CMS page path
- Auth/Role: REVALIDATE_SECRET header OR rfp_admin/master_admin session
- Validation: manual — path required; secret or session
- Data: none (revalidatePath only); event: system.content.page_revalidated; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A
- Status: ✅active
- Notes: ⚠️ 500 uses code:'DB_ERROR' but no DB is involved; CMS is ACTIVE — contradicts "CMS dormant" claim

### POST /api/consent   (file: frontend/app/api/consent/route.ts)
- Use: Record user consent (terms of service, privacy policy, marketing)
- Auth/Role: any authenticated user
- Validation: manual — consentType whitelist; accepted boolean
- Data: consent_records (w), users (w conditional); event: identity.consent.recorded; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A identity
- Status: ✅active
- Notes: ⚠️ consent_records INSERT and users UPDATE in same try/catch — no transaction, so partial failure leaves inconsistent state

### GET /api/content/[slug]   (file: frontend/app/api/content/[slug]/route.ts)
- Use: Public content endpoint — fetch a published CMS article by slug
- Auth/Role: none — public
- Validation: none (slug from path)
- Data: cms_content (r); no events; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A public
- Status: ✅active

### GET, POST /api/events   (file: frontend/app/api/events/route.ts)
- Use: GET — list system events (tenant-scoped for non-admins); POST — admin manual event write
- Auth/Role: GET: any authenticated user; POST: rfp_admin+
- Validation: manual — namespace, type, phase required for POST
- Data: system_events (r/w); no events emitted via this route; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A (route enforces tenant filter for non-admins)
- Status: ✅active

### GET /api/health   (file: frontend/app/api/health/route.ts)
- Use: Liveness/readiness probe — checks DB connectivity, returns version/uptime
- Auth/Role: none — public
- Validation: none
- Data: runs SELECT 1 (health check only); no events; no jobs
- Response: {ok,version,environment,uptimeMs,checks} — intentional SOP exception (no {data} wrapper)
- Tenant scope: N/A public
- Status: ✅active

### GET, POST /api/invite   (file: frontend/app/api/invite/route.ts)
- Use: GET — validate invite token and return proposal info; POST — accept invite, set password
- Auth/Role: none — invite token is the credential
- Validation: manual — token required; password required for POST
- Data: proposal_collaborators (r/w), users (w), proposals (r), tenants (r); event: identity.invite_accepted; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A (invite flow — not tenant-scoped)
- Status: ✅active
- Notes: ⚠️ Event type 'identity.invite_accepted' with namespace 'identity' → effective path is identity.identity.invite_accepted — type should be 'invite.accepted'; POST missing DB transaction (user + collaborator updates separate — partial failure leaves broken state)

### POST /api/stripe/checkout   (file: frontend/app/api/stripe/checkout/route.ts)
- Use: Create a Stripe checkout session for a proposal purchase
- Auth/Role: tenant_admin+
- Validation: manual — proposalId, productType, priceId required
- Data: tenants (r); event: capture.checkout.started; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A (Stripe, not tenant-scoped portal route)
- Status: ✅active (critical path — monetization)
- Notes: ⚠️ tenants SELECT NOT in try/catch

### POST /api/stripe/portal   (file: frontend/app/api/stripe/portal/route.ts)
- Use: Create a Stripe billing portal session for subscription management
- Auth/Role: tenant_admin+
- Validation: manual — stripeCustomerId required
- Data: tenants (r); event: capture.billing.portal_opened; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A (Stripe)
- Status: ✅active
- Notes: ⚠️ tenants SELECT NOT in try/catch; emitEventSingle NOT in try/catch (post-session-creation failure returns 500)

### POST /api/stripe/webhook   (file: frontend/app/api/stripe/webhook/route.ts)
- Use: Stripe webhook handler — processes checkout.session.completed, subscription events, invoice events
- Auth/Role: none — HMAC verified via stripe-signature header
- Validation: Stripe signature verification; event type routing
- Data: purchases (r/w), tenants (r/w); events: capture.subscription.started/renewed/canceled, capture.consulting.purchased, capture.purchase.completed; no jobs
- Response: {received:true} on success; {error,code}✓ on signature/config failure; permanent errors also return {received:true} (correct — stops Stripe retries)
- Tenant scope: N/A (webhook)
- Status: ✅active (critical path — monetization)
- Notes: sql.begin() callback typed as `any`

### GET /api/system   (file: frontend/app/api/system/route.ts)
- Use: Stub — not implemented
- Auth/Role: none (stub returns 501 immediately)
- Validation: N/A
- Data: none
- Response: {error,code}✓ 501
- Tenant scope: N/A
- Status: 💀dead (stub — no implementation; separate from /api/admin/system)

### POST /api/tools/[name]   (file: frontend/app/api/tools/[name]/route.ts)
- Use: Tool invocation gateway — routes to registered tool implementations by name
- Auth/Role: any authenticated user minimum; per-tool requiredRole enforced by registry
- Validation: per-tool validation via ToolValidationError; toolName from path checked against registry
- Data: delegated to individual tool implementations (varies)
- Response: {data}✓ via withHandler; {error,code}✓ including ToolNotFoundError/ToolAuthorizationError/ToolValidationError/ToolExecutionError translations
- Tenant scope: delegated to tool implementation
- Status: ✅active (critical path — all AI tool invocations)

### GET /api/uploads/[...key]   (file: frontend/app/api/uploads/[...key]/route.ts)
- Use: Serve S3 files from cms/ prefix (CMS image proxy); path traversal guard
- Auth/Role: none — public (scoped to cms/ prefix only)
- Validation: manual — key must start with cms/; .. rejection
- Data: none (S3 read); no events; no jobs
- Response: binary stream; {error,code}✓ on errors
- Tenant scope: N/A public
- Status: ✅active

### POST /api/waitlist   (file: frontend/app/api/waitlist/route.ts)
- Use: Public waitlist signup
- Auth/Role: none — public
- Validation: manual — email required; company_name optional
- Data: waitlist (w); event: capture.waitlist.joined; no jobs
- Response: {data}✓ ; {error,code}✓
- Tenant scope: N/A public
- Status: ✅active

---

## Counts Summary

| Domain | Routes | ✅active | ⚠️stale | 💀dead |
|--------|--------|---------|---------|-------|
| admin/* | 72 | 71 | 1 | 0 |
| portal/* | 47 | 47 | 0 | 0 |
| public/shared | 19 | 18 | 0 | 1 |
| **Total** | **138** | **136** | **1** | **1** |

---

## SOP Violation Index

### Missing inner try/catch around `await sql` calls (violates "EVERY await sql MUST be inside try/catch")
- `admin/analytics` — 7 parallel calls in single catch
- `admin/automation` (GET) — automation_rules SELECT bare
- `admin/pipeline` — all sql calls bare
- `admin/rfp-curation/[solId]/outline` — GET lines 58-76, POST lines 167-203
- `admin/rfp-curation/[solId]/topics/[topicId]/compliance` — GET lines 76-122, DELETE multiple
- `admin/rfp-curation/[solId]/triage` — lines 110-183
- `admin/sources/[profileId]/regions/[regionId]` — UPDATE line 56
- `admin/sources/[profileId]/scout` — lines 59, 83
- `admin/storage` — POST dedup hash line 220; PATCH second HeadObject
- `admin/tenants` (list GET) — all 4 sql branches
- `admin/waitlist` — both branches
- `admin/workflows/[instanceId]` — both SELECTs
- `admin/workflows` (GET) — all query branches
- `admin/workflows/[instanceId]/cancel` — sql.begin() bare
- `admin/workflows/[instanceId]/retry` — sql.begin() bare
- `portal/[tenantSlug]/dashboard` — all 6 calls in single catch
- `portal/[tenantSlug]/proposals/[proposalId]/collaborators` (POST) — lines 235, 245
- `portal/[tenantSlug]/proposals/[proposalId]/compliance` — line 49
- `portal/[tenantSlug]/proposals/[proposalId]/dropbox` (POST) — line 161
- `portal/[tenantSlug]/proposals/[proposalId]/sections` (GET) — lines 49, 62

### Missing `{code}` field on some error responses
- `admin/compliance-suggest` — memory query failure silently swallowed (no error response at all)
- `admin/site/*/publish` and `admin/site/*/save` — emitEventEnd error object missing `code` field

### auth() called outside outer try/catch
- `admin/rfp-document/[id]/set-primary`
- `admin/rfp-document/[id]/signed-url`
- `admin/rfp-upload`
- `admin/site/upload-image` (requireAdmin outside try)

### emitEventSingle/emitEventEnd not in try/catch (event failure causes 500 on success)
- `admin/topics/[id]` — emitEventSingle bare
- `admin/upload-topic-files` — emitEventSingle bare
- `stripe/portal` — emitEventSingle bare (post session-creation)
- `portal/[tenantSlug]/library/upload` — emitEventSingle bare
- `portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export` — emitEventSingle line 182
- `portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/save` — emitEventSingle line 300
- `portal/[tenantSlug]/rfp-curation/[solId]/compliance` (POST) — emitEventEnd not called on AppError path

### Internal error details exposed to client
- `admin/sbir-data/ingest` — outer catch emits `\`Ingest failed: ${msg.slice(0,500)}\`` to client

### Namespace / event type SOP violations
- `invite` — event type is `identity.invite_accepted` with namespace `identity` → effective `identity.identity.invite_accepted`; should be `invite.accepted`
- `cms/revalidate` — 500 uses `code:'DB_ERROR'` but no DB involved
- `portal/[tenantSlug]/proposals/[proposalId]/ai/review` — event failure returns `code:'DB_ERROR'` (wrong code)

### Missing transaction for multi-table writes (partial failure leaves inconsistent state)
- `invite` (POST) — user password + collaborator accept in separate try/catch blocks (no sql.begin)
- `consent` (POST) — consent_records INSERT + users UPDATE in same catch but no transaction

### Other
- `portal/[tenantSlug]/profile` GET — no minimum role; partner_user can read billing_email
- `portal/[tenantSlug]/proposals/[proposalId]/lock` DELETE — proposalId missing isValidUUID
- `portal/[tenantSlug]/team` GET — response shape `{data: members[]}` instead of `{data: {members: []}}`
- `admin/topics/[id]` — request.json() not in try/catch
- `admin/sbir-data/ingest` — sbir_awards INSERT has no ON CONFLICT clause (potential unique constraint errors)
- `admin/rfp-curation/[solId]/triage` — dead code: updateFields object built but never used
- `portal/[tenantSlug]/proposals/[proposalId]/stage` PATCH — stage history INSERT failure causes misleading 500 even though stage already updated
