-- 106_purchase_curation_notification.sql
--
-- Close the "silent purchase" gap: capture:purchase.completed had NO automation_rule,
-- so a customer buying a workspace never alerted the RFP admin. Seed a notify_admin rule
-- (the CMS event listener emails ADMIN_NOTIFICATION_EMAIL on match) mirroring the existing
-- capture:topic.pinned rule. Idempotent via ON CONFLICT (name).
--
-- Note: the customer-side "your workspace is ready" email is already covered — release
-- provisions the proposal which emits proposal:proposal.created, matched by the existing
-- 'Proposal workspace ready' rule (mig 028).

INSERT INTO automation_rules (name, description, trigger_namespace, trigger_type, action_type, action_config, is_active)
VALUES (
  'Purchase needs curation',
  'Alert the RFP admin when a customer purchases a proposal workspace that needs expert curation + release',
  'capture', 'purchase.completed', 'notify_admin',
  '{"subject": "New purchase — proposal workspace needs curation", "template": "admin_notification", "include_payload": true}'::jsonb,
  true
)
ON CONFLICT (name) DO NOTHING;
