import type { SeedPage } from './types';

/**
 * /features — hero + eight feature cards + closing CTA.
 *
 * Block fields mirror exactly what app/(marketing)/features/page.tsx reads, and
 * every value here is the verbatim in-code default the page falls back to, so
 * seeding this page leaves the public render unchanged. Hero accent: "win" =
 * award (font-prose italic), encoded as `*win*` and rendered via RichText.
 */
export const features: SeedPage = {
  pageKey: 'features',
  title: 'Features',
  blocks: [
    // Hero. Title accent: award ("win").
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Platform Features',
      title: 'Everything you need to *win*.',
      body: 'From opportunity discovery to submission-ready packages. Expert curation, isolated AI, and structured workflows — designed for small businesses pursuing federal R&D funding.',
      metadata: { accent: 'award' },
    },

    // Feature cards (8). title -> heading, body -> description.
    {
      section: 'items',
      displayOrder: 1,
      title: 'Source Scout',
      body: 'Automated monitoring of SAM.gov, SBIR.gov, and agency portals. Source Scout detects new opportunities, tracks changes to existing solicitations, and alerts your team before deadlines sneak up. Every source is HITL-verified by our expert curator.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 2,
      title: 'RFP Curation',
      body: 'Every solicitation is reviewed by a federal R&D expert with 25 years of experience. Topics are scored, categorized, and annotated with compliance requirements before they reach your pipeline. No AI hallucinations in your opportunity feed.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 3,
      title: 'Spotlight Feed',
      body: 'Your personalized opportunity feed, scored against your company profile. NAICS codes, keywords, agency priorities, and set-aside types all factor into your match score. Pin the opportunities that matter and pass on the rest.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 4,
      title: 'Proposal Workspace',
      body: 'A structured, stage-gated workspace for building federal proposals. Draft, review, and finalize with your team. Invite internal contributors and external partners with role-based, section-level access control.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 5,
      title: 'AI Drafting',
      body: 'Your tenant gets its own isolated AI team. Agents draft sections using your content library, past proposals, and the solicitation requirements. Every draft is clearly marked as AI-generated and requires human review before acceptance.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 6,
      title: 'Content Library',
      body: 'Build a reusable catalog of proven content atoms — technical descriptions, past performance narratives, capability statements, and more. Tag winning content, track usage across proposals, and let the AI find the right atom for each section.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 7,
      title: 'Compliance Engine',
      body: 'Automated compliance matrix tracking against solicitation requirements. Every requirement is mapped to a proposal section with status tracking. Know exactly what is addressed, what is partial, and what is missing before you submit.',
      metadata: {},
    },
    {
      section: 'items',
      displayOrder: 8,
      title: 'Export Package',
      body: 'Generate submission-ready document packages that meet federal formatting requirements. Page limits, font specifications, margin requirements, and section ordering are all enforced by the canvas rules engine.',
      metadata: {},
    },

    // Closing CTA. Button label/href in metadata.cta.
    {
      section: 'cta',
      displayOrder: 9,
      title: 'Ready to see it in action?',
      body: 'Join the founding cohort and get early access to every feature.',
      metadata: { cta: { label: 'Apply Now', href: '/apply' } },
    },
  ],
};
