-- 220_project_deliverable_documents.sql
--
-- A deliverable can be AUTHORED, not only uploaded.
--
-- ── WHY THIS IS A LINK AND NOT A NEW SUBSYSTEM ───────────────────────────────────────────────
-- The build portal already has everything a project needs to produce a report, a deck, a workbook
-- or a PDF: `tenant_documents` holds a CanvasDocument, the canvas editor edits it, the compliance
-- floor measures it, and `…/documents/[id]/export` renders docx · pptx · xlsx · pdf. None of that
-- is proposal-specific. What was missing was one column saying "this deliverable IS that document".
--
-- Building a parallel authoring path for projects would have meant a second editor to keep in step
-- with the first, and a second export pipeline to keep correct — the same argument that made
-- project ToDos a projection onto the platform queue rather than a queue of their own.
--
-- ── THE TWO FACTS ARE STILL TWO FACTS ────────────────────────────────────────────────────────
-- `storage_key` (an uploaded file) and `document_id` (an authored canvas) are two ways to ATTACH
-- evidence. Neither is acceptance: `accepted_at` remains the separate, deliberate act by a
-- tenant_admin. Authoring a deck no more closes a CLIN than uploading a PDF does.
--
-- A deliverable may carry BOTH — a signed scan of the report someone authored here is a normal
-- thing to have — so this is not an XOR. What it must never be is *neither* at acceptance time, and
-- that is enforced in `acceptDeliverable`, where the message can say which is missing.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

ALTER TABLE project_deliverables
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES tenant_documents(id) ON DELETE SET NULL;

-- `ON DELETE SET NULL`, deliberately, and not CASCADE: deleting the document must not delete the
-- DELIVERABLE. The obligation to produce it survives losing the draft — that is the whole reason a
-- deliverable is a row rather than a file.

-- One document backs at most one deliverable. Without this the same draft could be pointed at by
-- two obligations, and accepting one would look like evidence for the other.
CREATE UNIQUE INDEX IF NOT EXISTS uq_project_deliverables_document
  ON project_deliverables (document_id)
  WHERE document_id IS NOT NULL;
