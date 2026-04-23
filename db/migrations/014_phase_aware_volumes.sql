-- 014_phase_aware_volumes.sql
--
-- Adds applies_to_phase filtering so a single solicitation can
-- serve both Phase I and Phase II topics with different volume
-- structures (different page limits, different required docs).
--
-- Purely additive. Idempotent.

ALTER TABLE solicitation_volumes
  ADD COLUMN IF NOT EXISTS applies_to_phase TEXT[];

ALTER TABLE volume_required_items
  ADD COLUMN IF NOT EXISTS applies_to_phase TEXT[];
