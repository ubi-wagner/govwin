-- =============================================================================
-- End-to-End Test Suite
-- Tests all data flows: DB → API layer queries → Frontend expectations
-- Run after seed_test_data.sql
-- =============================================================================

\set ON_ERROR_STOP on
\timing on

-- Helper: test assertion that raises error on failure
CREATE OR REPLACE FUNCTION assert_equals(description TEXT, expected TEXT, actual TEXT)
RETURNS VOID AS $$
BEGIN
  IF expected IS DISTINCT FROM actual THEN
    RAISE EXCEPTION 'FAIL: % — expected "%" but got "%"', description, expected, actual;
  ELSE
    RAISE NOTICE 'PASS: %', description;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION assert_true(description TEXT, condition BOOLEAN)
RETURNS VOID AS $$
BEGIN
  IF NOT condition THEN
    RAISE EXCEPTION 'FAIL: %', description;
  ELSE
    RAISE NOTICE 'PASS: %', description;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- TEST GROUP 1: ADMIN PERSONA — System Status (GET /api/system)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 1: ADMIN — System Status';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  raw JSONB;
BEGIN
  SELECT get_system_status() INTO raw;

  -- Verify structure matches what /api/system transforms
  PERFORM assert_true('system_status returns JSONB', raw IS NOT NULL);
  PERFORM assert_true('has pipeline_jobs key', raw ? 'pipeline_jobs');
  PERFORM assert_true('has tenants key', raw ? 'tenants');
  PERFORM assert_true('has source_health key', raw ? 'source_health');
  PERFORM assert_true('has api_keys key', raw ? 'api_keys');
  PERFORM assert_true('has rate_limits key', raw ? 'rate_limits');
  PERFORM assert_true('has checked_at key', raw ? 'checked_at');

  -- Verify tenant counts
  PERFORM assert_equals('tenants.total', '3', (raw->'tenants'->>'total'));
  PERFORM assert_equals('tenants.active', '2', (raw->'tenants'->>'active'));
  PERFORM assert_equals('tenants.trial', '1', (raw->'tenants'->>'trial'));

  -- Verify pipeline job counts (1 pending was dequeued, 1 failed in last 24h)
  PERFORM assert_true('pipeline_jobs.failed_24h >= 1', (raw->'pipeline_jobs'->>'failed_24h')::int >= 1);

  -- Verify source health
  PERFORM assert_equals('sam_gov health', 'healthy', raw->'source_health'->>'sam_gov');
  PERFORM assert_equals('grants_gov health', 'error', raw->'source_health'->>'grants_gov');

  -- Verify API keys
  PERFORM assert_equals('sam_gov api key', 'no_expiry', raw->'api_keys'->>'sam_gov');
END $$;

-- =============================================================================
-- TEST GROUP 2: ADMIN — Tenant List (GET /api/tenants)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 2: ADMIN — Tenant List';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  r RECORD;
  cnt INT;
