-- =============================================================================
-- CMS Database Migration 002 — Email Automation Engine
--
-- Subsystem for campaign management, template drafting (Claude), Gmail sending
-- via delegated workspace account, engagement tracking, and automation triggers.
--
-- Architecture:
--   Sweep Account → Send via Gmail API → Archive in DB → Track Engagement
--   → Emit Events → Trigger Automation Rules
--
-- Tables:
--   email_accounts       — Delegated Gmail workspace accounts (sweep accounts)
--   email_templates      — Reusable email templates with Claude drafting
--   email_campaigns      — Campaign definitions (type, audience, schedule)
--   email_sends          — Individual send records (immutable audit trail)
--   email_engagement     — Opens, clicks, replies, bounces (event-driven)
--   email_threads        — Thread tracking for conversation continuity
--   email_queue          — Outbound send queue (processed by worker)
-- =============================================================================

-- =============================================================================
-- EMAIL_ACCOUNTS — Delegated Gmail workspace accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_accounts (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email_address       TEXT NOT NULL UNIQUE,
    display_name        TEXT NOT NULL,
    account_type        TEXT NOT NULL DEFAULT 'sweep'
        CHECK (account_type IN ('sweep', 'support', 'marketing', 'notifications')),

    -- Gmail API credentials (encrypted at rest)
    -- Service account JSON or OAuth refresh token stored encrypted
    credentials_encrypted BYTEA,
    credentials_type    TEXT NOT NULL DEFAULT 'service_account'
        CHECK (credentials_type IN ('service_account', 'oauth2', 'delegated')),
    delegate_subject    TEXT,       -- email to impersonate via domain-wide delegation

    -- State
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    daily_send_limit    INT NOT NULL DEFAULT 500,  -- Gmail workspace limit
    sends_today         INT NOT NULL DEFAULT 0,
    sends_today_reset   DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Sweep config
    sweep_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
    sweep_inbox         BOOLEAN NOT NULL DEFAULT TRUE,
    sweep_sent          BOOLEAN NOT NULL DEFAULT TRUE,
    last_sweep_at       TIMESTAMPTZ,
    sweep_history_id    TEXT,      -- Gmail API history ID for incremental sync

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EMAIL_TEMPLATES — Reusable templates with AI drafting
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_templates (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL,
    slug                TEXT NOT NULL UNIQUE,
    description         TEXT,

    -- Template type
    category            TEXT NOT NULL DEFAULT 'transactional'
        CHECK (category IN (
            'transactional',     -- system notifications, confirmations
            'campaign',          -- marketing campaigns
            'spotlight',         -- opportunity spotlight deliveries
            'nudge',             -- engagement nudges, reminders
            'support',           -- customer support responses
            'digest',            -- periodic digests
            'onboarding',        -- welcome series
            'update'             -- product/platform updates
        )),

    -- Content
    subject_template    TEXT NOT NULL,        -- supports {{variables}}
    body_html           TEXT NOT NULL DEFAULT '',
    body_text           TEXT NOT NULL DEFAULT '',

    -- AI drafting config
    ai_drafted          BOOLEAN NOT NULL DEFAULT FALSE,
    ai_prompt           TEXT,                -- prompt used to generate this template
    ai_model            TEXT,
    ai_drafted_at       TIMESTAMPTZ,

    -- Metadata
    variables           JSONB NOT NULL DEFAULT '[]',  -- expected template variables
    tags                TEXT[] NOT NULL DEFAULT '{}',
    version             INT NOT NULL DEFAULT 1,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EMAIL_CAMPAIGNS — Campaign definitions
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_campaigns (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                TEXT NOT NULL,
    description         TEXT,

    campaign_type       TEXT NOT NULL DEFAULT 'one_time'
        CHECK (campaign_type IN (
            'one_time',          -- single blast
            'recurring',         -- scheduled recurring (digest, spotlight)
            'triggered',         -- event-triggered (nudge, onboarding)
            'drip',              -- time-sequenced series
            'support'            -- support response campaigns
        )),

    -- Content
    template_id         UUID REFERENCES email_templates(id) ON DELETE SET NULL,
    account_id          UUID REFERENCES email_accounts(id) ON DELETE SET NULL,

    -- Audience
    audience_type       TEXT NOT NULL DEFAULT 'all_active'
        CHECK (audience_type IN ('all_active', 'segment', 'individual', 'tier_based')),
    audience_filter     JSONB NOT NULL DEFAULT '{}',  -- tenant filter criteria
    -- e.g. {"tier": ["grinder", "binder"], "active_within_days": 30}

    -- Scheduling
    status              TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'scheduled', 'active', 'paused', 'completed', 'cancelled')),
    scheduled_at        TIMESTAMPTZ,
    cron_expression     TEXT,             -- for recurring campaigns
    timezone            TEXT NOT NULL DEFAULT 'UTC',
    started_at          TIMESTAMPTZ,
    completed_at        TIMESTAMPTZ,

    -- Trigger config (for event-triggered campaigns)
    trigger_event       TEXT,             -- e.g. 'customer.signed_up', 'opportunity.deadline_approaching'
    trigger_delay_hours INT DEFAULT 0,    -- delay after trigger event

    -- Stats (denormalized for quick access)
    total_sent          INT NOT NULL DEFAULT 0,
    total_delivered     INT NOT NULL DEFAULT 0,
    total_opened        INT NOT NULL DEFAULT 0,
    total_clicked       INT NOT NULL DEFAULT 0,
    total_replied       INT NOT NULL DEFAULT 0,
    total_bounced       INT NOT NULL DEFAULT 0,
    total_unsubscribed  INT NOT NULL DEFAULT 0,

    created_by          TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EMAIL_SENDS — Individual send records (immutable audit trail)
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_sends (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id         UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
    template_id         UUID REFERENCES email_templates(id) ON DELETE SET NULL,
    account_id          UUID REFERENCES email_accounts(id) ON DELETE SET NULL,

    -- Recipient
    recipient_email     TEXT NOT NULL,
    recipient_name      TEXT,
    tenant_id           TEXT,              -- cross-reference to main DB tenant
    user_id             TEXT,              -- cross-reference to main DB user

    -- Content (rendered at send time, snapshot for audit)
    subject             TEXT NOT NULL,
    body_html           TEXT,
    body_text           TEXT,
    template_variables  JSONB NOT NULL DEFAULT '{}',

    -- Gmail tracking
    gmail_message_id    TEXT,              -- Gmail message ID after send
    gmail_thread_id     TEXT,              -- for thread continuity
    in_reply_to         TEXT,              -- Message-ID header for threading

    -- State
    status              TEXT NOT NULL DEFAULT 'queued'
        CHECK (status IN ('queued', 'sending', 'sent', 'delivered', 'bounced', 'failed')),
    sent_at             TIMESTAMPTZ,
    delivered_at        TIMESTAMPTZ,
    bounced_at          TIMESTAMPTZ,
    error_message       TEXT,
    retry_count         INT NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EMAIL_ENGAGEMENT — Opens, clicks, replies, bounces
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_engagement (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    send_id             UUID NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
    campaign_id         UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,

    engagement_type     TEXT NOT NULL
        CHECK (engagement_type IN ('open', 'click', 'reply', 'bounce', 'unsubscribe', 'complaint', 'forward')),

    -- Details
    metadata            JSONB NOT NULL DEFAULT '{}',
    -- opens: {user_agent, ip_geo}
    -- clicks: {url, link_id}
    -- replies: {gmail_message_id, body_preview, sentiment}
    -- bounces: {bounce_type, diagnostic_code}

    -- Reply interpretation (Claude)
    reply_body          TEXT,
    reply_sentiment     TEXT CHECK (reply_sentiment IN ('positive', 'neutral', 'negative', 'urgent', NULL)),
    reply_intent        TEXT CHECK (reply_intent IN ('question', 'interest', 'complaint', 'unsubscribe', 'out_of_office', 'other', NULL)),
    reply_interpreted   BOOLEAN NOT NULL DEFAULT FALSE,
    reply_interpreted_at TIMESTAMPTZ,

    tenant_id           TEXT,
    user_id             TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- EMAIL_THREADS — Conversation thread tracking
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_threads (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    gmail_thread_id     TEXT NOT NULL,
    account_id          UUID NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,

    -- Participants
    recipient_email     TEXT NOT NULL,
    tenant_id           TEXT,
    user_id             TEXT,

    -- State
    subject             TEXT,
    message_count       INT NOT NULL DEFAULT 0,
    last_message_at     TIMESTAMPTZ,
    last_sender         TEXT,              -- 'us' or 'them'
    status              TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'closed', 'waiting_reply', 'needs_attention')),

    -- Context
    campaign_id         UUID REFERENCES email_campaigns(id) ON DELETE SET NULL,
    tags                TEXT[] NOT NULL DEFAULT '{}',

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(gmail_thread_id, account_id)
);

-- =============================================================================
-- EMAIL_QUEUE — Outbound send queue (dequeued by worker)
-- =============================================================================
CREATE TABLE IF NOT EXISTS email_queue (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    send_id             UUID NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
    priority            INT NOT NULL DEFAULT 50,   -- lower = higher priority
    scheduled_for       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts            INT NOT NULL DEFAULT 0,
    max_attempts        INT NOT NULL DEFAULT 3,
    locked_at           TIMESTAMPTZ,
    locked_by           TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- INDEXES
-- =============================================================================

-- Accounts
CREATE INDEX IF NOT EXISTS idx_email_accounts_active ON email_accounts(is_active) WHERE is_active = TRUE;

-- Templates
CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);
CREATE INDEX IF NOT EXISTS idx_email_templates_slug ON email_templates(slug);

-- Campaigns
CREATE INDEX IF NOT EXISTS idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_type ON email_campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_email_campaigns_trigger ON email_campaigns(trigger_event) WHERE trigger_event IS NOT NULL;

-- Sends
CREATE INDEX IF NOT EXISTS idx_email_sends_campaign ON email_sends(campaign_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_recipient ON email_sends(recipient_email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_sends_tenant ON email_sends(tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_gmail ON email_sends(gmail_message_id) WHERE gmail_message_id IS NOT NULL;

-- Engagement
CREATE INDEX IF NOT EXISTS idx_email_engagement_send ON email_engagement(send_id);
CREATE INDEX IF NOT EXISTS idx_email_engagement_campaign ON email_engagement(campaign_id, engagement_type);
CREATE INDEX IF NOT EXISTS idx_email_engagement_tenant ON email_engagement(tenant_id, created_at DESC) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_engagement_type ON email_engagement(engagement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_engagement_uninterpreted ON email_engagement(created_at)
    WHERE engagement_type = 'reply' AND reply_interpreted = FALSE;

-- Threads
CREATE INDEX IF NOT EXISTS idx_email_threads_gmail ON email_threads(gmail_thread_id, account_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_recipient ON email_threads(recipient_email);
CREATE INDEX IF NOT EXISTS idx_email_threads_status ON email_threads(status) WHERE status != 'closed';

-- Queue
CREATE INDEX IF NOT EXISTS idx_email_queue_pending ON email_queue(scheduled_for, priority)
    WHERE locked_at IS NULL AND attempts < max_attempts;

-- =============================================================================
-- SEED CONFIG for email engine
-- =============================================================================
INSERT INTO cms_config (key, value, description) VALUES
    ('email.default_account', 'null', 'Default email account ID for sending'),
    ('email.daily_send_limit', '500', 'Global daily send limit across all accounts'),
    ('email.reply_interpretation_enabled', 'true', 'Use Claude to interpret email replies'),
    ('email.reply_interpretation_model', '"claude-sonnet-4-20250514"', 'Model for reply interpretation'),
    ('email.sweep_interval_seconds', '300', 'Interval between inbox sweeps (5 min default)'),
    ('email.sweep_max_messages', '100', 'Max messages to process per sweep'),
    ('email.queue_batch_size', '10', 'Number of queued emails to send per batch'),
    ('email.queue_poll_interval', '15', 'Seconds between queue polls'),
    ('email.bounce_threshold', '0.05', 'Campaign auto-pause if bounce rate exceeds 5%'),
    ('email.template_draft_model', '"claude-sonnet-4-20250514"', 'Model for template drafting'),
    ('email.template_draft_temperature', '0.7', 'Temperature for template drafting')
ON CONFLICT (key) DO NOTHING;
