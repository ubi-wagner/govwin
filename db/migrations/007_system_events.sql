-- 007_system_events.sql
--
-- Structured event stream for the RFP Pipeline platform. Every
-- significant action across the system writes to this table via
-- frontend/lib/events.ts (emitEventStart / emitEventEnd /
-- emitEventSingle). See docs/EVENT_CONTRACT.md for the binding
-- specification of the row shape and the start/end pattern.
--
-- Namespaces (see docs/NAMESPACES.md §"Event namespaces"):
--   finder.*    — opportunity ingestion, triage, curation, push
--   capture.*   — customer conversion, purchases, workspace provision
--   proposal.*  — workspace lifecycle (Phase 3)
--   agent.*     — agent invocations (Phase 4)
--   identity.*  — auth, invites, password changes
--   system.*    — platform operations (migrations, deploys, errors)
--   tool.*      — tool invocation audit (tool.invoke.start/end)
--
-- Phases:
--   'start'  — beginning of a paired action; later referenced by an
--              'end' event via parent_event_id
--   'end'    — completion of a paired action; carries duration_ms and
--              either a result_shape payload or an error object
--   'single' — instantaneous event that doesn't need bracketing
--              (e.g., identity.user.signed_in)
--
-- Idempotency: CREATE TABLE IF NOT EXISTS makes this safe to re-run;
-- index + trigger creations use IF NOT EXISTS / DROP IF EXISTS.

CREATE TABLE IF NOT EXISTS system_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace         TEXT NOT NULL,
    type              TEXT NOT NULL,
    phase             TEXT NOT NULL CHECK (phase IN ('start', 'end', 'single')),
    actor_type        TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'pipeline', 'agent')),
    actor_id          TEXT NOT NULL,
    actor_email       TEXT,
    tenant_id         UUID REFERENCES tenants(id),
    parent_event_id   UUID REFERENCES system_events(id),
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    error             JSONB,
    duration_ms       INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes serve the query patterns used by:
--   1. Admin /admin/system page: "show the last 100 errors" →
--      (phase = 'end' AND error IS NOT NULL) ORDER BY created_at DESC
--   2. Per-tenant audit: WHERE tenant_id = ? ORDER BY created_at DESC
--   3. Event correlation: WHERE parent_event_id = ? (for tracing
--      all child events of a given start event)
--   4. Namespace subscription (Phase 4): WHERE namespace = ? AND
--      created_at > ?
CREATE INDEX IF NOT EXISTS idx_system_events_namespace_type
    ON system_events (namespace, type);
CREATE INDEX IF NOT EXISTS idx_system_events_tenant_id
    ON system_events (tenant_id)
    WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_events_parent
    ON system_events (parent_event_id)
    WHERE parent_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_events_created_at
    ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_errors
    ON system_events (created_at DESC)
    WHERE error IS NOT NULL;

-- NOTIFY hook so Phase 4 agent subscribers can listen for new events
-- via pg_notify. Channel naming is `events:{namespace}` — each
-- subscriber listens to the namespaces it cares about.
CREATE OR REPLACE FUNCTION notify_system_event() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'events:' || NEW.namespace,
        json_build_object(
            'id',        NEW.id,
            'namespace', NEW.namespace,
            'type',      NEW.type,
            'phase',     NEW.phase,
            'tenant_id', NEW.tenant_id
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_events_notify ON system_events;
CREATE TRIGGER system_events_notify
    AFTER INSERT ON system_events
    FOR EACH ROW
    EXECUTE FUNCTION notify_system_event();
