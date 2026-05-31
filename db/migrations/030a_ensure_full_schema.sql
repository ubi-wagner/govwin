-- ============================================================================
-- 030a_ensure_full_schema.sql — Schema Bridge Migration
--
-- PURPOSE: Ensure the ENTIRE schema is correct regardless of which prior
-- migrations actually applied their DDL. Migration 019 is recorded in
-- _migration_history but its table creations never landed. Rather than
-- chasing individual fixes, this single migration guarantees every table,
-- column, index, and constraint from migrations 002-035 exists.
--
-- SAFETY: 100% idempotent. Uses CREATE TABLE IF NOT EXISTS, ALTER TABLE
-- ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and DO $$ guards
-- for constraints. Safe to run on any DB state — fresh, partial, or full.
--
-- SCOPE: Only schema (DDL). No seed data (INSERTs).
-- Does NOT touch tables from 001_baseline.sql — those are guaranteed.
-- ============================================================================

-- ############################################################################
-- SECTION A: TABLES CREATED IN MIGRATIONS 007-030
-- ############################################################################

-- ── 007: system_events ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    namespace         TEXT NOT NULL,
    type              TEXT NOT NULL,
    phase             TEXT NOT NULL CHECK (phase IN ('start', 'end', 'single')),
    actor_type        TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'pipeline', 'agent')),
    actor_id          TEXT NOT NULL,
    actor_email       TEXT,
    tenant_id         UUID REFERENCES tenants(id),
    parent_event_id   UUID REFERENCES system_events(id),
    payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
    error             JSONB,
    duration_ms       INTEGER,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_events_namespace_type
    ON system_events (namespace, type);
CREATE INDEX IF NOT EXISTS idx_system_events_tenant_id
    ON system_events (tenant_id)
    WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_events_parent
    ON system_events (parent_event_id)
    WHERE parent_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_system_events_created_at
    ON system_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_errors
    ON system_events (created_at DESC)
    WHERE error IS NOT NULL;

