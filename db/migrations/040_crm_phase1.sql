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

-- 1. Lifecycle stage on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
  DEFAULT 'customer' CHECK (lifecycle_stage IN ('lead','target','customer','at_risk','churned'));

-- =============================================================================
-- 2. AUTOMATION RULES — CRM event-driven actions
-- =============================================================================
INSERT INTO automation_rules (id, trigger_namespace, trigger_type, action_type, action_config, is_active, description) VALUES
  (gen_random_uuid(), 'capture', 'application.submitted', 'create_todo', '{"title_template": "Review application from {company_name}", "todo_type": "general", "priority": "high"}', true, 'Auto-create admin todo on new application'),
  (gen_random_uuid(), 'system', 'content.published', 'distribute_social', '{"platforms": ["linkedin"]}', true, 'Post published content to LinkedIn'),
  (gen_random_uuid(), 'finder', 'source.change_detected', 'create_todo', '{"title_template": "Review scout changes: {source_name}", "todo_type": "curation", "priority": "medium"}', true, 'Auto-create curation todo on source change'),
  (gen_random_uuid(), 'system', 'content_pipeline.post.publish', 'publish_content', '{"content_type": "blog_post"}', true, 'Push published CMS content to public website');
