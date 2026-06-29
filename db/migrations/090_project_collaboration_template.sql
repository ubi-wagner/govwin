-- Migration 090: pre-seed the ProjectCollaboration template catalog row (R3.1).
--
-- ProjectCollaboration is the generic, overlay-parameterized project/opportunity
-- HITL reaction (pipeline/src/workflows/project_collaboration.py). The pipeline
-- boot-sync (sync_template_catalog) upserts this row from the live registry, but
-- the frontend launcher (lib/process/launch-template.ts) reads process_templates
-- for the trigger_key BEFORE a launch — so a fresh deploy where the frontend
-- launches before the pipeline has booted/synced would 404. Pre-seeding the row
-- makes the template launchable immediately. ON CONFLICT DO NOTHING so the
-- boot-sync (which refreshes description/trigger_key but never the admin-owned
-- active/memo fields) and any re-run are no-ops.
--
-- trigger_key = "namespace:type:phase" — phase MUST be 'single' for the overlay
-- launcher (a paired start/end template is reactive-only, not launchable).

INSERT INTO process_templates (workflow_name, description, trigger_key, source, active)
VALUES (
    'ProjectCollaboration',
    'Generic project/opportunity HITL reaction: park one payload-parameterized human gate (tasks row + nudges), resume on completion, then notify.',
    'proposal:project.collaboration_requested:single',
    'pipeline',
    TRUE
)
ON CONFLICT (workflow_name) DO NOTHING;
