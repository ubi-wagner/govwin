import type { SeedPage } from './types';

/** /customers — page chrome (hero / empty-state / CTA). The testimonial grid is
 *  sourced from testimonial documents (content_pages docs), not these blocks. */
export const customers: SeedPage = {
  pageKey: 'customers',
  title: 'Customers',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Customers',
      title: 'Trusted by *federal innovators*.',
      body: 'Hear from the small businesses building their federal R&D pipeline with us.',
      metadata: { accent: 'brand-500' },
    },
    {
      section: 'empty',
      displayOrder: 1,
      title: 'Customer stories coming soon.',
      body: 'We are onboarding our founding cohort. Check back for their stories.',
      metadata: {},
    },
    {
      section: 'cta',
      displayOrder: 2,
      title: 'Join our founding cohort.',
      body: 'Be among the first small businesses to build a federal R&D pipeline powered by AI.',
      metadata: { ctaLabel: 'Apply Now', ctaHref: '/apply' },
    },
  ],
};
