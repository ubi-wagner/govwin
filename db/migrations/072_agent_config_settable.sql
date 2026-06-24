-- 072_agent_config_settable.sql
-- Make the agent cost-control limits admin-settable in two scopes:
--   1. Per-tenant   — tenant_agent_config (budget already exists; add rate limit)
--   2. Pipeline-wide — platform_agent_config (a new singleton: defaults + a
--      hard platform monthly cap + a master AI on/off switch)
--
-- The guards (frontend/lib/ai/agent-guard.ts, pipeline/src/agents/fabric.py)
-- resolve effective limits as: tenant override -> platform default -> the
-- hardcoded constant (last-resort fallback if a row is missing). Nothing here
-- changes current behavior until an admin edits a value: the seeded platform
-- defaults match the existing constants (50 calls/hour, $50/month), the cap is
-- NULL (off), and AI is enabled.

-- ── 1. Per-tenant: settable hourly rate limit ───────────────────────────────
-- NULL = inherit the platform default (keeps existing rows behaving as before).
ALTER TABLE tenant_agent_config
  ADD COLUMN IF NOT EXISTS rate_limit_per_hour INT;

-- ── 2. Pipeline-wide singleton config ───────────────────────────────────────
-- The single-row guard (id is always TRUE) keeps exactly one platform config.
CREATE TABLE IF NOT EXISTS platform_agent_config (
    id                          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
    -- Defaults applied to any tenant without an explicit override.
    default_monthly_budget      NUMERIC(10,2) NOT NULL DEFAULT 50.00,
    default_rate_limit_per_hour INT           NOT NULL DEFAULT 50,
    -- Hard ceiling on TOTAL AI spend across ALL tenants + admin/system for the
    -- calendar month. NULL = no platform cap (off). Closes the otherwise
    -- uncapped admin (tenant_id = NULL) path.
    platform_monthly_cap        NUMERIC(12,2),
    -- Master switch for the whole agent workforce. FALSE disables all AI.
    ai_enabled                  BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by                  UUID
);

-- Seed the single row with the current hardcoded defaults so behavior is
-- byte-identical until an admin changes something.
INSERT INTO platform_agent_config
    (id, default_monthly_budget, default_rate_limit_per_hour, platform_monthly_cap, ai_enabled)
VALUES
    (TRUE, 50.00, 50, NULL, TRUE)
ON CONFLICT (id) DO NOTHING;
