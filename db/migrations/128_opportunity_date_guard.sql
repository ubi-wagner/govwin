-- Migration 128: OPP open/close date guard (docs/AUTOMATION_POLICY_DESIGN.md decision ⑤).
--
-- An OPP card must never exist without an open AND close date. If the org hasn't
-- published them, the RFP admin enters ESTIMATED dates (dates_estimated=true),
-- upgraded to OFFICIAL on publish. This GUARANTEES the resolver's relative-timing
-- anchor (close_date) is always present — the null-anchor degrade path is deleted.
--
-- `open_date` + `close_date` already exist (open_date from mig 100, close_date from
-- baseline). This migration adds only the estimated/official flag; the enforcement —
-- refuse a push/activation whose activated opportunities lack open+close — rides in
-- the RFP-admin push tool (`lib/tools/solicitation-push.ts`). Existing rows keep the
-- default `false`; the guard is enforced forward at the push boundary, not retroactively.

ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS dates_estimated  BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN opportunities.dates_estimated IS
    'TRUE when open_date/close_date are RFP-admin ESTIMATES (org has not published); upgraded to official on publish. Guard: mig 128 / AUTOMATION_POLICY_DESIGN ⑤.';
