# Spotlight Bucket Lock-Down (2026-08-15)

Hardening pass on the tenant spotlight-bucket scoring/ranking subsystem — the ranking that makes the
Command Center's **Opportunities** lane (and the `/cards` order) mean anything. Scope decided with the
product owner: **keep the 6 live signals, harden them; do NOT activate the reserved TRL/prior-funding
signals** (that needs opp-TRL extraction + a tenant→award linkage — a separate follow-on). Full
Tier 1+2+3. Harden keyword matching.

## As-is (scouted 2026-08-15)

- **Schema is production-grade already.** `tenant_spotlight_buckets` + `tenant_bucket_scores` (mig 096)
  are both **FORCE-RLS** (`tenant_isolation`), with UNIQUE `(tenant_id, bucket_id, opportunity_id)`, a
  `(tenant_id, bucket_id, score DESC)` ranking index, and `ON DELETE CASCADE` from bucket. `criteria` +
  `factors` are jsonb.
- **The scorer** (`frontend/lib/bucket-ranking.ts` `scoreCard`) is a clean 6-signal weighted average:
  `keyword · naics · agency · program · accessibility(set-aside) · timeline`, each normalized [0,1] ×
  weight → `round(100·Σvw/Σw)`. `trl`/prior-funding are **reserved** (not wired). Faithful Python port
  in `pipeline/src/workflows/actions/rescore.py`.
- **Event-driven**, not in-tx: card arrival → `capture:card.applied` → `OnCardApplied` →
  `rescore_tenant_card`; bucket create/edit → `capture:buckets.updated` → `OnBucketsUpdated` →
  `rescore_tenant`. Bucket **create** also does a synchronous `rankBucket` for instant results.

## The gaps (what this pass fixes)

**Tier 1 — integrity (mig 180 + code):**
1. `frontend/scripts/backfill-buckets.mts` imports the deleted `autoScoreCard` → dead/broken.
2. `score` lost its `CHECK (0..100)` when the legacy table was retired — a bad writer can store anything.
3. Orphaned scores: `opportunity_id` has no cascade, so deleting a card leaves its score rows behind.
4. `rankBucket` does not `coerceJsonb` `criteria`/`card` → a wrong-shaped jsonb write silently zeroes
   every score (the repo's documented #1 jsonb footgun).
5. `DELETE` a bucket sets `is_active=false` but never prunes its scores or re-ranks; no reactivation.

**Tier 2 — safety + validation:**
6. The canonical **TS scorer has zero direct tests** — correctness rests on comment-discipline parity
   with the Python port. Add a vitest suite mirroring `test_rescore.py`.
7. Criteria have **no shape validation**; PATCH **clobbers** the whole `criteria` object. Validate on
   create/edit; PATCH merges.
8. Keyword matching is **substring** → bare `'ai'`/`'ml'` false-positive on "email"/"html". Word-boundary
   for short tokens (≤3 chars); substring for multi-word phrases. Mirror in Python.

**Tier 3 — determinism + hygiene:**
9. Timeline decays with wall-clock but nothing periodically re-scores → urgency goes stale. Add a **daily
   rescore** (lifecycle scheduler). Timeline is day-banded, so daily cadence is the clean fix.
10. `is_active` count mismatch (dashboard counts deactivated; manage doesn't).
11. Doc drift: several docs still describe the retired in-tx `autoScoreCard` path.

## Verify

Green backbone (`tsc` · `vitest` · `pytest`) + a live drive of create/edit/rank/delete as `tenant_admin`
**served under the forced-RLS `govtech_app` role** (folds in the CC RLS-verification caveat).

## Explicitly OUT of scope (follow-on)

Activating TRL + prior-funding (needs opp-TRL extraction + tenant→award linkage); making
`NOTIFICATION_THRESHOLD` tenant-configurable.
