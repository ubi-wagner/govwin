import type { SeedPage } from './types';

/** /resources — page chrome (hero / programs grid / section headings / portals /
 *  CTA). The "Latest Insights" list is sourced from resource+guide+blog_post
 *  documents (content_pages docs), not these blocks. */
export const resources: SeedPage = {
  pageKey: 'resources',
  title: 'Resources',
  blocks: [
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Resources',
      title: 'Insights, guides, and your *portals*.',
      body: 'Federal R&D funding intelligence. Updated as we curate.',
      metadata: { accent: 'brand-500' },
    },
    { section: 'programs-header', displayOrder: 1, title: 'Programs We Cover', metadata: {} },
    { section: 'programs', displayOrder: 2, title: 'SBIR', body: 'Small Business Innovation Research — Phase I through Phase III across all DoD branches, NSF, DOE, NIH, and more.', metadata: { icon: 'program-sbir' } },
    { section: 'programs', displayOrder: 3, title: 'STTR', body: 'Small Business Technology Transfer — requires a research institution partner. Same agencies, different collaboration model.', metadata: { icon: 'program-sttr' } },
    { section: 'programs', displayOrder: 4, title: 'BAA', body: 'Broad Agency Announcements — open-ended R&D solicitations from DARPA, AFRL, Army Research Lab, and others.', metadata: { icon: 'program-baa' } },
    { section: 'programs', displayOrder: 5, title: 'OTA', body: 'Other Transaction Authority — non-FAR contracting for prototype development. Faster timelines, different compliance.', metadata: { icon: 'program-ota' } },
    { section: 'programs', displayOrder: 6, title: 'CSO', body: 'Commercial Solutions Openings — typically Air Force (AFWERX). Slide-deck format, short-form proposals.', metadata: { icon: 'program-cso' } },
    { section: 'programs', displayOrder: 7, title: 'Grants / NOFO', body: 'Grants.gov Notices of Funding Opportunity — NSF, DOE, NIH. CFDA-based, different compliance structure.', metadata: { icon: 'program-grants' } },
    { section: 'insights-header', displayOrder: 8, title: 'Latest Insights', metadata: {} },
    { section: 'portals-header', displayOrder: 9, title: 'Subscriber Portals', body: 'Logged-in subscribers access their portals via the dashboard.', metadata: {} },
    { section: 'portals', displayOrder: 10, title: 'Spotlight Dashboard', body: 'Your ranked opportunity feed, deadline reminders, and pinned topics.', metadata: { linkLabel: 'Login to access', linkHref: '/login' } },
    { section: 'portals', displayOrder: 11, title: 'Proposal Portals', body: 'Your purchased proposal workspaces — drafts, collaborators, and submission packages.', metadata: { linkLabel: 'Login to access', linkHref: '/login' } },
    { section: 'cta', displayOrder: 12, title: 'Ready to build your federal R&D pipeline?', metadata: { ctaLabel: 'Apply Now', ctaHref: '/apply' } },
  ],
};
