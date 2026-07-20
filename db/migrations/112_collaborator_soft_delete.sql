-- 112_collaborator_soft_delete.sql
-- Collaborators are NEVER hard-deleted. "Removing" a collaborator marks revoked_at so
-- the full history is preserved (they may have contributed once and that record must
-- endure — the same layered-memory principle the product is built on). Access-granting
-- reads filter `revoked_at IS NULL`; the Team list still SHOWS revoked collaborators
-- (badged inactive). Re-inviting a revoked collaborator REACTIVATES the same row.
-- See docs/MULTI_MEMBERSHIP_IDENTITY_DESIGN.md.

ALTER TABLE proposal_collaborators
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

-- Fast "active collaborators on this proposal" lookups (the common access path).
CREATE INDEX IF NOT EXISTS idx_proposal_collaborators_active
  ON proposal_collaborators (proposal_id)
  WHERE revoked_at IS NULL;
