-- =============================================================================
-- CMS Database Migration 005 — Drip Campaign Sequences and Enrollments
--
-- Adds drip-campaign support to the email engine:
--   drip_sequences        — ordered steps within a drip campaign
--   drip_enrollments      — recipients progressing through a sequence
--   campaign_execution_log — audit trail for all campaign executions
--
-- Depends on: 004
-- =============================================================================

-- =============================================================================
-- DRIP_SEQUENCES — steps within a drip campaign
-- =============================================================================
CREATE TABLE IF NOT EXISTS drip_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number INT NOT NULL,
  template_id UUID REFERENCES email_templates(id),
  subject_override TEXT,
  body_override TEXT,
  delay_hours INT NOT NULL DEFAULT 0,
  delay_from TEXT NOT NULL DEFAULT 'enrollment' CHECK (delay_from IN ('enrollment','previous_step')),
  condition_filter JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(campaign_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_drip_sequences_campaign ON drip_sequences(campaign_id, step_number);

-- =============================================================================
-- DRIP_ENROLLMENTS — recipients progressing through a drip campaign
-- =============================================================================
CREATE TABLE IF NOT EXISTS drip_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id),
  tenant_id UUID,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  current_step INT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','cancelled','failed')),
  enrolled_at TIMESTAMPTZ DEFAULT now(),
  next_send_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drip_enrollments_next ON drip_enrollments(next_send_at) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_drip_enrollments_campaign ON drip_enrollments(campaign_id, status);

-- =============================================================================
-- CAMPAIGN_EXECUTION_LOG — audit trail for campaign runs
-- =============================================================================
CREATE TABLE IF NOT EXISTS campaign_execution_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES email_campaigns(id),
  execution_type TEXT NOT NULL CHECK (execution_type IN ('one_time','recurring','drip_step')),
  step_number INT,
  recipients_targeted INT DEFAULT 0,
  sends_created INT DEFAULT 0,
  errors INT DEFAULT 0,
  started_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'
);