-- NOTIFY hook
CREATE OR REPLACE FUNCTION notify_system_event() RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify(
        'events:' || NEW.namespace,
        json_build_object(
            'id',        NEW.id,
            'namespace', NEW.namespace,
            'type',      NEW.type,
            'phase',     NEW.phase,
            'tenant_id', NEW.tenant_id
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS system_events_notify ON system_events;
CREATE TRIGGER system_events_notify
    AFTER INSERT ON system_events
    FOR EACH ROW
    EXECUTE FUNCTION notify_system_event();

-- ── 008: tool_invocation_metrics ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tool_invocation_metrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tool_name       TEXT NOT NULL,
    tool_namespace  TEXT NOT NULL,
    actor_type      TEXT NOT NULL CHECK (actor_type IN ('user', 'system', 'pipeline', 'agent')),
    actor_id        TEXT NOT NULL,
    tenant_id       UUID REFERENCES tenants(id),
    success         BOOLEAN NOT NULL,
    error_code      TEXT,
    duration_ms     INTEGER NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tim_tool_created
    ON tool_invocation_metrics (tool_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tim_tenant_created
    ON tool_invocation_metrics (tenant_id, created_at DESC)
    WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tim_errors
    ON tool_invocation_metrics (created_at DESC)
    WHERE success = false;

-- ── 008: system_health_snapshots ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS system_health_snapshots (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    captured_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    queue_depth       INTEGER NOT NULL DEFAULT 0,
    events_last_hour  INTEGER NOT NULL DEFAULT 0,
    errors_last_hour  INTEGER NOT NULL DEFAULT 0,
    db_reachable      BOOLEAN NOT NULL DEFAULT true,
    s3_reachable      BOOLEAN NOT NULL DEFAULT true,
    notes             JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_shs_captured
    ON system_health_snapshots (captured_at DESC);

-- ── 009: triage_actions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS triage_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    actor_id        UUID NOT NULL REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN (
                      'claim', 'release', 'dismiss', 'request_review',
                      'approve', 'reject', 'push', 'reclaim',
                      'skip_shredder', 'return_to_curation'
                    )),
    from_state      TEXT NOT NULL,
    to_state        TEXT NOT NULL,
    notes           TEXT,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_triage_actions_sol_chrono
  ON triage_actions (solicitation_id, created_at DESC);

-- ── 009: solicitation_annotations ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solicitation_annotations (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id          UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    actor_id                 UUID NOT NULL REFERENCES users(id),
    kind                     TEXT NOT NULL CHECK (kind IN ('highlight', 'text_box', 'compliance_tag')),
    source_location          JSONB NOT NULL,
    payload                  JSONB NOT NULL DEFAULT '{}',
    compliance_variable_name TEXT,
    created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION _touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS solicitation_annotations_updated ON solicitation_annotations;
CREATE TRIGGER solicitation_annotations_updated
  BEFORE UPDATE ON solicitation_annotations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_sol_annotations_sol
  ON solicitation_annotations (solicitation_id);
CREATE INDEX IF NOT EXISTS idx_sol_annotations_variable
  ON solicitation_annotations (compliance_variable_name)
  WHERE compliance_variable_name IS NOT NULL;

-- ── 011: applications ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS applications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_email           TEXT NOT NULL,
    contact_name            TEXT NOT NULL,
    contact_title           TEXT,
    contact_phone           TEXT,
    company_name            TEXT NOT NULL,
    company_website         TEXT,
    company_size            TEXT,
    company_state           TEXT,
    sam_registered          BOOLEAN,
    sam_cage_code           TEXT,
    duns_uei                TEXT,
    previous_submissions    INTEGER,
    previous_awards         INTEGER,
    previous_award_programs TEXT[],
    tech_summary            TEXT NOT NULL,
    tech_areas              TEXT[] NOT NULL DEFAULT '{}',
    target_programs         TEXT[] NOT NULL DEFAULT '{}',
    target_agencies         TEXT[] NOT NULL DEFAULT '{}',
    desired_outcomes        TEXT[] NOT NULL DEFAULT '{}',
    motivation              TEXT,
    referral_source         TEXT,
    status                  TEXT NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','under_review','accepted','rejected','onboarded','withdrawn')),
    reviewed_by             UUID REFERENCES users(id),
    reviewed_at             TIMESTAMPTZ,
    review_notes            TEXT,
    accepted_cohort         TEXT,
    terms_accepted_at       TIMESTAMPTZ NOT NULL,
    terms_version           TEXT NOT NULL DEFAULT 'v1',
    metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip_hash                 TEXT,
    user_agent              TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_applications_email_unique
  ON applications (LOWER(contact_email));
CREATE INDEX IF NOT EXISTS idx_applications_status
  ON applications (status, created_at DESC)
  WHERE status IN ('pending','under_review');
CREATE INDEX IF NOT EXISTS idx_applications_accepted
  ON applications (created_at DESC)
  WHERE status = 'accepted';

-- ── 012: solicitation_documents ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solicitation_documents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id   UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    document_type     TEXT NOT NULL DEFAULT 'source',
    original_filename TEXT NOT NULL,
    storage_key       TEXT NOT NULL UNIQUE,
    file_size         BIGINT,
    content_type      TEXT,
    page_count        INTEGER,
    extracted_text    TEXT,
    extracted_at      TIMESTAMPTZ,
    uploaded_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    metadata          JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Columns from 015:
    content_hash      TEXT,
    -- Columns from 021:
    is_primary        BOOLEAN NOT NULL DEFAULT false,
    document_label    TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_docs_solicitation
  ON solicitation_documents (solicitation_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_sol_docs_needs_extraction
  ON solicitation_documents (solicitation_id)
  WHERE extracted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_sol_docs_content_hash_unique
  ON solicitation_documents (content_hash)
  WHERE content_hash IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sol_docs_touch_updated_at') THEN
    CREATE TRIGGER sol_docs_touch_updated_at
      BEFORE UPDATE ON solicitation_documents
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;

-- ── 012: solicitation_volumes ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS solicitation_volumes (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    solicitation_id       UUID NOT NULL REFERENCES curated_solicitations(id) ON DELETE CASCADE,
    volume_number         INTEGER NOT NULL,
    volume_name           TEXT NOT NULL,
    volume_format         TEXT DEFAULT 'custom'
                            CHECK (volume_format IN ('dsip_standard','l_and_m','custom')),
    description           TEXT,
    special_requirements  TEXT[] NOT NULL DEFAULT '{}',
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by            UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Column from 014:
    applies_to_phase      TEXT[],
    -- Column from 027:
    topic_id              UUID REFERENCES opportunities(id) ON DELETE CASCADE,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sol_volumes_solicitation
  ON solicitation_volumes (solicitation_id, volume_number ASC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'sol_volumes_touch_updated_at') THEN
    CREATE TRIGGER sol_volumes_touch_updated_at
      BEFORE UPDATE ON solicitation_volumes
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;

-- ── 012: volume_required_items ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS volume_required_items (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    volume_id             UUID NOT NULL REFERENCES solicitation_volumes(id) ON DELETE CASCADE,
    item_number           INTEGER NOT NULL,
    item_name             TEXT NOT NULL,
    item_type             TEXT NOT NULL DEFAULT 'word_doc'
                            CHECK (item_type IN (
                              'word_doc','slide_deck','spreadsheet','pdf','text',
                              'form_sf424','form_sbir_certs','form_other','other'
                            )),
    required              BOOLEAN NOT NULL DEFAULT true,
    page_limit            INTEGER,
    slide_limit           INTEGER,
    font_family           TEXT,
    font_size             TEXT,
    margins               TEXT,
    line_spacing          TEXT,
    header_format         TEXT,
    footer_format         TEXT,
    required_sections     JSONB NOT NULL DEFAULT '[]'::jsonb,
    format_rules          JSONB NOT NULL DEFAULT '{}'::jsonb,
    custom_fields         JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_excerpts       JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata              JSONB NOT NULL DEFAULT '{}'::jsonb,
    verified_by           UUID REFERENCES users(id) ON DELETE SET NULL,
    verified_at           TIMESTAMPTZ,
    -- Column from 014:
    applies_to_phase      TEXT[],
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (volume_id, item_number)
);

CREATE INDEX IF NOT EXISTS idx_vol_items_volume
  ON volume_required_items (volume_id, item_number ASC);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'vol_items_touch_updated_at') THEN
    CREATE TRIGGER vol_items_touch_updated_at
      BEFORE UPDATE ON volume_required_items
      FOR EACH ROW EXECUTE FUNCTION _touch_updated_at();
  END IF;
END $$;

-- ── 017: document_templates ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS document_templates (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    template_type   TEXT NOT NULL
                      CHECK (template_type IN (
                        'technical_volume','cost_volume','slide_deck',
                        'past_performance','key_personnel','commercialization',
                        'abstract','cover_sheet','supporting_docs','custom'
                      )),
    agency          TEXT,
    program_type    TEXT,
    storage_key     TEXT NOT NULL,
    canvas_preset   JSONB NOT NULL,
    node_count      INTEGER DEFAULT 0,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    tenant_id       UUID REFERENCES tenants(id),
    created_by      UUID REFERENCES users(id),
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_type_agency
  ON document_templates (template_type, agency)
  WHERE is_system = true;
CREATE INDEX IF NOT EXISTS idx_templates_tenant
  ON document_templates (tenant_id, template_type)
  WHERE tenant_id IS NOT NULL;

-- ── 017: canvas_versions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS canvas_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id      UUID NOT NULL REFERENCES proposal_sections(id) ON DELETE CASCADE,
    version_number  INTEGER NOT NULL,
    content         JSONB NOT NULL,
    snapshot_reason TEXT,
    created_by      UUID REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (section_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_canvas_versions_section
  ON canvas_versions (section_id, version_number DESC);

-- ── 018: sbir_companies ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sbir_companies (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name    TEXT NOT NULL,
    uei             TEXT,
    duns            TEXT,
    address1        TEXT,
    address2        TEXT,
    city            TEXT,
    state           TEXT,
    zip             TEXT,
    country         TEXT,
    company_url     TEXT,
    hubzone_owned   BOOLEAN DEFAULT false,
    woman_owned     BOOLEAN DEFAULT false,
    disadvantaged   BOOLEAN DEFAULT false,
    number_awards   INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbir_companies_uei
  ON sbir_companies (uei) WHERE uei IS NOT NULL AND uei != '';
CREATE INDEX IF NOT EXISTS idx_sbir_companies_name
  ON sbir_companies USING gin (to_tsvector('english', company_name));
CREATE INDEX IF NOT EXISTS idx_sbir_companies_state
  ON sbir_companies (state);

-- ── 018: sbir_awards ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sbir_awards (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_name          TEXT NOT NULL,
    award_title           TEXT,
    agency                TEXT,
    branch                TEXT,
    phase                 TEXT,
    program               TEXT,
    agency_tracking_number TEXT,
    contract              TEXT,
    proposal_award_date   DATE,
    contract_end_date     DATE,
    solicitation_number   TEXT,
    solicitation_year     TEXT,
    solicitation_close_date DATE,
    proposal_receipt_date DATE,
    date_of_notification  DATE,
    topic_code            TEXT,
    award_year            TEXT,
    award_amount          NUMERIC(15,2),
    uei                   TEXT,
    duns                  TEXT,
    hubzone_owned         BOOLEAN DEFAULT false,
    disadvantaged         BOOLEAN DEFAULT false,
    woman_owned           BOOLEAN DEFAULT false,
    number_employees      INTEGER,
    company_website       TEXT,
    address1              TEXT,
    address2              TEXT,
    city                  TEXT,
    state                 TEXT,
    zip                   TEXT,
    abstract              TEXT,
    contact_name          TEXT,
    contact_title         TEXT,
    contact_phone         TEXT,
    contact_email         TEXT,
    pi_name               TEXT,
    pi_title              TEXT,
    pi_phone              TEXT,
    pi_email              TEXT,
    ri_name               TEXT,
    ri_poc_name           TEXT,
    ri_poc_phone          TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sbir_awards_company
  ON sbir_awards USING gin (to_tsvector('english', company_name));
CREATE INDEX IF NOT EXISTS idx_sbir_awards_uei
  ON sbir_awards (uei) WHERE uei IS NOT NULL AND uei != '';
CREATE INDEX IF NOT EXISTS idx_sbir_awards_agency
  ON sbir_awards (agency, program);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_topic
  ON sbir_awards (topic_code) WHERE topic_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sbir_awards_year
  ON sbir_awards (award_year);
CREATE INDEX IF NOT EXISTS idx_sbir_awards_sol
  ON sbir_awards (solicitation_number) WHERE solicitation_number IS NOT NULL;

-- ── 018: sbir_data_uploads ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sbir_data_uploads (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        TEXT NOT NULL,
    file_hash       TEXT NOT NULL,
    file_type       TEXT NOT NULL CHECK (file_type IN ('company', 'award')),
    row_count       INTEGER NOT NULL DEFAULT 0,
    uploaded_by     UUID REFERENCES users(id),
    storage_key     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sbir_uploads_hash
  ON sbir_data_uploads (file_hash);

-- ── 019/031: cms_content ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cms_content (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            TEXT NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    content_type    TEXT NOT NULL DEFAULT 'page_block',
    body            TEXT NOT NULL DEFAULT '',
    excerpt         TEXT,
    author          TEXT,
    tags            TEXT[] DEFAULT '{}',
    published       BOOLEAN NOT NULL DEFAULT false,
    published_at    TIMESTAMPTZ,
    featured_image  TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID REFERENCES users(id),
    -- Columns from 031:
    external_url    TEXT,
    display_order   INT DEFAULT 0,
    -- Column from 034:
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure columns exist on a pre-existing cms_content table (migration 019
-- created it without these). CREATE TABLE IF NOT EXISTS above is a no-op
-- when the table already exists, so the columns must be added explicitly
-- before any index references them.
ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;
ALTER TABLE cms_content ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft';

CREATE INDEX IF NOT EXISTS idx_cms_content_type_published
  ON cms_content (content_type, published_at DESC) WHERE published = true;
CREATE INDEX IF NOT EXISTS idx_cms_content_slug
  ON cms_content (slug);
CREATE INDEX IF NOT EXISTS idx_cms_content_tags
  ON cms_content USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_cms_content_status
  ON cms_content (status);

-- ── 020: source_profiles ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_profiles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    site_type       TEXT NOT NULL DEFAULT 'custom'
                      CHECK (site_type IN ('dsip','sam_gov','sbir_gov','grants_gov','afwerx','xtech','nsf','custom')),
    base_url        TEXT NOT NULL,
    bookmark_url    TEXT,
    agency          TEXT,
    program_type    TEXT,
    admin_notes     TEXT,
    visit_instructions TEXT,
    topic_url_pattern TEXT,
    pdf_url_pattern TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    last_visited_at TIMESTAMPTZ,
    last_visited_by UUID REFERENCES users(id),
    created_by      UUID REFERENCES users(id),
    -- Columns from 025:
    auto_crawl_enabled BOOLEAN DEFAULT false,
    crawl_cron      TEXT DEFAULT '0 6 * * *',
    last_crawl_at   TIMESTAMPTZ,
    crawl_config    JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_profiles_active
  ON source_profiles (site_type) WHERE is_active = true;

-- ── 020: source_visits ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_visits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
    visited_by      UUID REFERENCES users(id),
    action          TEXT NOT NULL CHECK (action IN ('visit','download','upload','paste_topics','import_topics','shred','note')),
    url             TEXT,
    notes           TEXT,
    files_count     INTEGER DEFAULT 0,
    topics_count    INTEGER DEFAULT 0,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_visits_profile
  ON source_visits (profile_id, created_at DESC);

-- ── 025: source_regions ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_regions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  selector_hint TEXT,
  content_context TEXT,
  region_type TEXT DEFAULT 'content'
    CHECK (region_type IN ('content','listing','download','navigation','table')),
  sample_html TEXT,
  sample_text TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_regions_profile
  ON source_regions (profile_id) WHERE is_active = true;

-- ── 025: source_snapshots ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  region_id UUID REFERENCES source_regions(id) ON DELETE SET NULL,
  content_hash TEXT NOT NULL,
  content_text TEXT,
  raw_html_s3_key TEXT,
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_snapshots_region
  ON source_snapshots (region_id, captured_at DESC);

-- ── 025: source_diffs ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_diffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES source_profiles(id) ON DELETE CASCADE,
  region_id UUID REFERENCES source_regions(id),
  prev_snapshot_id UUID REFERENCES source_snapshots(id),
  next_snapshot_id UUID REFERENCES source_snapshots(id),
  is_meaningful BOOLEAN DEFAULT false,
  summary TEXT,
  extracted_opportunities JSONB DEFAULT '[]'::jsonb,
  severity TEXT DEFAULT 'info'
    CHECK (severity IN ('info','low','medium','high','critical')),
  claude_model TEXT,
  claude_tokens_used INT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_source_diffs_profile
  ON source_diffs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_source_diffs_meaningful
  ON source_diffs (is_meaningful, created_at DESC)
  WHERE is_meaningful = true;

-- ── 027: compliance_presets ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compliance_presets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  phase_type      TEXT NOT NULL,
  agency          TEXT,
  program_type    TEXT,
  compliance_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  volumes_data    JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system       BOOLEAN DEFAULT false,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_presets_name_phase
  ON compliance_presets (name, phase_type);


-- ############################################################################
-- SECTION B: ALTER TABLE ADD COLUMN — columns added to BASELINE tables
-- ############################################################################

-- ── 009: Memory namespace columns ───────────────────────────────────────────

ALTER TABLE episodic_memories ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE semantic_memories ADD COLUMN IF NOT EXISTS namespace TEXT;
ALTER TABLE procedural_memories ADD COLUMN IF NOT EXISTS namespace TEXT;

CREATE INDEX IF NOT EXISTS idx_episodic_namespace
  ON episodic_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_semantic_namespace
  ON semantic_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_procedural_namespace
  ON procedural_memories (namespace text_pattern_ops)
  WHERE namespace IS NOT NULL;

-- ── 009: pipeline_jobs dispatcher columns ───────────────────────────────────

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS priority INTEGER NOT NULL DEFAULT 5;
ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pending_queue
  ON pipeline_jobs (priority DESC, created_at ASC)
  WHERE status = 'pending';

-- ── 009: curated_solicitations review_requested_for ─────────────────────────

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS review_requested_for UUID REFERENCES users(id);

-- ── 009: solicitation_compliance index ──────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sol_compliance_sol_id
  ON solicitation_compliance (solicitation_id);

-- ── 010: pipeline_jobs.kind ─────────────────────────────────────────────────

ALTER TABLE pipeline_jobs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'ingest';

CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_pending_by_kind
  ON pipeline_jobs (kind, priority DESC, created_at ASC)
  WHERE status = 'pending';

-- ── 013: opportunities topic columns ────────────────────────────────────────

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS solicitation_id UUID
    REFERENCES curated_solicitations(id) ON DELETE SET NULL;
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_number TEXT;
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_branch TEXT;

-- topic_status needs special handling because CHECK constraint can't be in ADD COLUMN IF NOT EXISTS easily
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opportunities' AND column_name = 'topic_status'
  ) THEN
    ALTER TABLE opportunities ADD COLUMN topic_status TEXT DEFAULT 'open'
      CHECK (topic_status IN ('open','pre_release','closed','awarded','withdrawn'));
  END IF;
END $$;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS tech_focus_areas TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS poc_name TEXT;
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS poc_email TEXT;
ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS topic_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_opps_solicitation
  ON opportunities (solicitation_id, topic_number ASC)
  WHERE solicitation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_opps_topic_status
  ON opportunities (topic_status)
  WHERE topic_status != 'closed';

-- ── 013: curated_solicitations umbrella columns ─────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'curated_solicitations' AND column_name = 'solicitation_type'
  ) THEN
    ALTER TABLE curated_solicitations ADD COLUMN solicitation_type TEXT DEFAULT 'single'
      CHECK (solicitation_type IN ('single','multi_topic'));
  END IF;
END $$;

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS solicitation_title TEXT;
ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS solicitation_number TEXT;

-- ── 014: phase-aware volume columns ─────────────────────────────────────────

ALTER TABLE solicitation_volumes
  ADD COLUMN IF NOT EXISTS applies_to_phase TEXT[];
ALTER TABLE volume_required_items
  ADD COLUMN IF NOT EXISTS applies_to_phase TEXT[];

-- ── 015: solicitation_documents content_hash ────────────────────────────────

ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- ── 015: curated_solicitations round columns ────────────────────────────────

ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS round_number INTEGER;
ALTER TABLE curated_solicitations
  ADD COLUMN IF NOT EXISTS round_label TEXT;

-- ── 017: library_units outcome columns ──────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'library_units' AND column_name = 'outcome'
  ) THEN
    ALTER TABLE library_units ADD COLUMN outcome TEXT
      CHECK (outcome IN ('pending','awarded','rejected','withdrawn'));
  END IF;
END $$;

ALTER TABLE library_units ADD COLUMN IF NOT EXISTS outcome_score REAL DEFAULT 0.5;
ALTER TABLE library_units ADD COLUMN IF NOT EXISTS original_proposal_id UUID;
ALTER TABLE library_units ADD COLUMN IF NOT EXISTS original_node_id TEXT;
ALTER TABLE library_units ADD COLUMN IF NOT EXISTS atom_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_library_units_outcome
  ON library_units (outcome_score DESC)
  WHERE outcome = 'awarded';

-- ── 021: solicitation_documents additional columns ──────────────────────────

ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE solicitation_documents
  ADD COLUMN IF NOT EXISTS document_label TEXT;

-- ── 022: tenants Stripe columns ─────────────────────────────────────────────

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tenants' AND column_name = 'subscription_status'
  ) THEN
    ALTER TABLE tenants ADD COLUMN subscription_status TEXT NOT NULL DEFAULT 'none'
      CHECK (subscription_status IN ('none','active','past_due','canceled'));
  END IF;
END $$;

-- ── 024: system_config deploy_environment ───────────────────────────────────

ALTER TABLE system_config
  ADD COLUMN IF NOT EXISTS deploy_environment TEXT DEFAULT 'production';

-- ── 025: source_profiles auto-crawl columns ─────────────────────────────────

ALTER TABLE source_profiles
  ADD COLUMN IF NOT EXISTS auto_crawl_enabled BOOLEAN DEFAULT false;
ALTER TABLE source_profiles
  ADD COLUMN IF NOT EXISTS crawl_cron TEXT DEFAULT '0 6 * * *';
ALTER TABLE source_profiles
  ADD COLUMN IF NOT EXISTS last_crawl_at TIMESTAMPTZ;
ALTER TABLE source_profiles
  ADD COLUMN IF NOT EXISTS crawl_config JSONB DEFAULT '{}'::jsonb;

-- ── 027: solicitation_compliance topic_id ───────────────────────────────────

ALTER TABLE solicitation_compliance
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES opportunities(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_sol_topic
  ON solicitation_compliance (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'));

-- ── 027: solicitation_volumes topic_id ──────────────────────────────────────

ALTER TABLE solicitation_volumes
  ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES opportunities(id) ON DELETE CASCADE;

-- Drop old UNIQUE constraint if it exists so we can replace with topic-aware one
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'solicitation_volumes'
      AND constraint_name = 'solicitation_volumes_solicitation_id_volume_number_key'
  ) THEN
    ALTER TABLE solicitation_volumes
      DROP CONSTRAINT solicitation_volumes_solicitation_id_volume_number_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_volumes_sol_topic_num
  ON solicitation_volumes (solicitation_id, COALESCE(topic_id, '00000000-0000-0000-0000-000000000000'), volume_number);

-- ── 027: opportunities phase_type ───────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'opportunities' AND column_name = 'phase_type'
  ) THEN
    ALTER TABLE opportunities ADD COLUMN phase_type TEXT
      CHECK (phase_type IN ('phase_1','phase_2','direct_to_phase_2','phase_3','cso','ota','baa','other'));
  END IF;
END $$;

-- ── 029: proposals stage constraint + new columns ───────────────────────────

ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS gate_config JSONB DEFAULT '["draft","final"]'::jsonb;
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS lock_count INT NOT NULL DEFAULT 0;
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS download_count INT NOT NULL DEFAULT 0;
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS last_locked_at TIMESTAMPTZ;
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS last_unlocked_at TIMESTAMPTZ;
ALTER TABLE proposals
  ADD COLUMN IF NOT EXISTS unlock_deadline TIMESTAMPTZ;

-- ── 029: proposal_collaborators enhancements ────────────────────────────────

ALTER TABLE proposal_collaborators
  ADD COLUMN IF NOT EXISTS assigned_sections UUID[] DEFAULT '{}';
ALTER TABLE proposal_collaborators
  ADD COLUMN IF NOT EXISTS dropbox_enabled BOOLEAN DEFAULT true;

-- ── 030: library_units structured atom columns ──────────────────────────────

ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS canvas_nodes JSONB;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS document_metadata JSONB DEFAULT '{}'::jsonb;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS source_filename TEXT;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS source_storage_key TEXT;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS heading_text TEXT;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS char_offset INT;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS char_length INT;
ALTER TABLE library_units
  ADD COLUMN IF NOT EXISTS is_seminal BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_library_parent
  ON library_units(parent_unit_id) WHERE parent_unit_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_seminal
  ON library_units(tenant_id, is_seminal) WHERE is_seminal = true;

-- ── 031: cms_content extra columns ──────────────────────────────────────────

ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS external_url TEXT;
ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS display_order INT DEFAULT 0;

-- ── 033: visitor analytics enhancements ─────────────────────────────────────

ALTER TABLE page_views ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS referrer TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE page_views ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS ip_hash TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE visitor_sessions ADD COLUMN IF NOT EXISTS page_count INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_session_id ON page_views(session_id);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_created_at ON visitor_sessions(created_at);

-- ── 034: cms_content status column ──────────────────────────────────────────

ALTER TABLE cms_content
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';

-- Backfill from existing published boolean (safe if status already exists)
UPDATE cms_content SET status = 'published' WHERE published = true AND (status IS NULL OR status = 'draft');
UPDATE cms_content SET status = 'draft' WHERE status IS NULL;

DO $$
BEGIN
  ALTER TABLE cms_content ALTER COLUMN status SET NOT NULL;
  ALTER TABLE cms_content ALTER COLUMN status SET DEFAULT 'draft';
EXCEPTION WHEN others THEN NULL;
END $$;

-- ── 035: purchases metadata column ──────────────────────────────────────────

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;


-- ############################################################################
-- SECTION C: CONSTRAINT RECONCILIATION
-- ############################################################################

-- ── automation_rules: bridge 001 (trigger_bus/trigger_events) → 019/028 schema

-- Relax old 001_baseline NOT NULL on trigger_bus + trigger_events
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'automation_rules' AND column_name = 'trigger_bus'
  ) THEN
    ALTER TABLE automation_rules ALTER COLUMN trigger_bus DROP NOT NULL;
    ALTER TABLE automation_rules ALTER COLUMN trigger_bus SET DEFAULT '';
    ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_trigger_bus_check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'automation_rules' AND column_name = 'trigger_events'
  ) THEN
    ALTER TABLE automation_rules ALTER COLUMN trigger_events DROP NOT NULL;
    ALTER TABLE automation_rules ALTER COLUMN trigger_events SET DEFAULT '{}';
  END IF;
END $$;

-- Add 019/028 columns to automation_rules
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS trigger_namespace TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Widen action_type CHECK to accept both old (001) and new (019) values
ALTER TABLE automation_rules DROP CONSTRAINT IF EXISTS automation_rules_action_type_check;
ALTER TABLE automation_rules ADD CONSTRAINT automation_rules_action_type_check
  CHECK (action_type IN ('log_only','queue_notification','queue_job','emit_event',
                         'send_email','notify_admin','webhook','update_status'));

CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger
  ON automation_rules (trigger_namespace, trigger_type) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_rules_name ON automation_rules(name);

-- ── automation_log: bridge 001 → 019/028 schema

ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS action_type TEXT NOT NULL DEFAULT '';
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'success';
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE automation_log ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE automation_log DROP CONSTRAINT IF EXISTS automation_log_status_check;
  ALTER TABLE automation_log ADD CONSTRAINT automation_log_status_check
    CHECK (status IN ('success', 'failed', 'skipped'));
EXCEPTION WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_automation_log_rule
  ON automation_log (rule_id, executed_at DESC);

-- ── curated_solicitations.status: final CHECK with all states (009 + 010)

DO $$
DECLARE
  _conname TEXT;
BEGIN
  SELECT conname INTO _conname
  FROM pg_constraint
  WHERE conrelid = 'curated_solicitations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%status%'
  LIMIT 1;

  IF _conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE curated_solicitations DROP CONSTRAINT %I', _conname);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'curated_solicitations'::regclass
      AND conname = 'curated_solicitations_status_check'
  ) THEN
    ALTER TABLE curated_solicitations
      ADD CONSTRAINT curated_solicitations_status_check
      CHECK (status IN (
        'new','claimed','released','released_for_analysis','ai_analyzed',
        'shredder_failed','curation_in_progress','review_requested',
        'approved','pushed_to_pipeline','dismissed','rejected_review'
      ));
  END IF;
END $$;

-- ── solicitation_documents.document_type: final CHECK (012 + 015 + 021)

ALTER TABLE solicitation_documents
  DROP CONSTRAINT IF EXISTS solicitation_documents_document_type_check;
ALTER TABLE solicitation_documents
  ADD CONSTRAINT solicitation_documents_document_type_check
  CHECK (document_type IN (
    'source','rfp','nofo','instructions','amendment','qa',
    'template','supporting','attachment','topic','other'
  ));

-- ── pipeline_jobs.kind: final CHECK (010 + 026)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_jobs_kind_check'
      AND conrelid = 'pipeline_jobs'::regclass
  ) THEN
    ALTER TABLE pipeline_jobs DROP CONSTRAINT pipeline_jobs_kind_check;
  END IF;

  ALTER TABLE pipeline_jobs ADD CONSTRAINT pipeline_jobs_kind_check
    CHECK (kind IN ('ingest', 'shred_solicitation', 'scout_source'));
END $$;

-- ── proposals.stage: final CHECK (029)
-- Migrate old stage values before applying new constraint
UPDATE proposals SET stage = 'draft'
  WHERE stage IN ('outline','pink_team','red_team','gold_team');

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_stage_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'proposals' AND constraint_name = 'proposals_stage_check'
  ) THEN
    ALTER TABLE proposals ADD CONSTRAINT proposals_stage_check
      CHECK (stage IN ('draft','review','final','submitted','archived'));
  END IF;
END $$;

-- ── cms_content.content_type: final CHECK (031)

ALTER TABLE cms_content DROP CONSTRAINT IF EXISTS cms_content_content_type_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cms_content' AND constraint_name = 'cms_content_content_type_check'
  ) THEN
    ALTER TABLE cms_content ADD CONSTRAINT cms_content_content_type_check
      CHECK (content_type IN (
        'blog_post', 'resource', 'guide', 'announcement', 'faq',
        'testimonial', 'team_member', 'social_post', 'page_block'
      ));
  END IF;
END $$;

-- ── cms_content.status: final CHECK (034)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'cms_content' AND constraint_name = 'cms_content_status_check'
  ) THEN
    ALTER TABLE cms_content ADD CONSTRAINT cms_content_status_check
      CHECK (status IN ('draft', 'pending', 'published', 'private', 'archived'));
  END IF;
