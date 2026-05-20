-- =============================================================================
-- CMS Database Migration 006 — CRM operational tables
--
-- Moves admin_todos, social_accounts, social_posts from Main Postgres into
-- the CMS database. Foreign keys to Main Postgres tables (users, tenants)
-- are replaced with plain UUID columns (no REFERENCES across databases).
--
-- Depends on: 005
-- =============================================================================

-- =============================================================================
-- UTILITY: set_updated_at trigger function
-- (may not exist in CMS Postgres — create it if missing)
-- =============================================================================
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- ADMIN_TODOS — internal task queue
-- =============================================================================
CREATE TABLE IF NOT EXISTS admin_todos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  todo_type TEXT NOT NULL CHECK (todo_type IN ('curation','support','content_review','campaign','general')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('critical','high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','done','dismissed')),
  assigned_to UUID,
  tenant_id UUID,
  related_entity_type TEXT,
  related_entity_id UUID,
  due_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_admin_todos_status ON admin_todos(status) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_admin_todos_assigned ON admin_todos(assigned_to) WHERE status != 'done';
CREATE INDEX IF NOT EXISTS idx_admin_todos_type ON admin_todos(todo_type);

-- =============================================================================
-- SOCIAL_ACCOUNTS — connected platform accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS social_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL CHECK (platform IN ('linkedin','twitter','facebook','instagram')),
  account_name TEXT NOT NULL,
  platform_account_id TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  tenant_id UUID,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','revoked','disconnected')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_accounts_platform ON social_accounts(platform);

-- =============================================================================
-- SOCIAL_POSTS — scheduled and posted social content
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
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_social_posts_scheduled ON social_posts(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_social_posts_account ON social_posts(social_account_id);

-- =============================================================================
-- TRIGGERS — updated_at
-- =============================================================================
CREATE TRIGGER admin_todos_updated_at BEFORE UPDATE ON admin_todos FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_accounts_updated_at BEFORE UPDATE ON social_accounts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER social_posts_updated_at BEFORE UPDATE ON social_posts FOR EACH ROW EXECUTE FUNCTION set_updated_at();
