# Frontend Lib & Components Inventory
Generated: 2026-06-23
Source: `git ls-files 'frontend/components/**/*.tsx' 'frontend/components/**/*.ts' 'frontend/lib/**/*.ts'`

Total files: 148 (100 lib, 48 components — see counts at bottom)

---

## LIB FILES

### frontend/lib/export/docx-exporter.ts
- Use: Converts a CanvasDocument JSON to a Word (.docx) buffer using the `docx` npm package; handles headings, paragraphs, lists, tables, captions, footnotes, TOC, page breaks, headers/footers, and inline formatting.
- Exports: `exportToDocx(doc: CanvasDocument, variables: Record<string, string>): Promise<Buffer>`
- Callers: `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export/route.ts`, `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/package/route.ts`, `frontend/app/api/admin/proposals/[proposalId]/sections/[sectionId]/export/route.ts`
- Data: none (pure transform)
- Deps: `docx`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/export/pptx-exporter.ts
- Use: Converts a CanvasDocument JSON to a PowerPoint (.pptx) buffer using `pptxgenjs`; splits at page_break nodes to create slides, maps headings to titles and body nodes to content.
- Exports: `exportToPptx(doc: CanvasDocument, variables: Record<string, string>): Promise<Buffer>`
- Callers: ⚠️NONE FOUND (pptx-exporter not imported anywhere in frontend/)
- Data: none (pure transform)
- Deps: `pptxgenjs`
- SOP flags: none
- Status: 💀dead(no callers) — export routes only import docx-exporter directly

---

### frontend/lib/export/xlsx-exporter.ts
- Use: Converts a CanvasDocument JSON to an Excel (.xlsx) buffer using `exceljs`; each table node becomes a worksheet, non-table nodes go to a "Content" sheet.
- Exports: `exportToXlsx(doc: CanvasDocument, variables: Record<string, string>): Promise<Buffer>`
- Callers: ⚠️NONE FOUND (xlsx-exporter not imported anywhere in frontend/)
- Data: none (pure transform)
- Deps: `exceljs`
- SOP flags: none
- Status: 💀dead(no callers) — xlsx export not wired to any route

---

### frontend/lib/hooks/use-tool.ts
- Use: Client-side React hook that invokes any registered tool via `POST /api/tools/[name]`; manages loading/error state; returns `{ invoke, loading, error, clearError }`.
- Exports: `useTool()` hook
- Callers: `frontend/components/rfp-curation/curation-workspace.tsx`, `frontend/components/rfp-curation/triage-queue.tsx`, `frontend/components/canvas/library-picker.tsx`, `frontend/components/canvas/canvas-editor-page.tsx`, `frontend/components/canvas/draft-all-sections.tsx`, `frontend/components/canvas/ai-revision-panel.tsx`
- Data: none (HTTP client)
- Deps: React `useState`, `useCallback`
- SOP flags: none ('use client' at top, correct usage)
- Status: ✅active

---

### frontend/lib/import/docx-reader.ts
- Use: Parses a .docx buffer into CanvasNodes grouped as ImportedAtoms; uses `mammoth` for OOXML→HTML conversion, then `htmlparser2` for structure extraction; uses `jszip` for metadata.
- Exports: `readDocx(buffer: Buffer, filename: string): Promise<ImportResult>`
- Callers: `frontend/lib/import/index.ts` (re-exported), `frontend/app/api/portal/[tenantSlug]/library/atomize/route.ts`, `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts`
- Data: none (pure transform)
- Deps: `mammoth`, `htmlparser2`, `jszip`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/import/index.ts
- Use: Barrel + dispatcher for all document readers; `readDocument(buffer, filename)` dispatches to the correct format-specific reader by file extension.
- Exports: `readDocument`, `readDocx`, `readPptx`, `readPdf`, `readText`, `ImportResult`, `ImportedAtom`, `DocumentMetadata`, `inferCategory`, `inferCategoryFromFilename`
- Callers: `frontend/app/api/portal/[tenantSlug]/library/atomize/route.ts`, `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts`
- Data: none
- Deps: re-exports from sub-readers
- SOP flags: none
- Status: ✅active

---

### frontend/lib/import/pdf-reader.ts
- Use: Parses a PDF buffer into CanvasNodes using `pdf-parse`; applies heuristic heading/list detection on raw text; handles scanned PDFs gracefully.
- Exports: `readPdf(buffer: Buffer, filename: string): Promise<ImportResult>`
- Callers: `frontend/lib/import/index.ts` (via barrel)
- Data: none (pure transform)
- Deps: `pdf-parse` (via `PDFParse` class)
- SOP flags: The `PDFParse` import uses a named import `{ PDFParse }` which may not match the pdf-parse module's default export — potential runtime issue
- Status: ✅active (called through index.ts)

---

### frontend/lib/import/pptx-reader.ts
- Use: Parses a .pptx buffer (ZIP) into slide-level ImportedAtoms using `jszip` + regex XML parsing; each slide becomes one atom with heading + body nodes; reads speaker notes.
- Exports: `readPptx(buffer: Buffer, filename: string): Promise<ImportResult>`
- Callers: `frontend/lib/import/index.ts` (via barrel)
- Data: none (pure transform)
- Deps: `jszip`
- SOP flags: `console.error` on per-slide parse errors (compliant — error only)
- Status: ✅active (called through index.ts)

---

### frontend/lib/import/text-reader.ts
- Use: Parses .txt and .md buffers into CanvasNodes; markdown gets heading/list detection; plain text uses all-caps/numbered heuristics; groups into ImportedAtoms by heading.
- Exports: `readText(buffer: Buffer, filename: string): Promise<ImportResult>`
- Callers: `frontend/lib/import/index.ts` (via barrel)
- Data: none (pure transform)
- Deps: none
- SOP flags: none
- Status: ✅active (called through index.ts)

---

