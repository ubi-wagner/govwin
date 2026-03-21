-- 006: Google Drive integration tables
-- drive_files: Index of all Drive files per tenant
-- email_log: Track all sent emails (digest, alerts, onboarding)
-- integration_executions: Audit trail for automated operations

BEGIN;

-- ── drive_files ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS drive_files (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  gid             TEXT UNIQUE NOT NULL,            -- Google Drive file ID
  name            TEXT NOT NULL,
  type            TEXT NOT NULL,                   -- FOLDER, DOCUMENT, SPREADSHEET, etc.
  mime_type       TEXT,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  parent_gid      TEXT,                            -- parent folder's Google Drive ID
  web_view_link   TEXT,
  download_link   TEXT,
  permissions     JSONB DEFAULT '[]'::jsonb,
  is_processed    BOOLEAN DEFAULT false,
  auto_created    BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_drive_files_tenant  ON drive_files(tenant_id);
CREATE INDEX IF NOT EXISTS idx_drive_files_parent  ON drive_files(parent_gid);
CREATE INDEX IF NOT EXISTS idx_drive_files_gid     ON drive_files(gid);

-- ── email_log ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_log (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  message_id      TEXT UNIQUE,                     -- Gmail message ID
  thread_id       TEXT,
  recipient       TEXT NOT NULL,
  subject         TEXT,
  body_preview    TEXT,
  email_type      TEXT NOT NULL,                   -- 'digest', 'alert', 'onboarding', 'custom'
  sent_at         TIMESTAMPTZ DEFAULT now(),
  delivery_status TEXT DEFAULT 'sent'
);

-- ── integration_executions ────────────────────────────────────
CREATE TABLE IF NOT EXISTS integration_executions (
  id              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  function_name   TEXT NOT NULL,                   -- 'drive.createFolder', 'gmail.sendDigest'
  tenant_id       UUID REFERENCES tenants(id) ON DELETE SET NULL,
  status          TEXT DEFAULT 'STARTED',          -- STARTED, COMPLETED, FAILED
  started_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  success         BOOLEAN,
  duration_ms     INTEGER,
  error_message   TEXT,
  parameters      JSONB,
  result          JSONB
);

CREATE INDEX IF NOT EXISTS idx_integration_exec_tenant ON integration_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integration_exec_func   ON integration_executions(function_name);

-- ── Add Drive columns to tenants ──────────────────────────────
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS gmail_thread_label_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS onboarding_step TEXT DEFAULT 'pending';

COMMIT;
