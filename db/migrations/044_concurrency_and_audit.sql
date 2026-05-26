-- Migration 044: Optimistic Concurrency Control + Collaborative Audit Trail
-- Supports concurrent editing, conflict detection, and complete audit trail
-- for the proposal workspace collaborative process.

-- 1. Add version column to proposals for stage-level OCC
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;

-- 2. Add last_modified_by to track who made each change
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS last_modified_by UUID REFERENCES users(id);

-- 3. Proposal activity log — the complete who-what-where-why audit trail
CREATE TABLE IF NOT EXISTS proposal_activity_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),

    -- WHO
    actor_id UUID REFERENCES users(id),
    actor_email TEXT,
    actor_role TEXT,  -- tenant_admin, tenant_user, partner_user, system

    -- WHAT
    activity_type TEXT NOT NULL CHECK (activity_type IN (
        'section_edited', 'section_saved', 'section_reverted',
        'section_assigned', 'section_unassigned',
        'stage_advanced', 'stage_reverted',
        'proposal_locked', 'proposal_unlocked',
        'collaborator_invited', 'collaborator_removed',
        'collaborator_access_changed',
        'comment_added', 'comment_resolved',
        'ai_draft_requested', 'ai_review_requested',
        'compliance_checked',
        'outcome_recorded',
        'document_uploaded', 'document_deleted',
        'proposal_created', 'proposal_exported'
    )),

    -- WHERE (what part of the proposal was affected)
    section_id UUID REFERENCES proposal_sections(id),
    section_title TEXT,

    -- WHY / DETAILS
    details JSONB DEFAULT '{}'::jsonb,
    -- For section_edited: { previous_version, new_version, edit_summary }
    -- For stage_advanced: { from_stage, to_stage, notes, gate_requirements_met }
    -- For collaborator_invited: { email, role, sections_assigned }
    -- For ai_draft_requested: { sections_queued }
    -- For outcome_recorded: { outcome, notes }

    -- VERSION at time of action (for conflict resolution)
    entity_version INT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pal_proposal ON proposal_activity_log(proposal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_tenant ON proposal_activity_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_actor ON proposal_activity_log(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_type ON proposal_activity_log(activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pal_section ON proposal_activity_log(section_id) WHERE section_id IS NOT NULL;

-- 4. Stage gate completion tracking
CREATE TABLE IF NOT EXISTS stage_gate_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
    stage TEXT NOT NULL,  -- which stage this requirement gates

    -- Requirement definition
    requirement_type TEXT NOT NULL CHECK (requirement_type IN (
        'all_sections_complete', 'compliance_check_passed',
        'min_sections_approved', 'admin_review_complete',
        'collaborator_signoff', 'custom'
    )),
    label TEXT NOT NULL,
    description TEXT,

    -- Completion tracking
    is_met BOOLEAN NOT NULL DEFAULT false,
    met_by UUID REFERENCES users(id),
    met_at TIMESTAMPTZ,
    evidence JSONB DEFAULT '{}'::jsonb,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sgr_proposal_stage ON stage_gate_requirements(proposal_id, stage);

-- 5. Add edit_session tracking for real-time collaboration awareness
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS editing_by UUID REFERENCES users(id);
ALTER TABLE proposal_sections ADD COLUMN IF NOT EXISTS editing_since TIMESTAMPTZ;
-- editing_by is set when a user opens a section for editing
-- cleared when they save, navigate away, or after 5 minutes of inactivity
-- used to warn other users "User X is currently editing this section"
