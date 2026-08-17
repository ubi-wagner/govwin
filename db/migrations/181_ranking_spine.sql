-- Migration 181: Ranking-spine hardening.
--
-- Canonical: docs/RANKING_SPINE.md. Realizes the customer-admin/designee → cap →
-- rescore/reshuffle → single-list per-bucket ranking → admin pin-for-updates →
-- notify/nudge → provision spine. This migration adds ONLY the new columns/defaults
-- the spine needs; the code that reads them ships in the same pass.
--
-- All four blocks are idempotent + guarded so a re-run (or a partially-applied env)
-- is a no-op. Nothing here drops or rewrites existing data.

-- ── 1. Bucket cap ───────────────────────────────────────────────────────────────
-- Raise the platform default 12 → 6 (product decision: keep all 6 seeded defaults and
-- cap at 6). This is a framework-HARD limit to the tenant; an rfp_admin tunes it
-- GLOBALLY at /admin/automation-framework (mig 126). The column existed and was
-- admin-editable, but NOTHING read or enforced it — RANK-2 wires enforcement into the
-- bucket-create route. The UPDATE only moves the singleton off the OLD default (12), so
-- an admin who already tuned the value is never stomped.
ALTER TABLE automation_framework ALTER COLUMN max_buckets_per_tenant SET DEFAULT 6;
UPDATE automation_framework SET max_buckets_per_tenant = 6 WHERE id = 1 AND max_buckets_per_tenant = 12;

-- ── 2. Designee grant ───────────────────────────────────────────────────────────
-- A tenant_admin may delegate bucket authoring to a chosen team member. Per-membership
-- capability (audited, revocable). DEFAULT false → today's tenant_admin-only authoring
-- is unchanged until a grant is set. user_memberships is RLS-off (read via `sql` in
-- verifyTenantAccess); RANK-3 adds canManageBuckets() over this column + a tenant_admin
-- toggle. A tenant_user with the grant can create/edit/delete buckets in their OWN
-- tenant (the coarse verifyTenantAccess gate already admits them read-side).
ALTER TABLE user_memberships ADD COLUMN IF NOT EXISTS can_manage_buckets BOOLEAN NOT NULL DEFAULT false;

-- ── 3. Admin pin-for-updates ────────────────────────────────────────────────────
-- rfp_admin arms update-monitoring on a MASTER opportunity so amendment/re-push updates
-- fan out to EVERY tenant holding its mirror card — pre-purchase, before any proposal
-- exists (today's amendment engine only reaches opps that already have a proposal).
-- `opportunities` is the platform catalog (no tenant_id, RLS-off): admin writes go
-- through sqlBypass. RANK-8 adds the toggle route + the holder fan-out.
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS update_watch    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS update_watch_at TIMESTAMPTZ;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS update_watch_by UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_opp_update_watch ON opportunities(update_watch) WHERE update_watch;

-- ── 4. Start-nudge watermark ────────────────────────────────────────────────────
-- Bound the pre-purchase "start a proposal on this hot OPP" nudge per mirror card:
-- idempotent (a card is nudged at most max_nudges_per_gate times) with a last-sent
-- stamp for cadence spacing. tenant_opportunity_cards is FORCE-RLS; the sweep writes
-- these under the tenant context (RANK-9). DEFAULT 0/NULL → no card is considered
-- already-nudged, and nothing fires until the sweep is wired + the tenant toggle is on.
ALTER TABLE tenant_opportunity_cards ADD COLUMN IF NOT EXISTS start_nudges_sent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tenant_opportunity_cards ADD COLUMN IF NOT EXISTS start_nudged_at   TIMESTAMPTZ;
