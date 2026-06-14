import type { SeedPage } from './types';

/**
 * /(marketing) homepage — every section is an editable block.
 *
 * Block fields mirror exactly what app/(marketing)/page.tsx reads, and every
 * value here is the verbatim in-code default the page falls back to, so seeding
 * this page leaves the public render byte-for-byte unchanged. Accent words in
 * headings use `*phrase*` (+ `\n` for line breaks) via RichText; the chosen
 * accent color is noted per heading below.
 */
export const homepage: SeedPage = {
  pageKey: 'homepage',
  title: 'Home',
  blocks: [
    // Hero. Title accent: brand-500 ("not").
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'AI + Expert · From Application to Submission',
      title: 'A proposal\nengine, *not* a\nproposal\ngamble.',
      body: 'Win non-dilutive federal R&D funding — without burning a month of payroll on every submission. We pair 25 years of hands-on expertise with isolated, company-specific AI, so you pursue more opportunities and submit better proposals. (SBIR, STTR, BAA, OTA.)',
      metadata: {
        primary_cta: { label: 'Apply for Founding Cohort', href: '/apply' },
        secondary_cta: { label: 'See why it works', href: '/value' },
        note: 'Platform launches July 2026. 20 founding-cohort seats. Applications reviewed weekly.',
      },
    },

    // Stats bar (4).
    { section: 'stats', displayOrder: 1, title: '4+', body: 'Federal Sources Ingested' },
    { section: 'stats', displayOrder: 2, title: '72h', body: 'Expert-Review SLA' },
    { section: 'stats', displayOrder: 3, title: '20', body: 'Founding Cohort Cap' },
    { section: 'stats', displayOrder: 4, title: '25+', body: 'Years of Fed R&D Expertise' },

    // Value band — newcomer hook + ROI anchor.
    {
      section: 'value-band',
      displayOrder: 5,
      excerpt: 'New to federal R&D?',
      body: 'There are billions a year in non-dilutive federal R&D funding — grant-like money you keep your equity and IP on. Most qualifying small businesses never apply. We make it accessible.',
      metadata: {
        roiLabel: 'The math',
        roi: 'Replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $299/mo and a flat $999 / $1,999 per proposal. No success fee.',
      },
    },

    // How-it-works teaser header (the full 6-stage journey lives on /how-it-works).
    {
      section: 'stages-header',
      displayOrder: 6,
      excerpt: 'How it works',
      title: 'From application to submitted *proposal* — one workflow.',
    },

    // Pricing hero. Title accent: citrus ("portals").
    {
      section: 'pricing-hero',
      displayOrder: 12,
      excerpt: 'How We Charge',
      title: 'One subscription.\nPer-proposal *portals*.',
      body: 'Priced and built specifically for small businesses, not enterprise. Low cost subscription provides find and remind capabilities. Per proposal pricing ensures you only pay for builds you choose.',
    },

    // Pricing cards (3).
    { section: 'pricing', displayOrder: 13, excerpt: 'Required · Monthly', title: 'Spotlight Subscription', body: 'Daily ingestion. AI-powered ranking against your profile. Expert-curated compliance matrix. Deadline alerts. 15 min of Ask-the-Expert each month (rolls over).', metadata: { price: '$299', period: '/mo', note: 'Required to purchase any portal' } },
    { section: 'pricing', displayOrder: 14, excerpt: 'Per-Proposal', title: 'Phase I — Like Effort', body: 'SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form. 72-hour curation by Expert. Stage-gated workspace. Custom AI drafting.', metadata: { price: '$999', period: 'per proposal' } },
    { section: 'pricing', displayOrder: 15, excerpt: 'Per-Proposal', title: 'Phase II — Like Effort', body: 'SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20-50+ page tech volumes. Commercialization plans included.', metadata: { price: '$1,999', period: 'per proposal' } },

    // Expert gate. Title accent: brand-500 ("verifies").
    {
      section: 'expert-gate',
      displayOrder: 16,
      excerpt: 'The Expert Gate',
      title: 'The AI drafts.\nThe Expert *verifies*.\nYour Team collaborates.',
      body: 'The Expert personally reviews every application, curates every solicitation released into your Spotlight, and is available for pre-submission review. As the service scales, additional experts will join the roster — you will always know which expert reviewed your pipeline.',
      metadata: {
        expert_name: 'Eric Wagner',
        bullets: [
          '72-hour application & curation SLA',
          '15 min of strategy calls per month',
          'Agency-specific: DoD, NSF, DOE, DARPA, DOT',
          'Additional time on demand — $500/hr',
        ],
      },
    },

    // Latest Insights header. Title accent: brand-500 ("blog").
    {
      section: 'insights-header',
      displayOrder: 17,
      excerpt: 'Latest Insights',
      title: 'From the *blog*.',
    },

    // Quote.
    {
      section: 'quote',
      displayOrder: 18,
      body: 'Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier.',
      excerpt: 'Why No Free Trial',
    },

    // Final CTA. Title accent: citrus ("first").
    {
      section: 'cta',
      displayOrder: 19,
      excerpt: 'Applications Open · Launch July 2026',
      title: 'Apply today. Draft your *first*\nproposal on launch day.',
      metadata: {
        cta: { label: 'Apply Now', href: '/apply' },
        secondary: { label: 'New to federal R&D? Start here', href: '/federal-rd-101' },
        footer: { role: 'Founder & Architect', name: 'Eric Wagner', email: 'eric@rfppipeline.com' },
      },
    },
  ],
};
