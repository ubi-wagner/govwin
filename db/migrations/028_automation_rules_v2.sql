-- =============================================================================
-- Migration 028 — Seed automation_rules for new event types
--
-- Bridge: reconciles 001_baseline schema (trigger_bus, trigger_events, enabled)
-- with 019 schema (trigger_namespace, trigger_type, is_active). Relaxes old
-- NOT NULL constraints, adds missing columns, then seeds rules.
-- =============================================================================

-- ── Step 1: Relax old 001_baseline columns so INSERTs without them don't crash
ALTER TABLE automation_rules ALTER COLUMN trigger_bus DROP NOT NULL;
ALTER TABLE automation_rules ALTER COLUMN trigger_bus SET DEFAULT '';
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_trigger_bus_check;

ALTER TABLE automation_rules ALTER COLUMN trigger_events DROP NOT NULL;
ALTER TABLE automation_rules ALTER COLUMN trigger_events SET DEFAULT '{}';

-- ── Step 2: Add 019 schema columns (safe if they already exist)
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS trigger_namespace TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Step 3: Widen action_type CHECK to accept both old and new values
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
  CHECK (action_type IN ('log_only','queue_notification','queue_job','emit_event',
                         'send_email','notify_admin','webhook','update_status'));

-- ── Step 4: Bridge automation_log columns
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ── Step 5: Indexes (safe if they already exist)
CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger
  ON automation_rules (trigger_namespace, trigger_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_automation_log_rule
  ON automation_log (rule_id, executed_at DESC);

-- ── Step 6: Unique constraint for ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_rules_name ON automation_rules(name);

INSERT INTO automation_rules (name, description, trigger_namespace, trigger_type, action_type, action_config, is_active)
VALUES
  (
    'Welcome new customer',
    'Send welcome email when a customer application is accepted',
    'capture', 'application.accepted', 'send_email',
    '{"template": "welcome_accepted", "to_field": "result.userId", "subject": "Welcome to RFP Pipeline!"}'::jsonb,
    true
  ),
  (
    'Proposal workspace ready',
    'Notify customer when their proposal workspace is created and AI-drafted',
    'proposal', 'proposal.created', 'send_email',
    '{"template": "proposal_workspace_ready", "to_field": "payload.tenantId", "subject": "Your proposal workspace is ready"}'::jsonb,
    true
  ),
  (
    'New RFP ready for curation',
    'Alert admin when a new RFP document is uploaded and shredded',
    'finder', 'rfp.uploaded', 'notify_admin',
    '{"subject": "New RFP uploaded — ready for curation", "template": "new_rfp_uploaded", "include_payload": true}'::jsonb,
    true
  ),
  (
    'Source change detected',
    'Alert admin when Source Scout detects meaningful changes on a monitored site',
    'finder', 'source.change_detected', 'notify_admin',
    '{"subject": "Source Scout detected changes", "template": "source_change_detected", "include_payload": true}'::jsonb,
    true
  ),
  (
    'Proposal stage advanced',
    'Notify customer when their proposal advances to a new review stage',
    'proposal', 'proposal.advanced', 'send_email',
    '{"template": "stage_advanced", "to_field": "payload.tenantId", "subject": "Proposal stage updated"}'::jsonb,
    true
  ),
  (
    'Topic pinned by customer',
    'Alert admin when a customer pins a topic from their Spotlight',
    'capture', 'topic.pinned', 'notify_admin',
    '{"subject": "Customer pinned a topic", "template": "admin_notification", "include_payload": true}'::jsonb,
    true
  )
ON CONFLICT (name) DO NOTHING;
