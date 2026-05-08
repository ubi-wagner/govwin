-- Add more content types for marketing page blocks
ALTER TABLE cms_content DROP CONSTRAINT IF EXISTS cms_content_content_type_check;
ALTER TABLE cms_content ADD CONSTRAINT cms_content_content_type_check
  CHECK (content_type IN (
    'blog_post', 'resource', 'guide', 'announcement', 'faq',
    'testimonial', 'team_member', 'social_post', 'page_block'
  ));

-- External URL for resources that link out
ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS external_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