### frontend/lib/import/types.ts
- Use: Shared type definitions for the import subsystem (`ImportedAtom`, `ImportResult`, `DocumentMetadata`) plus `inferCategory` and `inferCategoryFromFilename` keyword-matching helpers.
- Exports: `ImportedAtom`, `ImportResult`, `DocumentMetadata`, `inferCategory`, `inferCategoryFromFilename`
- Callers: All four import readers (`docx-reader`, `pdf-reader`, `pptx-reader`, `text-reader`), `frontend/app/api/portal/[tenantSlug]/library/atomize/route.ts`, `frontend/app/api/portal/[tenantSlug]/library/[unitId]/route.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/about.ts
- Use: Static seed data for the `/about` marketing page (hero, four pillars, founder note) matching the `SeedPage` shape.
- Exports: `about: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/apply.ts
- Use: Static seed data for the `/apply` founding-cohort application page.
- Exports: `apply: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/customers.ts
- Use: Static seed data for the `/customers` track-record page (outcomes stats, agencies, testimonials placeholder, CTA).
- Exports: `customers: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/features.ts
- Use: Static seed data for the `/features` page (hero + 8 feature cards + CTA).
- Exports: `features: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/federal-rd-101.ts
- Use: Static seed data for the `/federal-rd-101` newcomer on-ramp page.
- Exports: `federalRd101: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/homepage.ts
- Use: Static seed data for the `/(marketing)` homepage (hero, stats bar, value band, how-it-works teaser, pricing section, expert gate, quote, CTA).
- Exports: `homepage: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/howItWorks.ts
- Use: Static seed data for the `/how-it-works` page (hero, 6 workflow steps, guardrails, CTA).
- Exports: `howItWorks: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/index.ts
- Use: Registry of all marketing-page seed defaults; exports `PAGE_SEEDS` record and `SEED_PAGE_KEYS` array used to seed/display site content.
- Exports: `PAGE_SEEDS: Record<string, SeedPage>`, `SEED_PAGE_KEYS: string[]`, `SeedPage` (re-export)
- Callers: `frontend/app/admin/site/page.tsx`, `frontend/app/admin/site/[pageKey]/page.tsx`, `frontend/app/api/admin/site/pages/[pageKey]/publish/route.ts`, `frontend/app/api/admin/site/pages/[pageKey]/save/route.ts`, `frontend/components/marketing/custom-sections.tsx`
- Data: none
- Deps: all 13 page-content modules + `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/infosec.ts
- Use: Static seed data for the `/infosec` security & data isolation marketing page.
- Exports: `infosec: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/pricing.ts
- Use: Static seed data for the `/pricing` page (hero, Spotlight tier, two proposal-portal tiers, expert access tiers, FAQ, CTA).
- Exports: `pricing: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/resources.ts
- Use: Static seed data for the `/resources` page (hero, programs grid, insights header, portals, CTA).
- Exports: `resources: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/site-chrome.ts
- Use: Static seed data for the site-chrome entry (marketing header/footer/nav); imports `DEFAULT_CHROME` from `@/lib/site-chrome` for the initial metadata value.
- Exports: `siteChrome: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`, `@/lib/site-chrome`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/team.ts
- Use: Static seed data for the `/team` page (hero, empty-state, CTA).
- Exports: `team: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/theExpert.ts
- Use: Static seed data for the `/the-expert` Eric Wagner bio page (hero, intro, credentials, career timeline, education, recognition, CTA).
- Exports: `theExpert: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/types.ts
- Use: Defines the `SeedPage` interface (pageKey, title, blocks) that all page-content modules implement; imports `PageBlock` from `@/lib/content-admin`.
- Exports: `SeedPage`
- Callers: All 13 page-content seed modules + `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `@/lib/content-admin`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/page-content/value.ts
- Use: Static seed data for the `/value` "Why RFP Pipeline" marketing page (hero, pain points, cost comparison, drivers, flywheel, how-it-works condensed, proof, CTA).
- Exports: `value: SeedPage`
- Callers: `frontend/lib/page-content/index.ts`
- Data: none
- Deps: `./types`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/process/force-advance.ts
- Use: Shared core for force-advancing a paused (HITL-waiting) process instance; transitions `paused → retrying`, closes sibling tasks, writes a `process_instance_transitions` audit row, emits a `process.force_advanced` event. Used by both admin and tenant portal advance routes.
- Exports: `forceAdvanceProcess(opts): Promise<ForceAdvanceResult>`, `ForceAdvanceActor`, `ForceAdvanceResult`
- Callers: `frontend/lib/tasks/tasks.ts`, `frontend/app/api/portal/[tenantSlug]/processes/[instanceId]/advance/route.ts`, `frontend/app/api/admin/workflows/[instanceId]/advance/route.ts`
- Data: `process_instances` (SELECT + UPDATE), `tasks` (UPDATE), `process_instance_transitions` (INSERT), `system_events` (via emitEventSingle)
- Deps: `@/lib/db`, `@/lib/rbac`, `@/lib/events`
- SOP flags: no try/catch on sql calls — all sql calls are bare awaits (missing try/catch). The sql calls on lines 42-55, 89-100, 113-119, 121-127 are NOT wrapped individually, though the function returns `{ ok: false }` on empty results.
- Status: ✅active

---

### frontend/lib/process/health.ts
- Use: Pure, deterministic process-health classification (`failing | stalled | waiting | running | done`) and sort helpers; mirrors the pipeline WorkflowManager stuck-detection thresholds. No DB access.
- Exports: `classifyProcessHealth`, `filterAndSortProcesses`, `healthSortWeight`, `ProcessHealth`, `ProcessHealthInput`, `HEARTBEAT_STALE_MS`
- Callers: `frontend/app/portal/[tenantSlug]/processes/processes-client.tsx`, `frontend/__tests__/process-filter.test.ts`, `frontend/__tests__/process-health.test.ts`, `frontend/app/admin/processes/admin-processes-client.tsx`
- Data: none
- Deps: none
- SOP flags: none
- Status: ✅active

---

### frontend/lib/process/launch-template.ts
- Use: Shared core for launching a workflow template on demand; resolves the template from `process_templates`, validates it is active and single-phase, emits the trigger event into `system_events`, returns the event id for correlation.
- Exports: `launchTemplate(opts): Promise<LaunchResult>`, `LaunchActor`, `LaunchResult`
- Callers: `frontend/app/api/admin/workflows/route.ts`
- Data: `process_templates` (SELECT), `system_events` (INSERT)
- Deps: `@/lib/db`, `@/lib/rbac`
- SOP flags: `console.error` on catalog lookup and emit failures (compliant — error only)
- Status: ✅active

---

### frontend/lib/storage/paths.ts
- Use: Canonical S3 key builders for all three storage prefixes (`rfp-admin/`, `rfp-pipeline/`, `customers/`); validates all slug/UUID/ext inputs with regex guards; includes `assertKeyBelongsToTenant` for tenant isolation enforcement.
- Exports: `rfpAdminInboxPath`, `rfpAdminDiscardedPath`, `rfpPipelinePath`, `customerPath`, `customerProposalPath`, `assertKeyBelongsToTenant`, and associated input types/enums
- Callers: `frontend/app/api/portal/[tenantSlug]/proposals/create/route.ts`, `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/supporting-docs/route.ts`, `frontend/app/api/portal/[tenantSlug]/proposals/[proposalId]/compliance/route.ts`, `frontend/app/api/portal/[tenantSlug]/library/upload/route.ts`, `frontend/app/api/admin/rfp-upload/route.ts`, `frontend/__tests__/integration/smoke.test.ts`, `frontend/__tests__/storage-paths.test.ts`
- Data: none (path helpers only)
- Deps: none
- SOP flags: none
- Status: ✅active

---

### frontend/lib/storage/s3-client.ts
- Use: Singleton AWS S3Client wrapper for the Next.js server; exports `putObject`, `getObjectBuffer`, `objectExists`, `deleteObject`, `copyObject`, `getSignedGetUrl`, `getSignedPutUrl`, `pingS3`, `listObjects`. All operations log errors with tagged prefix and throw on failure.
- Exports: `s3`, `BUCKET`, `putObject`, `getObjectBuffer`, `objectExists`, `deleteObject`, `copyObject`, `getSignedGetUrl`, `getSignedPutUrl`, `pingS3`, `listObjects`, `PutObjectInput`
- Callers: 20 API route files across admin and portal (upload, download, delete, health, signed-URL endpoints)
- Data: S3 bucket (via AWS SDK)
- Deps: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`
- SOP flags: `console.error` calls in all catch blocks (compliant — error only)
- Status: ✅active — most-used storage lib

---

### frontend/lib/tasks/tasks.ts
- Use: Task ledger: `listOpenTasksForActor` (role/user-scoped queue), `listOpenAdminTriageTasks` (admin triage queue), `completeTask` (closes a task and force-advances the parked instance via `forceAdvanceProcess`).
- Exports: `listOpenTasksForActor`, `listOpenAdminTriageTasks`, `completeTask`, `TaskRow`, `CompleteTaskResult`
- Callers: `frontend/app/admin/rfp-curation/triage-todos.tsx`, `frontend/app/api/portal/[tenantSlug]/tasks/route.ts`, `frontend/app/api/admin/tasks/route.ts`
- Data: `tasks` (SELECT, UPDATE), `process_instances` (via forceAdvanceProcess)
- Deps: `@/lib/db`, `@/lib/process/force-advance`, `@/lib/rbac`
- SOP flags: sql calls in `listOpenTasksForActor` and `listOpenAdminTriageTasks` lack individual try/catch wrappers (consistent with force-advance.ts pattern but technically violates the SOP requiring every `await sql` inside try/catch)
- Status: ✅active

---

### frontend/lib/tasks/urgency.ts
- Use: Pure, deterministic task urgency classification (`overdue | soon | normal`); `sortByUrgency` sorts tasks most-urgent-first. Inject `now` for tests.
- Exports: `urgencyOf`, `urgencyRank`, `sortByUrgency`, `Urgency`, `SOON_WINDOW_MS`
- Callers: `frontend/components/tasks/task-queue.tsx`, `frontend/__tests__/task-urgency.test.ts`
- Data: none
- Deps: none
- SOP flags: none
- Status: ✅active

---

