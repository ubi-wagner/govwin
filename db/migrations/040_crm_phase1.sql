-- =============================================================================
-- Migration 040: CRM Phase 1 — lead lifecycle + automation rule seeds
-- Depends on: 039
--
-- Adds:
--   tenants.lifecycle_stage  — track lead/customer lifecycle
--   automation_rules seeds   — auto-create todos + social distribution
--
-- NOTE: CRM operational tables (admin_todos, social_accounts, social_posts)
-- live in the CMS Postgres database. See CMS migration 006.
-- =============================================================================

-- 0a. Extend pipeline_jobs.kind CHECK to support AI draft/review jobs
ALTER TABLE pipeline_jobs DROP CONSTRAINT IF EXISTS pipeline_jobs_kind_check;
ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_kind_check
    CHECK (kind IN ('ingest', 'shred_solicitation', 'scout_source', 'draft_section', 'review_section'));

-- 0b. Extend action_type CHECK to support CRM automation actions
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
    CHECK (action_type IN ('log_only','queue_notification','queue_job','emit_event',
                           'send_email','notify_admin','webhook','update_status',
                           'create_todo','distribute_social','publish_content','enroll_drip'));

-- 1. Lifecycle stage on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
  DEFAULT 'customer' CHECK (lifecycle_stage IN ('lead','target','customer','at_risk','churned'));

-- =============================================================================
-- 2. AUTOMATION RULES — CRM event-driven actions
-- =============================================================================
INSERT INTO automation_rules (id, name, trigger_namespace, trigger_type, action_type, action_config, is_active, description) VALUES
  (gen_random_uuid(), 'Auto-todo on application', 'capture', 'application.submitted', 'create_todo', '{"title_template": "Review application from {company_name}", "todo_type": "general", "priority": "high"}', true, 'Auto-create admin todo on new application'),
  (gen_random_uuid(), 'Social distribute on publish', 'system', 'content.published', 'distribute_social', '{"platforms": ["linkedin"]}', true, 'Post published content to LinkedIn'),
  (gen_random_uuid(), 'Auto-todo on source change', 'finder', 'source.change_detected', 'create_todo', '{"title_template": "Review scout changes: {source_name}", "todo_type": "curation", "priority": "medium"}', true, 'Auto-create curation todo on source change'),
  (gen_random_uuid(), 'Publish CMS content to site', 'system', 'content_pipeline.post.publish', 'publish_content', '{"content_type": "blog_post"}', true, 'Push published CMS content to public website');
