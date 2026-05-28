-- Migration 050: Seed the automation rule that bridges CMS published content to Main DB
-- When the CMS publishes a post (content_pipeline.post.published event),
-- the event_listener's _action_publish_content upserts into cms_content.
-- Without this rule, the publish event fires but nothing happens.

INSERT INTO automation_rules (
  name, description, is_active,
  trigger_namespace, trigger_type,
  action_type, action_config,
  created_by
) VALUES (
  'CMS Content Publish Bridge',
  'When content is published in the CMS SPA, upsert it into the Main DB cms_content table for the marketing site to render.',
  true,
  'system',
  'content_pipeline.post.published',
  'publish_content',
  '{"target_table": "cms_content", "upsert_by": "slug"}'::jsonb,
  'system'
) ON CONFLICT DO NOTHING;

-- Also add the unpublish bridge rule
INSERT INTO automation_rules (
  name, description, is_active,
  trigger_namespace, trigger_type,
  action_type, action_config,
  created_by
) VALUES (
  'CMS Content Unpublish Bridge',
  'When content is unpublished in the CMS SPA, update the Main DB cms_content row to draft/unpublished.',
  true,
  'system',
  'content_pipeline.post.unpublished',
  'unpublish_content',
  '{"target_table": "cms_content"}'::jsonb,
  'system'
) ON CONFLICT DO NOTHING;
