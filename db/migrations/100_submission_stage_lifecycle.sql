-- Migration 100: canonical 6-state submission lifecycle + rich release metadata
-- (greenfield Tranche 1).
--
-- The spec's card lifecycle has SIX states: NOFO, PRE-RELEASE, OPEN, UPDATED,
-- CLOSED, ARCHIVED. The prior model only had a 3-state coarse `lifecycle_status`
-- (open/closed/archived) split across `lifecycle_status` (mig 082) and
-- `topic_status` (mig 013), with no NOFO/UPDATED anywhere.
--
-- Design: `submission_stage` becomes the CANONICAL 6-state field on the master
-- opportunity and is mirrored onto the tenant card. `lifecycle_status`
-- (open/closed/archived) is retained as the COARSE projection that existing feed
-- and ranking filters (`WHERE lifecycle_status='open'`, `WHERE is_active`) already
-- rely on — the app keeps the two in sync (lib/lifecycle.ts coarseStatus). This is
-- additive and backward-compatible.

-- ── Master opportunity: canonical stage + rich release metadata ──
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS submission_stage TEXT NOT NULL DEFAULT 'open'
    CHECK (submission_stage IN ('nofo','pre_release','open','updated','closed','archived')),
  ADD COLUMN IF NOT EXISTS open_date        TIMESTAMPTZ,   -- distinct from posted_date
  ADD COLUMN IF NOT EXISTS pre_release_date TIMESTAMPTZ,   -- forecast/NOFO → pre-release date
  ADD COLUMN IF NOT EXISTS org_unit         TEXT,          -- 3rd org level below agency:office
  ADD COLUMN IF NOT EXISTS expert_notes     TEXT,          -- opp/topic-level RFP Expert Notes
  ADD COLUMN IF NOT EXISTS built_by         UUID REFERENCES users(id),   -- the curator
  ADD COLUMN IF NOT EXISTS released_by      UUID REFERENCES users(id),   -- the releaser (push)
  ADD COLUMN IF NOT EXISTS released_at      TIMESTAMPTZ;

-- Backfill submission_stage from existing coarse state so live rows get a sensible
-- stage. Only touches rows still at the column default (idempotent on re-run).
UPDATE opportunities SET submission_stage =
  CASE
    WHEN lifecycle_status = 'archived'          THEN 'archived'
    WHEN lifecycle_status = 'closed'            THEN 'closed'
    WHEN topic_status     = 'pre_release'       THEN 'pre_release'
    ELSE 'open'
  END
WHERE submission_stage = 'open'
  AND (lifecycle_status <> 'open' OR topic_status = 'pre_release');

CREATE INDEX IF NOT EXISTS idx_opp_submission_stage
  ON opportunities (submission_stage) WHERE submission_stage <> 'open';

-- ── Lifecycle audit: allow the generalized set_stage action ──
ALTER TABLE opportunity_lifecycle_actions DROP CONSTRAINT IF EXISTS opportunity_lifecycle_actions_action_check;
ALTER TABLE opportunity_lifecycle_actions ADD CONSTRAINT opportunity_lifecycle_actions_action_check
  CHECK (action IN ('close','reopen','archive','close_date_change','set_stage'));

-- ── Tenant card: mirror the canonical 6-state stage ──
ALTER TABLE tenant_opportunity_cards
  ADD COLUMN IF NOT EXISTS submission_stage TEXT NOT NULL DEFAULT 'open'
    CHECK (submission_stage IN ('nofo','pre_release','open','updated','closed','archived'));

-- Backfill the tenant mirror from the master so existing replicant cards reflect the
-- real stage immediately (rather than all 'open'). The app also self-heals on the next
-- bridge event; this makes day-one state correct. Only touches column-default rows.
UPDATE tenant_opportunity_cards toc
SET submission_stage = o.submission_stage
FROM opportunities o
WHERE o.id = toc.opportunity_id
  AND toc.submission_stage = 'open'
  AND o.submission_stage <> 'open';

-- ── Bridge: 'archived' becomes a first-class event type ──
ALTER TABLE opportunity_bridge DROP CONSTRAINT IF EXISTS opportunity_bridge_event_type_check;
ALTER TABLE opportunity_bridge ADD CONSTRAINT opportunity_bridge_event_type_check
  CHECK (event_type IN ('published','updated','closed','reopened','awarded','archived'));
