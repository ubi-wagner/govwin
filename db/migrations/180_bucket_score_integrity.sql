-- 180_bucket_score_integrity.sql
-- Spotlight-bucket lock-down, Tier 1 — restore the integrity guards tenant_bucket_scores lost when
-- the legacy spotlight_bucket_scores table was retired (docs/BUCKET_LOCKDOWN.md).
--
--  1. Score bounds — the scorer emits round(100·…) ∈ [0,100], but mig 096 dropped the legacy
--     CHECK(score BETWEEN 0 AND 100). Clamp any stragglers, then re-assert the CHECK so a bad
--     writer can never store an out-of-range score again.
--  2. Orphan prune — opportunity_id carries NO FK (tenant cards hold no FK to global opps), so a
--     deleted/never-mirrored card leaves score rows behind. Delete scores whose (tenant, opp) has
--     no live card. (Bucket deletion already cascades; card deletion did not.)
--  3. Inactive-bucket prune — DELETE a bucket only sets is_active=false (soft), so its score rows
--     linger (hidden by the /cards is_active join, but they skew the digest's LEFT-joined reads).
--     Drop them; the app now prunes on deactivate going forward.
--
-- Idempotent + safe to re-run. Runs as the owner (superuser) so FORCE-RLS is bypassed for the sweep.

-- 1a. Clamp any existing out-of-range scores so the CHECK can attach.
UPDATE tenant_bucket_scores
   SET score = LEAST(100, GREATEST(0, score))
 WHERE score < 0 OR score > 100;

-- 2. Prune orphaned scores (no live card for this tenant+opportunity).
DELETE FROM tenant_bucket_scores s
 WHERE NOT EXISTS (
   SELECT 1 FROM tenant_opportunity_cards c
    WHERE c.tenant_id = s.tenant_id AND c.opportunity_id = s.opportunity_id
 );

-- 3. Prune scores tied to a deactivated bucket.
DELETE FROM tenant_bucket_scores s
 USING tenant_spotlight_buckets b
 WHERE b.id = s.bucket_id AND b.is_active = false;

-- 1b. Re-assert the score-range CHECK (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_tbs_score_range') THEN
    ALTER TABLE tenant_bucket_scores
      ADD CONSTRAINT chk_tbs_score_range CHECK (score BETWEEN 0 AND 100);
  END IF;
END $$;
