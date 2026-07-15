-- 108_patch_live_marketing_content.sql
--
-- The public marketing pages render from the CMS store (content_pages.blocks,
-- with cms_content as the legacy fallback), seeded by earlier migrations
-- (034/039/063/064) with the ORIGINAL copy. Our page-content .ts seeds and .tsx
-- fallbacks were updated for the new pricing + copy, but NOTHING syncs them into
-- content_pages — so the live pages kept serving $299/$999/$1,999 and "6%".
--
-- This migration patches the live content directly so the deploy actually reflects
-- the changes. Pure string swaps on the serialized JSON (no structural edits, so
-- the ::jsonb re-parse stays valid), ordered so the $999→$1,999→$4,999 overlap
-- can't corrupt (old Phase II $1,999 is placeholdered BEFORE $999 becomes $1,999).
-- Idempotent enough for a one-shot migration (runs once via the runner).

DO $$
BEGIN
  -- ── content_pages.blocks — the primary render source (active + draft versions) ──
  UPDATE content_pages SET blocks = (
    replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      blocks::text,
      '$1,999', '@@P2@@'),          -- 1: old Phase II → placeholder (before $999 moves up)
      '$999', '$1,999'),            -- 2: Phase I  $999  → $1,999
      '@@P2@@', '$4,999'),          -- 3: Phase II       → $4,999
      '$299', '$499'),              -- 4: Spotlight $299 → $499
      'July 2026', 'August 2026'),  -- 5: launch date
      '6% of the price', 'a tenth of the price'),           -- 6: math error
      'across two decades', 'across 25 years'),             -- 7: tenure contradiction
      'Requires Spotlight subscription', 'Apply for Access'), -- 8: misleading CTA
      'Included with Spotlight', 'Apply for Access'),         -- 9
      'Purchase Hours', 'Apply for Access'),                  -- 10
      'only $1,000 more', 'only $3,000 more'),                -- 11: stale delta
      'Cancel anytime.', '3-month minimum, then cancel anytime.')  -- 12: cancellation policy
  )::jsonb
  WHERE blocks IS NOT NULL;  -- ALL content types + versions (pages, resources, blog) so prices are uniform everywhere

  -- ── cms_content — legacy fallback + the table content_pages was backfilled from ──
  UPDATE cms_content SET
    body = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(
      body,
      '$1,999', '@@P2@@'), '$999', '$1,999'), '@@P2@@', '$4,999'), '$299', '$499'),
      'July 2026', 'August 2026'), '6% of the price', 'a tenth of the price'),
      'across two decades', 'across 25 years'),
      'Requires Spotlight subscription', 'Apply for Access'),
      'Included with Spotlight', 'Apply for Access'), 'Purchase Hours', 'Apply for Access'),
      'only $1,000 more', 'only $3,000 more'),
      'Cancel anytime.', '3-month minimum, then cancel anytime.'),
    metadata = (
    replace(replace(replace(replace(replace(replace(replace(
      COALESCE(metadata, '{}'::jsonb)::text,
      '$1,999', '@@P2@@'), '$999', '$1,999'), '@@P2@@', '$4,999'), '$299', '$499'),
      'Requires Spotlight subscription', 'Apply for Access'),
      'Included with Spotlight', 'Apply for Access'), 'Purchase Hours', 'Apply for Access')
    )::jsonb
  WHERE body IS NOT NULL OR metadata IS NOT NULL;  -- all cms_content rows (page_block, resource, blog, …)
END $$;
