-- 008_capacity_and_system_health.sql
--
-- Adds the tables that back the /admin/system page and the
-- tool-invocation metrics used by Phase 4 capacity planning.
--
-- Two tables:
--
--   tool_invocation_metrics — one row per tool invocation, written
--     by lib/capacity.ts::recordInvoke() after the registry emits
--     the tool.invoke.end event. Used for:
--       - admin panel aggregates ("hot tools by p95 latency")
--       - per-tenant capacity counters
--       - cost attribution (Phase 5 billing)
--
--   system_health_snapshots — periodic snapshots of queue depth,
--     error rate, and other synthetic metrics written by a Phase 4
--     background job. Phase 0.5b creates the table structure; the
--     writer job lands later.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS
-- throughout. Safe to re-run via the GitHub Actions migrate workflow.

-- ─── tool_invocation_metrics ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS tool_invocation_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name       TEXT NOT NULL,
    tool_namespace  TEXT NOT NULL,
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'pipeline', 'agent')),
    actor_id        TEXT NOT NULL,
    tenant_id       UUID REFERENCES tenants(id),
    success         BOOLEAN NOT NULL,
    error_code      TEXT,
    duration_ms     INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Admin panel queries: "hot tools by p95 in the last 24h"
CREATE INDEX IF NOT EXISTS idx_tim_tool_created
    ON tool_invocation_metrics (tool_name, created_at DESC);

-- Per-tenant capacity: "tool calls by this tenant in the last 7d"
CREATE INDEX IF NOT EXISTS idx_tim_tenant_created
    ON tool_invocation_metrics (tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;

-- Error rate aggregates
CREATE INDEX IF NOT EXISTS idx_tim_errors
    ON tool_invocation_metrics (created_at DESC)
    WHERE success = false;

-- ─── system_health_snapshots ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_health_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    queue_depth       INTEGER NOT NULL DEFAULT 0,        -- agent_task_queue rows in status='pending'
    events_last_hour  INTEGER NOT NULL DEFAULT 0,        -- system_events written in the last hour
    errors_last_hour  INTEGER NOT NULL DEFAULT 0,        -- system_events with error IS NOT NULL in last hour
    db_reachable      BOOLEAN NOT NULL DEFAULT true,
    s3_reachable      BOOLEAN NOT NULL DEFAULT true,
    notes             JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shs_captured
    ON system_health_snapshots (captured_at DESC);
