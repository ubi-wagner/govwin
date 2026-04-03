-- =============================================================================
-- CMS Database Migration 003 — HITL Email Approval Queue
--
-- All outgoing emails must pass through human review before sending.
-- Admins see a shared outbox, can claim items, modify content, then approve
-- individually or in bulk. When claimed, the email sends as the claimer's
-- account (not the default service account) but remains fully traceable.
--
-- Flow:
--   Create Send → pending_approval → [claim optional] → approved → queued → sent
--
-- Tables:
--   email_outbox  — Approval queue with claim/review/approve workflow
--
-- Modifications to existing tables:
--   email_sends   — Add pending_approval status, approved_by/approved_at fields
-- =============================================================================

-- Add HITL fields to email_sends
ALTER TABLE email_sends
    DROP CONSTRAINT IF EXISTS email_sends_status_check;

ALTER TABLE email_sends
    ADD CONSTRAINT email_sends_status_check
    CHECK (status IN ('pending_approval', 'queued', 'sending', 'sent', 'delivered', 'bounced', 'failed', 'rejected'));

-- Track who approved and who actually sent
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS approved_by_account_id UUID REFERENCES email_accounts(id);
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS rejected_by TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;

-- Original content snapshot (before human edits)
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS original_subject TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS original_body_html TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS original_body_text TEXT;
ALTER TABLE email_sends ADD COLUMN IF NOT EXISTS was_modified BOOLEAN NOT NULL DEFAULT FALSE;

-- Change default status to pending_approval
ALTER TABLE email_sends ALTER COLUMN status SET DEFAULT 'pending_approval';

-- =============================================================================
-- EMAIL_OUTBOX — HITL approval queue
--
-- This is the shared review queue. When a send is created, an outbox entry
-- is auto-created. Admins see all unclaimed items. When they claim one,
-- it locks to them. They can modify content, then approve or reject.
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_outbox (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    send_id             UUID NOT NULL UNIQUE REFERENCES email_sends(id) ON DELETE CASCADE,

    -- Queue state
    status              TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'claimed', 'approved', 'rejected')),

    -- Claim — when an admin picks this up, it becomes "theirs"
    claimed_by          TEXT,                  -- admin user ID or email
    claimed_by_name     TEXT,                  -- display name
    claimed_by_account_id UUID REFERENCES email_accounts(id),  -- their email account (sends as them)
    claimed_at          TIMESTAMPTZ,

    -- Review
    reviewed_by         TEXT,                  -- may differ from claimer (supervisor override)
    reviewed_at         TIMESTAMPTZ,
    review_notes        TEXT,                  -- internal notes about modifications or approval

    -- Priority & routing
    priority            INT NOT NULL DEFAULT 50,   -- lower = higher priority, inherited from send
    category            TEXT,                       -- campaign type or 'ad_hoc' for quick reference
    recipient_preview   TEXT,                       -- denormalized for queue listing
    subject_preview     TEXT,                       -- denormalized for queue listing

    -- Default sending account (admin@rfppipeline.com unless claimed by specific user)
    default_account_id  UUID REFERENCES email_accounts(id),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Outbox: pending items (what admins see in the queue)
CREATE INDEX IF NOT EXISTS idx_email_outbox_pending
    ON email_outbox(priority, created_at)
    WHERE status = 'pending';

-- Outbox: claimed items by user
CREATE INDEX IF NOT EXISTS idx_email_outbox_claimed
    ON email_outbox(claimed_by, created_at DESC)
    WHERE status = 'claimed';

-- Outbox: lookup by send_id
CREATE INDEX IF NOT EXISTS idx_email_outbox_send ON email_outbox(send_id);

-- Sends: pending approval status
CREATE INDEX IF NOT EXISTS idx_email_sends_pending_approval
    ON email_sends(created_at DESC)
    WHERE status = 'pending_approval';

-- =============================================================================
-- CONFIG updates
-- =============================================================================
INSERT INTO cms_config (key, value, description) VALUES
    ('email.hitl_enabled', 'true', 'Require human-in-the-loop approval for all outgoing email'),
    ('email.default_sender_account', '"admin@rfppipeline.com"', 'Default service account email for unclaimed sends'),
    ('email.auto_approve_internal', 'false', 'Auto-approve emails to internal addresses (skip HITL)'),
    ('email.bulk_approve_limit', '50', 'Max emails that can be bulk-approved at once')
ON CONFLICT (key) DO NOTHING;
