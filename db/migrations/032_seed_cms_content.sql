INSERT INTO cms_content (slug, title, content_type, body, excerpt, author, tags, published, published_at, external_url, display_order, metadata)
VALUES
  ('sbir-overview', 'What is SBIR?', 'resource',
   'The Small Business Innovation Research (SBIR) program is a highly competitive program that encourages domestic small businesses to engage in Federal Research/Research and Development (R/R&D) with the potential for commercialization. Through a competitive awards-based program, SBIR enables small businesses to explore their technological potential and provides the incentive to profit from its commercialization.',
   'A comprehensive overview of the SBIR program for first-time applicants.',
   'RFP Pipeline', ARRAY['sbir','getting-started','overview'], true, now(),
   'https://www.sbir.gov/about', 1, '{}'::jsonb),

  ('dsip-guide', 'How to Use DSIP', 'guide',
   'The Defense SBIR/STTR Innovation Portal (DSIP) is the single entry point for small businesses to submit proposals for DoD SBIR and STTR topics. This guide walks you through account creation, topic search, proposal upload, and common submission pitfalls.',
   'Step-by-step guide to navigating DSIP for topic discovery and submission.',
   'RFP Pipeline', ARRAY['dsip','tutorial','submission'], true, now(),
   'https://www.dodsbirsttr.mil', 2, '{}'::jsonb),

  ('proposal-writing-tips', 'SBIR Proposal Writing Tips', 'guide',
   'Writing a competitive SBIR proposal requires a structured approach. Start with a clear problem statement tied to the agency''s mission. Quantify your innovation''s impact. Address commercialization potential early. Follow the evaluation criteria order in your narrative. Keep technical jargon accessible to reviewers who may not be domain experts. Budget should be realistic and justified line by line.',
   '10 essential tips for writing winning SBIR Phase I proposals.',
   'Eric Wagner', ARRAY['proposal-writing','tips','phase-1'], true, now(),
   NULL, 3, '{}'::jsonb)
ON CONFLICT (slug) DO NOTHING;