BEGIN
  -- Simulate the exact query from /api/tenants
  SELECT COUNT(*) INTO cnt FROM (
    SELECT
      t.*,
      COUNT(DISTINCT u.id)::INT AS user_count,
      COUNT(DISTINCT to2.opportunity_id)::INT AS opportunity_count,
      COUNT(DISTINCT to2.opportunity_id)
        FILTER (WHERE to2.pursuit_status = 'pursuing')::INT AS pursuing_count,
      ROUND(AVG(to2.total_score), 1) AS avg_score,
      MAX(ta.created_at) AS last_activity_at
    FROM tenants t
    LEFT JOIN users u ON u.tenant_id = t.id AND u.is_active = true
    LEFT JOIN tenant_opportunities to2 ON to2.tenant_id = t.id
    LEFT JOIN tenant_actions ta ON ta.tenant_id = t.id
    GROUP BY t.id
    ORDER BY t.created_at DESC
  ) sub;

  PERFORM assert_true('tenant list returns all tenants', cnt >= 2);

  -- Verify TechForward stats
  SELECT
    t.name, t.plan, t.status,
    COUNT(DISTINCT u.id)::INT AS user_count,
    COUNT(DISTINCT to2.opportunity_id)::INT AS opportunity_count,
    COUNT(DISTINCT to2.opportunity_id)
      FILTER (WHERE to2.pursuit_status = 'pursuing')::INT AS pursuing_count,
    ROUND(AVG(to2.total_score), 1) AS avg_score
  INTO r
  FROM tenants t
  LEFT JOIN users u ON u.tenant_id = t.id AND u.is_active = true
  LEFT JOIN tenant_opportunities to2 ON to2.tenant_id = t.id
  LEFT JOIN tenant_actions ta ON ta.tenant_id = t.id
  WHERE t.slug = 'techforward-solutions'
  GROUP BY t.id;

  PERFORM assert_equals('TechForward name', 'TechForward Solutions LLC', r.name);
  PERFORM assert_equals('TechForward plan', 'professional', r.plan);
  PERFORM assert_equals('TechForward status', 'active', r.status);
  PERFORM assert_equals('TechForward user_count', '2', r.user_count::text);
  PERFORM assert_equals('TechForward opp_count', '6', r.opportunity_count::text);
  PERFORM assert_equals('TechForward pursuing_count', '2', r.pursuing_count::text);
  PERFORM assert_true('TechForward avg_score > 0', r.avg_score > 0);
END $$;

-- =============================================================================
-- TEST GROUP 3: ADMIN — Tenant Detail (GET /api/tenants/[id])
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 3: ADMIN — Tenant Detail';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  t_exists BOOLEAN;
  p_exists BOOLEAN;
  u_cnt INT;
  a_cnt INT;
BEGIN
  -- Tenant exists
  SELECT EXISTS(SELECT 1 FROM tenants WHERE id = tid) INTO t_exists;
  PERFORM assert_true('TechForward tenant exists', t_exists);

  -- Profile exists
  SELECT EXISTS(SELECT 1 FROM tenant_profiles WHERE tenant_id = tid) INTO p_exists;
  PERFORM assert_true('TechForward profile exists', p_exists);

  -- Users
  SELECT COUNT(*) INTO u_cnt FROM users WHERE tenant_id = tid;
  PERFORM assert_equals('TechForward has 2 users', '2', u_cnt::text);

  -- Recent actions (joined with users and opportunities)
  SELECT COUNT(*) INTO a_cnt FROM (
    SELECT ta.action_type, ta.created_at, u.name AS user_name, o.title AS opp_title
    FROM tenant_actions ta
    JOIN users u ON u.id = ta.user_id
    JOIN opportunities o ON o.id = ta.opportunity_id
    WHERE ta.tenant_id = tid
    ORDER BY ta.created_at DESC
    LIMIT 20
  ) sub;
  PERFORM assert_true('TechForward has recent actions', a_cnt >= 4);
END $$;

-- =============================================================================
-- TEST GROUP 4: ADMIN — Pipeline Jobs (GET /api/pipeline?view=jobs)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 4: ADMIN — Pipeline';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  job_cnt INT;
  schedule_cnt INT;
  run_cnt INT;
BEGIN
  SELECT COUNT(*) INTO job_cnt FROM pipeline_jobs;
  PERFORM assert_equals('pipeline jobs count', '4', job_cnt::text);

  SELECT COUNT(*) INTO schedule_cnt FROM pipeline_schedules;
  PERFORM assert_true('pipeline schedules exist', schedule_cnt >= 5);

  SELECT COUNT(*) INTO run_cnt FROM pipeline_runs;
  PERFORM assert_equals('pipeline runs count', '3', run_cnt::text);

  -- Verify job statuses
  PERFORM assert_true('has completed jobs', EXISTS(SELECT 1 FROM pipeline_jobs WHERE status = 'completed'));
  PERFORM assert_true('has failed jobs', EXISTS(SELECT 1 FROM pipeline_jobs WHERE status = 'failed'));
