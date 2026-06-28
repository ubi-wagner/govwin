-- Migration 074: section-level accept/lock lifecycle + document (volume) grouping
--
-- The customer-facing draft → regen → accept → lock loop (V1 core feature) needs:
--   1. Section-level lock state (the proposal-level lock is the separate
--      final/download lock). A locked section is the unit of "accepted" content
--      and freezes editing until unlocked.
--   2. Each section's parent document/volume identity (Technical Volume, Cost
--      Volume, ...) so a stage gate can require "every section of every document
--      for this stage is locked". proposal_sections was previously flat; the
--      volume identity already exists upstream in the compliance matrix
--      (solicitation_volumes) and is set on the section at proposal-create time.
--
-- accepted_by / accepted_at / completed_stage / completed_at already exist
-- (migration 046); this adds the lock + grouping columns.

ALTER TABLE proposal_sections
  ADD COLUMN IF NOT EXISTS is_locked     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_by     UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS volume_name   TEXT,
  ADD COLUMN IF NOT EXISTS volume_number INT;

-- Gate/status queries scan locked state per proposal.
CREATE INDEX IF NOT EXISTS idx_proposal_sections_lock
  ON proposal_sections (proposal_id, is_locked);

-- Document-grouped status views order by volume then section.
CREATE INDEX IF NOT EXISTS idx_proposal_sections_volume
  ON proposal_sections (proposal_id, volume_number, section_number);
