-- 153_seed_scout_opportunities.sql
-- Durable seed for the Scout-ingested representative OPP set (DSIP + NSF + DOE),
-- captured after the SBIR BAA multi-topic grouping fix. Complements mig 140
-- (Foundation TVSF/intake demo OPPs) — together they reproduce the full OPP landscape.
--
-- Structure: 4 DSIP single-topic solicitations + NSF & DOE multi_topic BAAs
-- (each = 1 inactive umbrella opportunity + 2 topic opportunities linked via
-- solicitation_id). Staged at status='new' for the admin RFP Triage Queue.
-- Deterministic uuid5 ids; self-guarding (ON CONFLICT DO NOTHING) — safe to re-run.
-- (No BEGIN/COMMIT: the migrate runner wraps each file in its own transaction.)

-- ── Opportunities (umbrellas, topics, singles) ─────────────────────────────
INSERT INTO opportunities
  (id, source, source_id, title, agency, office, solicitation_number,
   program_type, close_date, description, topic_number, topic_branch,
   topic_status, tech_focus_areas, topic_metadata, set_aside_type,
   is_active, content_hash)
VALUES
  -- dsip: CBD241-001: AI-Driven Chemical Agent Detection [single]
  ('d04f4894-2e61-5c21-a4db-22d4e95c6c19', 'dsip', 'CBD241-001', 'CBD241-001: AI-Driven Chemical Agent Detection', 'Chemical and Biological Defense', 'CBD', 'DoD CSO 2024.1', 'cso', '2026-08-01T17:00:00+00:00'::timestamptz, 'CBD seeks AI/ML approaches for real-time chemical agent detection and classification from multi-sensor fusion data.', 'CBD241-001', 'CBD', 'open', '{"ai/ml","sensor","chemical agent","multi-sensor fusion"}'::text[], '{"solicType": "CSO"}'::jsonb, 'Small Business SBIR/STTR Program', true, '9daecafc7b84edf42f67e2844cb2763592e94e73fdf4154d398a23764cee2c2a'),
  -- dsip: AF241-001: Advanced Thermal Protection Materials [single]
  ('6984a10b-ae09-5646-b72b-30dc480fdc88', 'dsip', 'AF241-001', 'AF241-001: Advanced Thermal Protection Materials for Hypersonic Vehicles', 'Department of the Air Force', 'AF', 'DoD SBIR 2024.1', 'sbir_phase_1', '2026-06-15T17:00:00+00:00'::timestamptz, 'The Air Force seeks innovative thermal protection materials capable of withstanding temperatures exceeding 2000C during sustained hypersonic flight. Research areas include ultra-high temperature ceramics and carbon-carbon composites.', 'AF241-001', 'AF', 'open', '{"hypersonic","composite"}'::text[], '{"phase": "Phase I", "solicType": "SBIR"}'::jsonb, 'Small Business SBIR/STTR Program', true, '95a30c89f4110fc89cb85690d5b8d48e05f63595b870c25ec852d5b08567f79e'),
  -- dsip: N241-015: Compact Underwater Acoustic Sensor Arr [single]
  ('36c04859-0106-5706-b19c-fdbfe9feec03', 'dsip', 'N241-015', 'N241-015: Compact Underwater Acoustic Sensor Arrays', 'Department of the Navy', 'N', 'DoD SBIR 2024.1', 'sbir_phase_2', '2026-07-01T17:00:00+00:00'::timestamptz, 'The Navy seeks compact acoustic sensor array designs for submarine detection and classification using advanced piezoelectric materials and MEMS-based transducers.', 'N241-015', 'N', 'open', '{"sensor","acoustic","piezoelectric","mems"}'::text[], '{"phase": "Phase II", "solicType": "SBIR"}'::jsonb, 'Small Business SBIR/STTR Program', true, '72904c36a2e93e6b3f3ab1fb911628352ad6b58d408e8cfe76401f98de22ff3a'),
  -- dsip: A241-003: Autonomous Navigation for GPS-Denied E [single]
  ('fc9a1e2b-21bd-5fef-b354-5a2139779316', 'dsip', 'A241-003', 'A241-003: Autonomous Navigation for GPS-Denied Environments', 'Department of the Army', 'A', 'DoD STTR 2024.1', 'sttr_phase_1', '2026-06-30T16:00:00+00:00'::timestamptz, 'The Army seeks collaborative research on GPS-denied autonomous navigation using LiDAR, computer vision, and ML approaches for unmanned ground vehicles in complex terrain.', 'A241-003', 'A', 'open', '{"autonomous","lidar","unmanned","computer vision"}'::text[], '{"phase": "Phase I", "solicType": "STTR"}'::jsonb, 'Small Business SBIR/STTR Program', true, '0c24e13152ed8230c729615220adb30076dd5633bf04c329507c232132043f5b'),
  -- sbir_gov: DOE SBIR/STTR Phase I Release 2 (FY2026) [topic]
  ('cd3555c2-674a-5bc9-b745-9bb457b60ee0', 'sbir_gov', 'C53-26a', 'DOE SBIR/STTR Phase I Release 2 (FY2026)', 'Department of Energy', 'Office of Science', 'DE-FOA-0003241', 'sbir_phase_1', '2026-10-19T00:00:00+00:00'::timestamptz, 'The DOE SBIR/STTR program funds R&D aligned to DOE mission areas — clean energy, grid, fusion, materials.', 'C53-26a', 'Office of Science', 'open', '{}'::text[], '{"phase": "Phase I", "program": "SBIR", "embedded_topics": [{"description": "Long-duration storage chemistries + power-conversion systems for grid resilience.", "topic_title": "Grid-Scale Energy Storage", "topic_number": "C53-26a"}], "solicitation_year": "2026"}'::jsonb, NULL, true, 'b7cdc21b78fdf932819cd7cd27462482e721690c71be798a0ac53682a52a8820'),
  -- sbir_gov: DOE SBIR/STTR Phase I Release 2 (FY2026) [topic]
  ('4137280f-796a-5af1-88dc-7601b74de61c', 'sbir_gov', 'C60-26b', 'DOE SBIR/STTR Phase I Release 2 (FY2026)', 'Department of Energy', 'Office of Science', 'DE-FOA-0003241', 'sbir_phase_1', '2026-10-19T00:00:00+00:00'::timestamptz, 'The DOE SBIR/STTR program funds R&D aligned to DOE mission areas — clean energy, grid, fusion, materials.', 'C60-26b', 'Office of Science', 'open', '{}'::text[], '{"phase": "Phase I", "program": "SBIR", "embedded_topics": [{"description": "Plasma-facing materials + tritium-breeding blankets for fusion energy systems.", "topic_title": "Advanced Fusion Materials", "topic_number": "C60-26b"}], "solicitation_year": "2026"}'::jsonb, NULL, true, '74c0f8130762b51f93d9774588dc2a41b21b87bfa2606b8f2f045fab4cb525c3'),
  -- sbir_gov: DOE SBIR/STTR Phase I Release 2 (FY2026) [umbrella]
  ('ce374ac0-eafa-59e1-8cfd-d3ab643ef35d', 'sbir_gov', 'DE-FOA-0003241::umbrella', 'DOE SBIR/STTR Phase I Release 2 (FY2026)', 'Department of Energy', 'Office of Science', 'DE-FOA-0003241', 'sbir_phase_1', NULL, 'The DOE SBIR/STTR program funds R&D aligned to DOE mission areas — clean energy, grid, fusion, materials.', NULL, NULL, 'open', '{}'::text[], '{}'::jsonb, NULL, false, '679ae6da68a309fd47ae6cdb89e6d13fe9eb1d280af1dad15740e6d677353839'),
  -- sbir_gov: NSF SBIR/STTR Phase I (2026) [umbrella]
  ('60fba668-9d80-53a7-9703-6db7545459e4', 'sbir_gov', 'NSF 26-517::umbrella', 'NSF SBIR/STTR Phase I (2026)', 'National Science Foundation', 'Directorate for Technology, Innovation and Partnerships', 'NSF 26-517', 'sbir_phase_1', NULL, 'NSF''s SBIR/STTR (America''s Seed Fund) funds early-stage deep-tech R&D with commercial potential.', NULL, NULL, 'open', '{}'::text[], '{}'::jsonb, NULL, false, 'c0d0d76107bb093a39be3d329fa7cf866054e942dac66acd158f1ce50999bfeb'),
  -- sbir_gov: NSF SBIR/STTR Phase I (2026) [topic]
  ('f6b80c09-7258-5aa9-b272-f396b074bf61', 'sbir_gov', 'NSF-AI-26', 'NSF SBIR/STTR Phase I (2026)', 'National Science Foundation', 'Directorate for Technology, Innovation and Partnerships', 'NSF 26-517', 'sbir_phase_1', '2026-11-03T00:00:00+00:00'::timestamptz, 'NSF''s SBIR/STTR (America''s Seed Fund) funds early-stage deep-tech R&D with commercial potential.', 'NSF-AI-26', 'Directorate for Technology, Innovation and Partnerships', 'open', '{}'::text[], '{"phase": "Phase I", "program": "SBIR", "embedded_topics": [{"description": "Trustworthy ML, edge inference, and AI for scientific + commercial impact.", "topic_title": "Artificial Intelligence Technologies", "topic_number": "NSF-AI-26"}], "solicitation_year": "2026"}'::jsonb, NULL, true, 'aae106c45b343378dadada2916bf364d5e54c0d369e0ad13445f383b56c7f472'),
  -- sbir_gov: NSF SBIR/STTR Phase I (2026) [topic]
  ('646865bb-92ff-5d22-affc-574bfe2edf80', 'sbir_gov', 'NSF-EN-26', 'NSF SBIR/STTR Phase I (2026)', 'National Science Foundation', 'Directorate for Technology, Innovation and Partnerships', 'NSF 26-517', 'sbir_phase_1', '2026-11-03T00:00:00+00:00'::timestamptz, 'NSF''s SBIR/STTR (America''s Seed Fund) funds early-stage deep-tech R&D with commercial potential.', 'NSF-EN-26', 'Directorate for Technology, Innovation and Partnerships', 'open', '{}'::text[], '{"phase": "Phase I", "program": "SBIR", "embedded_topics": [{"description": "Grid-scale storage, power electronics, and energy-efficient computing.", "topic_title": "Advanced Energy & Power Efficiency", "topic_number": "NSF-EN-26"}], "solicitation_year": "2026"}'::jsonb, NULL, true, 'eb3ebb80adf15c36b1542aa914fb147c3d379e49d6df34bd4a357beb378a65dc')
