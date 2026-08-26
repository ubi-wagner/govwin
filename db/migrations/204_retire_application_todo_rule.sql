-- =============================================================================
-- Migration 204: retire the mig-040 'Auto-todo on application' automation rule
-- Depends on: 203
--
-- Bug log B51, half (a). One application raised TWO ToDos:
--
--   creator                                  task_type            entity link
--   ---------------------------------------  -------------------  -----------
--   app/api/applications/route.ts createTask  application_triage   yes
--   automation_rules 'Auto-todo on ...'       (untyped)            no
--
-- The route's own ToDo is strictly better: it is typed for the domain
-- (`application_triage`, so the catalog in lib/tasks/workflows.ts knows how to
-- route and complete it), it carries `entity_type='application'` +
-- `entity_id=<the application>` (so the accept/reject decision can find and
-- close it — half (b) of B51), and it names the applicant in its title.
--
-- The rule's ToDo has none of that. It fires off the same
-- `capture:application.submitted` event, so the two are exact duplicates of one
-- question, and the unlinked one is the copy nothing can ever close: it has no
-- entity to match on, which is why the queue only ever grew.
--
-- Deactivate rather than delete. `automation_rules` is a configuration surface an
-- rfp_admin can read, and a row switched off with a reason on it explains itself;
-- a deleted row just leaves the mig-040 seed looking unaccountably absent. The
-- CMS event listener skips inactive rules, so `is_active=false` is a full stop.
--
-- Scoped by NAME + TRIGGER so a differently-named future rule on the same event,
-- or a re-purposed row with this name on another event, is left alone. Idempotent.
-- =============================================================================

UPDATE automation_rules
SET is_active   = false,
    description = 'RETIRED (mig 204, bug log B51): duplicated the typed, entity-linked '
                  || 'application_triage ToDo raised by app/api/applications/route.ts. This '
                  || 'copy carried no entity_id, so no accept/reject decision could close it.',
    updated_at  = now()
WHERE name = 'Auto-todo on application'
  AND trigger_namespace = 'capture'
  AND trigger_type = 'application.submitted'
  AND is_active = true;

-- Close the ToDos it already left behind. These are the un-closeable copies: they
-- point at no entity, so the accept/reject fix (half (b)) can never reach them, and
-- with the rule off nothing will ever produce another. Matched on the rule's exact
-- title_template shape ('Review application from <company>'), NOT on task_type — the
-- route's own 'Review application: <company>' rows are the ones that must survive,
-- and they differ only in that separator.
UPDATE tasks
SET status       = 'cancelled',
    result       = COALESCE(result, '{}'::jsonb)
                   || jsonb_build_object('cancelledBy', 'migration_204',
                                         'reason', 'duplicate of application_triage (bug log B51)'),
    completed_at = now(),
    updated_at   = now()
WHERE status IN ('open', 'in_progress')
  AND entity_id IS NULL
  AND title LIKE 'Review application from %';
