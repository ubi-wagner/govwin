-- 107_spotlight_summary.sql
--
-- The RFP admin's manual FIRST-PASS "summary for spotlight matches": a short,
-- curated context blurb (built from the shred's recommendations) that captures
-- what the solicitation is really about for ranking against tenant spotlight
-- buckets. It is REQUIRED before the solicitation is released into the Opportunity
-- Pipeline (the push), and it is folded into the fan-out card so scoreCard's
-- keyword match sees it. The full skeleton (volumes/molds/templates) remains a
-- separate, later step (built eagerly or at purchase) — this is only the
-- lightweight matching context.

ALTER TABLE curated_solicitations ADD COLUMN IF NOT EXISTS spotlight_summary TEXT;