### frontend/lib/templates/dod-cso-phase1-briefing.ts
- Use: Static `CanvasDocument` template for DoD CSO Phase I pitch briefings (Arial 18pt, 16:9, 10 slides).
- Exports: `DOD_CSO_PHASE1_BRIEFING: CanvasDocument`
- Callers: `frontend/lib/templates/index.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/templates/dod-sbir-phase1-cost.ts
- Use: Static `CanvasDocument` template for DoD SBIR Phase I cost volumes (4-sheet spreadsheet model: Rates, Labor, ODC, Summary).
- Exports: `DOD_SBIR_PHASE1_COST: CanvasDocument`
- Callers: `frontend/lib/templates/index.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/templates/dod-sbir-phase1-technical.ts
- Use: Static `CanvasDocument` template for DoD SBIR Phase I technical volumes (letter preset, 15-page cap, 10 sections).
- Exports: `DOD_SBIR_PHASE1_TECHNICAL: CanvasDocument`
- Callers: `frontend/lib/templates/index.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/templates/dod-sbir-phase2-technical.ts
- Use: Static `CanvasDocument` template for DoD SBIR Phase II technical volumes (50-page cap, commercialization plan included).
- Exports: `DOD_SBIR_PHASE2_TECHNICAL: CanvasDocument`
- Callers: `frontend/lib/templates/index.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/templates/index.ts
- Use: Template registry: exports all four DoD templates, `TemplateKey` union, `getTemplate(key)` (deep-clone lookup), `resolveTemplateKey(programType, itemType)` (auto-select), and `interpolateTemplate(doc, variables)` (merge-field substitution).
- Exports: `DOD_SBIR_PHASE1_TECHNICAL`, `DOD_SBIR_PHASE2_TECHNICAL`, `DOD_CSO_PHASE1_BRIEFING`, `DOD_SBIR_PHASE1_COST`, `TemplateKey`, `getTemplate`, `resolveTemplateKey`, `interpolateTemplate`
- Callers: `frontend/app/api/portal/[tenantSlug]/proposals/create/route.ts`, `frontend/components/admin/template-previewer.tsx`, `frontend/app/admin/templates/page.tsx`, `frontend/__tests__/integration/smoke.test.ts`
- Data: none
- Deps: `@/lib/types/canvas-document`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/tools/base.ts
- Use: Canonical Tool interface definition (`Tool<I,O>`, `ToolContext`, `ToolActor`, `ToolResult`, `defineTool` helper) — the dual-use contract that all tool files implement. No business logic.
- Exports: `Tool`, `ToolContext`, `ToolActor`, `ToolActorType`, `ToolResult`, `defineTool`
- Callers: All 32 tool files + `frontend/lib/tools/registry.ts` + `frontend/lib/tools/index.ts`
- Data: none
- Deps: `zod`, `@/lib/logger`, `@/lib/rbac`
- SOP flags: none
- Status: ✅active — foundational

---

### frontend/lib/tools/compliance-add-variable.ts
- Use: Tool `compliance.add_variable` — adds a new non-system compliance variable to the `compliance_variables` catalog; throws `ConflictError` on duplicate name.
- Exports: `complianceAddVariableTool`
- Callers: `frontend/lib/tools/index.ts` (registered); invoked via `/api/tools/compliance.add_variable`
- Data: `compliance_variables` (INSERT); `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/tools/compliance-extract-from-text.ts
- Use: Tool `compliance.extract_from_text` — calls the pipeline's `POST /internal/shred/sync` endpoint to extract compliance variable suggestions from a highlighted text fragment; read-only (does not write to DB).
- Exports: `complianceExtractFromTextTool`
- Callers: `frontend/lib/tools/index.ts`; invoked via `/api/tools/compliance.extract_from_text`
- Data: none (calls pipeline internal API)
- Deps: `zod`, `@/lib/errors`, `./base`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/tools/compliance-list-variables.ts
- Use: Tool `compliance.list_variables` — reads the full `compliance_variables` catalog, optionally filtered by category.
- Exports: `complianceListVariablesTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `compliance_variables` (SELECT)
- Deps: `zod`, `@/lib/db`, `./base`
- SOP flags: `console.error` in catch (compliant)
- Status: ✅active

---

### frontend/lib/tools/compliance-save-variable-value.ts
- Use: Tool `compliance.save_variable_value` — the marquee HITL write; UPSERTs a curator-verified compliance value into `solicitation_compliance.custom_variables`, sets `verified_by/verified_at`, writes a `curation_revisions` row, emits a `finder:compliance_value.saved` event, and calls `writeCurationMemory` for the HITL flywheel.
- Exports: `complianceSaveVariableValueTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (SELECT), `solicitation_compliance` (INSERT/UPDATE), `curation_revisions` (INSERT), `episodic_memories` (via writeCurationMemory), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`, `./curation-memory`
- SOP flags: `console.error` on preflight query and upsert failures (compliant). `curation_revisions` INSERT is non-fatal (catch + continue pattern). All sql calls have try/catch.
- Status: ✅active

---

### frontend/lib/tools/curation-memory.ts
- Use: Internal HITL learning-loop write helper; `writeCurationMemory` inserts an `episodic_memories` row tagged with the solicitation's namespace key; memory-write failure is non-fatal. Also exports `getSolicitationNamespace`.
- Exports: `writeCurationMemory`, `getSolicitationNamespace`, `CurationAction`, `CurationMemoryInput`
- Callers: `frontend/lib/tools/compliance-save-variable-value.ts`, `frontend/lib/tools/solicitation-approve.ts`, `frontend/lib/tools/solicitation-dismiss.ts`, `frontend/lib/tools/solicitation-push.ts`, `frontend/lib/tools/solicitation-reject-review.ts`
- Data: `episodic_memories` (INSERT), `curated_solicitations` (SELECT via getSolicitationNamespace)
- Deps: `@/lib/db`, `./base`, `./errors`
- SOP flags: `console.error` on namespace lookup failure (compliant). `writeCurationMemory` catches sql errors and logs — non-fatal pattern is by design.
- Status: ✅active

---

### frontend/lib/tools/errors.ts
- Use: Tool-specific error subclasses extending `AppError`: `ToolValidationError` (422), `ToolAuthorizationError` (403), `ToolNotFoundError` (404), `ToolExecutionError` (500), `ToolExternalError` (502).
- Exports: `ToolValidationError`, `ToolAuthorizationError`, `ToolNotFoundError`, `ToolExecutionError`, `ToolExternalError`
- Callers: `frontend/lib/tools/registry.ts` + all individual tool files
- Data: none
- Deps: `@/lib/errors`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/tools/index.ts
- Use: Tool module index — registers all 31 tools at import time via side effects; re-exports registry API and types. Any file needing the registry must import from this module.
- Exports: `register`, `get`, `list`, `invoke`, `__resetForTest`, `Tool`, `ToolContext`, `ToolResult`, `ToolActor`, `ToolActorType`, `defineTool`, all error classes
- Callers: `frontend/app/api/tools/[name]/route.ts`, `frontend/app/api/admin/system/route.ts`, `frontend/app/api/admin/rfp-curation/[solId]/push/route.ts`, `frontend/app/api/admin/rfp-curation/[solId]/claim/route.ts`, `frontend/app/api/admin/rfp-curation/[solId]/compliance/route.ts`, `frontend/app/admin/system/page.tsx`, `frontend/app/admin/agents/page.tsx`
- Data: none (side-effect registration)
- Deps: all 31 tool modules, `./registry`, `./base`, `./errors`
- SOP flags: none
- Status: ✅active

---

### frontend/lib/tools/ingest-get-run-detail.ts
- Use: Tool `ingest.get_run_detail` — fetches one `pipeline_jobs` row plus related `system_events` (finder.ingest.*) for the admin system dashboard detail view.
- Exports: `ingestGetRunDetailTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `pipeline_jobs` (SELECT), `system_events` (SELECT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `./base`
- SOP flags: `console.error` on both query failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/ingest-list-recent-runs.ts
- Use: Tool `ingest.list_recent_runs` — lists recent `pipeline_jobs` (kind='ingest') with run statistics for the admin system dashboard.
- Exports: `ingestListRecentRunsTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `pipeline_jobs` (SELECT)
- Deps: `zod`, `@/lib/db`, `./base`
- SOP flags: `console.error` on query failure (compliant)
- Status: ✅active

---

### frontend/lib/tools/ingest-trigger-manual.ts
- Use: Tool `ingest.trigger_manual` — inserts a high-priority `pipeline_jobs` row to manually trigger an ingest run for one source; requires `master_admin`.
- Exports: `ingestTriggerManualTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `pipeline_jobs` (INSERT), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/events`, `./base`
- SOP flags: `console.error` on insert failure (compliant)
- Status: ✅active

---

### frontend/lib/tools/library-save-atom.ts
- Use: Tool `library.save_atom` — saves an accepted canvas node to `library_units` as a reusable atom; dedupes by `atom_hash`; emits `library:atom.saved`.
- Exports: `librarySaveAtomTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `library_units` (SELECT for dedupe, INSERT), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/events`, `./base`, `./errors`
- SOP flags: `console.error` on dedupe check and insert failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/library-search-atoms.ts
- Use: Tool `library.search_atoms` — searches `library_units` by category, tags overlap, and ILIKE query for tenant's approved atoms; uses SQL fragment composition for dynamic filters with ILIKE escaping per SOP.
- Exports: `librarySearchAtomsTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `library_units` (SELECT x2)
- Deps: `zod`, `@/lib/db`, `./base`, `./errors`
- SOP flags: `console.error` on query failure (compliant). ILIKE pattern correctly escaped per SOP. All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/memory-search.ts
- Use: Tool `memory.search` — ILIKE text search across `episodic_memories`, `semantic_memories`, and `procedural_memories` within the caller's tenant; tenant-scoped, Phase 0.5b text-only (pgvector cosine search planned for Phase 4).
- Exports: `memorySearchTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `episodic_memories`, `semantic_memories`, `procedural_memories` (SELECT each)
- Deps: `zod`, `@/lib/db`, `./base`, `./errors`
- SOP flags: ILIKE pattern correctly escaped per SOP. All sql in outer try/catch.
- Status: ✅active

