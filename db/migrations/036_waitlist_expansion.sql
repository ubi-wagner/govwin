-- Expand waitlist table with full registration fields and connection metadata
-- The table is auto-created by the API route; this adds the new columns

ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS company_size TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS technology TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS ip_address TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS referer TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS city TEXT;
