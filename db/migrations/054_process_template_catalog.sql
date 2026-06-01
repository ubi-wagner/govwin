-- Migration 054: Process Template Catalog (activation + audit layer)
--
-- WHAT: A thin catalog row per workflow TEMPLATE. The template DEFINITION stays
--       in code — a Workflow subclass in pipeline/src/workflows/*.py, discovered
--       and registered at boot by discover_workflows(). This table does NOT store
--       the definition body; it stores the OPERATIONAL state of each template:
--       whether it is active, when it was (de)activated, who deactivated it, and a
--       memo. Revision control lives in the FILENAMES (e.g. cms_content_v1.py ->
--       cms_content_v2.py): a new version is a new file, superseding the old.
--
-- WHY:  The launcher must be able to refuse to launch a retired template without a
--       code deploy, and admins need an auditable record (who/when/why) of every
--       activation change. The same row is what a future authoring/overlay GUI
--       reads to list templates and toggle them.
--
-- HOW:  The pipeline worker SYNCS this table from the live registry at boot, right
--       after discover_workflows() (see pipeline/src/workflows/processor.py): it
--       UPSERTs one row per discovered template — inserting new ones as active and
--       refreshing description/trigger_key/last_seen_at for known ones, but NEVER
--       overwriting the admin-controlled active/inactive/memo fields. The launch
--       path then checks `active` before creating a process_instance; a missing row
--       fails OPEN (treated as active) so a sync gap never blocks live launches.
--
--       workflow_name == the Workflow subclass name (cls.__name__), which is also
--       process_instances.workflow_name — so this table joins 1:1 to instances.

CREATE TABLE IF NOT EXISTS process_templates (
    -- The Workflow subclass name; the registry key and process_instances join key.
    workflow_name        TEXT PRIMARY KEY,

    -- Human-readable description (synced from cls.description) and the registry
    -- trigger key "namespace:type:phase" (synced from the live trigger).
    description          TEXT,
    trigger_key          TEXT,

    -- Which engine owns it: the pipeline processor or the CMS event listener.
    source               TEXT NOT NULL DEFAULT 'pipeline'
        CHECK (source IN ('pipeline', 'cms')),

    -- Activation state. active=false makes the launcher refuse new launches of
    -- this template (existing in-flight instances are unaffected).
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    active_date          TIMESTAMPTZ DEFAULT now(),   -- when (re)activated
    inactive_date        TIMESTAMPTZ,                 -- when deactivated (NULL while active)
    inactivated_by       TEXT,                        -- actor email/label who deactivated
    memo                 TEXT,                        -- admin note: why (in)activated

    -- Drift bookkeeping: first_registered_at is set once; last_seen_at is touched
    -- on every boot-sync, so a template that disappears from code (last_seen_at
    -- goes stale) is detectable without deleting its audit history.
    first_registered_at  TIMESTAMPTZ DEFAULT now(),
    last_seen_at         TIMESTAMPTZ DEFAULT now(),

    created_at           TIMESTAMPTZ DEFAULT now(),
    updated_at           TIMESTAMPTZ DEFAULT now()
);

-- Admin list views: "all inactive templates", "all pipeline templates", etc.
CREATE INDEX IF NOT EXISTS idx_process_templates_active
    ON process_templates (source, active);

-- Keep updated_at honest on any UPDATE (boot-sync touch or admin toggle).
CREATE OR REPLACE FUNCTION update_process_template_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_template_updated ON process_templates;
CREATE TRIGGER trg_process_template_updated
    BEFORE UPDATE ON process_templates
    FOR EACH ROW EXECUTE FUNCTION update_process_template_timestamp();
