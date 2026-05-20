-- =============================================================================
-- 008 — Generation Sources: multi-input content generation support
--
-- Adds source tracking columns to cms_generations to support generation from:
--   prompt (default), url, email, screenshot, repackage
-- =============================================================================

ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'prompt'
    CHECK (source_type IN ('prompt','url','email','screenshot','repackage'));
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS source_url TEXT;
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS source_email_id UUID;
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS source_content TEXT;
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS attachments TEXT[] DEFAULT '{}';
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE cms_generations ADD COLUMN IF NOT EXISTS requested_by_email TEXT;

-- Index for finding generations by source
CREATE INDEX IF NOT EXISTS idx_cms_generations_source_type ON cms_generations(source_type);
CREATE INDEX IF NOT EXISTS idx_cms_generations_tenant ON cms_generations(tenant_id) WHERE tenant_id IS NOT NULL;
