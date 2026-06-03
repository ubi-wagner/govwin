import type { SeedPage } from './types';

/** /team — page chrome (hero / empty-state / CTA). The member grid is sourced
 *  from team_member documents (content_pages docs), not these blocks. */
export const team: SeedPage = {
  pageKey: 'team',
  title: 'Team',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Team',
      title: 'Built by *practitioners*.',
      body: '25 years of federal R&D experience, translated into software.',
      metadata: { accent: 'brand-500' },
    },
    {
      section: 'empty',
      displayOrder: 1,
      title: 'Team page coming soon.',
      body: 'We are finalizing our team profiles.',
      metadata: {},
    },
    {
      section: 'cta',
      displayOrder: 2,
      title: 'Work with our team.',
      body: 'Apply for our founding cohort and get direct access to federal R&D veterans.',
      metadata: { ctaLabel: 'Apply Now', ctaHref: '/apply' },
    },
  ],
};
