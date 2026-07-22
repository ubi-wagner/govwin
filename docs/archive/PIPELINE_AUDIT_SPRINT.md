# Pipeline E2E Audit & Fix — Sprint TODO

**Date:** 2026-05-30
**Scope:** Full pipeline audit — ingestion, scoring, scouts, doc builders, uploads, atomization, library
**Status:** COMPLETE

---

## Audit Findings Summary

### Architecture Verification (6 suspects checked)
| Suspect | Result | Severity |
|---------|--------|----------|
| Workflow monitor table name | CORRECT (uses `process_instances`) | — |
| Dual scoring systems | **FIXED** — spotlights now uses pipeline scores | HIGH |
| Agent task queue bypassed | **FIXED** — removed dead pipeline_jobs INSERT | MEDIUM |
| Library atomization path | CORRECT (frontend-local, intentional) | — |
| Document builder integration | CORRECT (canvas-native, no pipeline agents) | — |
| Shredder trigger chain | CORRECT (event-driven via `finder:rfp.uploaded`) | — |

### UI Page Health (10 pages checked)
| Page | Status | Issue |
|------|--------|-------|
| Admin Pipeline | Functional | — |
| Admin Sources | Functional | — |
| Admin Documents | Functional | — |
| Admin Templates | Functional | — |
| Admin Sidebar | **FIXED** | Added Automation + Email Outbox links |
| Portal Pipeline | Functional | — |
| Portal Section Editor | Functional (canvas-based) | — |
| Portal Library Upload+Review | Functional, connected | — |
| Portal Sidebar | Perfect | — |
| Portal Spotlight Detail | Functional, rich | — |

---

## Task List

### Phase 1: Scoring Unification (CRITICAL) — DONE ✅

- [x] **P1.1** Refactor spotlights page to LEFT JOIN `tenant_pipeline_items` for pre-computed scores
- [x] **P1.2** Keep lightweight estimation for opportunities not yet in `tenant_pipeline_items`, labeled as "Est."
- [x] **P1.3** Sort: pipeline-scored first (by total_score DESC), then estimated (by estimate DESC)
- [x] **P1.4** Display pipeline score when available, estimated score when not, with visual distinction (solid vs dashed badge)
- [x] **P1.5** Added min_surface_score filtering from tenant_profiles

### Phase 2: Draft/Review Job Dead-End Fix — DONE ✅

- [x] **P2.1** Verified invoke() tool path (draft-all-sections.tsx) is the working path
- [x] **P2.2** Removed dead `pipeline_jobs` INSERT from AI draft route (kind='draft_section')
- [x] **P2.3** Removed dead `pipeline_jobs` INSERT from AI review route (kind='review_section')

### Phase 3: Admin Sidebar Completeness — DONE ✅

- [x] **P3.1** Add `/admin/automation` link to admin sidebar
- [x] **P3.2** Add `/admin/email-outbox` link to admin sidebar

### Phase 4: 6-Dimensional Test Sweep — VERIFIED ✅

**Dimension 1: Data Flow**
- [x] **P4.1** All portal API routes enforce tenant isolation — verified via code audit (all queries include `tenant_id = ${tenantId}`)
- [x] **P4.2** Proposal creation flow verified: spotlight → pin → create proposal → sections auto-created from `volume_required_items`
- [x] **P4.3** Library upload → atomize → review → approve flow verified: correct status transitions (draft → approved)

**Dimension 2: API Route Wiring**
- [x] **P4.4** All admin API routes require rfp_admin/master_admin — verified
- [x] **P4.5** All portal API routes validate tenant access — verified
- [x] **P4.6** No 404 routes or nonexistent table/column references found

**Dimension 3: UI Rendering**
- [x] **P4.7** Spotlights feed renders with unified scoring — pipeline scores authoritative, estimated labeled
- [x] **P4.8** Proposal workspace section editing uses canvas nodes — saves/loads correctly
- [x] **P4.9** Library dashboard filters work — category, status, source_type, outcome all wired

**Dimension 4: Auth & Permissions**
- [x] **P4.10** Partner users see only assigned sections — verified via `collaborator_stage_access` + `assigned_sections`
- [x] **P4.11** Tenant isolation enforced — all portal queries include tenant_id filter
- [x] **P4.12** Admin routes reject non-admin roles — verified

**Dimension 5: Event Emission**
- [x] **P4.13** proposal.created event fires — verified in proposals/create/route.ts
- [x] **P4.14** finder.opportunity.ingested events have correct payload — verified in pipeline ingesters
- [x] **P4.15** System-state dashboard queries catch all active event types — extended in CMS sprint to include both legacy + new event names

**Dimension 6: Cross-Service Integration**
- [x] **P4.16** Scout chain verified: frontend POST → pipeline_jobs kind='scout_source' → dispatcher picks up → source_diffs
- [x] **P4.17** Shredder chain verified: rfp.uploaded event → OnRfpUploaded workflow → shred → ai_extracted
- [x] **P4.18** Automation rules fire correctly — trigger_namespace/trigger_type match system_events

### Phase 5: Common Bug Sweep — DONE ✅

- [x] **P5.1** No wrong SQL column names found
- [x] **P5.2** No console.log violations found (all use console.error)
- [x] **P5.3** No unparameterized SQL found (all use postgres.js tagged templates or asyncpg $N params)
- [x] **P5.4** Fixed 3 files with uncaught SQL (purchases, automation/[ruleId], agents); 2 others already compliant
- [x] **P5.5** No missing error+code fields found
- [x] **P5.6** All ILIKE patterns already had proper escaping — 5 files verified clean

### Phase 6: TypeScript & Python Verification — DONE ✅

- [x] **P6.1** `npx tsc --noEmit` passes clean (0 errors)
- [x] **P6.2** All Python files in `pipeline/src/` and `services/cms/src/` pass `ast.parse()` syntax check
- [x] **P6.3** All fixes committed and pushed

---

## Commits

| Commit | Changes |
|--------|---------|
| `11bf9cf` | P2: remove dead draft/review pipeline_jobs; P3: add sidebar links; pipeline audit TODO |
| `fd7be41` | P1: unify scoring in spotlights; P5 partial: wrap uncaught SQL in 3 files |

---

## Architecture Notes (Verified Working)

1. **Ingestion Pipeline**: SAM/SBIR/Grants/DSIP → opportunities → curated_solicitations (deduped by content_hash)
2. **Shredder**: Event-driven via `finder:rfp.uploaded:end` → workflow → Claude 2x → ai_extracted + compliance
3. **Scouts**: Frontend enqueues `pipeline_jobs` kind='scout_source' → dispatcher picks up → hash-based change detection → Claude analysis → events
4. **Library Atomization**: Self-contained in frontend with TypeScript readers (DOCX/PPTX/PDF/TXT)
5. **Document Editing**: Canvas-native in browser, no pipeline document agent dependency
6. **Workflow Engine**: Event-driven via `system_events` → workflow processor → registered workflows → crash recovery via `process_instances`
7. **AI Drafting**: Client-side `invoke('proposal.draft_section')` via tool registry — NOT via pipeline_jobs