ON CONFLICT (source, source_id) DO NOTHING;

-- ── Curated solicitations (triage rows, status='new') ──────────────────────
INSERT INTO curated_solicitations
  (id, opportunity_id, namespace, status, solicitation_type,
   solicitation_title, solicitation_number, full_text)
VALUES
  -- USAF:AF:SBIR:Phase1 [single]
  ('10a1f21d-7e7e-5330-8d86-b0bb19337dfe', '6984a10b-ae09-5646-b72b-30dc480fdc88', 'USAF:AF:SBIR:Phase1', 'new', 'single', NULL, NULL, 'The Air Force seeks innovative thermal protection materials capable of withstanding temperatures exceeding 2000C during sustained hypersonic flight. Research areas include ultra-high temperature ceramics and carbon-carbon composites.'),
  -- NAVY:N:SBIR:Phase2 [single]
  ('8f7c319a-1db3-5137-b9d8-6afcfcaf3be0', '36c04859-0106-5706-b19c-fdbfe9feec03', 'NAVY:N:SBIR:Phase2', 'new', 'single', NULL, NULL, 'The Navy seeks compact acoustic sensor array designs for submarine detection and classification using advanced piezoelectric materials and MEMS-based transducers.'),
  -- ARMY:A:STTR:Phase1 [single]
  ('573ab34f-3dcc-5e72-98ef-2ec19436b227', 'fc9a1e2b-21bd-5fef-b354-5a2139779316', 'ARMY:A:STTR:Phase1', 'new', 'single', NULL, NULL, 'The Army seeks collaborative research on GPS-denied autonomous navigation using LiDAR, computer vision, and ML approaches for unmanned ground vehicles in complex terrain.'),
  -- CHEMICAL AND BIOLOGICAL DEFENSE:CBD:CSO:Open [single]
  ('f1093426-fa62-5c5f-8ae9-f60219c0ef1b', 'd04f4894-2e61-5c21-a4db-22d4e95c6c19', 'CHEMICAL AND BIOLOGICAL DEFENSE:CBD:CSO:Open', 'new', 'single', NULL, NULL, 'CBD seeks AI/ML approaches for real-time chemical agent detection and classification from multi-sensor fusion data.'),
  -- DOE SBIR/STTR Phase I Release 2 (FY2026) [multi_topic]
  ('8e58bc07-1e26-5b3f-9f96-425fcba70c4b', 'ce374ac0-eafa-59e1-8cfd-d3ab643ef35d', 'DOE:SBIR:Phase1', 'new', 'multi_topic', 'DOE SBIR/STTR Phase I Release 2 (FY2026)', 'DE-FOA-0003241', 'The DOE SBIR/STTR program funds R&D aligned to DOE mission areas — clean energy, grid, fusion, materials.'),
  -- NSF SBIR/STTR Phase I (2026) [multi_topic]
  ('ffdb7243-a651-5c33-858f-9b4121f3f1b9', '60fba668-9d80-53a7-9703-6db7545459e4', 'NSF:SBIR:Phase1', 'new', 'multi_topic', 'NSF SBIR/STTR Phase I (2026)', 'NSF 26-517', 'NSF''s SBIR/STTR (America''s Seed Fund) funds early-stage deep-tech R&D with commercial potential.')
ON CONFLICT (id) DO NOTHING;

-- ── Topic → parent BAA back-links (opportunities.solicitation_id) ──────────
UPDATE opportunities SET solicitation_id = '8e58bc07-1e26-5b3f-9f96-425fcba70c4b' WHERE id = 'cd3555c2-674a-5bc9-b745-9bb457b60ee0' AND solicitation_id IS NULL;
UPDATE opportunities SET solicitation_id = '8e58bc07-1e26-5b3f-9f96-425fcba70c4b' WHERE id = '4137280f-796a-5af1-88dc-7601b74de61c' AND solicitation_id IS NULL;
UPDATE opportunities SET solicitation_id = 'ffdb7243-a651-5c33-858f-9b4121f3f1b9' WHERE id = 'f6b80c09-7258-5aa9-b272-f396b074bf61' AND solicitation_id IS NULL;
UPDATE opportunities SET solicitation_id = 'ffdb7243-a651-5c33-858f-9b4121f3f1b9' WHERE id = '646865bb-92ff-5d22-affc-574bfe2edf80' AND solicitation_id IS NULL;
