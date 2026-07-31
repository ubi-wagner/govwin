-- 130_curation_sla_todo.sql
--
-- Put a hard SLA on the "Purchase needs curation" admin ToDo.
--
-- A comp-code purchase fans capture:purchase.completed → the 'Purchase needs curation'
-- automation rule (mig 106) → an admin broadcast ToDo (assignee_role='rfp_admin'). Until
-- now that ToDo had no deadline and no escalation, so the 72h curation SLA lived only in
-- proposal_portals.curation_due_at — invisible on the admin ToDo itself.
--
-- Add two keys the automation engine now understands (lib/automation/triggers.ts
-- executeTodoAction):
--   due_hours: 72   → the ToDo gets due_at = now()+72h (the curation SLA countdown)
--   nudge_days:[2,1]→ nudge_schedule, days-BEFORE-due: the pipeline nudge sweep
--                     (_sweep_task_nudges) fires system:task.nudge + an admin EMAIL
--                     (to_role→ADMIN_NOTIFICATION_EMAIL) at 2d-before (~24h elapsed) and
--                     1d-before (~48h elapsed) if the portal is still un-released.
--
-- Merge (||) so the existing subject/template/include_payload keys are preserved.
-- Idempotent: re-running only re-sets the same two keys. No-op if the rule is absent.

UPDATE automation_rules
SET action_config = action_config || '{"due_hours": 72, "nudge_days": [2, 1]}'::jsonb
WHERE name = 'Purchase needs curation';
