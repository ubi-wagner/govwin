-- Consolidated, idempotent e2e fixtures for the driven Playwright suite.
-- Run AFTER scripts/seed_dev_accounts.mjs (needs the lighthouse tenant + admin).
--   PGPASSWORD=... psql -h 127.0.0.1 -U <role> -d <db> -f scripts/e2e_fixtures.sql
-- Re-runnable: upserts + resets solicitation status so fan-out/ranking can re-push.
DO $$
DECLARE
  lh uuid;
  admin_id uuid;
  collab_id uuid;
BEGIN
  SELECT id INTO lh FROM tenants WHERE slug = 'lighthouse';
  SELECT id INTO admin_id FROM users WHERE email = 'eric@lighthouse.com';
  IF lh IS NULL OR admin_id IS NULL THEN
    RAISE EXCEPTION 'seed_dev_accounts must run first (lighthouse tenant + admin missing)';
  END IF;

  -- Collaborator (partner_user) in Lighthouse.
  INSERT INTO users (email, name, role, tenant_id, password_hash, is_active, temp_password)
  VALUES ('collab@lighthouse.com', 'Collab One', 'partner_user', lh, crypt('CollabPass1', gen_salt('bf', 12)), true, false)
  ON CONFLICT (email) DO UPDATE SET role = 'partner_user', tenant_id = EXCLUDED.tenant_id,
    password_hash = EXCLUDED.password_hash, is_active = true, temp_password = false;
  SELECT id INTO collab_id FROM users WHERE email = 'collab@lighthouse.com';

  -- library.tenant: A1 tenant-shared (admin), A2 admin owner_only, A3 collab owner_only.
  INSERT INTO library_atoms (id, tenant_id, grain, title, content, status, visibility, owner_user_id, created_by, creator_kind) VALUES
    ('a1a1a1a1-0000-4000-8000-000000000001', lh, 'primitive', 'Shared Overview', 'shared', 'approved', 'tenant',     admin_id,  admin_id,  'admin'),
    ('a2a2a2a2-0000-4000-8000-000000000002', lh, 'primitive', 'Admin Private',   'apriv',  'approved', 'owner_only', admin_id,  admin_id,  'admin'),
    ('a3a3a3a3-0000-4000-8000-000000000003', lh, 'primitive', 'Collab Private',  'cpriv',  'approved', 'owner_only', collab_id, collab_id, 'collaborator')
  ON CONFLICT (id) DO NOTHING;

  -- lock.tenant + collab.tenant: two proposals + sections (own opportunities).
  INSERT INTO opportunities (id, source, source_id, title, is_active) VALUES
    ('d1000000-0000-4000-8000-00000000000a', 'manual_upload', 'fx-lock-opp',  'Lock Fixture Opp',  true),
    ('d1000000-0000-4000-8000-00000000000b', 'manual_upload', 'fx-collab-opp','Collab Fixture Opp', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked) VALUES
    ('d0000000-0000-4000-8000-000000000002', lh, 'd1000000-0000-4000-8000-00000000000a', 'Lock Fixture Proposal',  'draft', false),
    ('d2000000-0000-4000-8000-000000000001', lh, 'd1000000-0000-4000-8000-00000000000b', 'Collab Fixture Proposal', 'draft', false)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO proposal_sections (id, proposal_id, section_number, title, status, version, is_locked, content) VALUES
    ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', '1', 'Lock Fixture Section',  'in_progress', 1, false, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}'),
    ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', '1', 'Collab Fixture Section', 'in_progress', 1, false, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}')
  ON CONFLICT (id) DO NOTHING;
  -- lock/collab tests mutate the fixture sections; reset them so re-runs start clean.
  UPDATE proposal_sections SET is_locked = false, status = 'in_progress', completed_stage = NULL, accepted_by = NULL, accepted_at = NULL
   WHERE id IN ('d0000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002');

  -- matrix.tenant: an RFP chain (solicitation + 1 volume + 2 required items + topic).
  INSERT INTO opportunities (id, source, source_id, title, is_active) VALUES
    ('e0000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-matrix-topic', 'Autonomy SBIR Topic', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, solicitation_title, solicitation_number)
  VALUES ('c2000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'af', 'approved', 'Autonomy BAA', 'BAA-AF-2026')
  ON CONFLICT (id) DO NOTHING;
  UPDATE opportunities SET solicitation_id = 'c2000000-0000-4000-8000-000000000001' WHERE id = 'e0000000-0000-4000-8000-000000000001';
  INSERT INTO solicitation_volumes (id, solicitation_id, volume_number, volume_name)
  VALUES ('f0000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001', 1, 'Technical Volume')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO volume_required_items (volume_id, item_number, item_name, item_type, required, page_limit) VALUES
    ('f0000000-0000-4000-8000-000000000001', 1, 'Technical Approach', 'word_doc', true, 10),
    ('f0000000-0000-4000-8000-000000000001', 2, 'Key Personnel',      'word_doc', true, 5)
  ON CONFLICT DO NOTHING;
  -- matrix.tenant provisions from this topic; drop any prior proposal so it re-provisions.
  DELETE FROM proposal_compliance_matrix WHERE proposal_id IN (SELECT id FROM proposals WHERE opportunity_id = 'e0000000-0000-4000-8000-000000000001');
  DELETE FROM proposal_sections  WHERE proposal_id IN (SELECT id FROM proposals WHERE opportunity_id = 'e0000000-0000-4000-8000-000000000001');
  DELETE FROM proposal_artifacts WHERE proposal_id IN (SELECT id FROM proposals WHERE opportunity_id = 'e0000000-0000-4000-8000-000000000001');
  DELETE FROM proposals WHERE opportunity_id = 'e0000000-0000-4000-8000-000000000001';

  -- Two independent 2-topic AF SBIR solicitations: c3 for fanout, c4 for ranking
  -- (so the two push-based tests never contend for the same solicitation).
  -- fan-out (c3)
  INSERT INTO opportunities (id, source, source_id, title, is_active, program_type, agency) VALUES
    ('90000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-c3-umbrella', 'AF SBIR 26.1 BAA', false, 'sbir', 'Air Force')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, solicitation_title, solicitation_number)
  VALUES ('c3000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'af', 'approved', 'AF SBIR 26.1', 'SBIR-26.1')
  ON CONFLICT (id) DO NOTHING;
  UPDATE opportunities SET solicitation_id = 'c3000000-0000-4000-8000-000000000001' WHERE id = '90000000-0000-4000-8000-000000000001';
  INSERT INTO opportunities (id, source, source_id, title, is_active, solicitation_id, topic_number, topic_status, program_type, agency) VALUES
    ('91000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-c3-t1', 'Topic 1: Autonomy', false, 'c3000000-0000-4000-8000-000000000001', 'AF261-001', 'open', 'sbir', 'Air Force'),
    ('91000000-0000-4000-8000-000000000002', 'manual_upload', 'fx-c3-t2', 'Topic 2: Sensing',  false, 'c3000000-0000-4000-8000-000000000001', 'AF261-002', 'open', 'sbir', 'Air Force')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO solicitation_compliance (solicitation_id, topic_id, custom_variables)
  VALUES ('c3000000-0000-4000-8000-000000000001', NULL, jsonb_build_object('submission_format', jsonb_build_object('value', 'DSIP')))
  ON CONFLICT DO NOTHING;
  -- ranking (c4)
  INSERT INTO opportunities (id, source, source_id, title, is_active, program_type, agency) VALUES
    ('a0000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-c4-umbrella', 'AF SBIR 26.2 BAA', false, 'sbir', 'Air Force')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, solicitation_title, solicitation_number)
  VALUES ('c4000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'af', 'approved', 'AF SBIR 26.2', 'SBIR-26.2')
  ON CONFLICT (id) DO NOTHING;
  UPDATE opportunities SET solicitation_id = 'c4000000-0000-4000-8000-000000000001' WHERE id = 'a0000000-0000-4000-8000-000000000001';
  INSERT INTO opportunities (id, source, source_id, title, is_active, solicitation_id, topic_number, topic_status, program_type, agency) VALUES
    ('92000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-c4-t1', 'Topic 1: Nav', false, 'c4000000-0000-4000-8000-000000000001', 'AF262-001', 'open', 'sbir', 'Air Force'),
    ('92000000-0000-4000-8000-000000000002', 'manual_upload', 'fx-c4-t2', 'Topic 2: Comms', false, 'c4000000-0000-4000-8000-000000000001', 'AF262-002', 'open', 'sbir', 'Air Force')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO solicitation_compliance (solicitation_id, topic_id, custom_variables)
  VALUES ('c4000000-0000-4000-8000-000000000001', NULL, jsonb_build_object('submission_format', jsonb_build_object('value', 'DSIP')))
  ON CONFLICT DO NOTHING;

  -- Reset both push fixtures so fan-out/ranking can re-push on every run.
  UPDATE curated_solicitations SET status = 'approved', pushed_at = NULL
   WHERE id IN ('c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001');
  UPDATE opportunities SET is_active = false
   WHERE solicitation_id IN ('c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001');
  DELETE FROM tenant_bucket_scores WHERE opportunity_id IN (
    '90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002');
  DELETE FROM tenant_opportunity_cards WHERE opportunity_id IN (
    '90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002');
  DELETE FROM opportunity_bridge WHERE opportunity_id IN (
    '90000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002',
    'a0000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002');
  DELETE FROM tenant_bucket_scores WHERE bucket_id IN (SELECT id FROM tenant_spotlight_buckets WHERE tenant_id = lh AND name = 'AF SBIR');
  DELETE FROM tenant_spotlight_buckets WHERE tenant_id = lh AND name = 'AF SBIR';
END $$;
