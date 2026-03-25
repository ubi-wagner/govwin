-- Migration 017: Automation Framework
-- Adds automation_rules (declarative event→action mappings) and automation_log (execution audit trail)

-- ── Automation Rules ──────────────────────────────────────────────
-- Each rule defines: when THIS event fires, IF conditions match, DO this action.
-- Rules are evaluated by the AutomationWorker in the Python pipeline.

CREATE TABLE IF NOT EXISTS automation_rules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    -- Trigger: which event bus and event type(s) activate this rule
    trigger_bus     TEXT NOT NULL CHECK (trigger_bus IN ('opportunity_events', 'customer_events', 'content_events')),
    trigger_events  TEXT[] NOT NULL,          -- e.g. {'account.login', 'account.tenant_created'}
    -- Conditions: JSONB conditions that must ALL be true for the rule to fire
    -- Evaluated against the event row + metadata payload
    -- Examples:
    --   {"actor.type": "user"}                    → only user-initiated events
    --   {"payload.total_score": {"$gte": 70}}     → score threshold
    --   {"payload.nudge_type": "urgent"}          → specific nudge type
    --   {"$first_occurrence": true}               → only fire once per entity (uses automation_log dedup)
    conditions      JSONB DEFAULT '{}',
    -- Action: what to do when the rule fires
    action_type     TEXT NOT NULL CHECK (action_type IN (
        'emit_event',           -- Insert a new event into an event bus
        'queue_notification',   -- Insert into notifications_queue
        'queue_job',            -- Insert into pipeline_jobs
        'log_only'              -- Just log to automation_log (for auditing/debugging)
    )),
    -- Action config: type-specific configuration
    -- emit_event:         { "bus": "customer_events", "event_type": "...", "description_template": "..." }
    -- queue_notification: { "notification_type": "...", "subject_template": "...", "priority": 3 }
    -- queue_job:          { "source": "scoring", "run_type": "score", "priority": 3 }
    -- log_only:           { "message_template": "..." }
    action_config   JSONB NOT NULL DEFAULT '{}',
    -- Execution control
    enabled         BOOLEAN DEFAULT TRUE,
    priority        INT DEFAULT 50,          -- Lower = evaluated first
    cooldown_seconds INT DEFAULT 0,          -- Min seconds between firings for same entity
    max_fires_per_hour INT DEFAULT 0,        -- 0 = unlimited
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger
    ON automation_rules (trigger_bus, enabled)
    WHERE enabled = TRUE;

-- ── Automation Log ────────────────────────────────────────────────
-- Every rule evaluation (fire or skip) is recorded here for debugging.

CREATE TABLE IF NOT EXISTS automation_log (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rule_id         UUID REFERENCES automation_rules(id) ON DELETE SET NULL,
    rule_name       TEXT NOT NULL,
    trigger_event_id UUID,                    -- The event that triggered evaluation
    trigger_event_type TEXT,
    trigger_bus     TEXT,
    -- Outcome
    fired           BOOLEAN NOT NULL DEFAULT FALSE,
    skip_reason     TEXT,                      -- e.g. 'conditions_not_met', 'cooldown', 'rate_limited'
    -- Action result (only if fired)
    action_type     TEXT,
    action_result   JSONB,                     -- { "event_id": "...", "notification_id": "...", etc. }
    -- Context snapshot for debugging
    event_metadata  JSONB,
    correlation_id  UUID,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_log_rule
    ON automation_log (rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_log_event
    ON automation_log (trigger_event_id);

CREATE INDEX IF NOT EXISTS idx_automation_log_created
    ON automation_log (created_at DESC);

-- ── Seed initial automation rules ─────────────────────────────────

-- 1. Login → Activity log (every login gets logged for audit trail)
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'login_activity_log',
    'Log every user login for audit trail',
    'customer_events',
    '{account.login}',
    '{}',
    'log_only',
    '{"message_template": "User {actor.email} logged in for tenant {refs.tenant_id}"}',
    10
) ON CONFLICT (name) DO NOTHING;

-- 2. First login → Welcome email
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'first_login_welcome',
    'Send welcome email on first login',
    'customer_events',
    '{account.login}',
    '{"$first_occurrence": true, "$entity_key": "actor.id"}',
    'queue_notification',
    '{"notification_type": "welcome", "subject_template": "Welcome to GovWin Pipeline!", "priority": 5}',
    20
) ON CONFLICT (name) DO NOTHING;

