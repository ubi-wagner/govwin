-- =============================================================================
-- Migration 028 — Seed automation_rules for new event types
--
-- Adds rules for key lifecycle notifications:
--   - Welcome email on application accepted (capture bus)
--   - Proposal workspace ready notification
--   - New RFP uploaded admin alert
--   - Source Scout change detected admin alert
--   - Proposal stage advanced notification
--   - Customer topic pinned admin alert
--
-- These rules are consumed by the CMS event_listener which polls
-- system_events and matches against automation_rules.
-- =============================================================================

-- Unique constraint so ON CONFLICT works for idempotent seeding
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
