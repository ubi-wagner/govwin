-- =============================================================================
-- Migration 028 — SpotLight Buckets, Per-Bucket Scoring, Seat Limits,
--                  Team Invitations, Upload-to-Library Bridge
-- =============================================================================
-- Evolves focus_areas into SpotLight buckets with full matching capabilities.
-- Each bucket is a targeting lens — NAICS, keywords, set-asides, agencies.
-- Scoring engine scores every opp against each bucket.
-- Aggregate across buckets IS the tenant's pipeline.
-- Pinned opps track which bucket(s) surfaced them.
-- Uploaded artifacts are linked to buckets AND feed into the atomic library.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. EVOLVE focus_areas → SpotLight Buckets
-- ─────────────────────────────────────────────────────────────────────────────
-- Add the matching fields that tenant_profiles has, per bucket.

ALTER TABLE focus_areas
  ADD COLUMN IF NOT EXISTS set_aside_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS agency_priorities JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS keyword_domains JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_small_business BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS min_contract_value NUMERIC,
  ADD COLUMN IF NOT EXISTS max_contract_value NUMERIC,
  ADD COLUMN IF NOT EXISTS min_score_threshold INTEGER DEFAULT 40,
  ADD COLUMN IF NOT EXISTS opportunity_types TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS company_summary TEXT,
  ADD COLUMN IF NOT EXISTS technology_focus TEXT,
  ADD COLUMN IF NOT EXISTS created_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS last_scored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS matched_opp_count INTEGER DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PER-BUCKET OPPORTUNITY SCORES
-- ─────────────────────────────────────────────────────────────────────────────
-- Each opportunity is scored against each bucket independently.
-- tenant_opportunities.total_score becomes the MAX across all buckets.

