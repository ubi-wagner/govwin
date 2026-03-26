-- =============================================================================
-- Migration 026 — Full Automation Rules for Grinder, Binder, Workspace,
--                  and Remaining Event Gaps
-- =============================================================================
-- Wires up automation rules for ALL event types that were previously defined
-- in TypeScript but had no corresponding automation rules:
--
--   • Grinder: library intake, proposal lifecycle, RFP processing
--   • Binder: project management events
--   • Workspace: collaboration, reviews, stage transitions
--   • Gaps: drive events, reminder gaps, opp lifecycle
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- GRINDER — Library Intake Pipeline
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO automation_rules (name, description, trigger_bus, trigger_events, conditions, action_type, action_config, priority) VALUES

-- When atoms are extracted from an upload, notify the uploader
('library_atoms_extracted_notify',
 'Notify uploader when atomic extraction completes and atoms are ready for review',
 'customer_events', '{library.atoms_extracted}', '{}', 'queue_notification',
 '{"notification_type": "library_extraction_complete", "subject_template": "Extraction complete: {payload.atom_count} atoms from {payload.filename}", "priority": 2}',
 60),

-- Auto-approve high-confidence atoms (threshold from system_config)
('library_auto_approve_high_confidence',
 'Log auto-approval of atoms above the confidence threshold for quality tracking',
 'customer_events', '{library.atom_approved}',
 '{"payload.approval_method": {"$eq": "auto"}}',
 'log_only',
 '{"message_template": "Auto-approved atom {payload.atom_id}: {payload.category}/{payload.title} (confidence: {payload.confidence})"}',
 65),

-- ─────────────────────────────────────────────────────────────────────────────
-- GRINDER — RFP Processing
-- ─────────────────────────────────────────────────────────────────────────────

-- When an RFP is parsed, log for pipeline tracking
('rfp_parsed_log',
 'Log RFP parsing completion for pipeline tracking',
 'opportunity_events', '{rfp.parsed}', '{}', 'log_only',
 '{"message_template": "RFP parsed for opportunity {refs.opportunity_id}: {payload.section_count} sections extracted"}',
 70),

-- When a template is created from RFP, notify the proposal owner
('rfp_template_created_notify',
 'Notify when RFP template is extracted and ready for review',
 'customer_events', '{rfp.template_created}', '{}', 'queue_notification',
 '{"notification_type": "rfp_template_ready", "subject_template": "RFP template ready for review: {payload.agency} {payload.program_type}", "priority": 2}',
 55),

-- When a user accepts an AI-extracted template
('rfp_template_accepted_log',
 'Log template acceptance for learning loop metrics',
 'customer_events', '{rfp.template_accepted}', '{}', 'log_only',
 '{"message_template": "Template accepted for {payload.agency}/{payload.program_type} by {actor.email} — {payload.corrections_made} corrections before acceptance"}',
 70),

-- ─────────────────────────────────────────────────────────────────────────────
-- GRINDER — Proposal Lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

-- When AI populates a section, log for quality metrics
('proposal_section_populated_log',
 'Log AI section population for quality tracking and refinement metrics',
 'customer_events', '{proposal.section_populated}', '{}', 'log_only',
 '{"message_template": "Section {payload.section_key} populated for proposal {refs.proposal_id}: confidence {payload.confidence}, {payload.atoms_used} atoms used"}',
 75),

-- When a section is refined, log iteration count
('proposal_section_refined_log',
 'Track refinement iterations per section for optimization',
 'customer_events', '{proposal.section_refined}', '{}', 'log_only',
 '{"message_template": "Section {payload.section_key} refined (pass {payload.refinement_pass}/{payload.max_passes}): {payload.delta_summary}"}',
 75),

-- When a proposal is archived
('proposal_archived_log',
 'Log proposal archival for record keeping',
 'customer_events', '{proposal.archived}', '{}', 'log_only',
 '{"message_template": "Proposal archived: {payload.title} — outcome: {payload.outcome} by {actor.email}"}',
 80),

-- ─────────────────────────────────────────────────────────────────────────────
-- WORKSPACE — Stage Transitions (Color Team Pipeline)
-- ─────────────────────────────────────────────────────────────────────────────

