-- 123_portal_guardrail_managers_delegated.sql
--
-- Managers on a proposal portal are a DELEGATED, PER-PORTAL role now: an admin can assign
-- as many as they want on a given portal — a teammate or one of our experts (e.g. the
-- Econ-dev expert). Lift the manager cap on the default guardrail template (and raise the
-- collaborator cap to match, since managers are collaborators with role='manager').
-- Phases and nudges stay bounded per the product spec: 3 phases max, 3 nudges max
-- (the 3rd nudge is the final notice that also pings the portal's managers).
--
-- Idempotent: re-running just re-asserts the values on the single global default row.

UPDATE guardrail_templates
SET config = jsonb_set(
      jsonb_set(config, '{limits,maxManagers}', '25'::jsonb, true),
      '{limits,maxCollaborators}', '25'::jsonb, true)
WHERE tenant_id IS NULL AND is_default = true;
