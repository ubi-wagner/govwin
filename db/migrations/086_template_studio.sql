-- Migration 086: Template Studio foundations (E3) — DB-backed, expert-editable
-- templates + per-required-item template linkage + expert notes.
--
-- document_templates exists (mig 017) but was never queried; the create-route
-- resolved templates from an in-code registry (lib/templates). This makes
-- templates DB-backed and expert-authored:
--   * canvas_document JSONB — the full CanvasDocument starter BODY (nodes/headings/
--     tables), DISTINCT from canvas_preset (the CanvasRules format spec). The
--     create-route reads this DB body when a required-item links a template_id,
--     and falls back to the in-code registry otherwise.
--   * storage_key nullable — an inline-body template needs no S3 object.
-- volume_required_items.template_id — links a required item to its template.
-- expert_notes (volumes + items) — the curator's per-volume / per-section guidance,
--   flowed into the V0 section context to ground the agent fill (feeds E5.2).

ALTER TABLE document_templates
    ADD COLUMN IF NOT EXISTS canvas_document JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE document_templates ALTER COLUMN storage_key DROP NOT NULL;

ALTER TABLE volume_required_items
    ADD COLUMN IF NOT EXISTS template_id  UUID REFERENCES document_templates(id),
    ADD COLUMN IF NOT EXISTS expert_notes TEXT;

ALTER TABLE solicitation_volumes
    ADD COLUMN IF NOT EXISTS expert_notes TEXT;