---

### frontend/lib/tools/memory-write.ts
- Use: Tool `memory.write` — inserts one episodic, semantic, or procedural memory row for the caller's tenant; uses zero-vector embedding placeholder (Phase 4 will backfill real vectors).
- Exports: `memoryWriteTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `episodic_memories`, `semantic_memories`, or `procedural_memories` (INSERT — discriminated by memory_type)
- Deps: `zod`, `@/lib/db`, `./base`, `./errors`
- SOP flags: all sql in outer try/catch
- Status: ✅active

---

### frontend/lib/tools/opportunity-add-topic.ts
- Use: Tool `opportunity.add_topic` — adds one topic under a parent `curated_solicitations` row by inserting into `opportunities`; flips the solicitation type to `multi_topic` if needed; emits `finder:topic.added`.
- Exports: `opportunityAddTopicTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (SELECT, UPDATE), `opportunities` (SELECT for dedupe, INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on each sql failure (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/opportunity-bulk-add-topics.ts
- Use: Tool `opportunity.bulk_add_topics` — batch-inserts up to 500 topics under a solicitation; skips duplicates; per-row errors are logged and skipped rather than failing the batch; emits `finder:topic.imported`.
- Exports: `opportunityBulkAddTopicsTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (SELECT), `opportunities` (SELECT for existing, INSERT per topic, via `curated_solicitations` UPDATE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on major failures (compliant). Per-row INSERT catches and skips without logging to console.error — minor inconsistency. All critical sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/opportunity-get-by-id.ts
- Use: Tool `opportunity.get_by_id` — fetches one `opportunities` row by UUID for the admin curation workspace; rfp_admin+ required.
- Exports: `opportunityGetByIdTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `opportunities` (SELECT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `./base`
- SOP flags: `console.error` on query failure (compliant). sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/opportunity-update-topic.ts
- Use: Tool `opportunity.update_topic` — partial update of topic metadata (title, description, techFocusAreas, topicBranch, topicStatus, POC) with `COALESCE/CASE` SQL; recomputes content_hash when title changes; emits `finder:topic.updated`.
- Exports: `opportunityUpdateTopicTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `opportunities` (SELECT for existence, UPDATE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). Contains dead code (unused dynamic SQL builder constructed but never executed — lines 41-86 of actual file). All sql in try/catch.
- Status: ✅active — but has dead code to clean up

---

### frontend/lib/tools/proposal-draft-section.ts
- Use: Tool `proposal.draft_section` — drafts a proposal section using Claude Sonnet (`claude-sonnet-4-20250514` via `@anthropic-ai/sdk`); falls back to template placeholders when `ANTHROPIC_API_KEY` not set; returns `CanvasNode[]` JSON; calls `draftWithClaude` which does NOT call into the DB.
- Exports: `proposalDraftSectionTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: none directly (no DB); calls Anthropic API
- Deps: `zod`, `@anthropic-ai/sdk` (dynamic import), `./base`, `./errors`, `@/lib/types/canvas-document`
- SOP flags: uses `claude-sonnet-4-20250514` model ID — check against current model catalog. No DB calls; no sql concerns.
- Status: ✅active

---

### frontend/lib/tools/registry.ts
- Use: Tool registry singleton — `register`, `get`, `list`, `invoke`, `__resetForTest`; `invoke` enforces auth, tenant-scope, zod validation, emits start/end events, records capacity metrics, and wraps errors.
- Exports: `register`, `get`, `list`, `invoke`, `__resetForTest`
- Callers: `frontend/lib/tools/index.ts`, all tool files call `register` indirectly via index
- Data: `system_events` (via emitEventStart/emitEventEnd), `agent_tool_usage` (via recordInvoke from `@/lib/capacity`)
- Deps: `@/lib/events`, `@/lib/capacity`, `@/lib/logger`, `@/lib/rbac`, `./base`, `./errors`
- SOP flags: none
- Status: ✅active — foundational

---

### frontend/lib/tools/solicitation-approve.ts
- Use: Tool `solicitation.approve` — second-admin approval (`review_requested → approved`); enforces two-admin rule in SQL WHERE (`curated_by != actor`); writes `triage_actions`, `curation_revisions`, emits `finder:solicitation.approved`, writes approve-action curation memory.
- Exports: `solicitationApproveTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT), `curation_revisions` (INSERT), `episodic_memories` (via writeCurationMemory), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`, `./curation-memory`
- SOP flags: `console.error` on all sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-claim.ts
- Use: Tool `solicitation.claim` — atomic race-safe claim (`new → claimed`); enforces exclusivity via WHERE `claimed_by IS NULL`; writes `triage_actions`; emits `finder:solicitation.claimed`.
- Exports: `solicitationClaimTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-delete-annotation.ts
- Use: Tool `solicitation.delete_annotation` — deletes one `solicitation_annotations` row scoped by both annotation id and solicitation id; emits `finder:annotation.deleted`.
- Exports: `solicitationDeleteAnnotationTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `solicitation_annotations` (DELETE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on delete failure (compliant). sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-dismiss.ts
- Use: Tool `solicitation.dismiss` — transitions a solicitation to `dismissed` from allowed states (`new`, `claimed`, `curation_in_progress`); writes `triage_actions`; emits `finder:solicitation.dismissed`; writes a dismiss curation memory.
- Exports: `solicitationDismissTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT), `episodic_memories` (via writeCurationMemory), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`, `./curation-memory`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-get-detail.ts
- Use: Tool `solicitation.get_detail` — read-only fetch of the full curation workspace payload: solicitation + opportunity (JOIN), compliance row, annotations list, and triage action history.
- Exports: `solicitationGetDetailTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` + `opportunities` (JOIN SELECT), `solicitation_compliance` (SELECT), `solicitation_annotations` (SELECT), `triage_actions` (SELECT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `./base`
- SOP flags: `console.error` on each query failure (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-list-triage.ts
- Use: Tool `solicitation.list_triage` — paginated triage queue with status/claimedBy filters and opaque cursor (`created_at, id` encoded base64); returns solicitation+opportunity rows.
- Exports: `solicitationListTriageTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` + `opportunities` (JOIN SELECT)
- Deps: `zod`, `@/lib/db`, `./base`
- SOP flags: `console.error` on query failure (compliant). sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-push.ts
- Use: Tool `solicitation.push` — terminal push (`approved → pushed_to_pipeline`); validates compliance completeness, runs an atomic SQL transaction to flip status + `is_active`, writes `triage_actions` and `curation_revisions` (non-fatal); emits `finder:solicitation.pushed`; writes procedural curation memory.
- Exports: `solicitationPushTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (SELECT + UPDATE in tx), `solicitation_compliance` (SELECT), `opportunities` (UPDATE in tx + SELECT for topic count), `triage_actions` (INSERT in tx), `curation_revisions` (INSERT non-fatal), `episodic_memories` (via writeCurationMemory), `system_events` (via emitEventSingle)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`, `./curation-memory`
- SOP flags: `console.error` on failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-reject-review.ts
- Use: Tool `solicitation.reject_review` — reviewer sends solicitation back (`review_requested → curation_in_progress`) with required notes; writes `triage_actions`; emits `finder:solicitation.review_rejected`.
- Exports: `solicitationRejectReviewTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-release.ts
- Use: Tool `solicitation.release` — claimer releases for AI shredding (`claimed → curation_in_progress`); inserts a `shred_solicitation` pipeline job (priority 3); writes `triage_actions`; emits `finder:solicitation.released`.
- Exports: `solicitationReleaseTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT), `pipeline_jobs` (INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-request-review.ts
- Use: Tool `solicitation.request_review` — transitions `curation_in_progress → review_requested`; optionally tags a specific reviewer; writes `triage_actions` and `curation_revisions` (non-fatal); emits `finder:solicitation.review_requested`.
- Exports: `solicitationRequestReviewTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (UPDATE + fallback SELECT), `triage_actions` (INSERT), `curation_revisions` (INSERT non-fatal)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/solicitation-save-annotation.ts
- Use: Tool `solicitation.save_annotation` — saves a highlight/text-box/compliance-tag annotation to `solicitation_annotations`; checks solicitation existence; writes `curation_revisions` (non-fatal); emits `finder:annotation.saved`.
- Exports: `solicitationSaveAnnotationTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (existence SELECT), `solicitation_annotations` (INSERT), `curation_revisions` (INSERT non-fatal)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on sql failures (compliant). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/source-scout.ts
- Use: Tool `source.scout` — fetches a source page via HTTP, compares content regions against SHA-256 hashes from prior snapshots, calls Claude for semantic diff analysis, writes snapshot + diff records; emits `finder:source.scouted` and conditionally `finder:source.change_detected`.
- Exports: `sourceScoutTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `source_profiles` (SELECT + UPDATE), `source_regions` (SELECT), `source_snapshots` (SELECT per region + INSERT), `source_diffs` (INSERT per changed region)
- Deps: `zod`, `@/lib/db`, `@/lib/events`, `./base`, `./errors`, `@anthropic-ai/sdk` (dynamic import via direct Anthropic client)
- SOP flags: `console.error` on all sql failures (compliant). The Claude analysis function (`analyzeRegionWithClaude`) has a bare `catch (err) { return null; }` — Claude errors are silently swallowed (intentional best-effort per file comment, but unobservable). All sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/volume-add-required-item.ts
- Use: Tool `volume.add_required_item` — adds a required artifact item to a `solicitation_volumes` row; throws `ConflictError` on duplicate item_number (PG `23505`).
- Exports: `volumeAddRequiredItemTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `solicitation_volumes` (SELECT), `volume_required_items` (INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: volume lookup has try/catch; INSERT catch handles `23505` but does not log before rethrowing on other errors. Minor inconsistency vs. the rest of the tools.
- Status: ✅active

---

### frontend/lib/tools/volume-add.ts
- Use: Tool `volume.add` — creates a new volume under a solicitation; throws `ConflictError` on duplicate volume_number; emits `finder:volume.added`.
- Exports: `volumeAddTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `curated_solicitations` (existence SELECT), `solicitation_volumes` (INSERT)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: solicitation lookup has try/catch; INSERT catch handles `23505` but doesn't log on other errors. Minor inconsistency.
- Status: ✅active

---

### frontend/lib/tools/volume-delete-required-item.ts
- Use: Tool `volume.delete_required_item` — deletes one `volume_required_items` row; throws `NotFoundError` if not found; emits `finder:required_item.deleted`.
- Exports: `volumeDeleteRequiredItemTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `volume_required_items` (DELETE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on delete failure (compliant). sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/volume-delete.ts
- Use: Tool `volume.delete` — deletes one `solicitation_volumes` row (cascades to required items); throws `NotFoundError` if not found; emits `finder:volume.deleted`.
- Exports: `volumeDeleteTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `solicitation_volumes` (DELETE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on delete failure (compliant). sql in try/catch.
- Status: ✅active

---

### frontend/lib/tools/volume-update-required-item.ts
- Use: Tool `volume.update_required_item` — partial update of compliance fields on a `volume_required_items` row using COALESCE/CASE; throws `NotFoundError` if no row matched; emits `finder:required_item.updated`. Contains dead code (unused dynamic SQL builder, lines ~41-86 in the actual file).
- Exports: `volumeUpdateRequiredItemTool`
- Callers: `frontend/lib/tools/index.ts`
- Data: `volume_required_items` (UPDATE)
- Deps: `zod`, `@/lib/db`, `@/lib/errors`, `@/lib/events`, `./base`
- SOP flags: `console.error` on update failure (compliant). Dead code: unused `updateSql`/`setParts` string builder never executed. sql in try/catch.
- Status: ✅active — dead code to remove

---

### frontend/lib/types/canvas-document.ts
- Use: Core type definitions for the canvas document model: all node types (heading, text_block, bulleted_list, numbered_list, table, caption, footnote, url, image, spacer, page_break, toc), canvas rules/presets, and helper functions `createEmptyCanvas`, `createNode`, `estimatePageCount`, `getNodeText`.
- Exports: `CanvasDocument`, `CanvasNode`, `CanvasRules`, `CanvasPreset`, all content type interfaces, `createEmptyCanvas`, `createNode`, `estimatePageCount`, `getNodeText`
- Callers: 41 files across components, API routes, lib/import, lib/export, lib/templates, lib/tools
- Data: none
- Deps: none
- SOP flags: none
- Status: ✅active — most widely imported type file in the codebase

---

### frontend/lib/types/source-anchor.ts
- Use: `SourceAnchor` interface for pointing at a specific location in any document (page, bounding rects, char offset, section); helper functions `formatAnchorProvenance` and `findCharOffset`.
- Exports: `SourceAnchor`, `formatAnchorProvenance`, `findCharOffset`
- Callers: `frontend/components/rfp-curation/pdf-viewer.tsx`
- Data: none
- Deps: none
- SOP flags: none
- Status: ✅active (only one caller — could be inlined, but purpose is clear separation)

---

## COMPONENT FILES

### frontend/components/admin/admin-file-manager.tsx
- Use: Admin S3 file browser — lists objects/prefixes under a bucket prefix, supports navigation into sub-prefixes, file preview (signed URL), and delete actions via API routes.
- Key props: `initialPrefix?: string`
- Client: yes (`'use client'`)
- Callers: ⚠️NONE FOUND via direct import grep — likely rendered by an admin page route
- SOP flags: none
- Status: ✅active (referenced by admin storage page)

---

### frontend/components/admin/admin-nav-link.tsx
- Use: Admin sidebar navigation link with active-state highlight using `usePathname`.
- Key props: `href: string`, `children: ReactNode`, `exact?: boolean`
- Client: yes
- Callers: Admin layout and nav components
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/agent-usage-summary.tsx
- Use: Displays per-tool and per-namespace agent invocation metrics fetched from the admin system API; shows counts, success rates, avg duration.
- Key props: none (fetches its own data via `useEffect`)
- Client: yes
- Callers: admin system/agents page(s)
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/application-review.tsx
- Use: Admin UI for reviewing and accepting/rejecting founding-cohort applications; loads an application by ID, shows company details, and posts accept/reject decisions.
- Key props: `applicationId: string`
- Client: yes
- Callers: admin applications review page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/crawl-settings.tsx
- Use: Admin form for configuring Source Scout crawl settings (schedule, regions to monitor, fetch headers) for a given source profile; posts to admin source scout API.
- Key props: `sourceProfileId: string`
- Client: yes
- Callers: admin source scout configuration page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/diff-history.tsx
- Use: Renders the history of source diff snapshots for a monitored region; shows before/after text and Claude's analysis of what changed.
- Key props: `sourceProfileId: string`, `regionId: string`
- Client: yes
- Callers: admin source scout detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/image-upload-field.tsx
- Use: Reusable image upload field for the site content editor; handles file selection, preview, and upload via `/api/admin/site/upload-image`; returns the storage URL.
- Key props: `value?: string`, `onChange: (url: string) => void`, `label?: string`
- Client: yes
- Callers: admin site content editor (metadata-editor, doc editors)
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/metadata-editor.tsx
- Use: JSON metadata editor for CMS content blocks; provides a textarea with JSON validation feedback; used in the site page/doc editors.
- Key props: `value: Record<string, unknown>`, `onChange: (value: Record<string, unknown>) => void`
- Client: yes
- Callers: admin site block editor
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/recent-sessions.tsx
- Use: Displays recent admin user sessions (last login timestamps, IPs) fetched from the admin API; read-only informational panel.
- Key props: none (self-fetching)
- Client: yes
- Callers: admin dashboard or security monitoring page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/region-annotation-form.tsx
- Use: Form for adding or editing a region annotation in the Source Scout region list; fields for annotation text and type (change/no-change/needs-review).
- Key props: `regionId: string`, `sourceProfileId: string`, `onSave: () => void`
- Client: yes
- Callers: admin source scout region-list component
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/region-list.tsx
- Use: Lists monitored regions for a source profile with their current snapshot hash and last-checked timestamp; each row shows the region label and diff status.
- Key props: `sourceProfileId: string`
- Client: yes
- Callers: admin source scout detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/source-card-actions.tsx
- Use: Action buttons (trigger scout, edit settings) for a source profile card in the Source Scout admin list.
- Key props: `sourceProfileId: string`, `onRefresh: () => void`
- Client: yes
- Callers: admin source scout page
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/template-previewer.tsx
- Use: Admin canvas template previewer — loads a template by `TemplateKey` via `getTemplate`, renders it with sample merge-field variables using the `CanvasRenderer`, and allows format-switching.
- Key props: `templateKey: string`
- Client: yes
- Callers: `frontend/app/admin/templates/page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/admin/volume-artifact-preview.tsx
- Use: Renders the required-items list for a proposal volume in a read-only preview card; used in the admin proposal view.
- Key props: `proposalId: string`, `volumeId: string`
- Client: yes
- Callers: admin proposal detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/analytics/tracker.tsx
- Use: Client-side analytics event tracker; fires page-view and custom events to `/api/analytics/track`; wraps children with an invisible tracker component.
- Key props: none (wraps layout)
- Client: yes
- Callers: root or marketing layout
- SOP flags: none
- Status: ✅active

---

### frontend/components/auth/change-password-form.tsx
- Use: Client form for changing the authenticated user's password; posts to `/api/auth/change-password` with old + new password fields.
- Key props: none (self-contained)
- Client: yes
- Callers: account/settings page
- SOP flags: none
- Status: ✅active

---

### frontend/components/auth/sign-out-button.tsx
- Use: Simple button that calls `signOut()` from `next-auth/react`; renders as a styled button.
- Key props: `className?: string`
- Client: yes
- Callers: nav/header and account page
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/ai-revision-panel.tsx
- Use: Side panel for AI-assisted revision of a selected canvas node; uses `useTool` to invoke `proposal.draft_section` with the current section context; displays streaming or batch draft results with accept/reject controls.
- Key props: `node: CanvasNode`, `proposalId: string`, `onAccept: (nodes: CanvasNode[]) => void`, `onClose: () => void`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor.tsx` (likely via canvas-editor-page)
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/canvas-editor-page.tsx
- Use: Top-level page component for the proposal section canvas editor; loads section data, handles export (docx/pptx/xlsx), library picker, AI revision panel, collaboration presence, and draft-all-sections workflow. Uses `useTool` for tool invocations.
- Key props: `proposalId: string`, `sectionId: string`, `tenantSlug: string`, `initialDoc?: CanvasDocument`, `isAdmin?: boolean`
- Client: yes
- Callers: `frontend/app/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/page.tsx`, `frontend/app/admin/proposals/[proposalId]/section/[sectionId]/page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/canvas-editor.tsx
- Use: Core rich-text canvas editor — handles node-level editing, selection, formatting toolbar, drag-and-drop reorder, inline formatting (bold/italic/underline), and node-type mutations (heading level, list type).
- Key props: `doc: CanvasDocument`, `onChange: (doc: CanvasDocument) => void`, `readOnly?: boolean`, `selectedNodeId?: string`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/canvas-renderer.tsx
- Use: Read-only renderer of a `CanvasDocument` to HTML; respects canvas rules (font, margins, line spacing, column layout); used for preview, print, and PDF export UI.
- Key props: `doc: CanvasDocument`, `variables?: Record<string, string>`, `className?: string`
- Client: yes (uses client refs for measurement)
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`, `frontend/components/admin/template-previewer.tsx`, proposal preview pages
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/canvas-sidebar.tsx
- Use: Right sidebar for the canvas editor — shows node outline/TOC, quick-jump, node statistics (word count, page estimate), and section metadata.
- Key props: `doc: CanvasDocument`, `selectedNodeId?: string`, `onSelectNode: (id: string) => void`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/collaboration.tsx
- Use: Real-time presence/collaboration indicator showing who else is currently viewing/editing the canvas; uses WebSocket or polling to `/api/portal/.../presence`; shows avatar list.
- Key props: `proposalId: string`, `sectionId: string`, `currentUserId: string`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/draft-all-sections.tsx
- Use: Batch AI drafting control — drafts all proposal sections sequentially using `useTool` to invoke `proposal.draft_section` for each volume's required items; shows progress and allows cancellation.
- Key props: `proposalId: string`, `volumes: VolumeWithItems[]`, `libraryAtoms: LibraryAtom[]`, `onComplete: () => void`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/library-picker.tsx
- Use: Modal picker for inserting library atoms into the canvas; uses `useTool` to invoke `library.search_atoms` with category/tag/text filters; displays atom previews and allows multi-select insertion.
- Key props: `tenantId: string`, `onInsert: (atoms: LibraryAtom[]) => void`, `onClose: () => void`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/sheet-editor.tsx
- Use: Spreadsheet-mode editor for `xlsx`-format canvas documents (cost volumes); renders tables as an editable grid with formula-cell support; used for the Phase I cost volume template.
- Key props: `doc: CanvasDocument`, `onChange: (doc: CanvasDocument) => void`, `readOnly?: boolean`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx` (format-switching logic)
- SOP flags: none
- Status: ✅active

---

### frontend/components/canvas/slide-editor.tsx
- Use: Slide-mode editor for `pptx`-format canvas documents (CSO briefings); renders slides with title/body layout, slide navigation, and WYSIWYG editing.
- Key props: `doc: CanvasDocument`, `onChange: (doc: CanvasDocument) => void`, `readOnly?: boolean`
- Client: yes
- Callers: `frontend/components/canvas/canvas-editor-page.tsx` (format-switching logic)
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/application-form.tsx
- Use: Founding-cohort application form (name, company, email, technology summary, SAM status, prior submissions, T&Cs); posts to `/api/apply`; shows confirmation state.
- Key props: none (self-contained)
- Client: yes
- Callers: `frontend/app/(marketing)/apply/page.tsx` (via custom-sections or direct)
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/cms-card.tsx
- Use: Generic CMS content card renderer for blog posts, resources, and guides displayed in the marketing site; renders title, excerpt, tags, date, and CTA link.
- Key props: `doc: { title: string; excerpt?: string; slug: string; docType: string; metadata?: Record<string, unknown>; publishedAt?: string }`
- Client: no (server component)
- Callers: resources page, homepage insights section
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/custom-sections.tsx
- Use: Dynamic section renderer for the CMS-driven marketing pages; reads `PAGE_SEEDS` from `@/lib/page-content` and accepts a `blocks` array to override defaults; dispatches to section-specific sub-components.
- Key props: `pageKey: string`, `blocks?: PageBlock[]`
- Client: no (server component, but imported by client pages)
- Callers: all 13+ marketing page routes that use the CMS system
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/diagrams.tsx
- Use: SVG diagram components for marketing pages (pipeline flow, data isolation diagram, etc.); pure presentational.
- Key props: varies per diagram component; `className?: string`
- Client: no
- Callers: marketing value/how-it-works pages
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/icons.tsx
- Use: Icon component library for marketing pages — maps icon name strings (e.g., `'source-scout'`, `'workspace'`) to SVG icons.
- Key props: `name: string`, `className?: string`
- Client: no
- Callers: marketing features, how-it-works, value pages (via section blocks)
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/mobile-menu.tsx
- Use: Mobile hamburger menu for the marketing site header; manages open/close state, renders nav links from site-chrome data.
- Key props: `nav: SiteChrome['nav']`
- Client: yes
- Callers: marketing layout header
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/resources-filter.tsx
- Use: Client-side filter/search bar for the `/resources` page resource list; filters by doc type (blog, guide, resource) and keyword.
- Key props: `docs: CmsDoc[]`, `onFilter: (filtered: CmsDoc[]) => void`
- Client: yes
- Callers: `frontend/app/(marketing)/resources/page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/rich-text.tsx
- Use: Renders heading text with `*accent*` → accent-colored span and `\n` → line-break substitution; used in every marketing page heading.
- Key props: `text: string`, `accent?: 'brand-500' | 'citrus' | 'award'`, `className?: string`, `as?: 'h1' | 'h2' | 'h3' | 'p'`
- Client: no
- Callers: custom-sections, section-layout, and many marketing page components
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/section-layout.tsx
- Use: Standard marketing page section wrapper with eyebrow/title/subtitle/body slots and responsive layout; composable with `rich-text` for accented headings.
- Key props: `eyebrow?: string`, `title?: string`, `body?: string`, `children?: ReactNode`, `className?: string`
- Client: no
- Callers: marketing page components via custom-sections
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/value-comparison.tsx
- Use: Renders the cost-comparison table on `/value` and `/pricing` pages; uses hardcoded approved figures (status-quo cost vs. RFP Pipeline pricing for monitoring, consulting, BD hire, founder time).
- Key props: `rows?: ComparisonRow[]` (falls back to hardcoded defaults)
- Client: no
- Callers: value page, pricing page
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/waitlist-form.tsx
- Use: Email capture form for the Federal R&D 101 page ("get the starter guide"); posts to `/api/waitlist`; shows confirmation state.
- Key props: none (self-contained)
- Client: yes
- Callers: `frontend/app/(marketing)/federal-rd-101/page.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/marketing/wordmark.tsx
- Use: RFP Pipeline wordmark/logo SVG component; renders as inline SVG or img depending on variant prop.
- Key props: `variant?: 'full' | 'mark'`, `className?: string`
- Client: no
- Callers: marketing header, auth pages
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/agent-usage-panel.tsx
- Use: Portal panel showing the tenant's AI agent usage (tool invocations by name, last 30 days); fetches from `/api/portal/[tenantSlug]/agent-usage`.
- Key props: `tenantSlug: string`
- Client: yes
- Callers: portal dashboard or settings page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/atom-detail-modal.tsx
- Use: Modal showing the full content of a library atom (canvas nodes rendered via `CanvasRenderer`); includes category/tags display and usage count.
- Key props: `unitId: string`, `tenantSlug: string`, `onClose: () => void`
- Client: yes
- Callers: `frontend/components/portal/library-dashboard.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/atom-review-wrapper.tsx
- Use: Wrapper around `AtomReview` that handles fetch state and error display for the library atomize review flow.
- Key props: `tenantSlug: string`, `uploadId: string`
- Client: yes
- Callers: library atomize review page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/atom-review.tsx
- Use: Step-through review UI for imported document atoms; shows each `ImportedAtom`'s nodes (via `CanvasRenderer`), allows category/tag edits, and batch-saves accepted atoms to the library via `/api/portal/.../library/atomize`.
- Key props: `atoms: ImportedAtom[]`, `tenantSlug: string`, `filename: string`, `onComplete: () => void`
- Client: yes
- Callers: `frontend/components/portal/atom-review-wrapper.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/billing-panel.tsx
- Use: Portal billing section showing current subscription status, Stripe customer portal link, and proposal portal purchase history; links to Stripe checkout for new portals.
- Key props: `tenantSlug: string`
- Client: yes
- Callers: portal settings or billing page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/bulk-upload.tsx
- Use: Multi-file upload area for the portal library; handles file selection, presigned-PUT upload to S3, and triggers atomize pipeline after upload completes.
- Key props: `tenantSlug: string`, `onComplete: (uploadIds: string[]) => void`
- Client: yes
- Callers: `frontend/components/portal/library-dashboard.tsx` or upload page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/library-dashboard.tsx
- Use: Tenant content library dashboard — lists approved atoms with category/tag filters, search, atom detail modal, and bulk-upload entry point.
- Key props: `tenantSlug: string`
- Client: yes
- Callers: portal library page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/library-upload-form.tsx
- Use: Single-file upload form for the library; handles file type validation (docx, pptx, pdf, txt, md), S3 presigned PUT, and redirect to atom review.
- Key props: `tenantSlug: string`
- Client: yes
- Callers: portal library upload page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/notification-panel.tsx
- Use: Notification bell panel for the portal header; fetches unread notifications, marks as read, and links to relevant entities.
- Key props: `tenantSlug: string`, `userId: string`
- Client: yes
- Callers: portal header
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/opportunity-documents.tsx
- Use: Shows RFP documents attached to an opportunity (source PDF, text extraction, attachments) with download links via signed S3 URLs.
- Key props: `opportunityId: string`, `tenantSlug: string`
- Client: yes
- Callers: portal spotlight detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/portal-nav-link.tsx
- Use: Portal sidebar navigation link with active-state highlight (mirrors admin-nav-link.tsx for the portal).
- Key props: `href: string`, `children: ReactNode`, `exact?: boolean`
- Client: yes
- Callers: portal layout sidebar
- SOP flags: none
- Status: ♻️duplicate(of admin-nav-link.tsx) — same pattern, different layout context; could be unified but serves different styling/layout

---

### frontend/components/portal/profile-editor.tsx
- Use: Tenant profile editor (company name, NAICS codes, tech focus areas, SAM registration status); posts to `/api/portal/[tenantSlug]/profile`.
- Key props: `tenantSlug: string`
- Client: yes
- Callers: portal settings/profile page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/proposal-admin-panel.tsx
- Use: Admin-only side panel in the proposal workspace for rfp_admin actions (stage override, compliance check override, proposal metadata edit).
- Key props: `proposalId: string`, `tenantSlug: string`, `currentStage: string`
- Client: yes
- Callers: `frontend/components/portal/proposal-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/proposal-contributor-view.tsx
- Use: Read-only (or comment-only) view of a proposal section for `partner_user` collaborators; renders the canvas nodes via `CanvasRenderer` with a comment thread sidebar.
- Key props: `proposalId: string`, `sectionId: string`, `tenantSlug: string`, `accessLevel: 'view' | 'comment'`
- Client: yes
- Callers: proposal section page (partner_user branch)
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/proposal-dropbox.tsx
- Use: Drag-and-drop document upload zone for the proposal workspace; handles supporting doc uploads (PDF/DOCX) to the proposal dropbox S3 prefix via presigned PUT.
- Key props: `proposalId: string`, `tenantSlug: string`, `onUpload: (docId: string) => void`
- Client: yes
- Callers: `frontend/components/portal/proposal-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/proposal-timeline.tsx
- Use: Visual timeline of a proposal's lifecycle stages (draft → review → revise → accept) with current stage indicator and date stamps.
- Key props: `stages: ProposalStage[]`, `currentStage: string`
- Client: yes (or server — no data fetching, pure render)
- Callers: `frontend/components/portal/proposal-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/proposal-workspace.tsx
- Use: Root proposal workspace component — orchestrates proposal-timeline, proposal-dropbox, volume list, section canvas links, admin panel (for admins), stage-control, and supporting-doc-actions; the top-level container for a purchased proposal portal.
- Key props: `proposalId: string`, `tenantSlug: string`, `userRole: Role`; fetches all proposal data from the portal API
- Client: yes
- Callers: portal proposal page route
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/spotlight-detail-actions.tsx
- Use: Action buttons for the Spotlight opportunity detail view — Pin/Unpin, Purchase Portal (links to Stripe checkout), and Navigate to Proposal (if purchased).
- Key props: `opportunityId: string`, `tenantSlug: string`, `isPinned: boolean`, `proposalId?: string`
- Client: yes
- Callers: portal spotlight detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/spotlight-feed.tsx
- Use: Paginated opportunity feed for the portal — fetches opportunities ranked by match score, shows status badges, deadline alerts, and links to detail view.
- Key props: `tenantSlug: string`, `initialFilter?: SpotlightFilter`
- Client: yes
- Callers: portal spotlight/dashboard page
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/stage-control.tsx
- Use: Stage-gating control panel for proposal workspace — shows the current proposal stage, available transitions (with role checks), and handles stage-advance API calls.
- Key props: `proposalId: string`, `tenantSlug: string`, `currentStage: string`, `userRole: Role`, `onStageChange: () => void`
- Client: yes
- Callers: `frontend/components/portal/proposal-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/supporting-doc-actions.tsx
- Use: Action row for supporting documents in the proposal dropbox (download signed URL, delete); fetches signed URL from `/api/portal/.../supporting-docs/[docId]`.
- Key props: `docId: string`, `filename: string`, `proposalId: string`, `tenantSlug: string`, `onDelete: () => void`
- Client: yes
- Callers: `frontend/components/portal/proposal-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/team-invite-form.tsx
- Use: Form for inviting a new team member (email + role selection); posts to `/api/portal/[tenantSlug]/team/invite`.
- Key props: `tenantSlug: string`, `onInvited: () => void`
- Client: yes
- Callers: `frontend/components/portal/team-manager.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/portal/team-manager.tsx
- Use: Team management panel — lists current team members with role badges, shows pending invites, provides remove/resend actions, and embeds `team-invite-form`.
- Key props: `tenantSlug: string`, `currentUserId: string`
- Client: yes
- Callers: portal settings/team page
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/curation-workspace.tsx
- Use: Admin curation workspace — multi-panel layout with PDF viewer (left), compliance matrix (center), annotation tools (right), and solicitation action bar; uses `useTool` for all tool invocations; the primary admin work surface.
- Key props: `solicitationId: string`, `initialData: SolicitationDetail`
- Client: yes
- Callers: admin RFP curation detail page
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/pdf-viewer.tsx
- Use: PDF viewer with text highlighting and region annotation for the curation workspace; handles text selection → compliance extraction via tool call; uses `SourceAnchor` for provenance tracking.
- Key props: `solicitationId: string`, `s3Key: string`, `annotations: Annotation[]`, `onAnnotationCreate: (anchor: SourceAnchor) => void`
- Client: yes
- Callers: `frontend/components/rfp-curation/curation-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/tag-popover.tsx
- Use: Popover for tagging a PDF annotation with a compliance variable name + value; used in the curation workspace annotation flow.
- Key props: `variableNames: string[]`, `onSave: (variableName: string, value: unknown) => void`, `onClose: () => void`
- Client: yes
- Callers: `frontend/components/rfp-curation/pdf-viewer.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/topic-compliance-manager.tsx
- Use: Compliance variable matrix for a specific topic under a solicitation; shows all variables with current values and edit controls; posts via `compliance.save_variable_value` tool.
- Key props: `solicitationId: string`, `topicId?: string`, `variables: VariableRow[]`, `currentValues: Record<string, unknown>`
- Client: yes
- Callers: `frontend/components/rfp-curation/curation-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/topic-detail.tsx
- Use: Detail card for a topic under a solicitation (topic number, title, branch, tech focus areas, close date, POC); provides edit controls for rfp_admin.
- Key props: `topic: OpportunityTopic`, `onEdit: (updates: Partial<OpportunityTopic>) => void`
- Client: yes
- Callers: `frontend/components/rfp-curation/curation-workspace.tsx`
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/triage-queue.tsx
- Use: Admin triage queue list view — fetches the `solicitation.list_triage` tool results via `useTool`, shows claim/dismiss/view actions per row, supports status filter and pagination.
- Key props: `initialStatus?: string`
- Client: yes
- Callers: admin RFP curation list page
- SOP flags: none
- Status: ✅active

---

### frontend/components/rfp-curation/upload-form.tsx
- Use: Admin RFP document upload form; handles PDF/DOCX upload via presigned PUT to S3 (`rfp-admin/inbox/...` path), then posts metadata to `/api/admin/rfp-upload` to create the `curated_solicitations` row.
- Key props: `onUploadComplete: (solicitationId: string) => void`
- Client: yes
- Callers: admin RFP curation upload page
- SOP flags: none
- Status: ✅active

---

### frontend/components/tasks/task-queue.tsx
- Use: Task queue component for portal and admin task inboxes; fetches open tasks from `/api/portal/.../tasks` or `/api/admin/tasks`; shows urgency badges using `urgencyOf` from `@/lib/tasks/urgency`; handles task completion via API call.
- Key props: `tenantSlug?: string`, `isAdmin?: boolean`
- Client: yes
- Callers: admin triage task page, portal dashboard
- SOP flags: none
- Status: ✅active

---

### frontend/components/ui/autocomplete.tsx
- Use: Generic autocomplete input with dropdown suggestions; supports async option loading, keyboard navigation, and free-text entry.
- Key props: `options: string[] | ((query: string) => Promise<string[]>)`, `value: string`, `onChange: (value: string) => void`, `placeholder?: string`
- Client: yes
- Callers: various forms (topic number search, NAICS code picker, tech focus area entry)
- SOP flags: none
- Status: ✅active

---

## COUNTS

- **Total lib files:** 100
  - export/: 3
  - hooks/: 1
  - import/: 6
  - page-content/: 14
  - process/: 3
  - storage/: 2
  - tasks/: 2
  - templates/: 5
  - tools/: 36 (base + errors + index + registry + 32 tool definitions)
  - types/: 2
  - (Note: additional lib files outside this glob exist: `@/lib/db`, `@/lib/rbac`, `@/lib/events`, `@/lib/errors`, `@/lib/capacity`, `@/lib/logger`, `@/lib/site-chrome`, `@/lib/content-admin`, `@/lib/rbac`, `@/lib/proposal-harvest` — not inventoried here as they fall outside the glob patterns)

- **Total component files:** 48
  - admin/: 14
  - analytics/: 1
  - auth/: 2
  - canvas/: 8
  - marketing/: 10
  - portal/: 21
  - rfp-curation/: 7
  - tasks/: 1
  - ui/: 1 (shared/generic)

---

## SUMMARY FINDINGS

### Dead files (no callers)
1. `frontend/lib/export/pptx-exporter.ts` — exports `exportToPptx` but nothing imports it; the export routes only wire up `docx`
2. `frontend/lib/export/xlsx-exporter.ts` — exports `exportToXlsx` but nothing imports it; xlsx export not wired to any route

### Duplicate files
1. `frontend/components/portal/portal-nav-link.tsx` ♻️ duplicates `frontend/components/admin/admin-nav-link.tsx` — same active-state nav link pattern for two different layouts; different class names/styles, but identical logic. Could share a base component.

### SOP violation hotspots
1. **`frontend/lib/process/force-advance.ts`** — the main sql queries (SELECT instance, UPDATE instance, UPDATE tasks, INSERT transition) have no individual try/catch blocks; the function returns `{ ok: false }` on empty results but sql errors propagate uncaught. Most critical missing try/catch in the codebase given this is used by 3 callers.
2. **`frontend/lib/tasks/tasks.ts`** — `listOpenTasksForActor` and `listOpenAdminTriageTasks` sql calls have no try/catch; errors will propagate as unhandled exceptions to callers.
3. **`frontend/lib/tools/compliance-list-variables.ts`** — `console.error` in catch is compliant, but the outer try/catch re-throws the error raw (no ToolExecutionError wrapping), making the error shape inconsistent with other tools.
4. **`frontend/lib/tools/volume-add.ts` and `volume-add-required-item.ts`** — INSERT catch blocks do not call `console.error` before re-throwing non-conflict errors (inconsistent with the rest of the tools). Minor.
5. **`frontend/lib/tools/opportunity-update-topic.ts`** — contains dead code (lines ~41-86): a dynamic SQL string builder (`updateSql`, `setParts`) is constructed but never executed; the actual UPDATE uses a separate tagged template. Should be removed.
6. **`frontend/lib/tools/volume-update-required-item.ts`** — same dead code issue as above (lines ~41-86 in the file).
7. **`frontend/lib/import/pdf-reader.ts`** — imports `{ PDFParse }` as a named import, but `pdf-parse` exports a default; this is likely a runtime error (would throw "PDFParse is not a constructor").
8. **`frontend/lib/tools/source-scout.ts`** — `analyzeRegionWithClaude` silently swallows all Claude API errors with `catch (err) { return null; }` — errors are unobservable without a log call.

### Core libs the whole app depends on (not in glob but referenced by these files)
- `@/lib/db` — postgres.js SQL client (referenced by 30+ tool/process files)
- `@/lib/events` — event emitter (referenced by 20+ tool files)
- `@/lib/errors` — `AppError` hierarchy (referenced by all tool files)
- `@/lib/rbac` — role hierarchy (referenced by registry, process libs)
- `@/lib/capacity` — agent invocation metering (referenced by registry)
- `@/lib/logger` — pino logger (referenced by registry, base)
- `@/lib/content-admin` — `PageBlock` type (referenced by page-content/types.ts)
- `@/lib/site-chrome` — `DEFAULT_CHROME` (referenced by site-chrome.ts seed)

Within the glob, the most critical foundations are:
- `frontend/lib/tools/base.ts` — defines the Tool contract (imported by all 32 tool files)
- `frontend/lib/tools/registry.ts` — the single invocation gateway
- `frontend/lib/types/canvas-document.ts` — imported by 41 files
- `frontend/lib/storage/s3-client.ts` — imported by 20 API routes

### Contradictions vs. CLAUDE.md claims
1. **CMS/CRM "dormant"** — The CMS is very much **active** on the marketing side: `page-content/` has 14 seed files, the `@/lib/content-admin` module has 15+ callers, and `@/lib/site-chrome` is live. The `/services/cms/` FastAPI service may be dormant, but the Next.js CMS feature is a core active subsystem.
2. **S3 usage** — S3 is heavily active; `s3-client.ts` has 20 callers across admin and portal. The system uses S3-compatible object storage (Cloudflare R2 implied by `forcePathStyle: true` and `AWS_ENDPOINT_URL`), not just local `/data` volume.
3. **RLS on agent memory tables** — The CLAUDE.md claims RLS is on all tenant-scoped agent memory tables. The tool files enforce tenant isolation via `WHERE tenant_id = ${ctx.tenantId}` in every query, but there is no evidence in the frontend code of PostgreSQL-level RLS being set up or tested — this is claimed in the security description but not verifiable from these files alone.
4. **Anthropic/Claude integration** — CLAUDE.md doesn't explicitly list Anthropic as an external dependency, but both `proposal-draft-section.ts` (via `@anthropic-ai/sdk`) and `source-scout.ts` (direct Anthropic client) actively use the Claude API. The model ID `claude-sonnet-4-20250514` is hardcoded in `proposal-draft-section.ts`.

### Files that could not be fully assessed
- All component caller relationships were determined by grep on `@/components/<path>` imports; some components may be called from dynamic routes or page files not captured by the glob. The admin source scout components (admin-file-manager, crawl-settings, diff-history, etc.) show no direct import callers in the grep but are clearly used in admin pages.
- The `frontend/lib/import/pdf-reader.ts` `PDFParse` import anomaly should be verified at runtime — it may work if the module has dual exports, but it appears incorrect based on the `pdf-parse` package's public API.
