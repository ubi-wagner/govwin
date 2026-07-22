# CMS Visual Editor Migration + Status Displays — Sprint TODO

**Date:** 2026-05-30
**Decisions:** Editor → CMS SPA, remove old /admin/content, status tabs on system-state

---

## Task List

### Phase 1: CMS Backend — Page Block API (FastAPI)

- [x] **T1.1** Add `services/cms/src/routers/page_blocks.py` — CRUD for cms_content page_blocks via SHARED_DATABASE_URL
  - GET /page-blocks?page={name} — list blocks for a page
  - PATCH /page-blocks — batch save drafts (with version history)
  - POST /page-blocks/publish — batch publish
  - POST /page-blocks/submit-review — submit for review
  - POST /page-blocks/approve — approve pending (master_admin)
  - POST /page-blocks/reject — reject to draft
  - POST /page-blocks/reorder — atomic reorder (accept ordered ID array)
  - POST /page-blocks/add-blank — create blank block with page/section tags
  - DELETE /page-blocks/{id} — delete block
- [x] **T1.2** AI content generation (in same router)
  - POST /page-blocks/ai/generate — generate content for section type
  - POST /page-blocks/ai/revise — revise existing content
  - POST /page-blocks/ai/from-url — generate from URL
- [x] **T1.3** Register routers in `services/cms/src/main.py`
- [x] **T1.4** Add ISR revalidation trigger — POST to Next.js /api/admin/content/revalidate

### Phase 2: CMS SPA — Visual Editor Page

- [x] **T2.1** Create `services/cms/frontend/src/pages/PageEditor.tsx` — split-pane visual editor (1104 lines)
- [x] **T2.2** Create `services/cms/frontend/src/components/MetadataEditor.tsx` — port from Next.js (690 lines)
- [x] **T2.3** Add route in `services/cms/frontend/src/App.tsx` — /pages and /pages/:page routes
- [x] **T2.4** Add sidebar link in Layout.tsx — "Page Editor" under Content section
- [x] **T2.5** Add public page URL config — VITE_FRONTEND_URL env var for iframe src

### Phase 3: Block Ordering UX

- [x] **T3.1** Move Up/Down buttons on each block in the editor
- [x] **T3.2** Add Blank Block button — creates block with empty title/body, auto display_order
- [x] **T3.3** Reorder API — POST /page-blocks/reorder accepts [id1, id2, id3], sets display_order 0,1,2

### Phase 4: RFP Pipeline Admin Cleanup

- [x] **T4.1** Redirect /admin/content → /admin/content/editor
- [x] **T4.2** Add "Open in CMS Portal" link on /admin/content/editor
- [x] **T4.3** Update admin sidebar — "Content" link points to editor, "CMS Portal" external link

### Phase 5: System State Dashboard — New Tabs

- [x] **T5.1** Content Pipeline tab — block status summary, pending review pages, 7-day event timeline
- [x] **T5.2** Email Automation tab — rule execution log, email lifecycle events, summary cards
- [x] **T5.3** Tab integration with badges (pending count, failure count)

### Phase 6: E2E Audit & Fixes

- [ ] **T6.1** Fix: `created_by` UUID type mismatch in add-blank endpoint (page_blocks.py)
- [ ] **T6.2** Fix: Missing `ai_revision_started` event emission (page_blocks.py)
- [ ] **T6.3** Fix: Revalidation maps security→/infosec, get-started→/pricing (page_blocks.py)
- [ ] **T6.4** Fix: Section tag detection inconsistency (PageEditor.tsx)
- [ ] **T6.5** Fix: Revert button state flickers (PageEditor.tsx)
- [ ] **T6.6** Fix: AI error modal stays open on failure (PageEditor.tsx)
- [ ] **T6.7** Fix: Remove get-started, add team/customers to PAGES array (PageEditor.tsx)
- [ ] **T6.8** Fix: Add 8 missing SECTION_LABELS (PageEditor.tsx)
- [ ] **T6.9** Fix: Steps editor dual field names → standardize to `num` (MetadataEditor.tsx)
- [ ] **T6.10** Fix: Add `?_preview=1` support to 6 pages (how-it-works, engine, the-expert, value, infosec, apply)

### Phase 7: Final Verification

- [ ] **T7.1** TypeScript check passes (npx tsc --noEmit)
- [ ] **T7.2** Python syntax check passes
- [ ] **T7.3** Commit and push all fixes

---

## Audit Findings (2026-05-30)

### Data Sync: CONFIRMED
- 123 page_blocks seeded across 12 pages, all `status='published'`
- Tag format identical everywhere: lowercase kebab-case in PostgreSQL TEXT arrays
- Editor PAGES array, seed data, and public page queries all use same tag names

### Gaps Found
| # | Severity | Gap |
|---|----------|-----|
| 1 | HIGH | Resources page uses content_type filter, not getPageBlocks() |
| 2 | HIGH | get-started is a redirect (→ /pricing), editing it does nothing |
| 3 | MEDIUM | Team/Customers pages not in editor PAGES array |
| 4 | HIGH | 10 section types lack structured MetadataEditors |
| 5 | HIGH | 6 pages don't support ?_preview=1 (broken CMS iframe preview) |
| 6 | MEDIUM | security→/infosec and get-started→/pricing revalidation wrong |
| 7 | LOW | 8 sections missing friendly labels |
| 8 | LOW | 'form' label exists but no blocks use it |

### Code Bugs Found
| # | Severity | Bug |
|---|----------|-----|
| 1 | CRITICAL | `created_by` gets email string instead of UUID (page_blocks.py) |
| 2 | CRITICAL | Missing ai_revision_started event (page_blocks.py) |
| 3 | MAJOR | Section tag detection inconsistent with rest of file (PageEditor.tsx) |
| 4 | MINOR | Revert button state flickers (PageEditor.tsx) |
| 5 | MINOR | AI error modal stays open on failure (PageEditor.tsx) |
| 6 | MINOR | Steps editor maintains redundant num/number fields (MetadataEditor.tsx) |
