-- Migration 050: Seed the automation rule that bridges CMS published content to Main DB
-- When the CMS publishes a post (content_pipeline.post.published event),
-- the event_listener's _action_publish_content upserts into cms_content.
-- Without this rule, the publish event fires but nothing happens.

-- Widen action_type CHECK to include unpublish_content
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
    CHECK (action_type IN ('log_only','queue_notification','queue_job','emit_event',
                           'send_email','notify_admin','webhook','update_status',
                           'create_todo','distribute_social','publish_content',
                           'unpublish_content','enroll_drip'));

INSERT INTO automation_rules (
  name, description, is_active,
  trigger_namespace, trigger_type,
  action_type, action_config
) VALUES (
  'CMS Content Publish Bridge',
  'When content is published in the CMS SPA, upsert it into the Main DB cms_content table for the marketing site to render.',
  true,
  'system',
  'content_pipeline.post.published',
  'publish_content',
  '{"target_table": "cms_content", "upsert_by": "slug"}'::jsonb
) ON CONFLICT DO NOTHING;

-- Also add the unpublish bridge rule
INSERT INTO automation_rules (
  name, description, is_active,
  trigger_namespace, trigger_type,
  action_type, action_config
) VALUES (
  'CMS Content Unpublish Bridge',
  'When content is unpublished in the CMS SPA, update the Main DB cms_content row to draft/unpublished.',
  true,
  'system',
  'content_pipeline.post.unpublished',
  'unpublish_content',
  '{"target_table": "cms_content"}'::jsonb
) ON CONFLICT DO NOTHING;
