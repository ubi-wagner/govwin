-- =============================================================================
-- Migration 059: seed 3 launch resource articles into content_pages
-- -----------------------------------------------------------------------------
-- The /resources list reads active resource/guide/blog_post documents. Ship the
-- launch with three real, on-brand articles (newcomer primer, the ROI story, and
-- an eligibility check). Idempotent per (content_type, page_key). Markdown bodies
-- are dollar-quoted so apostrophes need no escaping.
-- =============================================================================

INSERT INTO content_pages (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by, published_at, created_at)
SELECT 'what-is-sbir-sttr', 'guide', 1, 'active',
  'What Is SBIR/STTR? A 5-Minute Primer for First-Time Applicants',
  jsonb_build_array(jsonb_build_object(
    'section', 'body',
    'title', 'What Is SBIR/STTR? A 5-Minute Primer for First-Time Applicants',
    'body', $md$If you run an innovative small business, there is a good chance the U.S. government will help fund your R&D — without taking a single share of equity.

## The programs

**SBIR** (Small Business Innovation Research) and **STTR** (Small Business Technology Transfer) are federal programs that award **non-dilutive** funding to small businesses doing high-risk, high-reward research. Eleven federal agencies participate — including the Department of Defense, NSF, NASA, the Department of Energy, and NIH — and together they award **billions of dollars every year**. STTR works like SBIR but requires you to partner with a research institution, such as a university.

## Non-dilutive means you keep your company

Unlike venture capital, this money is closer to a grant. You do not give up equity, board seats, or control, and you keep your IP. For a founder, that is the difference between owning your company and renting it back from investors.

## The three phases

- **Phase I** — proof of concept. Smaller awards (often under $250K) to show feasibility.
- **Phase II** — full R&D. Larger awards (often $1M and up) to build the thing.
- **Phase III** — commercialization. Move to market, often with follow-on government contracts.

## Why most companies never apply

The opportunities are scattered across dozens of agency portals. The solicitations are dense, and the compliance rules are unforgiving — miss a page limit or a required section and your proposal is rejected unread. Most great companies simply do not have the time, so they leave the money on the table.

That is the problem RFP Pipeline was built to solve: expert-curated opportunities and AI-drafted, compliance-checked proposals, so a small team can actually compete.

Not sure whether you qualify? See the [eligibility checklist](/federal-rd-101).$md$,
    'excerpt', $ex$SBIR and STTR award billions a year in non-dilutive R&D funding to small businesses. Here is what the programs are, the three phases, and why most companies never apply.$ex$,
    'metadata', '{}'::jsonb)),
  jsonb_build_object('tags', jsonb_build_array('SBIR','STTR','Getting Started'),
    'excerpt', $ex$SBIR and STTR award billions a year in non-dilutive R&D funding to small businesses. Here is what the programs are, the three phases, and why most companies never apply.$ex$,
    'author', 'Eric Wagner', 'generated', false),
  'Seeded launch article (migration 059)', 'system', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM content_pages WHERE page_key='what-is-sbir-sttr' AND content_type='guide');

