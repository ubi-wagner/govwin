-- 135_starter_offer_unique.sql
--
-- Backstop the one-time starter-set onboarding OFFER against a check-then-insert race
-- (two concurrent provisions of the same tenant both seeing zero open offers): at most
-- one OPEN 'starter_set_offer' ToDo per tenant. offerStarterSet is best-effort (the
-- caller swallows a throw), so a losing concurrent insert fails harmlessly instead of
-- creating a duplicate dismissible note.

CREATE UNIQUE INDEX IF NOT EXISTS uq_starter_offer_open
  ON tasks (tenant_id)
  WHERE task_type = 'starter_set_offer' AND status IN ('open', 'in_progress');
