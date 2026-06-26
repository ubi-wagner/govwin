-- Migration 078: seed proposal-lifecycle automation rules + wire them to the
-- per-tenant automation preferences (Phase 3, C3 Increment 3).
--
-- The lock route already emits proposal:document.locked (a volume closed) and
-- proposal:proposal.advance_ready (all sections locked). Until now no
-- automation_rule consumed them, so the notify_* customer toggles in
-- tenant_automation_preferences (mig 076) were inert. These rules close that
-- loop. Each rule opts into a customer toggle via action_config.tenant_pref;
-- the CMS event_listener consults tenant_automation_preferences and skips the
-- send when the tenant has that toggle off (default-on — a tenant with no
-- preferences row gets the column default).
--
-- Recipient resolution uses to_field=payload.tenantId; the listener surfaces
-- the system_events.tenant_id column into the payload, so this resolves to the
-- tenant's billing_email (or tenant_admin). Per-collaborator fan-out for the
-- "get ready" email is a follow-on; V1 targets the tenant admin.

INSERT INTO automation_rules (name, description, trigger_namespace, trigger_type, action_type, action_config, is_active)
VALUES
  (
    'Proposal document locked — notify team',
    'Notify the customer team when a proposal document/volume is fully locked. Gated by tenant_automation_preferences.notify_team_on_document_locked.',
    'proposal', 'document.locked', 'send_email',
    '{"template": "document_locked_team_notify", "to_field": "payload.tenantId", "subject": "A proposal document is locked and ready", "tenant_pref": "notify_team_on_document_locked"}'::jsonb,
    true
  ),
  (
    'Proposal ready to advance — collaborator get-ready',
    'Nudge the customer when every section is locked and the proposal is ready to advance. Gated by tenant_automation_preferences.notify_collaborators_get_ready.',
    'proposal', 'proposal.advance_ready', 'send_email',
    '{"template": "collaborator_get_ready", "to_field": "payload.tenantId", "subject": "Your proposal is ready to advance", "tenant_pref": "notify_collaborators_get_ready"}'::jsonb,
    true
  )
ON CONFLICT (name) DO NOTHING;

-- Wire the already-seeded stage-advanced notification (mig 028) to its toggle.
UPDATE automation_rules
SET action_config = action_config || '{"tenant_pref": "notify_on_stage_advanced"}'::jsonb,
    updated_at = now()
WHERE name = 'Proposal stage advanced'
  AND NOT (action_config ? 'tenant_pref');
