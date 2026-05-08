-- ============================================================================
-- 030: Library Enhancements — Structured atom storage, seminal tracking
-- ============================================================================

-- Structured CanvasNode storage (the rich atom, not just text)
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS canvas_nodes JSONB,
  ADD COLUMN IF NOT EXISTS document_metadata JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source_filename TEXT,
  ADD COLUMN IF NOT EXISTS source_storage_key TEXT,
  ADD COLUMN IF NOT EXISTS heading_text TEXT,
  ADD COLUMN IF NOT EXISTS char_offset INT,
  ADD COLUMN IF NOT EXISTS char_length INT,
  ADD COLUMN IF NOT EXISTS is_seminal BOOLEAN DEFAULT false;

-- Seminal = the original uploaded file row. Never deleted, only archived.
-- Child atoms have parent_unit_id pointing to the seminal row.

-- Index for finding children of a seminal unit efficiently
CREATE INDEX IF NOT EXISTS idx_library_parent ON library_units(parent_unit_id) WHERE parent_unit_id IS NOT NULL;

-- Index for finding seminal units
CREATE INDEX IF NOT EXISTS idx_library_seminal ON library_units(tenant_id, is_seminal) WHERE is_seminal = true;
