-- =============================================================================
-- Migration 007 — Event Bus + Drive Architecture + Product Tiers
--
-- Two parallel event buses:
--   opportunity_events — append-only log of ALL opp changes (SAM.gov, grants.gov, etc.)
--   customer_events    — append-only log of ALL tenant activity
--
-- Both drive worker automation via NOTIFY channels.
-- Workers are namespaced (finder.*, reminder.*, binder.*, grinder.*) and
-- consumed by step-function/job-manager infrastructure.
--
-- Drive schema expanded to support:
--   /RFPPIPELINE/Opportunities/YYYY-WNN/  (global, weekly-partitioned)
--   /RFPPIPELINE/Customers/{Tenant}/      (tier-aware folder tree)
-- =============================================================================

BEGIN;

-- =============================================================================
-- OPPORTUNITY EVENTS — Append-only event log
-- Replaces the simple amendments table as the canonical change record.
-- Every field change, new document, status transition, amendment gets a row.
-- Workers consume events, mark them processed. Nothing is overwritten.
-- =============================================================================

CREATE TABLE opportunity_events (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    opportunity_id    UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
    event_type        TEXT NOT NULL,
    -- Event types by namespace:
    --   ingest.new              — first time we see this opp
    --   ingest.updated          — content_hash changed (SAM.gov amendment)
    --   ingest.closed           — close_date passed or status → closed
    --   ingest.cancelled        — source marked cancelled
    --   ingest.document_added   — new attachment discovered
    --   ingest.field_changed    — specific field updated (close_date, set_aside, etc.)
    --   scoring.scored          — tenant scoring completed for this opp
    --   scoring.rescored        — re-scored after amendment
    --   drive.archived          — uploaded to Drive weekly folder
    --   drive.extracted         — text extraction completed
    --   drive.analyzed          — analysis summary generated

    source            TEXT NOT NULL,          -- 'sam_gov', 'grants_gov', 'sbir', etc.
    field_changed     TEXT,                   -- which field (close_date, description, etc.)
    old_value         TEXT,
    new_value         TEXT,
    snapshot_hash     TEXT,                   -- content_hash at time of event
    metadata          JSONB DEFAULT '{}',     -- flexible: document URLs, score details, etc.

    -- Worker consumption tracking
    processed         BOOLEAN DEFAULT FALSE,
    processed_by      TEXT,                   -- worker namespace: 'reminder.deadline_check'
    processed_at      TIMESTAMPTZ,

    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_opp_events_opp        ON opportunity_events(opportunity_id, created_at DESC);
CREATE INDEX idx_opp_events_type       ON opportunity_events(event_type, created_at DESC);
CREATE INDEX idx_opp_events_unprocessed ON opportunity_events(processed, event_type)
    WHERE processed = FALSE;
CREATE INDEX idx_opp_events_source     ON opportunity_events(source, created_at DESC);

-- NOTIFY trigger: wake workers when new events arrive
CREATE OR REPLACE FUNCTION notify_opportunity_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('opportunity_events',
        json_build_object(
            'event_id',       NEW.id,
            'opportunity_id', NEW.opportunity_id,
            'event_type',     NEW.event_type,
            'source',         NEW.source
        )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_opportunity_event
    AFTER INSERT ON opportunity_events
    FOR EACH ROW EXECUTE FUNCTION notify_opportunity_event();


-- =============================================================================
-- CUSTOMER EVENTS — Append-only tenant activity log
-- Parallel to opportunity_events but scoped to tenant actions.
-- Drives automation: AI review notifications, status change workflows,
-- tier upgrade triggers, usage tracking, and audit trail.
-- =============================================================================

CREATE TABLE customer_events (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id           TEXT REFERENCES users(id),           -- NULL for system-generated events
    event_type        TEXT NOT NULL,
    -- Event types by namespace:
    --   finder.opp_presented     — opp surfaced to this tenant
    --   finder.opp_attached      — tenant chose to track/pursue this opp
    --   finder.opp_dismissed     — tenant passed on this opp
    --   finder.summary_generated — AI summary created for this tenant+opp
    --   finder.summary_reviewed  — tenant viewed the AI summary
    --   finder.cap_reached       — hit active opp limit
    --
    --   reminder.nudge_sent      — deadline nudge email sent
    --   reminder.amendment_alert — amendment notification sent
    --   reminder.digest_sent     — weekly digest email sent
    --   reminder.deadline_acknowledged — tenant acknowledged a nudge
    --
    --   binder.project_created   — active project folder created
    --   binder.upload_added      — tenant uploaded a document
    --   binder.pwin_updated      — PWin assessment changed
    --   binder.stage_advanced    — proposal stage moved forward
    --
    --   grinder.draft_generated  — AI proposal section generated
    --   grinder.draft_reviewed   — tenant reviewed AI draft
    --   grinder.draft_approved   — tenant approved AI draft section
    --
    --   account.tier_upgraded    — product tier changed
    --   account.tier_downgraded  — product tier changed
    --   account.cap_increased    — max_active_opps increased (upsell)
    --   account.user_added       — new user created for tenant
    --   account.profile_updated  — tenant profile (NAICS, keywords) changed
    --   account.drive_provisioned — Drive folder tree created

    opportunity_id    UUID REFERENCES opportunities(id),   -- NULL for account-level events
    entity_type       TEXT,                                 -- 'opportunity', 'document', 'project', 'user'
    entity_id         TEXT,                                 -- ID of the related entity
    description       TEXT,                                 -- human-readable summary
    metadata          JSONB DEFAULT '{}',                   -- flexible payload

    -- Worker consumption tracking
    processed         BOOLEAN DEFAULT FALSE,
    processed_by      TEXT,                                 -- worker namespace
    processed_at      TIMESTAMPTZ,

    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cust_events_tenant      ON customer_events(tenant_id, created_at DESC);
CREATE INDEX idx_cust_events_type        ON customer_events(event_type, created_at DESC);
CREATE INDEX idx_cust_events_unprocessed ON customer_events(processed, event_type)
    WHERE processed = FALSE;
CREATE INDEX idx_cust_events_opp         ON customer_events(opportunity_id)
    WHERE opportunity_id IS NOT NULL;
CREATE INDEX idx_cust_events_user        ON customer_events(user_id)
    WHERE user_id IS NOT NULL;

-- NOTIFY trigger: wake workers when new customer events arrive
CREATE OR REPLACE FUNCTION notify_customer_event()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('customer_events',
        json_build_object(
            'event_id',    NEW.id,
            'tenant_id',   NEW.tenant_id,
            'event_type',  NEW.event_type,
            'opp_id',      NEW.opportunity_id
        )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_notify_customer_event
    AFTER INSERT ON customer_events
    FOR EACH ROW EXECUTE FUNCTION notify_customer_event();


-- =============================================================================
-- DRIVE SCHEMA EXPANSION — Artifact tracking + global structure
-- =============================================================================

-- Link drive_files to opportunities and classify by artifact type/tier
ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS opportunity_id UUID REFERENCES opportunities(id);
ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS artifact_type TEXT;
    -- Artifact types:
    --   Global (in /Opportunities/):
    --     'weekly_folder', 'opp_folder', 'opp_attachment', 'opp_extract',
    --     'opp_analysis', 'weekly_digest', 'master_index'
    --   Tenant Finder:
    --     'pipeline_snapshot', 'curated_summary', 'saved_shortcut'
    --   Tenant Reminder:
    --     'deadline_tracker', 'amendment_log'
    --   Tenant Binder:
    --     'project_folder', 'requirements_matrix', 'compliance_checklist',
    --     'pwin_assessment', 'tenant_upload'
    --   Tenant Grinder:
    --     'proposal_draft', 'proposal_section', 'compliance_matrix',
    --     'executive_summary'
    --   System:
    --     'template'

ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS artifact_scope TEXT;
    -- 'global'  — in /RFPPIPELINE/Opportunities/
    -- 'tenant'  — in /RFPPIPELINE/Customers/{name}/
    -- 'system'  — in /RFPPIPELINE/System/

ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS product_tier TEXT;
    -- 'finder', 'reminder', 'binder', 'grinder'
    -- NULL for global/system scope

ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ;
ALTER TABLE drive_files ADD COLUMN IF NOT EXISTS week_label TEXT;
    -- ISO week: '2026-W12' — for weekly-partitioned opp folders

CREATE INDEX IF NOT EXISTS idx_drive_files_opp      ON drive_files(opportunity_id)
    WHERE opportunity_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_drive_files_artifact  ON drive_files(artifact_type);
CREATE INDEX IF NOT EXISTS idx_drive_files_scope     ON drive_files(artifact_scope, product_tier);
CREATE INDEX IF NOT EXISTS idx_drive_files_week      ON drive_files(week_label)
    WHERE week_label IS NOT NULL;


-- =============================================================================
-- DOCUMENTS TABLE — Link to Drive
-- =============================================================================

ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_gid TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS drive_folder_gid TEXT;

CREATE INDEX IF NOT EXISTS idx_docs_drive ON documents(drive_gid)
    WHERE drive_gid IS NOT NULL;


-- =============================================================================
-- TENANT PRODUCT TIER + DRIVE FOLDER REFERENCES
-- =============================================================================

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS product_tier TEXT DEFAULT 'finder';
    -- 'finder' | 'reminder' | 'binder' | 'grinder'

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS max_active_opps INTEGER DEFAULT 10;
    -- Base = 10. Upsell: +10 per $99 increment.

-- Tier-specific Drive folder GIDs (set during provisioning)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_finder_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_reminders_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_binder_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_grinder_folder_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS drive_uploads_folder_id TEXT;


-- =============================================================================
-- SYSTEM CONFIG — Global Drive folder references
-- =============================================================================

INSERT INTO system_config (key, value, description) VALUES
    ('drive.root_folder_id',          'null', 'GID of /RFPPIPELINE/ root folder'),
    ('drive.opportunities_folder_id', 'null', 'GID of /RFPPIPELINE/Opportunities/'),
    ('drive.customers_folder_id',     'null', 'GID of /RFPPIPELINE/Customers/'),
    ('drive.templates_folder_id',     'null', 'GID of /RFPPIPELINE/System/templates/'),
    ('drive.current_week_folder_id',  'null', 'GID of current week folder'),
    ('drive.current_week_label',      'null', 'Current ISO week label (e.g. 2026-W12)')
ON CONFLICT (key) DO NOTHING;

-- Product tier pricing config
INSERT INTO system_config (key, value, description) VALUES
    ('tiers.finder.base_opps',     '10',   'Max active opps at Finder base tier'),
    ('tiers.finder.upsell_opps',   '10',   'Additional opps per upsell increment'),
    ('tiers.finder.upsell_price',  '99',   'Price per upsell increment (USD)')
ON CONFLICT (key) DO NOTHING;


-- =============================================================================
-- PIPELINE SCHEDULES — Add event-driven worker schedules
-- =============================================================================

INSERT INTO pipeline_schedules (source, display_name, run_type, cron_expression, priority) VALUES
    ('drive_sync',        'Drive Sync (Post-Ingest)',   'sync',   '0 6 30 * *',  6),
    ('reminder_nudges',   'Reminder Deadline Nudges',   'notify', '0 8 * * *',   4),
    ('reminder_amendments','Reminder Amendment Alerts', 'notify', '0 */2 * * *', 5),
    ('tenant_snapshots',  'Tenant Snapshot Refresh',    'sync',   '0 7 * * *',   6)
ON CONFLICT (source) DO NOTHING;


-- =============================================================================
-- HELPER: Get current ISO week label
-- =============================================================================

CREATE OR REPLACE FUNCTION get_iso_week_label(ts TIMESTAMPTZ DEFAULT NOW())
RETURNS TEXT AS $$
BEGIN
    RETURN TO_CHAR(ts, 'IYYY') || '-W' || LPAD(TO_CHAR(ts, 'IW'), 2, '0');
END;
$$ LANGUAGE plpgsql IMMUTABLE;


-- =============================================================================
-- HELPER: Check active opp cap for a tenant
-- Returns: can_attach (boolean), active_count, max_allowed
-- =============================================================================

CREATE OR REPLACE FUNCTION check_opp_cap(p_tenant_id UUID)
RETURNS TABLE(can_attach BOOLEAN, active_count BIGINT, max_allowed INTEGER) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*) < t.max_active_opps,
        COUNT(*),
        t.max_active_opps
    FROM tenants t
    LEFT JOIN tenant_opportunities to2
        ON to2.tenant_id = t.id
        AND to2.pursuit_status IN ('pursuing', 'monitoring')
    WHERE t.id = p_tenant_id
    GROUP BY t.max_active_opps;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- HELPER: Batch mark events as processed
-- Used by workers after successfully handling a batch of events
-- =============================================================================

CREATE OR REPLACE FUNCTION mark_events_processed(
    p_table TEXT,           -- 'opportunity_events' or 'customer_events'
    p_event_ids UUID[],
    p_worker TEXT            -- namespace: 'reminder.deadline_check'
)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    IF p_table = 'opportunity_events' THEN
        UPDATE opportunity_events
        SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSIF p_table = 'customer_events' THEN
        UPDATE customer_events
        SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
        WHERE id = ANY(p_event_ids) AND processed = FALSE;
    ELSE
        RAISE EXCEPTION 'Invalid event table: %', p_table;
    END IF;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- HELPER: Dequeue unprocessed events for a specific worker namespace
-- Atomic: claims events for this worker, returns them for processing
-- =============================================================================

CREATE OR REPLACE FUNCTION dequeue_opportunity_events(
    p_event_types TEXT[],    -- e.g. ARRAY['ingest.updated', 'ingest.field_changed']
    p_worker TEXT,           -- namespace: 'reminder.amendment_alert'
    p_limit INTEGER DEFAULT 100
)
RETURNS SETOF opportunity_events AS $$
BEGIN
    RETURN QUERY
    UPDATE opportunity_events
    SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
    WHERE id IN (
        SELECT id FROM opportunity_events
        WHERE processed = FALSE
          AND event_type = ANY(p_event_types)
        ORDER BY created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION dequeue_customer_events(
    p_event_types TEXT[],
    p_worker TEXT,
    p_limit INTEGER DEFAULT 100
)
RETURNS SETOF customer_events AS $$
BEGIN
    RETURN QUERY
    UPDATE customer_events
    SET processed = TRUE, processed_by = p_worker, processed_at = NOW()
    WHERE id IN (
        SELECT id FROM customer_events
        WHERE processed = FALSE
          AND event_type = ANY(p_event_types)
        ORDER BY created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;


-- =============================================================================
-- VIEW: Tenant active opportunity summary (for cap enforcement + dashboard)
-- =============================================================================

CREATE OR REPLACE VIEW tenant_active_opps AS
SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    t.product_tier,
    t.max_active_opps,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status = 'pursuing')   AS pursuing_count,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status = 'monitoring') AS monitoring_count,
    COUNT(to2.id) FILTER (WHERE to2.pursuit_status IN ('pursuing', 'monitoring')) AS active_count,
    t.max_active_opps - COUNT(to2.id)
        FILTER (WHERE to2.pursuit_status IN ('pursuing', 'monitoring')) AS slots_remaining
FROM tenants t
LEFT JOIN tenant_opportunities to2 ON to2.tenant_id = t.id
WHERE t.status = 'active'
GROUP BY t.id, t.name, t.product_tier, t.max_active_opps;


COMMIT;
