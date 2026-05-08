-- ============================================================================
-- Migration 029: Proposal Portal — Configurable gates + lock tracking
-- ============================================================================

-- Simplify stage model from 7 fixed stages to 2-4 configurable gates
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_stage_check;

-- Migrate old stage values BEFORE adding new constraint
UPDATE proposals SET stage = 'draft'
  WHERE stage IN ('outline','pink_team','red_team','gold_team');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'proposals' AND constraint_name = 'proposals_stage_check'
  ) THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_stage_check
      CHECK (stage IN ('draft','review','final','submitted','archived'));
  END IF;
END $$;

-- Gate config + lock tracking columns
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS gate_config JSONB DEFAULT '["draft","final"]'::jsonb,
  ADD COLUMN IF NOT EXISTS lock_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_unlocked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unlock_deadline TIMESTAMPTZ;

-- Collaborator enhancements
ALTER TABLE proposal_collaborators
  ADD COLUMN IF NOT EXISTS assigned_sections UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS dropbox_enabled BOOLEAN DEFAULT true;
