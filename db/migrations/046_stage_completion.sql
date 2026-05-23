-- Migration 046: Stage Completion Tracking
-- Tracks which stage each section was completed/accepted in, and records
-- full snapshots when a stage is completed so content history is preserved.

-- Track which stage each section was completed/accepted in
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS
    completed_stage TEXT;
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS
    completed_at TIMESTAMPTZ;
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS
    accepted_by UUID REFERENCES users(id);
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS
    accepted_at TIMESTAMPTZ;

-- Stage completion snapshots — records the state of all sections when a stage completes
CREATE TABLE IF NOT EXISTS stage_completion_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,
    completed_by UUID REFERENCES users(id),
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- Snapshot of all sections at completion
    sections_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- [{section_id, title, version, status, char_count}]

    -- Summary
    total_sections INTEGER NOT NULL DEFAULT 0,
    sections_complete INTEGER NOT NULL DEFAULT 0,
    sections_approved INTEGER NOT NULL DEFAULT 0,

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scs_proposal ON stage_completion_snapshots(proposal_id, stage);