END $$;

-- ── purchases.product_type: final CHECK (035)

ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_product_type_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_product_type_check
  CHECK (product_type IN (
    'finder_subscription','proposal_phase1','proposal_phase2','expert_consulting'
  ));

-- ── opportunities.content_hash UNIQUE (009)

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'opportunities_content_hash_key'
      AND conrelid = 'opportunities'::regclass
  ) THEN
    ALTER TABLE opportunities
      ADD CONSTRAINT opportunities_content_hash_key UNIQUE (content_hash);
  END IF;
END $$;

-- ── Triage queue partial indexes (009)

CREATE INDEX IF NOT EXISTS idx_csol_triage_unclaimed
  ON curated_solicitations (created_at DESC)
  WHERE status = 'new' AND claimed_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_csol_my_claims
  ON curated_solicitations (claimed_by, claimed_at DESC)
  WHERE status IN ('claimed', 'curation_in_progress', 'review_requested');


-- ############################################################################
-- SECTION D: FK CASCADE RULES FROM 035
-- ############################################################################

-- Proposal child tables: ON DELETE CASCADE
ALTER TABLE proposal_sections DROP CONSTRAINT IF EXISTS proposal_sections_proposal_id_fkey;
ALTER TABLE proposal_sections ADD CONSTRAINT proposal_sections_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_collaborators DROP CONSTRAINT IF EXISTS proposal_collaborators_proposal_id_fkey;
ALTER TABLE proposal_collaborators ADD CONSTRAINT proposal_collaborators_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE collaborator_stage_access DROP CONSTRAINT IF EXISTS collaborator_stage_access_proposal_id_fkey;
ALTER TABLE collaborator_stage_access ADD CONSTRAINT collaborator_stage_access_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_compliance_matrix DROP CONSTRAINT IF EXISTS proposal_compliance_matrix_proposal_id_fkey;
ALTER TABLE proposal_compliance_matrix ADD CONSTRAINT proposal_compliance_matrix_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_stage_history DROP CONSTRAINT IF EXISTS proposal_stage_history_proposal_id_fkey;
ALTER TABLE proposal_stage_history ADD CONSTRAINT proposal_stage_history_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_reviews DROP CONSTRAINT IF EXISTS proposal_reviews_proposal_id_fkey;
ALTER TABLE proposal_reviews ADD CONSTRAINT proposal_reviews_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

