-- 154_fix_process_instances_dedup_index.sql
-- Recreate the process_instances dedup arbiter index that mig 043 defines but that is
-- MISSING in any database which applied 043 before its
-- `CREATE UNIQUE INDEX ... idx_process_instances_dedup` line existed. The migrate runner
-- tracks applied migrations by FILENAME, so an edited 043 never re-runs — such databases
-- (observed: production) are left without the index permanently.
--
-- Symptom (production, PG16): every event-triggered workflow launch throws
--   "there is no unique or exclusion constraint matching the ON CONFLICT specification"
-- from WorkflowManager's
--   INSERT INTO process_instances ... ON CONFLICT (workflow_name, trigger_event_id)
--   WHERE trigger_event_id IS NOT NULL DO NOTHING            (pipeline/src/workflows/manager.py)
-- The planner needs the matching PARTIAL UNIQUE index to plan the ON CONFLICT, so the
-- error is raised at PLAN time and NO row is inserted — the workflow simply never
-- launches (silently, apart from this log line). The retry/recovery INSERT uses a NULL
-- trigger_event_id and never touches this index, so it is unaffected.
--
-- Because the failing INSERT inserts nothing, no duplicate (workflow_name,
-- trigger_event_id) rows can have accumulated from this bug, so the UNIQUE build below
-- is safe. If it were ever to fail on a pre-existing duplicate that would be a loud,
-- correct signal (we do NOT silently delete workflow instances / their cascaded
-- transitions + tasks).
--
-- A NEW filename is what makes this run everywhere, including databases where 043 is
-- already recorded as applied. DROP IF EXISTS first because `CREATE UNIQUE INDEX
-- IF NOT EXISTS` keys on the index NAME only: a wrongly-defined same-named index
-- (non-unique, or a different predicate/column set) would be silently kept and leave
-- ON CONFLICT broken. Re-applying this file is idempotent (drop-then-create).

DROP INDEX IF EXISTS idx_process_instances_dedup;

CREATE UNIQUE INDEX idx_process_instances_dedup
    ON process_instances (workflow_name, trigger_event_id)
    WHERE trigger_event_id IS NOT NULL;
