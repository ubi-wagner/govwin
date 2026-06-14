-- Migration 065: Seed the OnOpportunitiesDetected process-template catalog row
-- (Scouting Spine M2 / T2.2 — detection -> notify + triage ToDo)
--
-- WHAT: Pre-seed one process_templates row for the OnOpportunitiesDetected
--       workflow so the detection->alert template is ACTIVE the moment its
--       migrations land — before the pipeline worker's boot-sync
--       (manager.sync_template_catalog) has had a chance to reflect it.
--
-- WHY:  The launch path (manager.create_instance) checks process_templates.active
--       before spawning an instance; a missing row "fails OPEN" (treated active),
--       but an EXPLICIT active row makes the alerting nerve auditable from the
--       first deploy and gives admins an immediate toggle. The template DEFINITION
--       still lives in code (pipeline/src/workflows/on_opportunities_detected.py,
--       discovered + registered at boot); this row is only the OPERATIONAL state
--       (active flag, trigger_key, source, audit memo) per migration 054.
--
-- HOW:  Mirror the exact column shape the boot-sync upserts
--       (workflow_name, description, trigger_key, source) plus the activation
--       fields, and use ON CONFLICT (workflow_name) DO UPDATE so this seed and a
--       later boot-sync coexist idempotently. We DO refresh description/
--       trigger_key/source/last_seen_at here, but we deliberately leave the
--       admin-owned active / inactive_date / inactivated_by columns alone on
--       conflict, matching sync_template_catalog's "never clobber admin state"
--       contract. workflow_name == the Workflow subclass name (cls.__name__),
--       which is also the process_instances join key.
--
--   trigger_key = "namespace:type:phase" for the workflow's EventTrigger
--                 (finder:opportunities.detected:single — contract C2.a).

INSERT INTO process_templates
    (workflow_name, description, trigger_key, source, active, active_date,
     memo, last_seen_at)
VALUES (
    'OnOpportunitiesDetected',
    'When a scouting/ingest run detects new opportunities, alert the rfp admin '
        || '(email) and park a triage ToDo on the tasks ledger.',
    'finder:opportunities.detected:single',
    'pipeline',
    TRUE,
    now(),
    'Seeded by migration 065 (Scouting Spine M2/T2.2): detection rollup -> '
        || 'NOTIFY new_opportunities_to_triage + TODO triage_new_opportunities.',
    now()
)
ON CONFLICT (workflow_name) DO UPDATE
    SET description  = EXCLUDED.description,
        trigger_key  = EXCLUDED.trigger_key,
        source       = EXCLUDED.source,
        memo         = COALESCE(process_templates.memo, EXCLUDED.memo),
        last_seen_at = now();
