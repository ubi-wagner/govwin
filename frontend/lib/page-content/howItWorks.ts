import type { SeedPage } from './types';

/**
 * /how-it-works — hero + workflow header + six process steps + guardrails header
 * + three guardrails + closing CTA.
 *
 * Block fields mirror exactly what app/(marketing)/how-it-works/page.tsx reads,
 * and every value here is the verbatim in-code default the page falls back to, so
 * seeding this page leaves the public render unchanged. The hero/section headers
 * are plain text (no accent markup): the hero's "submitted proposal" accent is a
 * non-italic text-brand-400 span that only the JSX fallback styles, so the
 * editable title stays plain to avoid altering the rendered heading. Step
 * specifics (number, details[]) live in metadata exactly as the page reads them.
 */
export const howItWorks: SeedPage = {
  pageKey: 'how-it-works',
  title: 'How It Works',
  blocks: [
    // Hero. headline accepts ReactNode; *accent* = plain brand-400 color (no italic).
    {
      section: 'hero',
      displayOrder: 0,
      excerpt: 'How It Works',
      title: 'From application to *submitted proposal*',
      body: "A single workflow that starts with a qualifying application and ends with a compliant, expert-curated proposal ready to submit. Every step is designed for small businesses that can't afford to waste time on opportunities that won't convert.",
      metadata: {
        primary_cta: { label: 'Apply Now', href: '/apply' },
        secondary_cta: { label: 'See Pricing', href: '/pricing' },
      },
    },

    // Workflow section header. excerpt -> eyebrow, title, body -> subtitle.
    {
      section: 'workflow-header',
      displayOrder: 1,
      excerpt: 'The Workflow',
      title: 'Six stages from curious applicant to compliant submission',
      body: 'Designed so you get value in week one, not month six.',
    },

    // Six process steps. metadata.number is the step number, metadata.details the bullets.
    {
      section: 'steps',
      displayOrder: 2,
      title: 'Apply',
      body: "You submit a short application describing your company, your technology, and the federal R&D funding you're pursuing. This filters out tire-kickers and lets Eric assess fit before you pay anything.",
      metadata: {
        number: '01',
        details: [
          'Company + admin contact info',
          'SAM.gov registration status',
          'Previous submissions and awards',
          'Technology summary and desired outcomes',
          'T&Cs acceptance',
        ],
      },
    },
    {
      section: 'steps',
      displayOrder: 3,
      title: 'Accepted',
      body: 'Eric personally reviews every application within 72 hours. If you\'re a fit for the founding cohort (serious small businesses pursuing federal R&D funding), you\'re invited to onboard.',
      metadata: {
        number: '02',
        details: [
          '72-hour review SLA by Eric personally',
          'Brief onboarding call to set expectations',
          'Accepted applicants get an invite link to register',
        ],
      },
    },
    {
      section: 'steps',
      displayOrder: 4,
      title: 'Onboard',
      body: 'Your admin registers, uploads initial company documents (capability statement, past performance, key personnel bios), and activates your monthly subscription via Stripe.',
      metadata: {
        number: '03',
        details: [
          'Admin creates account, verifies email',
          'Upload foundational company docs (become your AI team\'s library)',
          'Activate $299/month subscription',
          'Your isolated AI agents are provisioned',
        ],
      },
    },
    {
      section: 'steps',
      displayOrder: 5,
      title: 'Spotlight',
      body: 'Every day, our pipeline ingests SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals. Expert-curated opportunities that match your tech areas surface at the top. You get deadline reminders and your monthly 15-min Ask-the-Expert call.',
      metadata: {
        number: '04',
        details: [
          'Daily ingestion from 4+ federal opportunity sources',
          'Expert-curated compliance matrix for every opportunity',
          'Ranked and filtered to your company\'s tech areas',
          'Notifications for new matches and upcoming deadlines',
        ],
      },
    },
    {
      section: 'steps',
      displayOrder: 6,
      title: 'Purchase a Proposal Portal',
      body: 'When you find an opportunity worth pursuing, purchase a proposal portal ($999 Phase I, $1,999 Phase II). Eric builds your curated compliance matrix within 72 hours. Your custom AI team drafts sections against your uploaded library.',
      metadata: {
        number: '05',
        details: [
          'Per-proposal purchase — no annual commitment',
          '72-hour expert curation by Eric',
          'Stage-gated workspace: draft, review, revise, accept',
          'Collaborator access controls by section and phase',
        ],
      },
    },
    {
      section: 'steps',
      displayOrder: 7,
      title: 'Submit + Learn',
      body: "You submit your proposal to the agency. Every curation decision, every verified compliance value, and every successful submission makes the AI smarter for your next proposal on the same program. The system gets more accurate and less expensive each cycle.",
      metadata: {
        number: '06',
        details: [
          'Export-ready submission package (PDFs, forms, attachments)',
          'Post-submission debrief stored in your library',
          'Future cycles of same program pre-fill from prior verified data',
          'Your library grows — so does the AI\'s accuracy for your company',
        ],
      },
    },

    // Guardrails section header. excerpt -> eyebrow, title, body -> subtitle.
    {
      section: 'guardrails-header',
      displayOrder: 8,
      excerpt: 'Built-in Guardrails',
      title: 'Trust is engineered into every stage',
      body: 'Federal R&D buyers care about data security, provenance, and compliance. We designed for that audience from day one.',
    },

    // Three guardrails. title, body.
    {
      section: 'guardrails',
      displayOrder: 9,
      title: 'Data isolation per customer',
      body: 'Your company data, documents, and proposal drafts are fully isolated. Your AI agents only see your data. No data from any other customer ever touches your context window.',
    },
    {
      section: 'guardrails',
      displayOrder: 10,
      title: 'Expert gate at every high-stakes step',
      body: 'Eric reviews your application, curates every solicitation you pursue, and is available for pre-submission review. The AI drafts; the expert verifies.',
    },
    {
      section: 'guardrails',
      displayOrder: 11,
      title: 'Collaborator controls',
      body: 'Invite partners, subcontractors, and internal reviewers to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly.',
    },

    // Closing CTA. excerpt -> eyebrow, title -> headline, body -> subheadline, metadata.cta -> button.
    {
      section: 'cta',
      displayOrder: 12,
      excerpt: 'Ready to apply?',
      title: 'Founding cohort is limited to 20 small businesses',
      body: 'Applications reviewed weekly. $299/month after acceptance. Cancel anytime.',
      metadata: { cta: { label: 'Start Your Application', href: '/apply' } },
    },
  ],
};