INSERT INTO content_pages (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by, published_at, created_at)
SELECT 'the-cost-of-chasing-federal-rd', 'resource', 1, 'active',
  'The Real Cost of Chasing Federal R&D the Old Way',
  jsonb_build_array(jsonb_build_object(
    'section', 'body',
    'title', 'The Real Cost of Chasing Federal R&D the Old Way',
    'body', $md$Federal R&D funding is non-dilutive and abundant. So why is it so expensive to pursue? Because the traditional stack is built for big primes, not small businesses.

## What the old way actually costs

- **Opportunity monitoring services** can run **$5,000 a month** — and most just send a keyword-matched feed with no human judgment.
- **Proposal consultants** typically take **10% of your award**. A $1M Phase II means **$100,000** out of your check — or a heavy monthly retainer instead.
- A **dedicated BD hire** is **$90,000 to $150,000 a year** fully loaded, plus the months it takes to find and ramp them.
- And the hidden cost: your **best engineer pulled off the product** to write proposals.

## The math, re-priced

RFP Pipeline replaces that entire stack:

- Expert-curated monitoring for **$299/month** — not $5,000.
- Proposal builds for a **flat $999 (Phase I) or $1,999 (Phase II)** — no success fee, ever. On a single Phase II award, you keep the $100,000 a consultant would have taken.
- Your business-development department, without the headcount.

## More shots on goal

Lower cost per proposal means you can submit **more** proposals. More submissions — each one higher quality as your library and AI improve — compounds into more non-dilutive capital over time.

See the [full pricing](/pricing), or [why it works](/value).$md$,
    'excerpt', $ex$Opportunity monitoring at $5,000/mo. Consultants taking 10% of your award. A BD hire at six figures. Here is the real cost of chasing federal R&D — and the math, re-priced.$ex$,
    'metadata', '{}'::jsonb)),
  jsonb_build_object('tags', jsonb_build_array('Pricing','ROI','Strategy'),
    'excerpt', $ex$Opportunity monitoring at $5,000/mo. Consultants taking 10% of your award. A BD hire at six figures. Here is the real cost of chasing federal R&D — and the math, re-priced.$ex$,
    'author', 'Eric Wagner', 'generated', false),
  'Seeded launch article (migration 059)', 'system', now() - interval '1 day', now() - interval '1 day'
WHERE NOT EXISTS (SELECT 1 FROM content_pages WHERE page_key='the-cost-of-chasing-federal-rd' AND content_type='resource');

INSERT INTO content_pages (page_key, content_type, version_no, status, title, blocks, metadata, audit_note, created_by, published_at, created_at)
SELECT 'sbir-sttr-eligibility-check', 'guide', 1, 'active',
  'Are You Eligible for SBIR/STTR? A Quick Check',
  jsonb_build_array(jsonb_build_object(
    'section', 'body',
    'title', 'Are You Eligible for SBIR/STTR? A Quick Check',
    'body', $md$Before you spend a minute on a proposal, make sure you can play. SBIR/STTR eligibility is straightforward — here is the quick version.

## You generally qualify if you are…

- A **U.S.-based, for-profit small business** with **500 or fewer employees**.
- **More than 50% owned and controlled** by U.S. individuals (or by other small businesses that are U.S.-owned).
- Performing the **R&D work in the United States**.
- Doing genuinely **innovative R&D** — not routine engineering or off-the-shelf integration.

For **STTR** specifically, you also partner with a **nonprofit research institution** (such as a university) that performs a portion of the work.

## A few common disqualifiers

- Majority ownership by another company, or by a venture fund, can complicate eligibility — the rules vary by agency.
- For SBIR, the principal investigator generally must be primarily employed by your company at the time of award.

## Registrations you will need

To be paid, you will need to register in **SAM.gov** and set up the relevant agency portal accounts (such as **SBIR.gov** and the DoD **DSIP**). These take time — start early.

## Not sure?

Eligibility has edge cases, and agencies differ. The fastest way to find out is to [apply](/apply) — Eric reviews every application personally and will tell you honestly whether you are a fit before you pay anything.$md$,
    'excerpt', $ex$SBIR/STTR eligibility in plain English: who qualifies, common disqualifiers, and the registrations you will need before you can be paid.$ex$,
    'metadata', '{}'::jsonb)),
  jsonb_build_object('tags', jsonb_build_array('SBIR','STTR','Eligibility'),
    'excerpt', $ex$SBIR/STTR eligibility in plain English: who qualifies, common disqualifiers, and the registrations you will need before you can be paid.$ex$,
    'author', 'Eric Wagner', 'generated', false),
  'Seeded launch article (migration 059)', 'system', now() - interval '2 days', now() - interval '2 days'
WHERE NOT EXISTS (SELECT 1 FROM content_pages WHERE page_key='sbir-sttr-eligibility-check' AND content_type='guide');
