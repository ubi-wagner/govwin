-- 070_proposal_sections_content_jsonb.sql
--
-- FE-20: Change proposal_sections.content column type from TEXT to JSONB.
--
-- Background: The section content field holds structured JSON (the canvas block-based
-- document format). All write paths cast to ::jsonb at insertion time (e.g. via
-- postgres.js tagged templates with jsonb parameters), so every value in the column
-- is already valid JSON. Changing the storage type to JSONB provides:
--   - Explicit schema semantics (the type declares what it stores)
--   - Server-side JSON validation on any future direct inserts
--   - Potential for GIN indexing on content structure in a future migration
--
-- The USING clause re-parses every stored TEXT value as JSONB during the ALTER.
-- All rows are valid JSON, so this cast is safe. This rewrites the column in-place
-- (expected and acceptable pre-launch with zero active customer data).
--
-- Source: AUDIT_PRELAUNCH_20260428 §Audit4-Break4 / LAUNCH_TODO FE-20

ALTER TABLE proposal_sections
  ALTER COLUMN content TYPE jsonb USING content::jsonb;
