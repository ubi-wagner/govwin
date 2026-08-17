-- 179_command_seen_state.sql
-- Per-(user, scope, tab) "last looked at" watermark for the Command Center.
--
-- The CC tab badges show the OPEN count (how many items need me). This adds the second half of the
-- email-inbox glance: which tabs have NEW items since I last looked. A notification/item is "new to
-- me" on a tab iff its created_at > my last_seen_at for that (scope, tab). One row per tab I've
-- viewed; no per-item rows, no per-item join — same cheap-watermark shape as notification_read_state
-- (mig 145). scope is the CC instance: 'admin' | 'tenant:<uuid>' | 'partner:<uuid>'; tab is the
-- tab key ('opp' | 'todos' | 'workflows' | 'activity' | 'admin' | 'tenant' | 'system').
--
-- Personal-preference data keyed by user_id (like notification_read_state): the app always filters
-- WHERE user_id = <session user>, so no RLS policy — a plain granted table, accessed on the app pool.

CREATE TABLE IF NOT EXISTS command_seen_state (
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope         TEXT NOT NULL,
    tab           TEXT NOT NULL,
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, scope, tab)
);

-- Grant on the app role (defensive — ALTER DEFAULT PRIVILEGES already covers new tables, but match
-- the RLS-cutover's explicit-grant idiom so a from-scratch migrate is self-contained). Guarded so a
-- pre-cutover DB without the role still applies clean.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'govtech_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON command_seen_state TO govtech_app;
  END IF;
END $$;
