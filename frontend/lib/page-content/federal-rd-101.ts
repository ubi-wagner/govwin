import type { SeedPage } from './types';

/** /federal-rd-101 — the newcomer on-ramp: what federal R&D funding is, whether
 *  you qualify, and a soft waitlist capture. Mirrors the in-code defaults in
 *  app/(marketing)/federal-rd-101/page.tsx. */
export const federalRd101: SeedPage = {
  pageKey: 'federal-rd-101',
  title: 'Federal R&D 101',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Federal R&D 101',
      title: "There's *non-dilutive* money for your R&D. You probably qualify.",
      body: 'Federal agencies hand out billions every year to help small businesses fund innovative R&D — grant-like money you keep your equity on. Here’s what it is, whether it’s for you, and how to start without a BD department.',
      metadata: { accent: 'award' },
    },

    { section: 'what', displayOrder: 1, title: "It's non-dilutive.", body: "Unlike venture capital, federal R&D funding doesn't take equity. You keep ownership of your company and your IP — it's closer to a grant than an investment.", metadata: {} },
    { section: 'what', displayOrder: 2, title: "It's billions a year.", body: 'Federal agencies set aside billions every year for small-business R&D through programs like SBIR and STTR — across defense, energy, health, climate, space, and more.', metadata: {} },
    { section: 'what', displayOrder: 3, title: 'You probably qualify.', body: "If you're a U.S. small business doing genuinely innovative work, there's likely a program for you. Most companies never apply, because the process looks impenetrable. It isn't — with the right help.", metadata: {} },

    {
      section: 'eligibility-header',
      displayOrder: 4,
      excerpt: 'Is this you?',
      title: 'You may qualify if you are…',
      body: 'Not sure? That’s exactly what the application is for — Eric reviews every one and tells you honestly whether it’s a fit.',
    },
    { section: 'eligibility', displayOrder: 5, body: 'A U.S.-based, for-profit small business (500 or fewer employees)', metadata: {} },
    { section: 'eligibility', displayOrder: 6, body: 'More than 50% owned by U.S. individuals', metadata: {} },
    { section: 'eligibility', displayOrder: 7, body: 'Doing genuinely innovative R&D — hardware, software, materials, bio, climate, or defense-adjacent', metadata: {} },
    { section: 'eligibility', displayOrder: 8, body: 'Willing to perform the work in the United States', metadata: {} },
    { section: 'eligibility', displayOrder: 9, body: 'Open to non-dilutive funding instead of — or alongside — venture capital', metadata: {} },

    {
      section: 'capture',
      displayOrder: 10,
      excerpt: 'Not ready to apply yet?',
      title: 'Get the federal R&D starter guide.',
      body: 'A plain-English primer on SBIR/STTR, what agencies fund, and how to position your company — plus a heads-up when a newcomer track opens.',
      metadata: {},
    },

    {
      section: 'cta',
      displayOrder: 11,
      title: 'Already know it’s for you?',
      body: 'Apply to the founding cohort — Eric reviews every application within 72 hours.',
      metadata: { cta: { label: 'Apply to the Founding Cohort', href: '/apply' } },
    },
  ],
};
