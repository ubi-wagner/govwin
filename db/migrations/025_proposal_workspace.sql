-- =============================================================================
-- Migration 025 — Proposal Workspace: Collaboration, Color Team Reviews,
--                  Change Tracking, Workspace Files, Comments, Checklists
-- =============================================================================
-- Extends the Grinder foundation (023) with full workspace capabilities for
-- team-based proposal development using the Color Team Review methodology:
--
--   Outline → Draft → Pink Team → Red Team → Gold Team → Final → Submitted
--
-- Each proposal is a workspace containing documents, assigned collaborators,
-- change history with accept/reject workflow, inline comments, review cycles,
-- and a stage-gated pipeline with full audit trail.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- ENUM-LIKE TYPES (as CHECK constraints for flexibility)
-- ─────────────────────────────────────────────────────────────────────────────

-- Proposal development stages (Color Team pipeline)
-- outline     → Structure created from RFP template
-- draft       → AI-populated + human writing in progress
-- pink_team   → Compliance review: does it answer every requirement?
-- red_team    → Scored review: would this win against eval criteria?
-- gold_team   → Executive review, go/no-go decision
-- final       → Locked for production/formatting/export
-- submitted   → Package submitted to agency portal
-- archived    → Post-submission archive

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'outline'
    CHECK (stage IN ('outline','draft','pink_team','red_team','gold_team','final','submitted','archived')),
  ADD COLUMN IF NOT EXISTS stage_color TEXT NOT NULL DEFAULT 'gray'
    CHECK (stage_color IN ('gray','blue','pink','red','gold','green','purple','slate')),
  ADD COLUMN IF NOT EXISTS stage_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS stage_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submission_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS workspace_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS workspace_locked_by TEXT REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS workspace_locked_at TIMESTAMPTZ;

-- Stage-to-color mapping reference (enforced in app logic):
--   outline    → gray
--   draft      → blue
--   pink_team  → pink
--   red_team   → red
--   gold_team  → gold
--   final      → green
--   submitted  → purple
--   archived   → slate

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROPOSAL WORKSPACE FILES
-- ─────────────────────────────────────────────────────────────────────────────
-- Docs, sheets, PPTs, PDFs, images — any file in the proposal workspace.
-- Files can be tied to a specific section or be workspace-level (section_id NULL).
-- Supports version chains via parent_file_id.

