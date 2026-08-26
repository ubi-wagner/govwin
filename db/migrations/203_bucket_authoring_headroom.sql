-- 203 · Spotlight bucket cap must leave authoring headroom (bug log B62)
--
-- Mig 181 moved max_buckets_per_tenant 12 → 6. Every tenant-creation path
-- (applications/[id]/accept, create-tenant, create-partner-org, partner/own-org) seeds
-- lib/spotlight/default-buckets.DEFAULT_BUCKETS so fanned cards rank on arrival — and that
-- set is exactly 6. RANKING_SPINE.md §15 asks for both in one sentence ("12 → 6; keep all 6
-- seeded defaults"); the arithmetic of the pair is a closed door.
--
-- Effect before this migration: a brand-new tenant opens at 100% of cap, so the ranking
-- spine's headline act — a customer authoring their own scoring lens — answers
--   409 BUCKET_LIMIT "You've reached the limit of 6 spotlight buckets. Delete one to add another."
-- before they have authored a single one. Proven live on a freshly-onboarded tenant during the
-- midterm end-to-end drive (northwind-additive: 6 active buckets, 0 tenant-authored).
--
-- Fix here: raise the stored cap to the seeded-set size plus authoring headroom (6 + 4 = 10),
-- ONLY where it still sits at the mig-181 value — an rfp_admin who has deliberately tuned the
-- cap to something else keeps their number. lib/automation/policy.ts additionally floors any
-- configured value at DEFAULT_BUCKETS.length + 1, so the two constants stay in a relationship
-- rather than silently colliding again the next time either one moves.

UPDATE automation_framework
   SET max_buckets_per_tenant = 10
 WHERE id = 1
   AND max_buckets_per_tenant = 6;

ALTER TABLE automation_framework ALTER COLUMN max_buckets_per_tenant SET DEFAULT 10;
