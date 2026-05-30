# Pipeline E2E Audit & Fix — Sprint TODO

**Date:** 2026-05-30
**Scope:** Full pipeline audit — ingestion, scoring, scouts, doc builders, uploads, atomization, library

---

## Audit Findings Summary

### Architecture Verification (6 suspects checked)
| Suspect | Result | Severity |
|---------|--------|----------|
| Workflow monitor table name | CORRECT (uses `process_instances`) | — |
| Dual scoring systems | **CRITICAL MISMATCH** | HIGH |
| Agent task queue bypassed | Dead `pipeline_jobs` for draft/review | MEDIUM |
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
| Admin Sidebar | **GAPS** | `/admin/automation` and `/admin/email-outbox` orphaned |
| Portal Pipeline | Functional | — |
| Portal Section Editor | Functional (canvas-based) | — |
| Portal Library Upload+Review | Functional, connected | — |
| Portal Sidebar | Perfect | — |
| Portal Spotlight Detail | Functional, rich | — |

---

## Task List

### Phase 1: Scoring Unification (CRITICAL)

**Problem:** Two independent scoring systems produce different rankings:
- **Pipeline** (`scoring/engine.py` → `tenant_pipeline_items`): NAICS 0-30, keyword 0-25, agency 0-20, set_aside 0-10, type 0-10, timeline 0-5 = 100pts max. Uses `tenant_profiles` table.
- **Spotlights** (`spotlights/page.tsx`): tech_focus 15pts each, agency 20pts, program 15pts, library 10pts. Uses `applications` table.

**Fix:** Spotlights should prefer pre-computed pipeline scores when available, fall back to a quick estimate for unscored opportunities, and clearly distinguish "scored" vs "estimated".

- [ ] **P1.1** Refactor spotlights page to LEFT JOIN `tenant_pipeline_items` for pre-computed scores
- [ ] **P1.2** Keep lightweight estimation for opportunities not yet in `tenant_pipeline_items`, but label as "est."
- [ ] **P1.3** Sort: pipeline-scored first (by total_score DESC), then estimated (by estimate DESC)
- [ ] **P1.4** Display pipeline score when available, estimated score when not, with visual distinction
- [ ] **P1.5** Verify pipeline scoring uses `applications` data when `tenant_profiles` is sparse (many tenants only have applications data)

### Phase 2: Draft/Review Job Dead-End Fix

**Problem:** Frontend AI draft/review routes INSERT into `pipeline_jobs` with `kind='draft_section'`/`kind='review_section'`, but the pipeline dispatcher only handles 3 kinds: `ingest`, `shred_solicitation`, `scout_source`. These jobs sit forever in `pending`.

**Fix:** Either add dispatcher handling or remove the dead INSERT.

- [ ] **P2.1** Verify: does the `invoke()` tool path (draft-all-sections.tsx) work independently?
- [ ] **P2.2** If invoke() is the working path: remove dead `pipeline_jobs` INSERT from AI draft/review API routes
- [ ] **P2.3** If pipeline_jobs is intended: add `draft_section` and `review_section` routing in `dispatcher.py`
- [ ] **P2.4** Clean up any orphaned `pipeline_jobs` rows with kind='draft_section'/'review_section' in pending status

### Phase 3: Admin Sidebar Completeness

- [ ] **P3.1** Add `/admin/automation` link to admin sidebar (Automation section)
- [ ] **P3.2** Add `/admin/email-outbox` link to admin sidebar (System section)

### Phase 4: 6-Dimensional Test Sweep

**Dimension 1: Data Flow** — verify DB reads/writes are correct
- [ ] **P4.1** Verify all portal API routes enforce tenant isolation (tenant_id check)
- [ ] **P4.2** Verify proposal creation flow: spotlight → pin → create proposal → sections auto-created from `volume_required_items`
- [ ] **P4.3** Verify library upload → atomize → review → approve flow writes correct status transitions

**Dimension 2: API Route Wiring** — verify endpoints return expected data
- [ ] **P4.4** Verify all admin API routes require proper role (rfp_admin/master_admin)
- [ ] **P4.5** Verify all portal API routes validate tenant access before data return
- [ ] **P4.6** Check for any API routes that 404 or reference nonexistent tables/columns

**Dimension 3: UI Rendering** — verify pages display data correctly
- [ ] **P4.7** Verify spotlights feed renders with unified scoring after P1 fix
- [ ] **P4.8** Verify proposal workspace section editing saves/loads canvas nodes correctly
- [ ] **P4.9** Verify library dashboard filters (category, status, source_type, outcome) work

**Dimension 4: Auth & Permissions** — verify role enforcement
- [ ] **P4.10** Verify partner_user can only see assigned sections in proposal workspace
- [ ] **P4.11** Verify tenant_user cannot access other tenants' data via URL manipulation
- [ ] **P4.12** Verify admin routes reject tenant_user/tenant_admin roles

**Dimension 5: Event Emission** — verify events fire correctly
- [ ] **P4.13** Verify proposal.created event fires when proposal is created
- [ ] **P4.14** Verify finder.opportunity.ingested events have correct payload structure
- [ ] **P4.15** Verify system-state dashboard queries catch all active event types

**Dimension 6: Cross-Service Integration** — verify pipeline ↔ frontend ↔ CMS
- [ ] **P4.16** Verify scout job creation (frontend) → pickup (pipeline dispatcher) → result (source_diffs)
- [ ] **P4.17** Verify shredder event chain: rfp.uploaded → workflow → shred → ai_extracted → curation workspace
- [ ] **P4.18** Verify automation rules fire correctly on system_events

### Phase 5: Common Bug Sweep

- [ ] **P5.1** Grep for SQL queries with wrong column names (cross-ref CLAUDE_CLIFFNOTES)
- [ ] **P5.2** Grep for `console.log` (should be `console.error` only per CLAUDE.md)
- [ ] **P5.3** Grep for unparameterized SQL (string interpolation in queries)
- [ ] **P5.4** Grep for missing try/catch around `await sql` calls
- [ ] **P5.5** Grep for missing `error` + `code` fields in error responses
- [ ] **P5.6** Grep for ILIKE patterns without escaped `%_\` characters

### Phase 6: TypeScript & Python Verification

- [ ] **P6.1** `npx tsc --noEmit` passes clean
- [ ] **P6.2** Python syntax check on all pipeline files
- [ ] **P6.3** Commit and push all fixes

---

## Architecture Notes (Verified Working)

These areas were audited and found to be correctly wired — no changes needed:

1. **Ingestion Pipeline**: SAM/SBIR/Grants/DSIP → opportunities → curated_solicitations (deduped by content_hash)
2. **Shredder**: Event-driven via `finder:rfp.uploaded:end` → workflow → Claude 2x → ai_extracted + compliance
3. **Scouts**: Frontend enqueues `pipeline_jobs` kind='scout_source' → dispatcher picks up → hash-based change detection → Claude analysis → events
4. **Library Atomization**: Self-contained in frontend with TypeScript readers (DOCX/PPTX/PDF/TXT) — intentional, no pipeline delegation
5. **Document Editing**: Canvas-native in browser, no pipeline document agent dependency
6. **Workflow Engine**: Event-driven via `system_events` → workflow processor → registered workflows → crash recovery via `process_instances`