END $$;

-- =============================================================================
-- TEST GROUP 5: ADMIN — Source Health (GET /api/system → sourceHealth)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 5: ADMIN — Source Health';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  sh_cnt INT;
  r RECORD;
BEGIN
  SELECT COUNT(*) INTO sh_cnt FROM source_health;
  PERFORM assert_true('source_health has entries', sh_cnt >= 4);

  SELECT * INTO r FROM source_health WHERE source = 'sam_gov';
  PERFORM assert_equals('sam_gov status', 'healthy', r.status);
  PERFORM assert_true('sam_gov has last_success', r.last_success_at IS NOT NULL);
  PERFORM assert_equals('sam_gov consecutive failures', '0', r.consecutive_failures::text);

  SELECT * INTO r FROM source_health WHERE source = 'grants_gov';
  PERFORM assert_equals('grants_gov status', 'error', r.status);
  PERFORM assert_equals('grants_gov consecutive failures', '3', r.consecutive_failures::text);
END $$;

-- =============================================================================
-- TEST GROUP 6: PORTAL (tenant_user) — Pipeline View
-- Simulates GET /api/opportunities?tenantSlug=techforward-solutions
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 6: PORTAL — Pipeline View (TechForward)';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  total INT;
  r RECORD;
BEGIN
  -- Total pipeline items
  SELECT COUNT(*) INTO total FROM tenant_pipeline WHERE tenant_id = tid;
  PERFORM assert_equals('TechForward pipeline total', '6', total::text);

  -- Score-sorted top result
  SELECT * INTO r FROM tenant_pipeline
    WHERE tenant_id = tid ORDER BY total_score DESC NULLS LAST LIMIT 1;
  PERFORM assert_true('top scored >= 90', r.total_score >= 90);
  PERFORM assert_equals('top scored is Cloud Migration', 'Enterprise Cloud Migration and Managed Services', r.title);
  PERFORM assert_equals('top scored priority', 'high', r.priority_tier);
  PERFORM assert_equals('top scored pursuit', 'pursuing', r.pursuit_status);
  PERFORM assert_true('Cloud Migration has thumbs_up', r.thumbs_up >= 2);
  PERFORM assert_true('Cloud Migration is pinned', r.is_pinned);
  PERFORM assert_true('Cloud Migration has docs', r.doc_count >= 2);
  PERFORM assert_true('Cloud Migration has amendments', r.amendment_count >= 1);

  -- Verify deadline statuses
  PERFORM assert_true('urgent opp exists', EXISTS(
    SELECT 1 FROM tenant_pipeline WHERE tenant_id = tid AND deadline_status = 'urgent'
  ));

  -- Verify set-aside displays
  SELECT * INTO r FROM tenant_pipeline
    WHERE tenant_id = tid AND title LIKE '%Cloud Migration%';
  PERFORM assert_equals('set_aside_type populated',
    'Service-Disabled Veteran-Owned Small Business (SDVOSB) Set-Aside', r.set_aside_type);

  -- Verify NAICS codes (array)
  PERFORM assert_true('naics_codes is array', array_length(r.naics_codes, 1) >= 1);

  -- Verify matched keywords and domains
  PERFORM assert_true('has matched_keywords', array_length(r.matched_keywords, 1) >= 3);
  PERFORM assert_true('has matched_domains', array_length(r.matched_domains, 1) >= 1);

  -- Verify LLM rationale
  PERFORM assert_true('has llm_rationale', r.llm_rationale IS NOT NULL AND length(r.llm_rationale) > 10);

  -- Verify key requirements
  PERFORM assert_true('has key_requirements', array_length(r.key_requirements, 1) >= 2);

  -- Verify source_url (SAM.gov link)
  PERFORM assert_true('source_url is SAM.gov link', r.source_url LIKE 'https://sam.gov/opp/%');

  -- Closed opportunity should NOT appear
  PERFORM assert_true('closed opp not in pipeline',
    NOT EXISTS(SELECT 1 FROM tenant_pipeline WHERE tenant_id = tid AND title LIKE '%CLOSED%'));
