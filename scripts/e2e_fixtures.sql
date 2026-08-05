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
    ('d1000000-0000-4000-8000-00000000000b', 'manual_upload', 'fx-collab-opp','Collab Fixture Opp', true),
    ('d1000000-0000-4000-8000-00000000000c', 'manual_upload', 'fx-fullloop-opp','Fullloop Fixture Opp', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked) VALUES
    ('d0000000-0000-4000-8000-000000000002', lh, 'd1000000-0000-4000-8000-00000000000a', 'Lock Fixture Proposal',  'draft', false),
    ('d2000000-0000-4000-8000-000000000001', lh, 'd1000000-0000-4000-8000-00000000000b', 'Collab Fixture Proposal', 'draft', false),
    ('d3000000-0000-4000-8000-000000000001', lh, 'd1000000-0000-4000-8000-00000000000c', 'Fullloop Fixture Proposal', 'draft', false)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO proposal_sections (id, proposal_id, section_number, title, status, version, is_locked, content) VALUES
    ('d0000000-0000-4000-8000-000000000003', 'd0000000-0000-4000-8000-000000000002', '1', 'Lock Fixture Section',  'in_progress', 1, false, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}'),
    ('d2000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', '1', 'Collab Fixture Section', 'in_progress', 1, false, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}'),
    ('d3000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000001', '1', 'Fullloop Section', 'in_progress', 1, false, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}')
  ON CONFLICT (id) DO NOTHING;
  -- lock/collab tests mutate the fixture sections; reset them so re-runs start clean.
  UPDATE proposal_sections SET is_locked = false, status = 'in_progress', completed_stage = NULL, accepted_by = NULL, accepted_at = NULL
   WHERE id IN ('d0000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000002');
  -- fullloop.tenant drives the WHOLE greenfield loop (upload→primitive→select→lock→return);
  -- reset its section fully (unlock + clear the selector-recorded sourceAtomIds + a vol so the
  -- returned derivative is tagged) so each run starts clean regardless of prior selections.
  UPDATE proposal_sections
     SET is_locked = false, status = 'in_progress', completed_stage = NULL, accepted_by = NULL, accepted_at = NULL,
         section_type = 'technical',
         content = '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"seed"}}]}',
         meta = coalesce(meta, '{}'::jsonb) - 'sourceAtomIds'
   WHERE id = 'd3000000-0000-4000-8000-000000000002';
  -- atomloop.tenant: the lock section carries source-atom lineage (A1) + a vol, so on
  -- lock the returned derivative atom is tagged (vol=technical) and links derived_from A1
  -- (the "child that can become a parent" — closing the atomize→mold→draft→library loop).
  UPDATE proposal_sections
     SET section_type = 'technical',
         meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('sourceAtomIds', jsonb_build_array('a1a1a1a1-0000-4000-8000-000000000001'))
   WHERE id = 'd0000000-0000-4000-8000-000000000003';
  -- fullloop/atomloop LEAK atoms every run: the uploaded reference ('approach.md') + primitive
  -- ('Uploaded Technical Approach'), and the returned derivative (source='download_derivative',
  -- titled after the section). Left to accumulate, the extra vol=technical primitives push the
  -- freshly-uploaded one out of the mold selector's top-N and fullloop line 69 flakes. Delete ONLY
  -- those leaked atoms — never the A1/A2/A3 fixtures. atom_tags/_lineage/_members cascade on delete.
  DELETE FROM library_atoms WHERE tenant_id = lh AND title IN ('Uploaded Technical Approach', 'approach.md');
  DELETE FROM library_atoms WHERE tenant_id = lh AND source = 'download_derivative'
    AND title IN ('Fullloop Section', 'Lock Fixture Section', 'Collab Fixture Section');

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

  -- Reset both push fixtures so fan-out/ranking can re-push on every run. push now REQUIRES
  -- a non-empty spotlight_summary (mig 107 — the first-pass matching context) before it will
  -- release into the pipeline, so set it here (also feeds ranking's bucket text-match).
  UPDATE curated_solicitations
     SET status = 'approved', pushed_at = NULL,
         spotlight_summary = 'Air Force SBIR — agencies: Air Force; program type: SBIR. Autonomy, sensing, navigation, and communications topics matching the AF SBIR spotlight bucket.'
   WHERE id IN ('c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001');
  -- push also date-guards: EVERY opp/topic that becomes a card must carry a close_date
  -- (AUTOMATION_POLICY_DESIGN ⑤). Set an estimated future close on the umbrella + topics.
  UPDATE opportunities SET is_active = false,
         close_date = COALESCE(close_date, now() + interval '60 days'),
         dates_estimated = true
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

  -- zzaudit.tenant (drive): the "Customer Interest" panel on /admin/rfp-curation/<sol>
  -- reads the live tenant_opportunity_cards spine — Lighthouse must have a PINNED card
  -- under solicitation 6c8571ca so the panel surfaces "Lighthouse". (opp first, then the
  -- solicitation, then point the opp at it — opportunities.solicitation_id is an FK.)
  INSERT INTO opportunities (id, source, source_id, title, is_active, topic_number, close_date, dates_estimated) VALUES
    ('6c000000-0000-4000-8000-000000000001', 'manual_upload', 'fx-audit-topic', 'Autonomy Interest Topic', true, 'AUD-001', now() + interval '45 days', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO curated_solicitations (id, opportunity_id, namespace, status, solicitation_title, solicitation_number, spotlight_summary)
  VALUES ('6c8571ca-292f-41db-9762-c5055a06e71e', '6c000000-0000-4000-8000-000000000001', 'af', 'approved', 'Autonomy Interest BAA', 'BAA-AUD-2026', 'Autonomy interest solicitation — customer-interest audit fixture.')
  ON CONFLICT (id) DO NOTHING;
  UPDATE opportunities SET solicitation_id = '6c8571ca-292f-41db-9762-c5055a06e71e' WHERE id = '6c000000-0000-4000-8000-000000000001';
  INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage, is_pinned, pinned_at) VALUES
    (lh, '6c000000-0000-4000-8000-000000000001', jsonb_build_object('title', 'Autonomy Interest Topic', 'opportunityId', '6c000000-0000-4000-8000-000000000001'), 1, 'open', 'open', true, now())
  ON CONFLICT (tenant_id, opportunity_id) DO UPDATE SET is_pinned = true, pinned_at = now(), lifecycle_status = 'open';
  -- (zzaudit's 2nd test creates 'audit-proof-co' but makes NO assertion — a screenshot drive —
  --  so it passes whether or not the company already exists. We deliberately do NOT delete it:
  --  the created tenant owns users/memberships/cards/atoms, and cascading that here is both
  --  unnecessary and FK-fragile.)

  -- zzblockers.tenant (drive): (t1) opp 223f57f4 — a Lighthouse opp WITHOUT a portal that
  -- the RFP-admin free-portal form approves into guardrails_pending; drop any portal left by
  -- a prior run so it re-approves clean. (t3) a submitted+locked proposal so the post-submit
  -- "Unlock for Edit" button renders. (member@ubihere is seeded by seed_dev_accounts.)
  INSERT INTO opportunities (id, source, source_id, title, is_active, close_date, dates_estimated) VALUES
    ('223f57f4-d6c4-47d6-8795-2f0c46a61c06', 'manual_upload', 'fx-freeportal-opp', 'Free Portal Fixture Opp', true, now() + interval '50 days', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO tenant_opportunity_cards (tenant_id, opportunity_id, card, bridge_version, lifecycle_status, submission_stage) VALUES
    (lh, '223f57f4-d6c4-47d6-8795-2f0c46a61c06', jsonb_build_object('title', 'Free Portal Fixture Opp', 'opportunityId', '223f57f4-d6c4-47d6-8795-2f0c46a61c06'), 1, 'open', 'open')
  ON CONFLICT (tenant_id, opportunity_id) DO NOTHING;
  -- drop any portal a prior t1 run approved so it re-approves clean (FK-safe: shadow_admin_grants
  -- references proposal_portals; clear grants first). purchases has no unique on (tenant,opp) so a
  -- re-approve's $0 purchase never conflicts — leave those (audit trail).
  DELETE FROM shadow_admin_grants WHERE portal_id IN (
    SELECT id FROM proposal_portals WHERE opportunity_id = '223f57f4-d6c4-47d6-8795-2f0c46a61c06' AND tenant_id = lh);
  DELETE FROM proposal_portals WHERE opportunity_id = '223f57f4-d6c4-47d6-8795-2f0c46a61c06' AND tenant_id = lh;

  INSERT INTO opportunities (id, source, source_id, title, is_active) VALUES
    ('d1000000-0000-4000-8000-00000000000d', 'manual_upload', 'fx-submitted-opp', 'Submitted Fixture Opp', true)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO proposals (id, tenant_id, opportunity_id, title, stage, is_locked, lock_count) VALUES
    ('a1b2c3d4-0000-4000-8000-000000000001', lh, 'd1000000-0000-4000-8000-00000000000d', 'Submitted Fixture Proposal', 'submitted', true, 1)
  ON CONFLICT (id) DO UPDATE SET stage = 'submitted', is_locked = true, lock_count = 1;
  INSERT INTO proposal_sections (id, proposal_id, section_number, title, status, version, is_locked, content) VALUES
    ('a1b2c3d4-0000-4000-8000-000000000002', 'a1b2c3d4-0000-4000-8000-000000000001', '1', 'Submitted Section', 'in_progress', 1, true, '{"version":1,"nodes":[{"id":"n1","type":"text_block","content":{"text":"final"}}]}')
  ON CONFLICT (id) DO NOTHING;
END $$;
