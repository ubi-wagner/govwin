-- Migration 043: Process Instances for Workflow State Persistence
-- Enables crash recovery, audit trail, and admin workflow management
-- Used by both RFP Pipeline workflows and CMS automation workflows

CREATE TABLE IF NOT EXISTS process_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_name TEXT NOT NULL,
    trigger_event_id UUID REFERENCES system_events(id),
    correlation_id UUID DEFAULT gen_random_uuid(),

    -- State tracking
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed', 'cancelled', 'retrying')),
    current_step TEXT,
    current_step_index INTEGER DEFAULT 0,

    -- Step results (accumulated as workflow progresses)
    step_results JSONB DEFAULT '{}'::jsonb,
    step_status JSONB DEFAULT '{}'::jsonb,  -- {step_name: "completed"|"failed"|"skipped"|"running"|"pending"}

    -- Timing
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ DEFAULT now(),
    deadline TIMESTAMPTZ,

    -- Recovery
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    last_error TEXT,
    last_error_step TEXT,
    recovered_from UUID,  -- ID of the failed instance this was recovered from

    -- Context
    tenant_id UUID REFERENCES tenants(id),
    actor_id UUID,
    actor_email TEXT,
    payload JSONB DEFAULT '{}'::jsonb,  -- Original trigger event payload

    -- Source system
    source TEXT NOT NULL DEFAULT 'pipeline'
        CHECK (source IN ('pipeline', 'cms')),

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_process_instances_status ON process_instances(status) WHERE status IN ('pending', 'running', 'paused', 'retrying');
CREATE INDEX IF NOT EXISTS idx_process_instances_workflow ON process_instances(workflow_name, status);
CREATE INDEX IF NOT EXISTS idx_process_instances_tenant ON process_instances(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_process_instances_heartbeat ON process_instances(last_heartbeat_at) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_process_instances_created ON process_instances(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_process_instances_trigger ON process_instances(trigger_event_id);

-- Prevent duplicate workflow instances for the same trigger event
CREATE UNIQUE INDEX IF NOT EXISTS idx_process_instances_dedup
    ON process_instances(workflow_name, trigger_event_id) WHERE trigger_event_id IS NOT NULL;

-- Audit table for state transitions
CREATE TABLE IF NOT EXISTS process_instance_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES process_instances(id) ON DELETE CASCADE,
    from_status TEXT,
    to_status TEXT NOT NULL,
    step_name TEXT,
    actor TEXT,  -- 'system', 'admin:{email}', 'cron'
    reason TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pit_instance ON process_instance_transitions(instance_id, created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_process_instance_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_process_instance_updated ON process_instances;
CREATE TRIGGER trg_process_instance_updated
    BEFORE UPDATE ON process_instances
    FOR EACH ROW EXECUTE FUNCTION update_process_instance_timestamp();
