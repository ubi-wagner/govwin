-- Migration 085: allow platform (non-tenant) AI spend to be logged + capped (G1).
--
-- agent_task_log.tenant_id was NOT NULL, so platform/system Claude calls (the
-- shredder per-ingest, discovery, CMS content generation) could not be logged —
-- and fabric._log_task skipped null-tenant logging — leaving platform spend
-- invisible to platform_agent_config.platform_monthly_cap. Make tenant_id
-- nullable (NULL = platform/system spend). The FK to tenants(id) and the
-- idx_atl_tenant index both still apply to non-null rows.
ALTER TABLE agent_task_log ALTER COLUMN tenant_id DROP NOT NULL;
