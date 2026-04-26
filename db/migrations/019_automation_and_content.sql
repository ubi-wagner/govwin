-- Automation rules: when event X fires, do action Y
CREATE TABLE IF NOT EXISTS automation_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    trigger_namespace TEXT NOT NULL,
    trigger_type    TEXT NOT NULL,
    action_type     TEXT NOT NULL CHECK (action_type IN ('send_email', 'notify_admin', 'webhook', 'update_status')),
    action_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger
  ON automation_rules (trigger_namespace, trigger_type) WHERE is_active = true;

-- Automation execution log
CREATE TABLE IF NOT EXISTS automation_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id         UUID NOT NULL REFERENCES automation_rules(id),
    trigger_event_id UUID,
    action_type     TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('success', 'failed', 'skipped')),
    result          JSONB DEFAULT '{}'::jsonb,
    error_message   TEXT,
    executed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_automation_log_rule
  ON automation_log (rule_id, executed_at DESC);

-- CMS content: markdown articles stored in DB for marketing pages
CREATE TABLE IF NOT EXISTS cms_content (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    content_type    TEXT NOT NULL CHECK (content_type IN ('blog_post', 'resource', 'guide', 'announcement', 'faq')),
    body            TEXT NOT NULL,
    excerpt         TEXT,
    author          TEXT,
    tags            TEXT[] DEFAULT '{}',
    published       BOOLEAN NOT NULL DEFAULT false,
    published_at    TIMESTAMPTZ,
    featured_image  TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cms_content_type_published
  ON cms_content (content_type, published_at DESC) WHERE published = true;
CREATE INDEX IF NOT EXISTS idx_cms_content_slug
  ON cms_content (slug);
CREATE INDEX IF NOT EXISTS idx_cms_content_tags
  ON cms_content USING gin (tags);

-- Seed default automation rules
INSERT INTO automation_rules (name, description, trigger_namespace, trigger_type, action_type, action_config)
VALUES
  ('Welcome email on acceptance', 'Send welcome email with temp password when application is accepted', 'identity', 'tenant.created', 'send_email', '{"template": "application_accepted"}'::jsonb),
  ('Admin alert on new application', 'Notify admin when a new application is submitted', 'identity', 'application.submitted', 'notify_admin', '{"template": "admin_new_application", "to": "eric@rfppipeline.com"}'::jsonb),
  ('Rejection email', 'Send rejection email when application is rejected', 'identity', 'application.rejected', 'send_email', '{"template": "application_rejected"}'::jsonb)
ON CONFLICT DO NOTHING;