END $$;

-- =============================================================================
-- TEST GROUP 7: PORTAL — Filters & Sorting
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 7: PORTAL — Filters & Sorting';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  cnt INT;
BEGIN
  -- Filter: pursuing only
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND pursuit_status = 'pursuing';
  PERFORM assert_equals('pursuing filter returns 2', '2', cnt::text);

  -- Filter: minScore >= 75
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND total_score >= 75;
  PERFORM assert_equals('score >= 75 returns 3', '3', cnt::text);

  -- Filter: urgent deadline
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND deadline_status = 'urgent';
  PERFORM assert_equals('urgent deadline returns 1', '1', cnt::text);

  -- Filter: pinned
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND is_pinned = true;
  PERFORM assert_equals('pinned returns 1', '1', cnt::text);

  -- Sort: close_date ASC (deadline soonest first)
  PERFORM assert_true('sort by close_date works',
    (SELECT close_date FROM tenant_pipeline
     WHERE tenant_id = tid AND close_date IS NOT NULL
     ORDER BY close_date ASC LIMIT 1) IS NOT NULL);

  -- Sort: posted_date DESC
  PERFORM assert_true('sort by posted_date works',
    (SELECT posted_date FROM tenant_pipeline
     WHERE tenant_id = tid
     ORDER BY posted_date DESC LIMIT 1) IS NOT NULL);

  -- Search: title contains "Cloud"
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND title ILIKE '%Cloud%';
  PERFORM assert_true('search Cloud returns >= 2', cnt >= 2);

  -- Search: solicitation number
  SELECT COUNT(*) INTO cnt FROM tenant_pipeline
    WHERE tenant_id = tid AND solicitation_number ILIKE '%HC1028%';
  PERFORM assert_equals('search sol# HC1028 returns 1', '1', cnt::text);
END $$;

-- =============================================================================
-- TEST GROUP 8: PORTAL — ClearPath Consulting (different persona)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 8: PORTAL — ClearPath Pipeline';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'b2222222-2222-2222-2222-222222222222';
  total INT;
  r RECORD;
BEGIN
  SELECT COUNT(*) INTO total FROM tenant_pipeline WHERE tenant_id = tid;
  PERFORM assert_equals('ClearPath pipeline total', '2', total::text);

  SELECT * INTO r FROM tenant_pipeline
    WHERE tenant_id = tid ORDER BY total_score DESC LIMIT 1;
  PERFORM assert_equals('ClearPath top opp is PMO', 'Program Management Office (PMO) Support Services', r.title);
  PERFORM assert_true('ClearPath top score >= 80', r.total_score >= 80);
  PERFORM assert_equals('ClearPath top pursuit', 'pursuing', r.pursuit_status);

  -- Verify different matched domains
  PERFORM assert_true('ClearPath has Program Management domain',
    'Program Management' = ANY(r.matched_domains));
END $$;

-- =============================================================================
-- TEST GROUP 9: PORTAL — Documents (GET /api/portal/[slug]/documents)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 9: PORTAL — Documents';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  cnt INT;
  r RECORD;
BEGIN
  -- Exact query from /api/portal/[tenantSlug]/documents/route.ts
  SELECT COUNT(*) INTO cnt FROM (
    SELECT id, title, description, url, link_type, opportunity_id,
           access_count, created_at
    FROM download_links
    WHERE tenant_id = tid
      AND is_active = true
      AND (expires_at IS NULL OR expires_at > NOW())
    ORDER BY created_at DESC
  ) sub;

  PERFORM assert_equals('TechForward has 3 documents', '3', cnt::text);

  -- Verify link types match frontend expectations
  PERFORM assert_true('has guidance doc',
    EXISTS(SELECT 1 FROM download_links WHERE tenant_id = tid AND link_type = 'guidance' AND is_active = true));
  PERFORM assert_true('has template doc',
    EXISTS(SELECT 1 FROM download_links WHERE tenant_id = tid AND link_type = 'template' AND is_active = true));
  PERFORM assert_true('has opportunity_doc',
    EXISTS(SELECT 1 FROM download_links WHERE tenant_id = tid AND link_type = 'opportunity_doc' AND is_active = true));
