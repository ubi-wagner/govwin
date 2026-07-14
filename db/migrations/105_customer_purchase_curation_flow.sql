-- 105_customer_purchase_curation_flow.sql
--
-- Founding-cohort self-serve purchase → "waiting for RFP-expert curation" (72h SLA)
-- → admin release loop. Three additions, all idempotent:
--   (a) proposal_portals: a pre-launch `curation_pending` state + a 72h SLA timer
--       (paid_at / curation_due_at) so the customer sees "Waiting for RFP Expert
--       Curation" with a countdown, and admins get a curation queue.
--   (b) promo_codes: a server-validated comp/discount-code system. Seeded with the
--       founding-cohort test code `rfppipelinetest` (kind=comp → 100% off, bypasses
--       Stripe and marks the purchase paid). Extensible to real percent/amount codes.
--   (c) purchases.promo_code: provenance for a comp/discount purchase (metadata JSONB
--       already exists from mig 035; this column makes joins/reporting trivial).

-- ── (a) Portal: awaiting-curation state + 72h SLA timer ────────────────────────
ALTER TABLE proposal_portals DROP CONSTRAINT IF EXISTS proposal_portals_status_check;
ALTER TABLE proposal_portals ADD CONSTRAINT proposal_portals_status_check
  CHECK (status IN (
    'guardrails_pending','curation_pending','launched','executing','closeout','archived','abandoned'
  ));
ALTER TABLE proposal_portals ADD COLUMN IF NOT EXISTS paid_at        TIMESTAMPTZ;
ALTER TABLE proposal_portals ADD COLUMN IF NOT EXISTS curation_due_at TIMESTAMPTZ;

-- ── (b) Promo / comp codes ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS promo_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,                       -- exact stored form; lookups are case-insensitive
  kind        TEXT NOT NULL DEFAULT 'comp'
                CHECK (kind IN ('comp','percent','amount')),
  value       INTEGER NOT NULL DEFAULT 0,                 -- percent (0-100) or amount_cents; ignored when kind='comp'
  active      BOOLEAN NOT NULL DEFAULT true,
  max_uses    INTEGER,                                    -- NULL = unlimited
  used_count  INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- case-insensitive uniqueness + fast lookup by lower(code)
CREATE UNIQUE INDEX IF NOT EXISTS idx_promo_codes_lower ON promo_codes (lower(code));

-- Seed the founding-cohort test comp code (idempotent).
INSERT INTO promo_codes (code, kind, value, active, note)
VALUES ('rfppipelinetest', 'comp', 0, true,
        'Founding-cohort test comp code — simulates a paid Stripe checkout (100% off)')
ON CONFLICT (code) DO NOTHING;

-- ── (c) Purchase provenance for comp/discount buys ─────────────────────────────
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS promo_code TEXT;