-- 3. Profile updated → Trigger re-scoring
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'profile_update_rescore',
    'Trigger scoring run when tenant profile is updated with new search parameters',
    'customer_events',
    '{account.tenant_updated, account.profile_updated}',
    '{"payload.fields_changed": {"$contains_any": ["primary_naics", "secondary_naics", "keyword_domains", "agency_priorities", "set_aside"]}}',
    'queue_job',
    '{"source": "scoring", "run_type": "score", "priority": 3}',
    30
) ON CONFLICT (name) DO NOTHING;

-- 4. New tenant created → Queue onboarding notification
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'tenant_created_onboarding',
    'Queue onboarding email when a new tenant is created',
    'customer_events',
    '{account.tenant_created}',
    '{}',
    'queue_notification',
    '{"notification_type": "onboarding", "subject_template": "Your GovWin Pipeline account is ready!", "priority": 3}',
    20
) ON CONFLICT (name) DO NOTHING;

-- 5. Ingest new opp → Log for monitoring (the finder worker handles the real logic,
--    this rule just provides visibility in the automation log)
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'ingest_new_monitor',
    'Log new opportunity ingestion for monitoring',
    'opportunity_events',
    '{ingest.new}',
    '{}',
    'log_only',
    '{"message_template": "New opportunity ingested: {payload.title} from {payload.agency}"}',
    90
) ON CONFLICT (name) DO NOTHING;

-- 6. High-score opportunity → Notify tenant
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'high_score_notify',
    'Notify tenant when an opportunity scores above their high-priority threshold',
    'opportunity_events',
    '{scoring.scored}',
    '{"payload.total_score": {"$gte": 75}, "payload.recommendation": "pursue"}',
    'emit_event',
    '{"bus": "customer_events", "event_type": "finder.high_score_alert", "description_template": "High-scoring opportunity ({payload.total_score}/100): recommend pursue"}',
    40
) ON CONFLICT (name) DO NOTHING;

-- 7. LLM adjustment → Log for analysis
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'llm_adjustment_log',
    'Log LLM score adjustments for analysis and model evaluation',
    'opportunity_events',
    '{scoring.llm_adjusted}',
    '{}',
    'log_only',
    '{"message_template": "LLM adjusted score by {payload.llm_adjustment} for opp (surface: {payload.surface_score} → final: {payload.final_score}): {payload.llm_rationale}"}',
    80
) ON CONFLICT (name) DO NOTHING;

-- 8. Amendment alert → Ensure email is triggered (backup to email_trigger worker)
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'amendment_ensure_email',
    'Ensure amendment alerts always result in email delivery',
    'customer_events',
    '{reminder.amendment_alert}',
    '{}',
    'log_only',
    '{"message_template": "Amendment alert for opp {refs.opportunity_id} sent to tenant {refs.tenant_id}"}',
    70
) ON CONFLICT (name) DO NOTHING;

-- 9. Deadline nudge urgent → Escalation log
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'urgent_nudge_escalation',
    'Log urgent deadline nudges for SLA tracking',
    'customer_events',
    '{reminder.nudge_sent}',
    '{"payload.nudge_type": "urgent"}',
    'log_only',
    '{"message_template": "URGENT deadline nudge: {payload.solicitation_number} closes tomorrow for tenant {payload.tenant_name}"}',
    50
) ON CONFLICT (name) DO NOTHING;

-- 10. Content published → Log CMS activity
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'content_publish_log',
    'Log CMS content publish events for change tracking',
    'content_events',
    '{content.published, content.rolled_back, content.unpublished}',
    '{}',
    'log_only',
    '{"message_template": "CMS {trigger_event_type}: {payload.path}"}',
    90
) ON CONFLICT (name) DO NOTHING;

-- 11. Drive archived → Emit customer event for tenant visibility
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'drive_archive_notify',
    'Notify tenants when their opportunities are archived to Google Drive',
    'opportunity_events',
    '{drive.archived}',
    '{}',
    'log_only',
    '{"message_template": "Opportunity archived to Drive: {payload.title}"}',
    80
) ON CONFLICT (name) DO NOTHING;

-- 12. User added to tenant → Welcome notification for new user
INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority)
VALUES (
    'user_added_welcome',
    'Send welcome notification when a new user is added to a tenant',
    'customer_events',
    '{account.user_added}',
    '{}',
    'queue_notification',
    '{"notification_type": "user_welcome", "subject_template": "You have been added to {payload.tenant_name} on GovWin Pipeline", "priority": 3}',
    20
) ON CONFLICT (name) DO NOTHING;
