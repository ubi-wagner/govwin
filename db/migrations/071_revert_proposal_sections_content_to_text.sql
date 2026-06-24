-- =============================================================================
-- Migration 071: revert proposal_sections.content JSONB -> TEXT
-- -----------------------------------------------------------------------------
-- Migration 070 (removed) converted proposal_sections.content TEXT -> JSONB.
-- That broke ~15 reader sites across frontend + pipeline which read the column as
-- a JSON *string* (JSON.parse(content), content.length, content[:N], json.loads):
-- postgres.js / asyncpg return a JSONB column as an already-parsed object, not a
-- string, so those reads crash or emit garbage. Reverting to TEXT restores the
-- working behavior (values are valid JSON strings the readers parse). Explicit
-- JSONB semantics (FE-20) is deferred until EVERY reader is updated to handle
-- objects (frontend save/compliance/package/review/advance/harvest; pipeline
-- context/tools/generate_preview/compliance_reviewer/packaging_specialist).
--
-- USING content::text is safe whether the column is currently JSONB (070 applied
-- to this env) or already TEXT (070 removed before it ran here) — text::text is
-- an identity cast.
-- =============================================================================

ALTER TABLE proposal_sections
  ALTER COLUMN content TYPE text USING content::text;