END $$;

-- =============================================================================
-- TEST GROUP 10: PORTAL — Profile (GET /api/portal/[slug]/profile)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 10: PORTAL — Profile';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  r RECORD;
BEGIN
  -- Exact query from /api/portal/[tenantSlug]/profile/route.ts
  SELECT * INTO r FROM tenant_profiles WHERE tenant_id = tid;

  PERFORM assert_true('profile exists', r IS NOT NULL);
  PERFORM assert_true('primary_naics has 3 codes', array_length(r.primary_naics, 1) = 3);
  PERFORM assert_true('primary_naics includes 541512', '541512' = ANY(r.primary_naics));
  PERFORM assert_true('secondary_naics has codes', array_length(r.secondary_naics, 1) >= 1);

  -- Set-aside flags
  PERFORM assert_true('is_small_business', r.is_small_business);
  PERFORM assert_true('is_sdvosb', r.is_sdvosb);
  PERFORM assert_true('not is_wosb', NOT r.is_wosb);
  PERFORM assert_true('not is_8a', NOT r.is_8a);

  -- Keyword domains (JSONB)
  PERFORM assert_true('has keyword_domains', r.keyword_domains IS NOT NULL);
  PERFORM assert_true('has Cloud & Infrastructure domain',
    r.keyword_domains ? 'Cloud & Infrastructure');
  PERFORM assert_true('has Cybersecurity domain',
    r.keyword_domains ? 'Cybersecurity');

  -- Scoring thresholds
  PERFORM assert_equals('min_surface_score', '35', r.min_surface_score::text);
  PERFORM assert_equals('high_priority_score', '70', r.high_priority_score::text);

  -- Agency priorities
  PERFORM assert_true('has agency priorities', r.agency_priorities IS NOT NULL);
  PERFORM assert_equals('GSA is tier 1', '1', (r.agency_priorities->>'047'));
END $$;

-- =============================================================================
-- TEST GROUP 11: ACTIONS (POST /api/opportunities/[id]/actions)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 11: Actions';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  tid UUID := 'a1111111-1111-1111-1111-111111111111';
  cnt INT;
  r RECORD;
BEGIN
  -- Verify reactions aggregate correctly in the view
  SELECT thumbs_up, thumbs_down, comment_count, is_pinned
  INTO r
  FROM tenant_pipeline
  WHERE tenant_id = tid AND title LIKE '%Cloud Migration%';

  PERFORM assert_true('Cloud Migration thumbs_up = 2', r.thumbs_up = 2);
  PERFORM assert_true('Cloud Migration thumbs_down = 0', r.thumbs_down = 0);
  PERFORM assert_true('Cloud Migration is pinned', r.is_pinned);

  -- Cybersecurity has a comment
  SELECT comment_count INTO cnt
  FROM tenant_pipeline
  WHERE tenant_id = tid AND title LIKE '%Cybersecurity%';
  PERFORM assert_equals('Cybersecurity has 1 comment', '1', cnt::text);

  -- Action records have score context
  SELECT * INTO r FROM tenant_actions
  WHERE tenant_id = tid AND action_type = 'thumbs_up' LIMIT 1;
  PERFORM assert_true('action has score_at_action', r.score_at_action IS NOT NULL);
  PERFORM assert_true('action has agency_at_action', r.agency_at_action IS NOT NULL);
  PERFORM assert_true('action has type_at_action', r.type_at_action IS NOT NULL);