CREATE TABLE IF NOT EXISTS spotlight_scores (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  spotlight_id        UUID NOT NULL REFERENCES focus_areas(id) ON DELETE CASCADE,
  opportunity_id      UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  total_score         NUMERIC(5,1) NOT NULL DEFAULT 0,
  naics_score         NUMERIC(4,1) DEFAULT 0,
  keyword_score       NUMERIC(4,1) DEFAULT 0,
  set_aside_score     NUMERIC(4,1) DEFAULT 0,
  agency_score        NUMERIC(4,1) DEFAULT 0,
  type_score          NUMERIC(4,1) DEFAULT 0,
  timeline_score      NUMERIC(4,1) DEFAULT 0,
  llm_adjustment      NUMERIC(4,1) DEFAULT 0,
  llm_rationale       TEXT,
  matched_keywords    TEXT[] DEFAULT '{}',
  matched_domains     TEXT[] DEFAULT '{}',
  scored_at           TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(spotlight_id, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_spotlight_scores_tenant
  ON spotlight_scores(tenant_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_spotlight_scores_spotlight
  ON spotlight_scores(spotlight_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_spotlight_scores_opp
  ON spotlight_scores(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_spotlight_scores_threshold
  ON spotlight_scores(spotlight_id, total_score DESC)
  WHERE total_score >= 40;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. EXTEND tenant_opportunities FOR BUCKET PROVENANCE
-- ─────────────────────────────────────────────────────────────────────────────
-- Track which buckets surfaced this opp and which was the best match.

ALTER TABLE tenant_opportunities
  ADD COLUMN IF NOT EXISTS matched_spotlight_ids UUID[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS best_spotlight_id UUID REFERENCES focus_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS best_spotlight_name TEXT,
  ADD COLUMN IF NOT EXISTS pinned_from_spotlight_id UUID REFERENCES focus_areas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tenant_opps_spotlight
  ON tenant_opportunities(best_spotlight_id) WHERE best_spotlight_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SEAT LIMITS & BUCKET LIMITS PER PLAN
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS max_seats INTEGER DEFAULT 2,
  ADD COLUMN IF NOT EXISTS max_spotlights INTEGER DEFAULT 1;

-- Plan-based defaults (enforced in app logic):
--   finder:   max_seats=2,  max_spotlights=1,  max_active_opps=10
--   reminder: max_seats=5,  max_spotlights=3,  max_active_opps=25
--   binder:   max_seats=10, max_spotlights=5,  max_active_opps=50
--   grinder:  max_seats=25, max_spotlights=10, max_active_opps=unlimited

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TEAM INVITATIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- Invite tokens for email-based team onboarding.
-- Invited user receives email with link → clicks → lands on sign-up page
-- with info pre-filled → sets password → joins tenant workspace.

CREATE TABLE IF NOT EXISTS team_invitations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  invited_by        TEXT NOT NULL REFERENCES users(id),
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'tenant_user'
                      CHECK (role IN ('tenant_admin', 'tenant_user')),
  company           TEXT,
  phone             TEXT,
  notes             TEXT,
  token             TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  accepted_user_id  TEXT REFERENCES users(id),
  accepted_at       TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  reminder_sent_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invitations_tenant
  ON team_invitations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_invitations_email
  ON team_invitations(email, status);
CREATE INDEX IF NOT EXISTS idx_invitations_token
  ON team_invitations(token) WHERE status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. EXTEND USERS TABLE FOR INVITE FIELDS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS company TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS invited_via TEXT REFERENCES team_invitations(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. UPLOAD-TO-LIBRARY BRIDGE
-- ─────────────────────────────────────────────────────────────────────────────
-- tenant_uploads already has focus_area_id for bucket linkage.
-- Add fields to track library atomization status and bridge to library_units.

ALTER TABLE tenant_uploads
  ADD COLUMN IF NOT EXISTS spotlight_id UUID REFERENCES focus_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS upload_category TEXT DEFAULT 'general'
    CHECK (upload_category IN (
      'general', 'capability_statement', 'past_performance',
      'personnel_resume', 'facility_description', 'tech_approach',
      'company_overview', 'certification', 'financial', 'other'
    )),
  ADD COLUMN IF NOT EXISTS library_status TEXT DEFAULT 'pending'
    CHECK (library_status IN ('pending', 'processing', 'atomized', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS atom_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS library_processed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_uploads_spotlight
  ON tenant_uploads(spotlight_id) WHERE spotlight_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_uploads_library_status
  ON tenant_uploads(library_status) WHERE library_status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. AUTOMATION RULES — SpotLight & Invites
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority) VALUES

-- When a new spotlight is created, trigger initial scoring
('spotlight_created_score',
 'Queue scoring run for all active opportunities against new SpotLight bucket',
 'customer_events', '{spotlight.created}', '{}', 'queue_job',
 '{"job_type": "spotlight_scoring", "worker": "scoring", "config": {"score_all_active": true}}',
 30),

-- When spotlight is updated, re-score
('spotlight_updated_rescore',
 'Re-score opportunities when SpotLight matching criteria change',
 'customer_events', '{spotlight.updated}', '{}', 'queue_job',
 '{"job_type": "spotlight_scoring", "worker": "scoring", "config": {"rescore": true}}',
 30),

-- When team invite is sent
('team_invite_sent_log',
 'Log team invitation for audit trail',
 'customer_events', '{account.invite_sent}', '{}', 'log_only',
 '{"message_template": "Invite sent to {payload.email} as {payload.role} by {actor.email} for tenant {refs.tenant_id}"}',
 70),

-- When invite is accepted
('team_invite_accepted_notify',
 'Notify tenant admin when invited team member accepts and joins',
 'customer_events', '{account.invite_accepted}', '{}', 'queue_notification',
 '{"notification_type": "invite_accepted", "subject_template": "{payload.name} has joined your team as {payload.role}", "priority": 3}',
 40),

-- When artifact is uploaded to a spotlight, queue library processing
('upload_to_library_queue',
 'Queue uploaded artifact for atomization into the content library',
 'customer_events', '{library.upload_ingested}', '{}', 'queue_job',
 '{"job_type": "docling_processor", "worker": "grinder", "config": {"extract_atoms": true, "link_to_spotlight": true}}',
 35),

-- When new opportunity is ingested, score against all spotlights
('ingest_score_all_spotlights',
 'Score new opportunity against all active SpotLight buckets for every tenant',
 'opportunity_events', '{ingest.new}', '{}', 'queue_job',
 '{"job_type": "spotlight_scoring_new_opp", "worker": "scoring", "config": {"score_all_tenants": true, "score_all_spotlights": true}}',
 25)

ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SYSTEM CONFIG — SpotLight & Invite Settings
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO system_config (key, value, description) VALUES
  ('spotlight.min_score_display',    '"30"',   'Minimum score to show an opp in a SpotLight feed'),
  ('spotlight.max_per_finder',       '"1"',    'Max SpotLight buckets for Finder tier'),
  ('spotlight.max_per_reminder',     '"3"',    'Max SpotLight buckets for Reminder tier'),
  ('spotlight.max_per_binder',       '"5"',    'Max SpotLight buckets for Binder tier'),
  ('spotlight.max_per_grinder',      '"10"',   'Max SpotLight buckets for Grinder tier'),
  ('seats.max_per_finder',          '"2"',    'Max team seats for Finder tier'),
  ('seats.max_per_reminder',        '"5"',    'Max team seats for Reminder tier'),
  ('seats.max_per_binder',          '"10"',   'Max team seats for Binder tier'),
  ('seats.max_per_grinder',         '"25"',   'Max team seats for Grinder tier'),
  ('invite.expiry_days',            '"7"',    'Days before invite token expires'),
  ('invite.max_pending',            '"20"',   'Max pending invitations per tenant'),
  ('invite.reminder_after_days',    '"3"',    'Days after invite to send reminder email'),
  ('upload.max_file_size_mb',       '"25"',   'Max upload file size in MB'),
  ('upload.allowed_types',          '["pdf","docx","xlsx","pptx","doc","xls","ppt","txt","csv","jpg","png"]', 'Allowed upload file extensions')
ON CONFLICT (key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- SpotLight dashboard: per-bucket stats
CREATE OR REPLACE VIEW spotlight_dashboard AS
SELECT
  fa.id AS spotlight_id,
  fa.tenant_id,
  fa.name AS spotlight_name,
  fa.description,
  fa.naics_codes,
  fa.keywords,
  fa.set_aside_types,
  fa.status,
  fa.sort_order,
  fa.matched_opp_count,
  fa.last_scored_at,
  (SELECT COUNT(*) FROM spotlight_scores ss
   WHERE ss.spotlight_id = fa.id AND ss.total_score >= fa.min_score_threshold) AS above_threshold_count,
  (SELECT COUNT(*) FROM spotlight_scores ss
   WHERE ss.spotlight_id = fa.id AND ss.total_score >= 75) AS high_priority_count,
  (SELECT MAX(ss.total_score) FROM spotlight_scores ss
   WHERE ss.spotlight_id = fa.id) AS top_score,
  (SELECT AVG(ss.total_score) FROM spotlight_scores ss
   WHERE ss.spotlight_id = fa.id AND ss.total_score >= fa.min_score_threshold) AS avg_score,
  (SELECT COUNT(*) FROM tenant_uploads tu
   WHERE tu.spotlight_id = fa.id AND tu.is_active = TRUE) AS upload_count,
  fa.created_at,
  fa.updated_at
FROM focus_areas fa
WHERE fa.status = 'active';

-- Pipeline with bucket provenance
CREATE OR REPLACE VIEW tenant_pipeline_with_spotlights AS
SELECT
  to2.id AS tenant_opp_id,
  to2.tenant_id,
  to2.opportunity_id,
  o.title,
  o.agency,
  o.agency_code,
  o.naics_codes AS opp_naics,
  o.set_aside_type,
  o.opportunity_type,
  o.posted_date,
  o.close_date,
  o.solicitation_number,
  o.source_url,
  to2.total_score,
  to2.pursuit_status,
  to2.pursuit_recommendation,
  to2.priority_tier,
  to2.matched_spotlight_ids,
  to2.best_spotlight_id,
  to2.best_spotlight_name,
  to2.pinned_from_spotlight_id,
  to2.key_requirements,
  to2.competitive_risks,
  to2.scored_at,
  EXTRACT(DAY FROM o.close_date - NOW()) AS days_to_close,
  o.status AS opp_status
FROM tenant_opportunities to2
JOIN opportunities o ON to2.opportunity_id = o.id;

COMMIT;