-- Notify all collaborators when proposal advances to Pink Team
('stage_pink_team_notify',
 'Notify all collaborators that proposal has entered Pink Team compliance review',
 'customer_events', '{proposal.stage_changed}',
 '{"payload.to_stage": {"$eq": "pink_team"}}',
 'queue_notification',
 '{"notification_type": "stage_change", "subject_template": "PINK TEAM: {payload.title} is ready for compliance review", "priority": 1, "notify_all_collaborators": true}',
 20),

-- Notify all collaborators when proposal advances to Red Team
('stage_red_team_notify',
 'Notify all collaborators that proposal has entered Red Team scored review',
 'customer_events', '{proposal.stage_changed}',
 '{"payload.to_stage": {"$eq": "red_team"}}',
 'queue_notification',
 '{"notification_type": "stage_change", "subject_template": "RED TEAM: {payload.title} is ready for scored review", "priority": 1, "notify_all_collaborators": true}',
 20),

-- Notify all collaborators when proposal advances to Gold Team
('stage_gold_team_notify',
 'Notify all collaborators that proposal has entered Gold Team executive review',
 'customer_events', '{proposal.stage_changed}',
 '{"payload.to_stage": {"$eq": "gold_team"}}',
 'queue_notification',
 '{"notification_type": "stage_change", "subject_template": "GOLD TEAM: {payload.title} — executive review & go/no-go", "priority": 1, "notify_all_collaborators": true}',
 15),

-- Notify when proposal is locked for final production
('stage_final_notify',
 'Notify all collaborators that proposal is locked for final production',
 'customer_events', '{proposal.stage_changed}',
 '{"payload.to_stage": {"$eq": "final"}}',
 'queue_notification',
 '{"notification_type": "stage_change", "subject_template": "FINAL: {payload.title} is locked for production — no further edits", "priority": 1, "notify_all_collaborators": true}',
 10),

-- Log all stage transitions for audit
('stage_transition_log',
 'Log every stage transition for full audit trail',
 'customer_events', '{proposal.stage_changed}', '{}', 'log_only',
 '{"message_template": "Stage transition: {payload.title} moved from {payload.from_stage} ({payload.from_color}) to {payload.to_stage} ({payload.to_color}) by {actor.email}"}',
 90),

-- ─────────────────────────────────────────────────────────────────────────────
-- WORKSPACE — Collaboration Events
-- ─────────────────────────────────────────────────────────────────────────────

-- When a collaborator is added, notify them
('collaborator_added_notify',
 'Notify user when they are added to a proposal team',
 'customer_events', '{proposal.collaborator_added}', '{}', 'queue_notification',
 '{"notification_type": "assignment", "subject_template": "You have been added to proposal: {payload.title} as {payload.role}", "priority": 2}',
 40),

-- When a review is requested, notify the reviewer
('review_requested_notify',
 'Notify assigned reviewer when a review is requested',
 'customer_events', '{proposal.review_requested}', '{}', 'queue_notification',
 '{"notification_type": "review_request", "subject_template": "{payload.review_type} review requested: {payload.title} — due {payload.due_date}", "priority": 1}',
 25),

-- When a review is completed, notify the section writer
('review_completed_notify',
 'Notify section writer when their section review is complete',
 'customer_events', '{proposal.review_completed}', '{}', 'queue_notification',
 '{"notification_type": "review_complete", "subject_template": "Review complete: {payload.section_title} — verdict: {payload.verdict}", "priority": 2}',
 35),

-- When someone is mentioned in a comment
('comment_mention_notify',
 'Notify users mentioned in proposal comments',
 'customer_events', '{proposal.comment_added}',
 '{"payload.has_mentions": {"$eq": true}}',
 'queue_notification',
 '{"notification_type": "mention", "subject_template": "{actor.name} mentioned you in {payload.title}: {payload.comment_preview}", "priority": 2}',
 45),

