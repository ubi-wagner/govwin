-- Migration 045: Complete Revision Tracking for Collaborative Editing
-- Tracks every version of every document across the platform:
-- AI generations, human edits, AI revisions, workflow changes, curation changes.

-- 1. Enhance canvas_versions with source tracking
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'human_edit'
    CHECK (source IN ('ai_draft', 'human_edit', 'ai_revision', 'library_import', 'template', 'system'));
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS ai_instruction TEXT;
    -- The prompt/instruction used for AI drafts and revisions
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS ai_model TEXT;
    -- Which Claude model generated this version
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS parent_version_id UUID REFERENCES canvas_versions(id);
    -- Links revision chain: v3 was created by revising v2
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS char_count INTEGER;
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS word_count INTEGER;
ALTER TABLE canvas_versions ADD COLUMN IF NOT EXISTS edit_summary TEXT;
    -- Brief description of what changed (auto-generated or user-provided)

-- Index for efficient version history queries
CREATE INDEX IF NOT EXISTS idx_cv_section_version ON canvas_versions(section_id, version_number DESC);
CREATE INDEX IF NOT EXISTS idx_cv_source ON canvas_versions(source);

-- 2. Curation revision tracking (for admin solicitation workspace)
CREATE TABLE IF NOT EXISTS curation_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,

    -- WHO
    actor_id UUID REFERENCES users(id),
    actor_email TEXT,

    -- WHAT changed
    revision_type TEXT NOT NULL CHECK (revision_type IN (
        'compliance_updated', 'annotation_added', 'annotation_removed',
        'outline_updated', 'volume_added', 'volume_removed',
        'item_added', 'item_updated', 'item_removed',
        'document_uploaded', 'ai_extracted',
        'review_requested', 'review_approved', 'review_rejected',
        'status_changed', 'namespace_set'
    )),

    -- DETAILS
    field_name TEXT,      -- which field changed (e.g., 'page_limit_technical')
    old_value TEXT,       -- previous value (stringified)
    new_value TEXT,       -- new value (stringified)
    metadata JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cr_solicitation ON curation_revisions(solicitation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cr_actor ON curation_revisions(actor_id);

-- 3. Workflow execution revision tracking
-- (process_instances + process_instance_transitions already exist from 043)
-- Add a column to link workflow steps to the content they modified
ALTER TABLE process_instance_transitions ADD COLUMN IF NOT EXISTS
    affected_entity_type TEXT;  -- 'proposal_section', 'solicitation', 'library_unit'
ALTER TABLE process_instance_transitions ADD COLUMN IF NOT EXISTS
    affected_entity_id UUID;
ALTER TABLE process_instance_transitions ADD COLUMN IF NOT EXISTS
    content_version_before INT;
ALTER TABLE process_instance_transitions ADD COLUMN IF NOT EXISTS
    content_version_after INT;
