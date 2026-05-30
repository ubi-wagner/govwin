# CMS Visual Editor Migration + Status Displays — Sprint TODO

**Date:** 2026-05-29
**Decisions:** Editor → CMS SPA, remove old /admin/content, status tabs on system-state

---

## Task List

### Phase 1: CMS Backend — Page Block API (FastAPI)

- [ ] **T1.1** Add `services/cms/src/routers/page_blocks.py` — CRUD for cms_content page_blocks via SHARED_DATABASE_URL
  - GET /page-blocks?page={name} — list blocks for a page
  - PATCH /page-blocks — batch save drafts (with version history)
  - POST /page-blocks/publish — batch publish
  - POST /page-blocks/submit-review — submit for review
  - POST /page-blocks/approve — approve pending (master_admin)
  - POST /page-blocks/reject — reject to draft
  - POST /page-blocks/reorder — atomic reorder (accept ordered ID array)
  - POST /page-blocks/add-blank — create blank block with page/section tags
  - DELETE /page-blocks/{id} — delete block
- [ ] **T1.2** Add `services/cms/src/routers/page_blocks_ai.py` — AI content generation
  - POST /page-blocks/ai/generate — generate content for section type
  - POST /page-blocks/ai/revise — revise existing content
  - POST /page-blocks/ai/from-url — generate from URL
- [ ] **T1.3** Register routers in `services/cms/src/main.py`
- [ ] **T1.4** Add ISR revalidation trigger — POST to Next.js /api/admin/content/revalidate

### Phase 2: CMS SPA — Visual Editor Page

- [ ] **T2.1** Create `services/cms/frontend/src/pages/PageEditor.tsx` — split-pane visual editor
  - Left: page selector, block list with accordion editors
  - Right: iframe loading Next.js public page URL with ?_preview=1
  - Move up/down buttons on each block
  - Add blank block button per section
  - AI tools (generate, revise, from URL)
  - Draft/submit/approve/publish workflow
  - Version history panel
- [ ] **T2.2** Create `services/cms/frontend/src/components/MetadataEditor.tsx` — port from Next.js
- [ ] **T2.3** Add route in `services/cms/frontend/src/App.tsx` — /pages route
- [ ] **T2.4** Add sidebar link in Layout.tsx — "Page Editor" under Content section
- [ ] **T2.5** Add public page URL config — FRONTEND_URL env var for iframe src

### Phase 3: Block Ordering UX

- [ ] **T3.1** Move Up/Down buttons on each block in the editor
- [ ] **T3.2** Add Blank Block button — creates block with empty title/body, auto display_order
- [ ] **T3.3** Reorder API — POST /page-blocks/reorder accepts [id1, id2, id3], sets display_order 0,1,2

### Phase 4: RFP Pipeline Admin Cleanup

- [ ] **T4.1** Redirect /admin/content → /admin/content/editor (keep editor as fallback)
- [ ] **T4.2** Add "Open in CMS" link on /admin/content/editor pointing to CMS SPA /pages
- [ ] **T4.3** Update admin sidebar — "Content" link points to editor, add "CMS Portal" external link

### Phase 5: System State Dashboard — New Tabs

- [ ] **T5.1** Content Pipeline tab — shows content.submitted_for_review, content.approved, content.rejected, content.page_published events grouped by page
- [ ] **T5.2** Email Automation tab — shows automation rule → email queued → HITL review → sent chain with status at each step
- [ ] **T5.3** Automation Log display — render automation_log entries (already queried in API, never displayed)

### Phase 6: Verification

- [ ] **T6.1** TypeScript check passes (npx tsc --noEmit)
- [ ] **T6.2** Python syntax check passes (py_compile on all CMS files)
- [ ] **T6.3** End-to-end flow: CMS SPA page editor → save draft → preview in iframe → publish → public page updates
- [ ] **T6.4** Block ordering: add 3 blanks → reorder → save → preview shows correct order
- [ ] **T6.5** System state dashboard shows content + email events