-- Log comment activity for metrics
('comment_activity_log',
 'Track comment and discussion activity for collaboration metrics',
 'customer_events', '{proposal.comment_added,proposal.comment_resolved}', '{}', 'log_only',
 '{"message_template": "Comment {payload.action} on {payload.title}/{payload.section_key} by {actor.email}"}',
 85),

-- Track change accept/reject for quality metrics
('change_tracking_log',
 'Log change accept/reject decisions for quality and iteration metrics',
 'customer_events', '{proposal.change_accepted,proposal.change_rejected}', '{}', 'log_only',
 '{"message_template": "Change {payload.action} on {payload.title}/{payload.section_key}: {payload.diff_summary} by {actor.email}"}',
 85),

-- ─────────────────────────────────────────────────────────────────────────────
-- WORKSPACE — Deadline & Submission
-- ─────────────────────────────────────────────────────────────────────────────

-- Submission deadline approaching (7 days)
('submission_deadline_7d',
 'Alert team 7 days before submission deadline',
 'customer_events', '{proposal.deadline_warning}',
 '{"payload.days_remaining": {"$lte": 7, "$gt": 3}}',
 'queue_notification',
 '{"notification_type": "deadline_warning", "subject_template": "⚠ {payload.days_remaining} days until submission: {payload.title}", "priority": 2, "notify_all_collaborators": true}',
 30),

-- Submission deadline approaching (3 days — urgent)
('submission_deadline_3d',
 'Urgent alert 3 days before submission deadline',
 'customer_events', '{proposal.deadline_warning}',
 '{"payload.days_remaining": {"$lte": 3, "$gt": 1}}',
 'queue_notification',
 '{"notification_type": "deadline_warning", "subject_template": "🚨 {payload.days_remaining} DAYS: {payload.title} submission deadline approaching", "priority": 1, "notify_all_collaborators": true}',
 10),

-- Submission deadline tomorrow
('submission_deadline_1d',
 'Critical alert 1 day before submission deadline',
 'customer_events', '{proposal.deadline_warning}',
 '{"payload.days_remaining": {"$lte": 1}}',
 'queue_notification',
 '{"notification_type": "deadline_warning", "subject_template": "🔴 TOMORROW: {payload.title} submission deadline is TOMORROW", "priority": 1, "notify_all_collaborators": true}',
 5),

-- ─────────────────────────────────────────────────────────────────────────────
-- BINDER — Project Management Events
-- ─────────────────────────────────────────────────────────────────────────────

('binder_project_created_log',
 'Log binder project creation for pipeline tracking',
 'customer_events', '{binder.project_created}', '{}', 'log_only',
 '{"message_template": "Binder project created for opp {refs.opportunity_id} by {actor.email}"}',
 70),

('binder_upload_added_log',
 'Log file uploads to binder projects',
 'customer_events', '{binder.upload_added}', '{}', 'log_only',
 '{"message_template": "File uploaded to binder: {payload.filename} ({payload.file_type}) by {actor.email}"}',
 80),

('binder_pwin_updated_log',
 'Log probability-of-win updates for capture analytics',
 'customer_events', '{binder.pwin_updated}', '{}', 'log_only',
 '{"message_template": "P(Win) updated for opp {refs.opportunity_id}: {payload.old_pwin} → {payload.new_pwin} by {actor.email}"}',
 75),

('binder_stage_advanced_notify',
 'Notify team when a binder project advances stages',
 'customer_events', '{binder.stage_advanced}', '{}', 'queue_notification',
 '{"notification_type": "binder_stage_change", "subject_template": "Project advanced: {payload.title} → {payload.new_stage}", "priority": 3}',
 50),

-- ─────────────────────────────────────────────────────────────────────────────
-- GAPS — Drive Events
-- ─────────────────────────────────────────────────────────────────────────────

('drive_extracted_log',
 'Log document text extraction from Drive files',
 'opportunity_events', '{drive.extracted}', '{}', 'log_only',
 '{"message_template": "Document extracted from Drive: {payload.filename} for opp {refs.opportunity_id} ({payload.page_count} pages)"}',
 80),

