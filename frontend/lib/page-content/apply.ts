import type { SeedPage } from './types';

/** /apply — founding-cohort hero + application form (form fields are client-side). */
export const apply: SeedPage = {
  pageKey: 'apply',
  title: 'Apply',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Founding Cohort Application',
      title: 'Apply to join the founding cohort',
      body: "We're accepting 20 small businesses into our initial cohort. The application itself is the qualifier — serious applicants pursuing SBIR, STTR, BAA, OTA, or similar federal R&D funding will be reviewed by Eric within 72 hours.",
      metadata: {
        before_you_apply_label: 'Before you apply:',
        before_you_apply:
          ' This is a paid service ($499/month after acceptance). There is no free trial. If accepted, you’ll be invited to onboard, register your admin, upload foundational company documents, and activate your subscription via Stripe.',
      },
    },
  ],
};
