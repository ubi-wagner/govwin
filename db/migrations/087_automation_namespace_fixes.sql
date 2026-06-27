-- Migration 087: fix silent automation breaks (namespace drift) + agent_task_log
-- hot-path indexes. (Deploy-now gap report A1-A3, I1.)
--
-- Root cause (A2/A3): seed mig 019 wired application rules under the `identity`
-- namespace, but the app emits them under `capture` (later migs moved the
-- emitters). The rules therefore never matched → rejection email + new-application
-- admin alert silently never fired. (A1): the social-distribute rule was seeded
-- under `system/content.published` but the pipeline emits `library/content.published`.
-- These UPDATEs are idempotent — re-running matches nothing once corrected, and on
-- a fresh deploy this runs after 019/040 so it corrects the seeded rows.

-- A2 — rejection email: identity/application.rejected -> capture/application.rejected
UPDATE automation_rules
   SET trigger_namespace = 'capture', updated_at = now()
 WHERE trigger_namespace = 'identity' AND trigger_type = 'application.rejected';

-- A3 — new-application admin alert: identity/application.submitted -> capture/application.submitted
UPDATE automation_rules
   SET trigger_namespace = 'capture', updated_at = now()
 WHERE trigger_namespace = 'identity' AND trigger_type = 'application.submitted';

-- A1 — social distribution: system/content.published -> library/content.published
UPDATE automation_rules
   SET trigger_namespace = 'library', updated_at = now()
 WHERE trigger_namespace = 'system' AND trigger_type = 'content.published'
   AND action_type = 'distribute_social';

-- A4 note: identity/tenant.created has NO emitter (tenant creation is a 501 stub);
-- acceptance email already fires via capture/application.accepted. Left in place
-- (harmless dead rule) — repoint or remove when tenant.created is implemented.

-- I1 — agent_task_log hot-path indexes. Every agent invocation runs a tenant
-- rate-limit COUNT + monthly-budget SUM (tenant_id AND created_at >= month) and a
-- platform-cap SUM (created_at >= month, all tenants incl. NULL). Existing indexes
-- are (tenant_id) and (tenant_id, agent_role); neither covers created_at, so both
-- sums post-filter the full per-tenant history on every call.
CREATE INDEX IF NOT EXISTS idx_atl_tenant_created ON agent_task_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_atl_created        ON agent_task_log (created_at);
