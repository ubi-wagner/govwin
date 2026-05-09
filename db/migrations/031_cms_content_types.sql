-- Create cms_content if it doesn't exist (019 may be in history but table
-- was never created due to transaction rollback with history entry surviving)
CREATE TABLE IF NOT EXISTS cms_content (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    content_type    TEXT NOT NULL DEFAULT 'page_block',
    body            TEXT NOT NULL DEFAULT '',
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

-- Add more content types for marketing page blocks
ALTER TABLE cms_content DROP CONSTRAINT IF EXISTS cms_content_content_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cms_content' AND constraint_name = 'cms_content_content_type_check'
  ) THEN
    ALTER TABLE cms_content ADD CONSTRAINT cms_content_content_type_check
      CHECK (content_type IN (
        'blog_post', 'resource', 'guide', 'announcement', 'faq',
        'testimonial', 'team_member', 'social_post', 'page_block'
      ));
  END IF;
END $$;

-- External URL for resources that link out
ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
