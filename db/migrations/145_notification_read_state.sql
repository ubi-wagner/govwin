-- 145_notification_read_state.sql
-- Per-user notification read watermark.
--
-- Notifications are DERIVED from system_events (there is no per-row read flag), so the bell tracked
-- "seen" client-side only and the unread badge reappeared on every reload. A single last_read_at per
-- (user, tenant) makes "mark all read" + persistent unread counts cheap: a notification is read iff
-- its created_at <= last_read_at. No per-event rows, no per-event join.

CREATE TABLE IF NOT EXISTS notification_read_state (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    last_read_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, tenant_id)
);