ALTER TABLE proposal_comments DROP CONSTRAINT IF EXISTS proposal_comments_proposal_id_fkey;
ALTER TABLE proposal_comments ADD CONSTRAINT proposal_comments_proposal_id_fkey
  FOREIGN KEY (proposal_id) REFERENCES proposals(id) ON DELETE CASCADE;

-- User FK columns: ON DELETE SET NULL / CASCADE
ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_claimed_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_claimed_by_fkey
  FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_curated_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_curated_by_fkey
  FOREIGN KEY (curated_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE curated_solicitations DROP CONSTRAINT IF EXISTS curated_solicitations_approved_by_fkey;
ALTER TABLE curated_solicitations ADD CONSTRAINT curated_solicitations_approved_by_fkey
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE solicitation_compliance DROP CONSTRAINT IF EXISTS solicitation_compliance_verified_by_fkey;
ALTER TABLE solicitation_compliance ADD CONSTRAINT solicitation_compliance_verified_by_fkey
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE solicitation_templates DROP CONSTRAINT IF EXISTS solicitation_templates_uploaded_by_fkey;
ALTER TABLE solicitation_templates ADD CONSTRAINT solicitation_templates_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_sections DROP CONSTRAINT IF EXISTS proposal_sections_assigned_to_fkey;
ALTER TABLE proposal_sections ADD CONSTRAINT proposal_sections_assigned_to_fkey
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_stage_history DROP CONSTRAINT IF EXISTS proposal_stage_history_changed_by_fkey;
ALTER TABLE proposal_stage_history ADD CONSTRAINT proposal_stage_history_changed_by_fkey
  FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE proposal_comments DROP CONSTRAINT IF EXISTS proposal_comments_user_id_fkey;
ALTER TABLE proposal_comments ADD CONSTRAINT proposal_comments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE proposal_reviews DROP CONSTRAINT IF EXISTS proposal_reviews_reviewer_id_fkey;
ALTER TABLE proposal_reviews ADD CONSTRAINT proposal_reviews_reviewer_id_fkey
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL;


-- ############################################################################
-- SECTION E: MISSING FK INDEXES (035)
-- ############################################################################

CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_tenant_pipeline_items_opportunity
  ON tenant_pipeline_items(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_tenant_actions_tenant
  ON tenant_actions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_proposals_opportunity
  ON proposals(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_proposal_sections_proposal
  ON proposal_sections(proposal_id);
CREATE INDEX IF NOT EXISTS idx_proposal_collaborators_proposal
  ON proposal_collaborators(proposal_id);


-- ############################################################################
-- SECTION F: VIEWS (013)
-- ############################################################################

CREATE OR REPLACE VIEW solicitation_summary AS
SELECT
  cs.id AS solicitation_id,
  cs.status AS solicitation_status,
  cs.namespace,
  cs.solicitation_type,
  COALESCE(cs.solicitation_title, o_primary.title) AS title,
  COALESCE(cs.solicitation_number, o_primary.solicitation_number) AS sol_number,
  o_primary.agency,
  o_primary.office,
  o_primary.program_type,
  o_primary.close_date,
  o_primary.posted_date,
  cs.claimed_by,
  cs.claimed_at,
  cs.curated_by,
  cs.approved_by,
  cs.created_at,
  (
    SELECT COUNT(*) FROM opportunities o2
    WHERE o2.solicitation_id = cs.id
  ) AS topic_count,
  (
    SELECT COUNT(*) FROM opportunities o2
    WHERE o2.solicitation_id = cs.id
      AND o2.is_active = true
      AND o2.topic_status IN ('open','pre_release')
  ) AS active_topic_count
FROM curated_solicitations cs
LEFT JOIN opportunities o_primary ON o_primary.id = cs.opportunity_id;


-- ############################################################################
-- SECTION G: TRIGGER FUNCTIONS + FTS (009)
-- ############################################################################

-- Opportunities full-text search trigger
CREATE OR REPLACE FUNCTION opportunities_fts_update() RETURNS TRIGGER AS $$
BEGIN
  NEW.full_text_tsv := to_tsvector('english',
    COALESCE(NEW.title, '') || ' ' ||
    COALESCE(NEW.description, '') || ' ' ||
    COALESCE(NEW.agency, '') || ' ' ||
    COALESCE(NEW.office, '') || ' ' ||
    COALESCE(NEW.solicitation_number, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS opportunities_fts_trigger ON opportunities;
CREATE TRIGGER opportunities_fts_trigger
  BEFORE INSERT OR UPDATE OF title, description, agency, office, solicitation_number
  ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION opportunities_fts_update();

-- ── 035: Drop unused table ──────────────────────────────────────────────────

DROP TABLE IF EXISTS solicitation_topics;


-- ############################################################################
-- DONE
-- ############################################################################
