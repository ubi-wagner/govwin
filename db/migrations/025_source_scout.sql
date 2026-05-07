-- 025_source_scout.sql
--
-- Source Scout: HITL-guided web monitoring for opportunity sources.
-- Extends source_profiles with auto-crawl settings and adds tables for
-- annotated page regions, content snapshots, and change diffs.
--
-- Purely additive. Idempotent.

-- ─── Extend source_profiles with auto-crawl settings ────────────────

ALTER TABLE source_profiles
  ADD COLUMN IF NOT EXISTS auto_crawl_enabled BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS crawl_cron TEXT DEFAULT '0 6 * * *',
  ADD COLUMN IF NOT EXISTS last_crawl_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS crawl_config JSONB DEFAULT '{}'::jsonb;

-- ─── Regions of interest annotated by admin (HITL guidance) ─────────

CREATE TABLE IF NOT EXISTS source_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selector_hint TEXT,          -- CSS selector admin noted
  content_context TEXT,        -- Admin's description: "this table lists active topics"
  region_type TEXT DEFAULT 'content'
    CHECK (region_type IN ('content','listing','download','navigation','table')),
  sample_html TEXT,            -- Snapshot of HTML when region was annotated
  sample_text TEXT,            -- Plain text extraction of the sample
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_regions_profile
  ON source_regions (profile_id) WHERE is_active = true;

-- ─── Snapshots of crawled content per region ────────────────────────

CREATE TABLE IF NOT EXISTS source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  region_id UUID REFERENCES source_regions(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  content_text TEXT,
  raw_html_s3_key TEXT,
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_region
  ON source_snapshots (region_id, captured_at DESC);

-- ─── Detected changes with Claude analysis ──────────────────────────

CREATE TABLE IF NOT EXISTS source_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  region_id UUID REFERENCES source_regions(id),
  prev_snapshot_id UUID REFERENCES source_snapshots(id),
  next_snapshot_id UUID REFERENCES source_snapshots(id),
  is_meaningful BOOLEAN DEFAULT false,
  summary TEXT,
  extracted_opportunities JSONB DEFAULT '[]'::jsonb,
  severity TEXT DEFAULT 'info'
    CHECK (severity IN ('info','low','medium','high','critical')),
  claude_model TEXT,
  claude_tokens_used INT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_diffs_profile
  ON source_diffs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_diffs_meaningful
  ON source_diffs (is_meaningful, created_at DESC)
  WHERE is_meaningful = true;
