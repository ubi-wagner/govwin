# Plan: Solicitation Ingest Refactor

**Goal:** Clean separation between ingestion (getting content into the system)
and curation (analyzing/structuring content for proposals).

---

## Current State (broken)

The curation workspace mixes ingestion and curation:
- Upload zone in the workspace (should be Sources or solicitation detail)
- Bulk topic import modal with pipe-delimited paste (confusing UX)
- TopicFileDropZone embedded in the compliance panel
- Extract Topics button that fails because shredder hasn't run
- Only allows one document per solicitation (should be many)

## Target State

```
Sources Hub (/admin/sources)
  └── Hunt & capture from gov sites
  └── Paste topic tables from DSIP/AFWERX
  └── Quick-create solicitations from downloaded PDFs

Solicitation Detail (/admin/rfp-curation/[solId])
  ├── Documents tab (Layer 1)
  │   ├── Upload multiple documents
  │   ├── Tag each: rfp | instructions | amendment | supporting | template
  │   ├── Mark one as primary (auto-shred on upload)
  │   └── View extracted text status per document
  │
  ├── Topics tab (Layer 2)
  │   ├── Paste from DSIP (same parser as Sources)
  │   ├── Upload individual topic PDFs (drag-drop)
  │   ├── Add topic manually
  │   ├── Each topic can have its own documents
  │   └── Extract topics from primary document (auto on upload)
  │
  └── Compliance tab (Layer 3) — curation workspace
      ├── PDF viewer with text selection → tag as variable
      ├── Compliance matrix
      ├── AI suggestions
      └── Volumes + required items

Triage Queue (/admin/rfp-curation)
  └── Shows solicitations ready for curation
  └── Links to solicitation detail page
```

---

## Migration 021: Expand document_type CHECK

```sql
ALTER TABLE solicitation_documents
  DROP CONSTRAINT IF EXISTS solicitation_documents_document_type_check;
ALTER TABLE solicitation_documents
  ADD CONSTRAINT solicitation_documents_document_type_check
  CHECK (document_type IN (
    'source','rfp','nofo','instructions','amendment','qa',
    'template','supporting','attachment','other'
  ));

ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS document_label TEXT;
```

---

## Task Breakdown (8 discrete tasks)

### Task 1: Migration 021
- Add new document_type values
- Add `is_primary` and `document_label` columns
- 1 file, Small

### Task 2: Refactor curation workspace — remove ingestion UI
- Remove the upload link/zone from the source documents section
- Remove BulkAddTopicsModal component (move to solicitation detail)
- Remove TopicFileDropZone component (move to solicitation detail)
- Keep: Add Topic button (single manual add), Extract Topics button
- Add "Manage Documents" link → solicitation detail page
- Add "Import Topics" link → solicitation detail page or Sources
- ~50 lines removed, ~10 lines added

### Task 3: Build solicitation detail — Documents tab
- New component at the top of `/admin/rfp-curation/[solId]/page.tsx`
- OR: a dedicated sub-page `/admin/rfp-curation/[solId]/documents/page.tsx`
- Multi-file upload with document_type dropdown per file
- Mark one as primary (radio button)
- Show list of existing documents with type badges, file size, extraction status
- Primary document auto-shreds on upload (uses the new auto-shredder)
- Edit document_type and document_label inline
- Delete document
- ~150 lines new component

### Task 4: Build solicitation detail — Topics tab
- Integrated into the existing topics section of the curation workspace
- Replace the pipe-delimited BulkAddTopicsModal with the smart paste parser
  (same parser from Sources paste-import, but scoped to this solicitation)
- Keep TopicFileDropZone but improve it:
  - Shows uploaded topic PDFs with parsed topic numbers
  - Auto-creates topic records from filenames
  - Links each topic PDF to its topic record
- Keep the manual Add Topic form
- Keep Extract Topics button (now works because auto-shred ran on upload)
- ~100 lines refactored

### Task 5: Wire multi-document upload API
- Update `/api/admin/rfp-upload/route.ts` to accept:
  - `solicitationId` (attach to existing solicitation, not create new)
  - `documentType` per file
  - `isPrimary` flag
  - Multiple files in one request
- If no solicitationId, create new solicitation (current behavior)
- If solicitationId provided, just add documents to existing
- ~30 lines modified

### Task 6: Update document list in curation workspace
- The "Source Documents" section currently shows one document
- Update to show ALL documents with type badges
- Clicking a document loads it in the PDF viewer
- Primary document shown first with a star icon
- ~20 lines modified

### Task 7: Wire paste-import to solicitation context
- The Sources paste-import endpoint already works
- Add a "Paste Topics" button on the curation workspace topics section
  that opens the same paste modal but pre-fills the solicitationId
- Reuse the parser from `/api/admin/sources/[profileId]/paste-import`
- ~15 lines added

### Task 8: Customer activity on solicitation detail
- Show which customers have pinned topics from this solicitation
- Show which customers bought portals for topics
- Show proposal status per customer (outline, drafting, submitted, etc.)
- Query: tenant_pipeline_items + proposals joined through opportunities
- Display as a "Customer Interest" panel on the solicitation detail page
- Shows: customer name, topic pinned, portal purchased (Y/N), proposal stage, outcome
- This is the admin's demand signal — helps prioritize curation effort
- ~40 lines new component

### Task 9: Update admin nav + links
- Sources page gets "New Solicitation" button
- Curation workspace header gets "Documents" and "Topics" quick-nav tabs
- Triage queue items link to the correct detail page
- ~10 lines modified

---

## Execution Order

```
Task 1 (migration) — no dependencies
Task 2 (remove ingestion UI from workspace) — after Task 1
Task 3 (documents tab) — after Task 1
Task 4 (topics tab refactor) — after Task 2
Task 5 (multi-doc upload API) — after Task 1
Task 6 (document list update) — after Task 3 + 5
Task 7 (paste-import wiring) — after Task 4
Task 8 (nav + links) — after all

Parallelizable: Tasks 1, 3, 5 can run in parallel
Then: Tasks 2, 4, 6 in parallel
Then: Tasks 7, 8
```

---

## What Doesn't Change

- PDF viewer component — stays the same
- Compliance matrix UI — stays the same
- AI suggestions — stays the same
- Volumes + required items — stays the same
- Push/approve workflow — stays the same
- Event emission — stays the same
- Topic detail page — stays the same

---

## Risk

- The curation workspace is 2,400+ lines. Removing components needs care
  to not break the remaining UI.
- The BulkAddTopicsModal is referenced by the Extract Topics button flow
  (extracts topics → pre-fills the modal). Need to preserve that flow
  but use the new paste parser instead.

## Estimated Size

- Migration: 10 lines
- Components: ~300 lines new/refactored
- API changes: ~50 lines
- Removals: ~200 lines from curation workspace
- Net: roughly neutral line count, much cleaner architecture
