import type { SeedPage } from './types';

/** /customers — "Track Record": hero + outcomes + agencies + customer-stories
 *  header/empty-state + CTA. The story grid is sourced from testimonial documents
 *  (content_pages docs) when they exist; until then the expert's record is the proof. */
export const customers: SeedPage = {
  pageKey: 'customers',
  title: 'Track Record',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Track Record',
      title: 'A 25-year record of *funded* outcomes.',
      body: "We're a new platform — but the expertise behind it isn't. Eric Wagner has spent 25 years turning innovative small businesses into federally funded ones. That playbook is what RFP Pipeline delivers as software.",
      metadata: { accent: 'award' },
    },

    { section: 'outcomes', displayOrder: 1, title: 'Hundreds of $M', body: 'in SBIR, STTR, BAA & OTA funding secured', metadata: {} },
    { section: 'outcomes', displayOrder: 2, title: '$270M', body: 'annual revenue at the A&D company Eric led', metadata: {} },
    { section: 'outcomes', displayOrder: 3, title: '22+', body: 'startups launched through OSU commercialization', metadata: {} },
    { section: 'outcomes', displayOrder: 4, title: 'Phase I–III', body: 'across DoD, NSF, DOE, DARPA & more', metadata: {} },

    {
      section: 'agencies',
      displayOrder: 5,
      excerpt: 'Funded across',
      title: 'Agencies our expert has won with.',
      metadata: { items: ['DoD', 'NSF', 'DOE', 'DARPA', 'DOT', 'AFWERX'] },
    },

    { section: 'testimonials-header', displayOrder: 6, title: 'From the founding cohort', metadata: {} },

    {
      section: 'empty',
      displayOrder: 7,
      title: 'New platform, proven expertise.',
      body: 'Our first customers are onboarding now. Their results will appear here as they win.',
      metadata: {},
    },

    {
      section: 'cta',
      displayOrder: 8,
      title: 'Put that track record to work for you.',
      body: 'Apply to the founding cohort and get the same expertise behind your next proposal.',
      metadata: { ctaLabel: 'Apply Now', ctaHref: '/apply' },
    },
  ],
};