('drive_analyzed_log',
 'Log AI analysis of Drive documents',
 'opportunity_events', '{drive.analyzed}', '{}', 'log_only',
 '{"message_template": "Document analyzed: {payload.filename} for opp {refs.opportunity_id} — {payload.analysis_type}"}',
 80),

-- ─────────────────────────────────────────────────────────────────────────────
-- GAPS — Opportunity Lifecycle
-- ─────────────────────────────────────────────────────────────────────────────

('opp_closed_log',
 'Log when an opportunity closes (past close date)',
 'opportunity_events', '{ingest.closed}', '{}', 'log_only',
 '{"message_template": "Opportunity closed: {payload.title} (solicitation {payload.solicitation_number})"}',
 70),

('opp_closed_notify_pursuing',
 'Notify pursuing tenants when an opportunity they are tracking closes',
 'opportunity_events', '{ingest.closed}',
 '{"payload.has_pursuing_tenants": {"$eq": true}}',
 'queue_notification',
 '{"notification_type": "opp_closed", "subject_template": "Opportunity closed: {payload.title}", "priority": 3}',
 60),

('opp_cancelled_log',
 'Log when an opportunity is cancelled by the agency',
 'opportunity_events', '{ingest.cancelled}', '{}', 'log_only',
 '{"message_template": "Opportunity CANCELLED: {payload.title} — reason: {payload.cancellation_reason}"}',
 70),

('opp_cancelled_notify_pursuing',
 'Alert pursuing tenants when a tracked opportunity is cancelled',
 'opportunity_events', '{ingest.cancelled}',
 '{"payload.has_pursuing_tenants": {"$eq": true}}',
 'queue_notification',
 '{"notification_type": "opp_cancelled", "subject_template": "⚠ Opportunity cancelled: {payload.title}", "priority": 1}',
 50),

-- ─────────────────────────────────────────────────────────────────────────────
-- GAPS — Reminder Tier
-- ─────────────────────────────────────────────────────────────────────────────

('amendment_alert_log',
 'Log amendment alerts for tracking',
 'customer_events', '{reminder.amendment_alert}', '{}', 'log_only',
 '{"message_template": "Amendment alert: {payload.amendment_title} for opp {refs.opportunity_id} — {payload.change_summary}"}',
 70),

('amendment_alert_notify',
 'Notify pursuing tenants when an amendment is posted to a tracked opportunity',
 'customer_events', '{reminder.amendment_alert}', '{}', 'queue_notification',
 '{"notification_type": "amendment_alert", "subject_template": "Amendment posted: {payload.opportunity_title} — {payload.amendment_title}", "priority": 1}',
 40),

('digest_sent_log',
 'Log weekly/daily digest emails for delivery tracking',
 'customer_events', '{reminder.digest_sent}', '{}', 'log_only',
 '{"message_template": "Digest sent to {actor.email}: {payload.digest_type} — {payload.opportunity_count} opportunities, {payload.action_count} actions needed"}',
 85)

ON CONFLICT (name) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- System Config — Workspace Settings
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO system_config (key, value, description) VALUES
  ('workspace.max_file_size_mb',       '"50"',    'Max upload size per workspace file in MB'),
  ('workspace.max_files_per_proposal', '"100"',   'Max files per proposal workspace'),
  ('workspace.allowed_file_types',     '["document","spreadsheet","presentation","pdf","image"]', 'Allowed workspace file types'),
  ('workspace.auto_lock_on_final',     '"true"',  'Auto-lock workspace when stage reaches final'),
  ('workspace.require_gate_checklist', '"true"',  'Require all gate checklist items before stage advance'),
  ('review.pink_team_min_reviewers',   '"1"',     'Min reviewers required for Pink Team gate'),
  ('review.red_team_min_reviewers',    '"2"',     'Min reviewers required for Red Team gate'),
  ('review.gold_team_min_reviewers',   '"1"',     'Min reviewers for Gold Team (typically executive)'),
  ('deadline.stage_warning_days',      '"3"',     'Days before stage deadline to send warnings'),
  ('deadline.submission_warning_days', '["7","3","1"]', 'Days before submission deadline for escalating alerts')
ON CONFLICT (key) DO NOTHING;

COMMIT;