END $$;

-- =============================================================================
-- TEST GROUP 12: AUTH & ACCESS CONTROL
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 12: Auth & Access Control';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  sess_cnt INT;
  admin_id TEXT;
  alice_role TEXT;
  bob_tenant UUID;
BEGIN
  -- Sessions exist
  SELECT COUNT(*) INTO sess_cnt FROM sessions WHERE expires > NOW();
  PERFORM assert_equals('4 active sessions', '4', sess_cnt::text);

  -- Admin has correct role
  SELECT role INTO admin_id FROM users WHERE email = 'admin@govwin.test';
  PERFORM assert_equals('admin role', 'master_admin', admin_id);

  -- Alice is tenant_admin
  SELECT role INTO alice_role FROM users WHERE email = 'alice@techforward.test';
  PERFORM assert_equals('alice role', 'tenant_admin', alice_role);

  -- Bob belongs to TechForward
  SELECT tenant_id INTO bob_tenant FROM users WHERE email = 'bob@techforward.test';
  PERFORM assert_equals('bob tenant', 'a1111111-1111-1111-1111-111111111111', bob_tenant::text);

  -- Verify getTenantBySlug equivalent
  PERFORM assert_true('slug lookup works',
    EXISTS(SELECT 1 FROM tenants WHERE slug = 'techforward-solutions' AND status = 'active'));

  -- Verify verifyTenantAccess equivalent
  -- Alice can access TechForward
  PERFORM assert_true('alice can access TechForward',
    EXISTS(SELECT 1 FROM users WHERE id = 'user-alice-001' AND tenant_id = 'a1111111-1111-1111-1111-111111111111'));
  -- Carol cannot access TechForward
  PERFORM assert_true('carol cannot access TechForward',
    NOT EXISTS(SELECT 1 FROM users WHERE id = 'user-carol-001' AND tenant_id = 'a1111111-1111-1111-1111-111111111111'));
END $$;

-- =============================================================================
-- TEST GROUP 13: DEQUEUE JOB (Pipeline Worker)
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 13: Pipeline Worker — dequeue_job';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Reset the pending job that was dequeued during setup
  UPDATE pipeline_jobs SET status = 'pending', worker_id = NULL, started_at = NULL
  WHERE id = 'a0000004-0004-0004-0004-000000000004';

  -- Dequeue should pick up the pending job
  SELECT * INTO r FROM dequeue_job('e2e-test-worker');
  PERFORM assert_true('dequeue returns a job', r.id IS NOT NULL);
  PERFORM assert_equals('dequeued job source', 'sam_gov', r.source);
  PERFORM assert_equals('dequeued job status is now running', 'running', r.status);
  PERFORM assert_equals('dequeued job worker_id', 'e2e-test-worker', r.worker_id);

  -- Second dequeue should return empty
  SELECT * INTO r FROM dequeue_job('e2e-test-worker');
  PERFORM assert_true('second dequeue returns null id', r.id IS NULL);
END $$;

-- =============================================================================
-- TEST GROUP 14: SAM.gov DATA ALIGNMENT
-- Verify our opportunity data matches SAM.gov response structure
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 14: SAM.gov Data Alignment';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  r RECORD;
  raw JSONB;
