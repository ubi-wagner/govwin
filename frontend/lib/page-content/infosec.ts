import type { SeedPage } from './types';

/**
 * /infosec — security & data isolation. Hero + four isolation layers + the
 * Claude/memory promise + collaboration admin + certifications + CTA.
 *
 * Block fields mirror exactly what app/(marketing)/infosec/page.tsx reads, and
 * every value here is the verbatim in-code default the page falls back to, so
 * seeding leaves the public render unchanged. Hero accent: citrus ("Nobody
 * else's.") with a line break encoded as `\n`.
 */
export const infosec: SeedPage = {
  pageKey: 'infosec',
  title: 'Security',
  blocks: [
    // Hero. Title accent: citrus ("Nobody else’s."), line break before it.
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'Security & Data Isolation',
      title: 'Your data. Your agents.\n*Nobody else’s.*',
      body: 'Federal R&D proposals contain sensitive IP, pricing strategy, and team composition. We built the architecture assuming that — not as an afterthought.',
      metadata: { accent: 'citrus' },
    },

    // Isolation section heading.
    {
      section: 'isolation-header',
      displayOrder: 1,
      title: 'Four layers of isolation. Independently enforced.',
    },

    // Four isolation layers. label = excerpt, heading = title.
    {
      section: 'isolation',
      displayOrder: 2,
      excerpt: 'Customer Isolation',
      metadata: { icon: 'lock' },
      title: 'Row-Level Security, tenant-scoped.',
      body: 'Unique storage prefix per account. Database queries are RLS-scoped to your tenant ID. Your AI context window never includes another customer\'s data — enforced at the database and storage layers, not just application logic.',
    },
    {
      section: 'isolation',
      displayOrder: 3,
      excerpt: 'Proposal Isolation',
      metadata: { icon: 'proposal-doc' },
      title: 'Sandboxed per portal.',
      body: 'Each proposal portal is its own workspace. Agents working on Proposal A cannot read Proposal B\'s data unless you explicitly enable cross-proposal library access. Access control is set by your admin, not ours.',
    },
    {
      section: 'isolation',
      displayOrder: 4,
      excerpt: 'Agent Isolation',
      metadata: { icon: 'isolation' },
      title: 'Pre-trained. Individually provisioned.',
      body: 'Your company gets its own AI team at signup. These agents are pre-trained on federal R&D compliance patterns but provisioned with access ONLY to your data. They learn from your uploads, your corrections, and your verified decisions — nobody else\'s.',
    },
    {
      section: 'isolation',
      displayOrder: 5,
      excerpt: 'Collaborator Isolation',
      metadata: { icon: 'collaboration' },
      title: 'Section-level. Role-level. Revocable.',
      body: 'Invite subcontractors and SMEs to specific sections of specific proposals at specific phases. View, comment, edit — each permission is granular. Revoke access instantly. Every action is audited with actor, timestamp, and change record.',
    },

    // The promise (2). label = excerpt, heading = title.
    {
      section: 'promise',
      displayOrder: 6,
      excerpt: 'The Claude Promise',
      metadata: { icon: 'no-training' },
      title: 'No model training on your data. Ever.',
      body: 'Built on Anthropic\'s Claude API with strict enterprise no-training terms. Your proposals, your company data, your compliance decisions are sent as input for each request — but are never used to train or fine-tune the underlying model. Your IP stays yours.',
    },
    {
      section: 'promise',
      displayOrder: 7,
      excerpt: 'Structured Memory Architecture',
      metadata: { icon: 'memory' },
      title: 'We remember for you. Not about you.',
      body: 'Our proprietary structured memory system stores verified compliance decisions, expert curation history, and proposal templates in tenant-isolated database rows — not in model weights. Your memory is retrievable, auditable, and deletable. It belongs to you, not to a training pipeline.',
    },

    // Collaboration admin heading.
    {
      section: 'collab-header',
      displayOrder: 8,
      excerpt: 'Collaboration Administration',
      title: 'Easy for admins. Clear for collaborators.',
    },

    // Collaboration cards (3).
    {
      section: 'collab',
      displayOrder: 9,
      title: 'Internal Team',
      metadata: { icon: 'team' },
      body: 'Your admin invites team members by email. Each gets role-based access to the proposals they\'re assigned to. All-proposals or per-proposal — your admin decides.',
    },
    {
      section: 'collab',
      displayOrder: 10,
      title: 'External Collaborators',
      metadata: { icon: 'external-collab' },
      body: 'Subcontractors, university partners, and SMEs get stage-scoped access to specific sections. They upload their materials, review their sections, and see nothing else. Revoke when the phase closes.',
    },
    {
      section: 'collab',
      displayOrder: 11,
      title: 'Full Audit Trail',
      metadata: { icon: 'audit' },
      body: 'Every login, every edit, every comment, every access grant and revocation is logged with actor name, timestamp, and IP. Exportable for your own compliance records.',
    },

    // Certifications. body is rendered as paragraphs split on \n\n (HTML allowed, sanitized).
    {
      section: 'certifications',
      displayOrder: 12,
      title: 'What we are. What we aren\'t. Yet.',
      body: '<strong class="text-navy-900">We are:</strong> A SaaS platform with strong tenant isolation, audit logging, encryption at rest and in transit, and a binding commitment to never train on your data.\n\n<strong class="text-navy-900">We are not (yet):</strong> SOC 2 Type II, FedRAMP, or ITAR certified. Most SBIR/STTR proposal development work doesn’t require those — but we’re honest about it.\n\n<strong class="text-navy-900">Roadmap:</strong> SOC 2 targeted for Year 2. Contract management and compliance tracking coming in Year 1. Additional certifications based on customer requirements.',
    },

    // Final CTA.
    {
      section: 'cta',
      displayOrder: 13,
      title: 'Questions about security? Ask Eric directly.',
      body: 'Raise them in your application. We\'ll tell you honestly whether we\'re a fit today.',
      metadata: { cta: { label: 'Start an Application', href: '/apply' } },
    },
  ],
};
