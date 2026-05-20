-- =============================================================================
-- Migration 040: CRM Phase 1 — lead lifecycle, admin todos, social media
-- Depends on: 039
--
-- Adds:
--   tenants.lifecycle_stage  — track lead/customer lifecycle
--   admin_todos              — internal task queue for admins
--   social_accounts          — connected social media accounts
--   social_posts             — scheduled/posted social content
--   automation_rules seeds   — auto-create todos + social distribution
-- =============================================================================

-- 1. Lifecycle stage on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT
  DEFAULT 'customer' CHECK (lifecycle_stage IN ('lead','target','customer','at_risk','churned'));

-- =============================================================================
-- 2. ADMIN_TODOS — internal task queue
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  todo_type TEXT NOT NULL CHECK (todo_type IN ('curation','support','content_review','campaign','general')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','dismissed')),
  assigned_to UUID REFERENCES users(id),
  tenant_id UUID REFERENCES tenants(id),
  related_entity_type TEXT,
  related_entity_id UUID,
  due_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_todos_status ON admin_todos(status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_admin_todos_assigned ON admin_todos(assigned_to) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_admin_todos_type ON admin_todos(todo_type);

-- =============================================================================
-- 3. SOCIAL_ACCOUNTS — connected platform accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','twitter','facebook','instagram')),
  account_name TEXT NOT NULL,
  platform_account_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  tenant_id UUID REFERENCES tenants(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','disconnected')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);

-- =============================================================================
-- 4. SOCIAL_POSTS — scheduled and posted social content
-- =============================================================================
CREATE TABLE IF NOT EXISTS social_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID,
  social_account_id UUID NOT NULL REFERENCES social_accounts(id),
  platform TEXT NOT NULL,
  post_text TEXT NOT NULL,
  media_urls TEXT[],
  link_url TEXT,
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  platform_post_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','posting','posted','failed')),
  engagement_data JSONB DEFAULT '{}',
  error_message TEXT,
  retry_count INT DEFAULT 0,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_account ON social_posts(social_account_id);

-- =============================================================================
-- 5. TRIGGERS — updated_at
-- =============================================================================
CREATE TRIGGER admin_todos_updated_at BEFORE UPDATE ON admin_todos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_posts_updated_at BEFORE UPDATE ON social_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- 6. AUTOMATION RULES — CRM event-driven actions
-- =============================================================================
INSERT INTO automation_rules (id, trigger_namespace, trigger_type, action_type, action_config, is_active, description) VALUES
  (gen_random_uuid(), 'capture', 'application.submitted', 'create_todo', '{"title_template": "Review application from {company_name}", "todo_type": "general", "priority": "high"}', true, 'Auto-create admin todo on new application'),
  (gen_random_uuid(), 'system', 'content.published', 'distribute_social', '{"platforms": ["linkedin"]}', true, 'Post published content to LinkedIn'),
  (gen_random_uuid(), 'finder', 'source.change_detected', 'create_todo', '{"title_template": "Review scout changes: {source_name}", "todo_type": "curation", "priority": "medium"}', true, 'Auto-create curation todo on source change');
