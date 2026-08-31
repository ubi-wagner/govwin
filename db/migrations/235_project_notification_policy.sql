-- 235_project_notification_policy.sql
--
-- Bringing Projects into the automation-policy layer, instead of beside it.
--
-- ── WHAT WAS HARD-CODED ──────────────────────────────────────────────────────────────────────
-- `lib/projects/todos.ts` carried `const NUDGE_DAYS = [7, 2, 0]` and the Python nudge sweep read
-- only the PLATFORM framework. So a customer could tune every reminder the proposal side sends and
-- none of the ones their project sends — which is the shape of a capability built alongside the
-- policy model rather than into it.
--
-- ── THE THREE LEVELS ALREADY EXIST; THIS ADDS THE THIRD FOR PROJECTS ─────────────────────────
--
--   platform    `automation_framework` (mig 126) — the operator's floor and caps
--   tenant      `tenant_automation_policies` (mig 127) — the customer's default, per trigger
--   per-entity  the build side puts this in the portal's own `guardrail_config`; the project side
--               gets `projects.notification_policy`, for the same reason and in the same shape
--
-- A jsonb column rather than a table: it holds at most a handful of keys per project, it is read
-- with the project row that is already being read, and a table would need its own RLS, its own
-- policy set and its own cascade for something that has exactly one parent. The tenant workflow
-- setup rides `guardrail_config` for precisely this reason.
--
-- ── AND THE SCOPE VOCABULARY WIDENS ──────────────────────────────────────────────────────────
-- `tenant_automation_policies.scope` was CHECKed to ('discovery','build'). A project trigger is
-- neither: discovery is before a customer buys, build is before they submit, and a project is after
-- they have won. Filing it under 'build' would make "notify me when a milestone slips" appear in
-- the proposal editor's list, which is where a vocabulary starts lying.
--
-- No explicit BEGIN/COMMIT: `migrate.mjs` runs each file in its own transaction.

-- ── 1 · THE SCOPE ────────────────────────────────────────────────────────────────────────────

ALTER TABLE tenant_automation_policies
  DROP CONSTRAINT IF EXISTS tenant_automation_policies_scope_check;

ALTER TABLE tenant_automation_policies
  ADD CONSTRAINT tenant_automation_policies_scope_check
  CHECK (scope IN ('discovery', 'build', 'project'));

COMMENT ON COLUMN tenant_automation_policies.scope IS
  'discovery (before they buy) · build (before they submit) · project (after they have won). '
  'Three phases of one customer''s life, and a trigger belongs to exactly one of them.';

-- ── 2 · THE PER-PROJECT OVERRIDE ─────────────────────────────────────────────────────────────

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS notification_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.notification_policy IS
  'The THIRD level of the automation-policy model, for this project only — the same role the '
  'portal''s guardrail_config plays on the build side. Keys are trigger names; each may carry '
  '{enabled, nudgeDays, channel}. EMPTY means "inherit", which is the correct default: a project '
  'nobody has configured must behave exactly as the tenant policy says, not as a copy of it taken '
  'at creation that then silently stops tracking.';

-- Deliberately NO index and NO CHECK on the jsonb shape. The resolver validates on read and
-- ignores anything it does not recognise, because a stored key it cannot parse must degrade to
-- "inherit" rather than raise on a page load — the same rule `coerceJsonb` applies everywhere else.
