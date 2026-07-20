-- 118_scout_crawl_and_schedules.sql
--
-- Our-org scout/CMS expansion. Three parts ((C) is inline right after (A)):
--
--   (A) Seed the SHARED cron manager (pipeline_schedules) with run_type='event' rows so the
--       our-org scheduled workflows run on the SAME cron + workflow processor as everything
--       else (ingest.dispatcher.tick_schedules emits source='namespace:type' → the processor
--       runs the workflow). Cron times are UTC (platform-canonical); admins pick a DISPLAY
--       timezone (users.timezone, part C) that the UI renders in. Idempotent via
--       ON CONFLICT (source) — UNIQUE(source).
--
--   (B) The CRAWL infrastructure the scouts consume: `scout_sources` (org websites / social
--       handles / RSS to crawl) and `scout_findings` (the candidate items a crawler WORKER
--       writes — the content/opportunity analog of how the ingesters write `opportunities`).
--       Platform / our-org scope (no tenant_id). Agents READ findings; the crawler WRITES them.
--
-- Idempotent.

-- ─────────────────────────────────────────────────────────────────────────────
-- (A) Scheduled workflow triggers on the shared cron (Eastern-baselined)
-- ─────────────────────────────────────────────────────────────────────────────
-- Staggered next_run_at so a deploy doesn't fire them all at once; compute_next_run aligns
-- each to its cron cadence after the first tick.
INSERT INTO pipeline_schedules (id, source, run_type, cron_expression, enabled, next_run_at)
VALUES
  -- POD 4 ops digest — daily 13:00 UTC → OnOpsDigestRequested
  (gen_random_uuid(), 'system:ops.digest_requested', 'event', '0 13 * * *', true, now() + interval '5 minutes'),
  -- Scout update-scan — every 6h → OnSolicitationUpdateScan (proactive amendment re-check)
  (gen_random_uuid(), 'finder:solicitation.update_scan_requested', 'event', '0 */6 * * *', true, now() + interval '10 minutes'),
  -- CMS resurface — weekly Mon 13:00 UTC → OnContentResurfaceRequested
  (gen_random_uuid(), 'library:content.resurface_requested', 'event', '0 13 * * 1', true, now() + interval '15 minutes'),
  -- CMS social scheduling — daily 14:00 UTC → OnSocialScheduleRequested
  (gen_random_uuid(), 'system:social.schedule_requested', 'event', '0 14 * * *', true, now() + interval '20 minutes')
ON CONFLICT (source) DO UPDATE
  SET run_type = EXCLUDED.run_type,
      cron_expression = EXCLUDED.cron_expression,
      enabled = EXCLUDED.enabled;

-- Per-admin DISPLAY timezone. The platform stores + computes everything in UTC; each user
-- (RFP or tenant admin, or any user) may pick a local timezone the UI renders timestamps in
-- (an IANA name, e.g. 'America/New_York'). 'UTC' default = no conversion. Storage/audit/cron
-- stay UTC; this is presentation only.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- ─────────────────────────────────────────────────────────────────────────────
-- (B) Crawl infrastructure — sources + findings the scouts consume
-- ─────────────────────────────────────────────────────────────────────────────

-- Crawl targets: org websites, social handles, RSS/sitemaps a crawler worker fetches.
CREATE TABLE IF NOT EXISTS scout_sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('website', 'social', 'rss', 'sitemap')),
  url             text NOT NULL,
  handle          text,                       -- e.g. @agency for social
  purpose         text NOT NULL DEFAULT 'content' CHECK (purpose IN ('content', 'opportunity', 'both')),
  enabled         boolean NOT NULL DEFAULT false,
  cron_expression text,                        -- optional per-source crawl cadence (Eastern)
  last_crawled_at timestamptz,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scout_sources_url_key ON scout_sources (url);

-- Candidate items the crawler discovers — the content/opportunity analog of `opportunities`.
-- Agents (content_curator, opportunity_scout, future mailing-list scouts) read these; the
-- crawler worker writes them. dedup_hash makes re-crawls idempotent. `status` + `outcome`
-- carry the OUTCOME (found → reviewed → reposted/drafted/pursued/dismissed), so a scout/watcher
-- has a record of not just what it found but what happened to it.
CREATE TABLE IF NOT EXISTS scout_findings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid REFERENCES scout_sources(id) ON DELETE SET NULL,
  run_id        uuid,                          -- the scout_runs row that discovered it
  purpose       text NOT NULL DEFAULT 'content' CHECK (purpose IN ('content', 'opportunity', 'both')),
  kind          text,                          -- article | post | release | update | ...
  title         text,
  url           text,
  snippet       text,
  author        text,
  published_at  timestamptz,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'reposted', 'drafted', 'pursued', 'dismissed')),
  outcome       text,                          -- free-text outcome (why reposted/pursued/dismissed)
  acted_at      timestamptz,                   -- when the outcome was recorded
  dedup_hash    text,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS scout_findings_dedup_key ON scout_findings (dedup_hash) WHERE dedup_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS scout_findings_status_idx ON scout_findings (purpose, status, discovered_at DESC);

-- Uniform RUN HISTORY for scouts / watchers / publishers — every crawl, update-scan, resurface,
-- or social-publish run logs one row: what ran, when (millisecond-precise), how much it found,
-- and its outcome. The same shape serves all three roles (differentiated by `role`/`kind`), so
-- "scouts have history and outcomes, and so do publishers and watchers" is one model, not three.
CREATE TABLE IF NOT EXISTS scout_runs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          text NOT NULL CHECK (role IN ('scout', 'watcher', 'publisher')),
  kind          text NOT NULL,                 -- crawl | update_scan | resurface | social | generate
  source_id     uuid REFERENCES scout_sources(id) ON DELETE SET NULL,
  trigger_event_id uuid,                        -- the system_events row that triggered it (audit link)
  triggered_by  text NOT NULL DEFAULT 'cron',   -- cron | manual | event
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  found_count   int NOT NULL DEFAULT 0,
  new_count     int NOT NULL DEFAULT 0,
  acted_count   int NOT NULL DEFAULT 0,         -- items that reached an outcome (reposted/pursued/…)
  status        text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  outcome       text,                          -- one-line result summary for the audit trail
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scout_runs_role_idx ON scout_runs (role, kind, started_at DESC);

-- A few example sources (DISABLED — an admin enables + the crawler worker runs on deploy).
INSERT INTO scout_sources (name, kind, url, purpose, enabled, notes)
VALUES
  ('SBIR.gov news', 'rss', 'https://www.sbir.gov/news', 'both', false, 'Program news + solicitation updates'),
  ('SAM.gov updates', 'website', 'https://sam.gov', 'opportunity', false, 'Opportunity postings + amendments'),
  ('DoD SBIR/STTR (DSIP)', 'website', 'https://www.dodsbirsttr.mil', 'both', false, 'DoD topics + announcements')
ON CONFLICT (url) DO NOTHING;
