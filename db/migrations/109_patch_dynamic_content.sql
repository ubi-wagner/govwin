-- =============================================================================
-- Migration 109: patch dynamic CMS content (the /resources + /team docs)
-- -----------------------------------------------------------------------------
-- Audit fixes for the live dynamic content. The public site reads the ACTIVE
-- `content_pages` doc versions (cms_content is shadowed — see lib/cms.ts), so this
-- targets content_pages `metadata` (camelCase: externalUrl/featuredImage) and
-- blocks[0].body. Idempotent (jsonb_set to fixed values; guarded string replace).
--
-- 1. The 7 `resources-*` agency-portal cards (mig 034 tiles → mig 039 flipped to
--    `resource`, backfilled by 057) lost their outbound URL: metadata.externalUrl
--    is NULL, so each card's "Read More" dead-ends on an internal stub instead of
--    the government portal. And 6 hotlink Wikimedia agency seals as full-bleed
--    article heroes (403 on fetch; semantically wrong; no local fallback). Fix:
--    set externalUrl to the correct portal (dsip domain corrected to dodsbirsttr.mil)
--    and drop the seal images — matching the clean external-reference resources.
-- 2. `proposal-writing-tips`: excerpt promises "10 essential tips" but the body was
--    ~6 tips of prose. Regenerate the body as a clean 10-item list (the in-house
--    markdown renderer supports '- ' lists + **bold** + ## headings only).
-- 3. `what-is-sbir-sttr`: point the eligibility link at the dedicated eligibility
--    guide rather than the general primer (both exist; this is precision).
-- =============================================================================

-- 1. resources-* : external portal link + drop the hotlinked seal ----------------
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://www.sbir.gov'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-sbir'  AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://sam.gov'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-sam'   AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(metadata, '{externalUrl}', to_jsonb('https://www.grants.gov'::text))
  WHERE page_key = 'resources-grants' AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://www.dodsbirsttr.mil'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-dsip'  AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://seedfund.nsf.gov'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-nsf'   AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://www.darpa.mil/work-with-us'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-darpa' AND content_type = 'resource' AND status = 'active';
UPDATE content_pages SET metadata = jsonb_set(jsonb_set(metadata, '{externalUrl}', to_jsonb('https://science.osti.gov/sbir'::text)), '{featuredImage}', 'null'::jsonb)
  WHERE page_key = 'resources-doe'   AND content_type = 'resource' AND status = 'active';

-- 2. proposal-writing-tips : regenerate the body as a real 10-item list -----------
UPDATE content_pages
SET blocks = jsonb_set(blocks, '{0,body}', to_jsonb($tips$Writing a competitive SBIR Phase I proposal is a discipline, not an art. These ten practices separate funded proposals from the rest.

- **Lead with the problem, not the technology.** Open with a clear, agency-relevant problem statement tied to the solicitation's mission before you describe your solution.
- **Answer the topic, exactly.** Map every requirement in the solicitation to a section of your proposal — reviewers score against the topic, not your enthusiasm.
- **Follow the evaluation-criteria order.** Structure the narrative in the order the criteria are weighted so each point lands where the reviewer expects it.
- **Quantify the innovation.** Replace adjectives with numbers — performance gains, cost reductions, timelines — and cite the baseline you are beating.
- **Show feasibility, not a finished product.** Phase I funds risk reduction; present a credible plan with preliminary evidence, not a claim that it already works.
- **Address commercialization early.** Name the customer, the market, and the path to Phase II/III revenue — reviewers fund a trajectory, not a science project.
- **Make the work plan concrete.** Break Phase I into tasks with milestones, deliverables, and a schedule a reviewer can hold you to.
- **Right-size the team.** Show the PI and key personnel have the specific expertise the work requires, and justify any consultants or subawards.
- **Respect the format rules.** Page limits, margins, font, and required sections are pass/fail gates — a non-compliant proposal is rejected unread.
- **Revise for the reviewer, then submit early.** Have someone outside the project read it against the criteria, tighten every paragraph, and submit before the deadline crush.$tips$::text))
WHERE page_key = 'proposal-writing-tips' AND content_type = 'guide' AND status = 'active';

-- 3. what-is-sbir-sttr : point the eligibility link at the dedicated guide ---------
UPDATE content_pages
SET blocks = jsonb_set(blocks, '{0,body}', to_jsonb(replace((blocks -> 0 ->> 'body'), '/federal-rd-101', '/resources/sbir-sttr-eligibility-check')::text))
WHERE page_key = 'what-is-sbir-sttr' AND content_type = 'guide' AND status = 'active'
  AND (blocks -> 0 ->> 'body') LIKE '%/federal-rd-101%';
