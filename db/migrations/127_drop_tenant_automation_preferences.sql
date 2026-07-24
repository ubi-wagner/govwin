-- Migration 127: retire tenant_automation_preferences (HOLD — do not run yet)
--
-- ⚠️  GATE: do NOT apply this migration until the 6-checkbox tenant UI
--     (automation-preferences-card.tsx) has been replaced with a per-trigger
--     editor that reads/writes tenant_automation_policies directly.
--
-- Retire conditions (ALL must be true before running):
--   1. The tenant automation UI reads from tenant_automation_policies, not this table.
--   2. The PATCH /api/portal/[tenantSlug]/automation-preferences route has been
--      repointed to write only to tenant_automation_policies (dual-write removed).
--   3. The CMS event_listener.py legacy fallback block (step 2 in
--      _automation_pref_allows) has been removed.
--   4. No live code references tenant_automation_preferences — verify with:
--      grep -rn "tenant_automation_preferences" frontend/ services/ pipeline/ \
--        --include="*.ts" --include="*.tsx" --include="*.py" | grep -v "migration"
--
-- The migration is committed now (2026-07-24) to lock in the exit path.
-- It is idempotent (IF EXISTS) and will no-op if the table was already dropped.
--
-- Pre-flight: abort if tenant_automation_policies is missing framework rows,
-- which would indicate migration 126 hasn't been applied or the backfill failed.

DO $$
BEGIN
  -- Safety check: tenant_automation_policies must exist with its seed rows.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name   = 'tenant_automation_policies'
  ) THEN
    RAISE EXCEPTION
      'Migration 127 aborted: tenant_automation_policies does not exist. Apply migration 126 first.';
  END IF;

  IF (SELECT count(*) FROM tenant_automation_policies WHERE tenant_id IS NULL) < 9 THEN
    RAISE EXCEPTION
      'Migration 127 aborted: tenant_automation_policies has fewer than 9 framework rows. Re-run migration 126 seed INSERTs.';
  END IF;
END $$;

-- The table being retired. All data has been backfilled to tenant_automation_policies
-- by migration 126; the dual-write period ensured every subsequent write landed in both.
DROP TABLE IF EXISTS tenant_automation_preferences;
