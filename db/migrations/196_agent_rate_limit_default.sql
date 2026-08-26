-- 196 · Raise the default agent rate limit above one user action
--
-- WHY. `platform_agent_config.default_rate_limit_per_hour` was 50, and the fabric refuses an agent
-- call once a tenant has 50 rows in `agent_task_log` within the hour. That number was chosen when
-- agents were invoked one at a time; the Proposal Draft Manager invokes a COHORT.
--
-- Measured on a live full draft of a 14-section SBIR set (Mode C): ~14 section_drafter calls plus
-- the nine-agent review cohort ≈ 23 calls for ONE press of "Draft the whole proposal". So a
-- customer who drafts, reads the result, and presses regenerate once — the normal way anyone uses
-- this — is refused partway through the second run. The refusal was also silent: draft_v0 logged
-- "skipping" per section and the workflow reported completed, so the build simply arrived half
-- drafted with nothing anywhere explaining why. (That half is fixed separately in
-- pipeline/src/workflows/actions/draft_v0.py, which now stops on a guardrail refusal and reports
-- `blocked_sections` + the reason.)
--
-- 300/hour keeps the control doing its actual job — catching a runaway loop — while leaving room
-- for several legitimate full-draft runs. It is NOT the spend control: `default_monthly_budget`
-- and `platform_monthly_cap` are, and both are unchanged. Tenants with their own
-- `tenant_agent_config.rate_limit_per_hour` override are unaffected.

UPDATE platform_agent_config
SET default_rate_limit_per_hour = 300,
    updated_at = now()
WHERE default_rate_limit_per_hour = 50;