CREATE TABLE IF NOT EXISTS proposal_workspace_files (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id           UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id            UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
  file_name             TEXT NOT NULL,
  file_type             TEXT NOT NULL CHECK (file_type IN (
                          'document','spreadsheet','presentation','pdf','image','other'
                        )),
  mime_type             TEXT,
  storage_path          TEXT NOT NULL,
  file_size_bytes       BIGINT,
  version               INTEGER NOT NULL DEFAULT 1,
  parent_file_id        UUID REFERENCES proposal_workspace_files(id) ON DELETE SET NULL,
  uploaded_by           TEXT NOT NULL REFERENCES users(id),
  description           TEXT,
  is_submission_artifact BOOLEAN NOT NULL DEFAULT FALSE,
  is_template           BOOLEAN NOT NULL DEFAULT FALSE,
  tags                  TEXT[] DEFAULT '{}',
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_files_proposal
  ON proposal_workspace_files(proposal_id);
CREATE INDEX IF NOT EXISTS idx_workspace_files_section
  ON proposal_workspace_files(section_id) WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_workspace_files_type
  ON proposal_workspace_files(proposal_id, file_type);
CREATE INDEX IF NOT EXISTS idx_workspace_files_submission
  ON proposal_workspace_files(proposal_id) WHERE is_submission_artifact = TRUE;
CREATE INDEX IF NOT EXISTS idx_workspace_files_parent
  ON proposal_workspace_files(parent_file_id) WHERE parent_file_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROPOSAL COLLABORATORS
-- ─────────────────────────────────────────────────────────────────────────────
-- Team members assigned to a proposal with role-based access.
-- Sections assignment tracks who is responsible for writing which sections.

CREATE TABLE IF NOT EXISTS proposal_collaborators (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id       UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN (
                      'owner','capture_manager','volume_lead','writer',
                      'reviewer','approver','subject_expert','viewer'
                    )),
  assigned_sections UUID[] DEFAULT '{}',
  permissions       JSONB NOT NULL DEFAULT '{
    "can_edit": true,
    "can_comment": true,
    "can_review": false,
    "can_approve": false,
    "can_upload": true,
    "can_manage_team": false,
    "can_lock": false,
    "can_export": false
  }'::jsonb,
  invited_by        TEXT REFERENCES users(id),
  invited_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at       TIMESTAMPTZ,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  notification_prefs JSONB NOT NULL DEFAULT '{
    "on_mention": true,
    "on_stage_change": true,
    "on_review_requested": true,
    "on_comment": true,
    "on_deadline": true,
    "digest_frequency": "immediate"
  }'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collaborators_proposal
  ON proposal_collaborators(proposal_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_collaborators_user
  ON proposal_collaborators(user_id) WHERE is_active = TRUE;
CREATE INDEX IF NOT EXISTS idx_collaborators_role
  ON proposal_collaborators(proposal_id, role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PROPOSAL STAGE HISTORY
-- ─────────────────────────────────────────────────────────────────────────────
-- Full audit trail of stage transitions through the Color Team pipeline.
-- Every stage change is recorded with who, when, why, and any gate criteria met.

CREATE TABLE IF NOT EXISTS proposal_stage_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  from_stage      TEXT,
  to_stage        TEXT NOT NULL,
  from_color      TEXT,
  to_color        TEXT NOT NULL,
  changed_by      TEXT NOT NULL REFERENCES users(id),
  reason          TEXT,
  gate_criteria   JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_history_proposal
  ON proposal_stage_history(proposal_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. PROPOSAL CHANGE TRACKING
-- ─────────────────────────────────────────────────────────────────────────────
-- Track-changes style: every edit, suggestion, accept, reject.
-- Supports the "suggested changes" workflow where writers propose and
-- reviewers accept/reject, similar to Google Docs suggestion mode.

CREATE TABLE IF NOT EXISTS proposal_changes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES proposal_sections(id) ON DELETE CASCADE,
  file_id         UUID REFERENCES proposal_workspace_files(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id),
  change_type     TEXT NOT NULL CHECK (change_type IN (
                    'edit','suggestion','accept','reject','revert',
                    'ai_edit','ai_suggestion','bulk_accept','bulk_reject'
                  )),
  field_changed   TEXT,
  old_value       TEXT,
  new_value       TEXT,
  diff_html       TEXT,
  diff_summary    TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','accepted','rejected','superseded'
                  )),
  reviewed_by     TEXT REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  review_comment  TEXT,
  batch_id        UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changes_proposal
  ON proposal_changes(proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_section
  ON proposal_changes(section_id, created_at DESC) WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_changes_pending
  ON proposal_changes(proposal_id, status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_changes_user
  ON proposal_changes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_batch
  ON proposal_changes(batch_id) WHERE batch_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PROPOSAL REVIEWS (Color Team Review Cycles)
-- ─────────────────────────────────────────────────────────────────────────────
-- Formal review cycles tied to the Color Team stages.
-- Each review has a type, assigned reviewer, scoring, and verdict.

CREATE TABLE IF NOT EXISTS proposal_reviews (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id      UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
  reviewer_id     TEXT NOT NULL REFERENCES users(id),
  review_type     TEXT NOT NULL CHECK (review_type IN (
                    'compliance','technical','editorial','executive',
                    'pink_team','red_team','gold_team','peer','final_qa'
                  )),
  review_stage    TEXT NOT NULL CHECK (review_stage IN (
                    'pink_team','red_team','gold_team','final','ad_hoc'
                  )),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                    'pending','in_progress','approved','rejected',
                    'changes_requested','deferred'
                  )),
  verdict         TEXT CHECK (verdict IN (
                    'pass','fail','conditional_pass','not_reviewed'
                  )),
  score           NUMERIC(5,2),
  max_score       NUMERIC(5,2),
  comments        TEXT,
  findings        JSONB DEFAULT '[]',
  due_date        TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_proposal
  ON proposal_reviews(proposal_id, review_stage);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON proposal_reviews(reviewer_id, status);
CREATE INDEX IF NOT EXISTS idx_reviews_pending
  ON proposal_reviews(proposal_id) WHERE status IN ('pending','in_progress');
CREATE INDEX IF NOT EXISTS idx_reviews_stage
  ON proposal_reviews(proposal_id, review_stage, status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. PROPOSAL COMMENTS
-- ─────────────────────────────────────────────────────────────────────────────
-- Inline comments on sections, files, or whole proposal.
-- Supports threading (parent_comment_id) and resolution workflow.
-- anchor_context stores the text/location the comment is attached to.

CREATE TABLE IF NOT EXISTS proposal_comments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id       UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  section_id        UUID REFERENCES proposal_sections(id) ON DELETE CASCADE,
  file_id           UUID REFERENCES proposal_workspace_files(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES proposal_comments(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id),
  content           TEXT NOT NULL,
  comment_type      TEXT NOT NULL DEFAULT 'general' CHECK (comment_type IN (
                      'general','suggestion','question','issue',
                      'resolution','action_item','praise'
                    )),
  anchor_context    JSONB,
  mentions          TEXT[] DEFAULT '{}',
  is_resolved       BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by       TEXT REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  is_pinned         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_proposal
  ON proposal_comments(proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_section
  ON proposal_comments(section_id, created_at DESC) WHERE section_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_thread
  ON proposal_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_unresolved
  ON proposal_comments(proposal_id) WHERE is_resolved = FALSE;
CREATE INDEX IF NOT EXISTS idx_comments_user
  ON proposal_comments(user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PROPOSAL CHECKLISTS
-- ─────────────────────────────────────────────────────────────────────────────
-- Submission checklists and gate criteria per stage.
-- Auto-generated from RFP template requirements, manually supplemented.

CREATE TABLE IF NOT EXISTS proposal_checklists (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  stage           TEXT NOT NULL CHECK (stage IN (
                    'outline','draft','pink_team','red_team','gold_team',
                    'final','submission'
                  )),
  category        TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
                    'compliance','content','formatting','technical',
                    'administrative','submission','general'
                  )),
  title           TEXT NOT NULL,
  description     TEXT,
  is_required     BOOLEAN NOT NULL DEFAULT TRUE,
  is_checked      BOOLEAN NOT NULL DEFAULT FALSE,
  checked_by      TEXT REFERENCES users(id),
  checked_at      TIMESTAMPTZ,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  auto_check_rule JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_checklists_proposal_stage
  ON proposal_checklists(proposal_id, stage);
CREATE INDEX IF NOT EXISTS idx_checklists_unchecked
  ON proposal_checklists(proposal_id, stage) WHERE is_checked = FALSE AND is_required = TRUE;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PROPOSAL ACTIVITY FEED
-- ─────────────────────────────────────────────────────────────────────────────
-- Denormalized activity feed for the workspace UI.
-- One row per meaningful action — rendered as a timeline in the portal.

CREATE TABLE IF NOT EXISTS proposal_activity (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id         TEXT REFERENCES users(id),
  activity_type   TEXT NOT NULL CHECK (activity_type IN (
                    'stage_changed','section_edited','section_populated',
                    'section_approved','section_locked',
                    'file_uploaded','file_versioned','file_deleted',
                    'collaborator_added','collaborator_removed',
                    'review_requested','review_completed',
                    'comment_added','comment_resolved',
                    'change_suggested','change_accepted','change_rejected',
                    'checklist_checked','checklist_unchecked',
                    'ai_populated','ai_refined',
                    'workspace_locked','workspace_unlocked',
                    'exported','submitted'
                  )),
  section_id      UUID REFERENCES proposal_sections(id) ON DELETE SET NULL,
  target_user_id  TEXT REFERENCES users(id),
  summary         TEXT NOT NULL,
  detail          JSONB DEFAULT '{}',
  is_system       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_proposal
  ON proposal_activity(proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_user
  ON proposal_activity(user_id, created_at DESC) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_activity_type
  ON proposal_activity(proposal_id, activity_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PROPOSAL NOTIFICATIONS
-- ─────────────────────────────────────────────────────────────────────────────
-- In-app notifications for collaborators (separate from email queue).

CREATE TABLE IF NOT EXISTS proposal_notifications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  proposal_id     UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN (
                    'mention','review_request','review_complete',
                    'stage_change','deadline_warning','comment_reply',
                    'change_accepted','change_rejected','assignment',
                    'lock_warning','submission_reminder'
                  )),
  title           TEXT NOT NULL,
  body            TEXT,
  link            TEXT,
  is_read         BOOLEAN NOT NULL DEFAULT FALSE,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prop_notifications_user
  ON proposal_notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prop_notifications_proposal
  ON proposal_notifications(proposal_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. TRIGGERS — updated_at auto-set
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE TRIGGER set_updated_at_workspace_files
  BEFORE UPDATE ON proposal_workspace_files
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_collaborators
  BEFORE UPDATE ON proposal_collaborators
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_reviews
  BEFORE UPDATE ON proposal_reviews
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_comments
  BEFORE UPDATE ON proposal_comments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE TRIGGER set_updated_at_checklists
  BEFORE UPDATE ON proposal_checklists
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. VIEWS
-- ─────────────────────────────────────────────────────────────────────────────

-- Proposal workspace summary: stage pipeline overview per tenant
CREATE OR REPLACE VIEW proposal_workspace_summary AS
SELECT
  p.tenant_id,
  p.id AS proposal_id,
  p.title,
  p.stage,
  p.stage_color,
  p.stage_entered_at,
  p.stage_deadline,
  p.submission_deadline,
  p.status,
  p.workspace_locked,
  o.title AS opportunity_title,
  o.close_date,
  (SELECT COUNT(*) FROM proposal_collaborators pc WHERE pc.proposal_id = p.id AND pc.is_active = TRUE) AS collaborator_count,
  (SELECT COUNT(*) FROM proposal_sections ps WHERE ps.proposal_id = p.id) AS total_sections,
  (SELECT COUNT(*) FROM proposal_sections ps WHERE ps.proposal_id = p.id AND ps.status IN ('approved','locked')) AS completed_sections,
  (SELECT COUNT(*) FROM proposal_workspace_files wf WHERE wf.proposal_id = p.id) AS file_count,
  (SELECT COUNT(*) FROM proposal_workspace_files wf WHERE wf.proposal_id = p.id AND wf.is_submission_artifact = TRUE) AS submission_file_count,
  (SELECT COUNT(*) FROM proposal_reviews pr WHERE pr.proposal_id = p.id AND pr.status IN ('pending','in_progress')) AS pending_reviews,
  (SELECT COUNT(*) FROM proposal_comments cm WHERE cm.proposal_id = p.id AND cm.is_resolved = FALSE) AS open_comments,
  (SELECT COUNT(*) FROM proposal_changes ch WHERE ch.proposal_id = p.id AND ch.status = 'pending') AS pending_changes,
  (SELECT COUNT(*) FROM proposal_checklists cl WHERE cl.proposal_id = p.id AND cl.stage = p.stage AND cl.is_required = TRUE AND cl.is_checked = FALSE) AS unchecked_gate_items,
  p.created_at,
  p.updated_at
FROM proposals p
LEFT JOIN opportunities o ON p.opportunity_id = o.id;

-- Section-level collaboration view: who is working on what
CREATE OR REPLACE VIEW proposal_section_assignments AS
SELECT
  ps.id AS section_id,
  ps.proposal_id,
  ps.section_key,
  ps.title,
  ps.status AS section_status,
  ps.page_limit,
  ps.current_page_count,
  ps.page_status,
  p.stage AS proposal_stage,
  p.stage_color,
  pc.user_id AS assignee_id,
  u.name AS assignee_name,
  u.email AS assignee_email,
  pc.role AS assignee_role,
  (SELECT COUNT(*) FROM proposal_comments cm WHERE cm.section_id = ps.id AND cm.is_resolved = FALSE) AS open_comments,
  (SELECT COUNT(*) FROM proposal_changes ch WHERE ch.section_id = ps.id AND ch.status = 'pending') AS pending_changes,
  (SELECT COUNT(*) FROM proposal_reviews rv WHERE rv.section_id = ps.id AND rv.status IN ('pending','in_progress')) AS pending_reviews,
  ps.updated_at AS section_updated_at
FROM proposal_sections ps
JOIN proposals p ON ps.proposal_id = p.id
LEFT JOIN proposal_collaborators pc ON pc.proposal_id = ps.proposal_id
  AND pc.is_active = TRUE
  AND ps.id = ANY(pc.assigned_sections)
LEFT JOIN users u ON pc.user_id = u.id;

COMMIT;
