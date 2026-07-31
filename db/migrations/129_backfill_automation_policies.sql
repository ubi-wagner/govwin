-- Migration 129: backfill tenant_automation_policies from the legacy 6-boolean
-- tenant_automation_preferences (docs/AUTOMATION_POLICY_DESIGN.md §8, decision ⑦).
--
-- Lossless supersession: each CONFIGURED tenant's notify choices become the equivalent
-- policy rows so nothing is lost when the UI flips to the grammar editor. Un-configured
-- tenants get NO rows (they ride the platform framework default). Idempotent via
-- ON CONFLICT (tenant, scope, trigger_key) DO NOTHING — safe to re-run.
--
-- Runs as the DB owner (BYPASSRLS), so the INSERT into the FORCE-RLS policy table is fine.
-- The four notify toggles map 1:1 to policy triggers; `auto_advance_when_all_locked` stays a
-- flow flag on the prefs row (not a notify trigger); `ai_review_on_advance` is an agent
-- dimension handled in Phase E. tenant_automation_preferences stays readable (dual-read)
-- until it is retired by the drop rule once zero refs remain.

-- 1) Document ready → notify the team.
INSERT INTO tenant_automation_policies
  (tenant_id, scope, trigger_key, enabled, recipient_roles, recipient_flags, channel, configured_at)
SELECT tenant_id, 'build', 'proposal:document.locked', notify_team_on_document_locked,
       ARRAY['tenant_admin','tenant_user']::text[], ARRAY[]::text[], 'email', now()
FROM tenant_automation_preferences WHERE configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- 2) Collaborator "get ready" → notify the stage's collaborators.
INSERT INTO tenant_automation_policies
  (tenant_id, scope, trigger_key, enabled, recipient_roles, recipient_flags, channel, configured_at)
SELECT tenant_id, 'build', 'proposal:collaborator.get_ready', notify_collaborators_get_ready,
       ARRAY[]::text[], ARRAY['collaborators_at_stage']::text[], 'email', now()
FROM tenant_automation_preferences WHERE configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- 3) Stage advanced → notify the admin.
INSERT INTO tenant_automation_policies
  (tenant_id, scope, trigger_key, enabled, recipient_roles, recipient_flags, channel, configured_at)
SELECT tenant_id, 'build', 'proposal:proposal.advanced', notify_on_stage_advanced,
       ARRAY['tenant_admin']::text[], ARRAY[]::text[], 'email', now()
FROM tenant_automation_preferences WHERE configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;

-- 4) New priority opportunity → notify the admin (discovery side).
INSERT INTO tenant_automation_policies
  (tenant_id, scope, trigger_key, enabled, recipient_roles, recipient_flags, channel, configured_at)
SELECT tenant_id, 'discovery', 'capture:card.applied', notify_on_new_priority_opp,
       ARRAY['tenant_admin']::text[], ARRAY[]::text[], 'email', now()
FROM tenant_automation_preferences WHERE configured_at IS NOT NULL
ON CONFLICT (tenant_id, scope, trigger_key) DO NOTHING;
