-- Migration 009: Transition from Google Drive to local filesystem storage
--
-- Renames drive_files → stored_files, swaps GIDs for filesystem paths.
-- The DB remains the source of truth; filesystem is just blob storage.
-- Railway volume mounted at STORAGE_ROOT (/data by default).

-- ── Rename table ───────────────────────────────────────────────
ALTER TABLE drive_files RENAME TO stored_files;

-- ── Add local storage columns ──────────────────────────────────
ALTER TABLE stored_files
    ADD COLUMN IF NOT EXISTS storage_path TEXT,          -- relative path under STORAGE_ROOT
    ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
    ADD COLUMN IF NOT EXISTS storage_backend TEXT DEFAULT 'local';  -- 'local' or 'r2' (future)

-- ── Populate storage_path from gid where possible ──────────────
-- Existing rows had Google Drive GIDs; mark them as legacy
UPDATE stored_files
SET storage_backend = 'gdrive_legacy'
WHERE gid IS NOT NULL AND storage_path IS NULL;

-- ── Index on storage_path for fast lookups ─────────────────────
CREATE INDEX IF NOT EXISTS idx_stored_files_path ON stored_files(storage_path)
    WHERE storage_path IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stored_files_backend ON stored_files(storage_backend);

-- ── Update tenant columns: rename drive_ prefixes to storage_ ──
-- Add new path-based columns (keep old GID columns for migration period)
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS storage_root_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_finder_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_reminders_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_binder_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_grinder_path TEXT,
    ADD COLUMN IF NOT EXISTS storage_uploads_path TEXT;

-- ── Update documents table for local storage ───────────────────
ALTER TABLE documents
    ADD COLUMN IF NOT EXISTS storage_path TEXT,           -- replaces drive_gid
    ADD COLUMN IF NOT EXISTS storage_backend TEXT DEFAULT 'local';

CREATE INDEX IF NOT EXISTS idx_docs_storage ON documents(storage_path)
    WHERE storage_path IS NOT NULL;

-- ── Update system_config for local storage paths ───────────────
INSERT INTO system_config (key, value, description) VALUES
    ('storage.root_path',            '"/"', 'Root storage path'),
    ('storage.opportunities_path',   '"opportunities"', 'Global opportunities folder'),
    ('storage.customers_path',       '"customers"', 'Per-tenant customer folders'),
    ('storage.templates_path',       '"system/templates"', 'System templates folder'),
    ('storage.backend',              '"local"', 'Storage backend: local or r2'),
    ('storage.provisioned',          'false', 'Whether global storage has been provisioned')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE stored_files IS 'File index — tracks all files in local storage (Railway volume) or R2 (archive). Formerly drive_files.';
COMMENT ON COLUMN stored_files.gid IS 'Legacy: Google Drive file ID. NULL for locally-stored files.';
COMMENT ON COLUMN stored_files.storage_path IS 'Relative path under STORAGE_ROOT for locally-stored files.';
COMMENT ON COLUMN stored_files.storage_backend IS 'Where the file lives: local (Railway volume), r2 (archive), gdrive_legacy (old).';
