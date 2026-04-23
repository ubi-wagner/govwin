-- 013_topics_as_opportunities.sql
--
-- Solicitation (umbrella BAA/CSO) vs. Topic (discrete pursuit unit)
-- ================================================================
-- Until now, opportunities and curated_solicitations were 1:1 — every
-- ingested listing produced one opportunity and one triage row. That
-- breaks down for real DoD BAAs: one BAA contains 100-300+ topics,
-- each of which is what a customer actually pursues.
--
-- Model after this migration:
--
--   curated_solicitations  = the UMBRELLA (DoD SBIR 25.1 BAA)
--     ├── solicitation_documents  (primary RFP PDF + amendments + Q&A)
--     ├── solicitation_volumes    (response structure — Volumes 1-5)
--     ├── volume_required_items   (per-artifact compliance)
--     └── opportunities[]         (the topics/tasks/focus-areas —
--                                   what customers pin + buy portals for)
--
-- Each opportunity is now a TOPIC by default:
--   - links back to its parent solicitation via solicitation_id
--   - carries topic-specific metadata (topic_number, branch,
--     tech_focus_areas, open/closed status, POC)
--   - inherits compliance rules from the parent solicitation
--   - is what the customer pins via Spotlight
--
-- Backward compat:
--   - Existing opportunities (38+ rows in prod) stay valid as
--     "single-topic solicitations" — each is backfilled with
--     solicitation_id pointing to its own curated_solicitations row.
--   - curated_solicitations.opportunity_id becomes nullable so
--     an umbrella can exist without a landing-page opportunity
--     (manual uploads of a BAA PDF with no topics yet extracted).
--
-- Purely additive. Idempotent via IF NOT EXISTS.

-- ============================================================================
-- 1. Add solicitation + topic metadata columns to opportunities
-- ============================================================================

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS solicitation_id UUID
    REFERENCES curated_solicitations(id) ON DELETE SET NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_number TEXT;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_branch TEXT;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_status TEXT DEFAULT 'open'
    CHECK (topic_status IN ('open','pre_release','closed','awarded','withdrawn'));

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS tech_focus_areas TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS poc_name TEXT;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS poc_email TEXT;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Index for the canonical "list topics under this solicitation" query
CREATE INDEX IF NOT EXISTS idx_opps_solicitation
  ON opportunities (solicitation_id, topic_number ASC)
  WHERE solicitation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_opps_topic_status
  ON opportunities (topic_status)
  WHERE topic_status != 'closed';

-- ============================================================================
-- 2. curated_solicitations becomes the umbrella anchor
-- ============================================================================

-- solicitation_type distinguishes single-topic (a Grants.gov NOFO, a
-- solo CSO posting) from multi-topic (a DoD SBIR BAA with 200 topics).
ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS solicitation_type TEXT DEFAULT 'single'
    CHECK (solicitation_type IN ('single','multi_topic'));

-- solicitation_title/number for umbrella-level display (distinct from
-- the landing opportunity's title/number). Optional — falls back to
-- the linked opportunity's fields if null.
ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS solicitation_title TEXT;

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS solicitation_number TEXT;

-- ============================================================================
-- 3. Backfill existing opportunities
-- ============================================================================
-- Every existing opportunity has a 1:1 curated_solicitations via the
-- existing cs.opportunity_id FK. Backfill so each opportunity knows
-- its own solicitation_id, making them valid "single-topic" rows.

UPDATE opportunities o
SET solicitation_id = cs.id
FROM curated_solicitations cs
WHERE cs.opportunity_id = o.id
  AND o.solicitation_id IS NULL;

-- Set solicitation_title/number from the opportunity for the 1:1 rows,
-- so the umbrella has display data.
UPDATE curated_solicitations cs
SET solicitation_title = o.title,
    solicitation_number = o.solicitation_number
FROM opportunities o
WHERE cs.opportunity_id = o.id
  AND cs.solicitation_title IS NULL;

-- ============================================================================
-- 4. Helper view for admin dashboards
-- ============================================================================
-- Every admin query that wants "solicitations with their topic counts"
-- goes through this view. Keeps the SELECT in one place + lets future
-- schema tweaks not break the UI.

CREATE OR REPLACE VIEW solicitation_summary AS
SELECT
  cs.id AS solicitation_id,
  cs.status AS solicitation_status,
  cs.namespace,
  cs.solicitation_type,
  COALESCE(cs.solicitation_title, o_primary.title) AS title,
  COALESCE(cs.solicitation_number, o_primary.solicitation_number) AS sol_number,
  o_primary.agency,
  o_primary.office,
  o_primary.program_type,
  o_primary.close_date,
  o_primary.posted_date,
  cs.claimed_by,
  cs.claimed_at,
  cs.curated_by,
  cs.approved_by,
  cs.created_at,
  (
    SELECT COUNT(*) FROM opportunities o2
    WHERE o2.solicitation_id = cs.id
  ) AS topic_count,
  (
    SELECT COUNT(*) FROM opportunities o2
    WHERE o2.solicitation_id = cs.id
      AND o2.is_active = true
      AND o2.topic_status IN ('open','pre_release')
  ) AS active_topic_count
FROM curated_solicitations cs
LEFT JOIN opportunities o_primary ON o_primary.id = cs.opportunity_id;