BEGIN
  SELECT * INTO r FROM opportunities WHERE source_id = 'a3b4c5d6e7f8g9h0i1j2k3l4';
  raw := r.raw_data;

  -- Verify raw_data has the exact SAM.gov field names
  PERFORM assert_true('raw_data has noticeId', raw ? 'noticeId');
  PERFORM assert_true('raw_data has title', raw ? 'title');
  PERFORM assert_true('raw_data has solicitationNumber', raw ? 'solicitationNumber');
  PERFORM assert_true('raw_data has fullParentPathName', raw ? 'fullParentPathName');
  PERFORM assert_true('raw_data has fullParentPathCode', raw ? 'fullParentPathCode');
  PERFORM assert_true('raw_data has postedDate', raw ? 'postedDate');
  PERFORM assert_true('raw_data has type', raw ? 'type');
  PERFORM assert_true('raw_data has typeOfSetAside', raw ? 'typeOfSetAside');
  PERFORM assert_true('raw_data has responseDeadLine', raw ? 'responseDeadLine');
  PERFORM assert_true('raw_data has naicsCode', raw ? 'naicsCode');
  PERFORM assert_true('raw_data has uiLink', raw ? 'uiLink');
  PERFORM assert_true('raw_data has pointOfContact', raw ? 'pointOfContact');

  -- Verify our columns match the SAM.gov raw fields
  PERFORM assert_equals('source_id matches noticeId', raw->>'noticeId', r.source_id);
  PERFORM assert_equals('title matches', raw->>'title', r.title);
  PERFORM assert_equals('solicitation_number matches', raw->>'solicitationNumber', r.solicitation_number);
  PERFORM assert_equals('source_url matches uiLink', raw->>'uiLink', r.source_url);

  -- Verify agency mapping: fullParentPathName → agency
  PERFORM assert_true('agency maps from fullParentPathName',
    r.agency = raw->>'fullParentPathName');

  -- Verify NAICS: naicsCode (singular string) → naics_codes array
  PERFORM assert_true('naics_codes[1] matches naicsCode',
    r.naics_codes[1] = raw->>'naicsCode');

  -- Verify set-aside mapping
  PERFORM assert_equals('set_aside_code matches typeOfSetAside',
    raw->>'typeOfSetAside', r.set_aside_code);
  PERFORM assert_equals('set_aside_type matches typeOfSetAsideDescription',
    raw->>'typeOfSetAsideDescription', r.set_aside_type);
END $$;

-- =============================================================================
-- TEST GROUP 15: TENANT PIPELINE VIEW COLUMNS — match TypeScript interface
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' TEST GROUP 15: tenant_pipeline VIEW column alignment';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

DO $$
DECLARE
  cols TEXT[];
  expected_cols TEXT[] := ARRAY[
    -- TenantPipelineItem TypeScript interface fields (snake_case in DB)
    'tenant_opp_id', 'tenant_id', 'opportunity_id',
    'source', 'source_id', 'solicitation_number', 'title', 'description',
    'agency', 'agency_code', 'naics_codes', 'set_aside_type',
    'opportunity_type', 'posted_date', 'close_date',
    'estimated_value_min', 'estimated_value_max', 'source_url',
    'opp_status', 'total_score', 'llm_adjustment', 'llm_rationale',
    'matched_keywords', 'matched_domains', 'pursuit_status',
    'pursuit_recommendation', 'key_requirements', 'competitive_risks',
    'questions_for_rfi', 'priority_tier', 'scored_at',
    'days_to_close', 'deadline_status',
    'thumbs_up', 'thumbs_down', 'comment_count', 'is_pinned',
    'last_action_at', 'doc_count', 'amendment_count'
  ];
  col TEXT;
BEGIN
  SELECT array_agg(column_name::text ORDER BY ordinal_position)
  INTO cols
  FROM information_schema.columns
  WHERE table_name = 'tenant_pipeline';

  -- Check every expected column exists
  FOREACH col IN ARRAY expected_cols LOOP
    PERFORM assert_true(
      format('tenant_pipeline has column: %s', col),
      col = ANY(cols)
    );
  END LOOP;
END $$;

-- =============================================================================
-- SUMMARY
-- =============================================================================
DO $n$ BEGIN
RAISE NOTICE '═══════════════════════════════════════════════════════════';
RAISE NOTICE ' ALL TESTS PASSED';
RAISE NOTICE '═══════════════════════════════════════════════════════════';
END $n$;

-- Cleanup test functions
DROP FUNCTION IF EXISTS assert_equals(TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS assert_true(TEXT, BOOLEAN);
