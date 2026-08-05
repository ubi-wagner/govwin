-- 147_proposals_archived_at.sql
-- Archive retention: stamp WHEN a proposal was archived so the retention window (purge-eligibility)
-- and the "archived N days ago" display are exact — not inferred from updated_at, which any later
-- edit bumps. Set by the outcome route (and any archive path) going forward; backfilled here.

ALTER TABLE proposals ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

-- Backfill existing archived proposals from updated_at (the outcome route set updated_at=now() when
-- it archived). Best-effort — exact enough for the retention window on legacy rows.
UPDATE proposals SET archived_at = updated_at WHERE stage = 'archived' AND archived_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_proposals_archived_at ON proposals(archived_at) WHERE stage = 'archived';
