-- Migration 082: opportunity lifecycle — archive / close / reopen / close-date
-- change (C6). All opportunities are retained (soft-state; never deleted), so
-- existing proposals that reference a closed/archived opportunity keep working.
--
-- lifecycle_status is the admin-facing state; is_active (the existing customer
-- visibility gate used by the spotlight feed's WHERE is_active = true) is kept
-- in sync by the lifecycle route, so closing/archiving hides an opportunity from
-- customers without touching the feed queries, and reopening restores it.

ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'open'
        CHECK (lifecycle_status IN ('open', 'closed', 'archived')),
    ADD COLUMN IF NOT EXISTS closed_at            TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS closed_reason        TEXT,
    ADD COLUMN IF NOT EXISTS reopened_at          TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS close_date_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS previous_close_date  TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_opp_lifecycle
    ON opportunities (lifecycle_status)
    WHERE lifecycle_status <> 'open';

-- Audit trail for lifecycle transitions (parallel to triage_actions).
CREATE TABLE IF NOT EXISTS opportunity_lifecycle_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    actor_id        UUID REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN ('close', 'reopen', 'archive', 'close_date_change')),
    from_status     TEXT,
    to_status       TEXT,
    reason          TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_opp_lifecycle_actions
    ON opportunity_lifecycle_actions (opportunity_id, created_at DESC);
