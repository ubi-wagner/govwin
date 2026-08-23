-- 206 · The bucket cap becomes an authoring BUDGET, not `seeded + headroom`.
--
-- History of this number, because it explains why it was wrong rather than just small:
--   mig 126  max_buckets_per_tenant DEFAULT 12
--   mig 181  → 6, at the same time as "keep all 6 seeded defaults"
--   mig 203  → 10, after B62: cap 6 == seeded 6 meant a brand-new tenant opened at 100% of
--             cap and got 409 BUCKET_LIMIT before authoring a single lens of its own. The
--             headroom patched the symptom and left the two numbers entangled — move either
--             and they collide again.
--
-- #189 removes the entanglement at the root: no tenant-creation path seeds buckets any more
-- (lib/spotlight/default-buckets.ts is now a fixture/demo catalog). A bucket is purely the
-- customer's own ranking lens, so nothing is spent before they spend it and the cap can be a
-- single honest number.
--
-- Why 25 and not unbounded: a bucket is genuinely cheap — `rankBucket` is one pass of
-- deterministic SQL over the tenant's own opportunity cards at creation, and O(1) per card on
-- arrival; no model call anywhere on the path. What it does cost is STORAGE, at
-- O(buckets × cards) rows in tenant_bucket_scores. So the cap bounds storage and gives an
-- operator a lever; it is not rationing a scarce compute. rfp_admin tunes it globally at
-- /admin/automation-framework, and the app floors any configured value at MIN_MAX_BUCKETS (1)
-- so a cap can never leave a tenant unable to author at all.
--
-- Idempotent. Only moves a value still sitting on the mig 203 default, so a deployment that
-- has already tuned the cap by hand keeps its own number.

ALTER TABLE automation_framework ALTER COLUMN max_buckets_per_tenant SET DEFAULT 25;

UPDATE automation_framework
   SET max_buckets_per_tenant = 25
 WHERE id = 1
   AND max_buckets_per_tenant = 10;
