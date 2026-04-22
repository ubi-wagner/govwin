import {
  Hero,
  Section,
  SectionHeader,
  ProcessStep,
  FeatureGrid,
  CtaSection,
} from '@/components/marketing/section-layout';

export const metadata = {
  title: 'How It Works — RFP Pipeline',
  description:
    'From application to your first submitted proposal. The RFP Pipeline workflow combines expert-curated opportunities, custom AI agents, and hands-on review at every gate.',
};

const steps = [
  {
    number: '01',
    title: 'Apply',
    body: "You submit a short application describing your company, your technology, and the federal R&D funding you're pursuing. This filters out tire-kickers and lets Eric assess fit before you pay anything.",
    details: [
      'Company + admin contact info',
      'SAM.gov registration status',
      'Previous submissions and awards',
      'Technology summary and desired outcomes',
      'T&Cs acceptance',
    ],
  },
  {
    number: '02',
    title: 'Accepted',
    body: 'Eric personally reviews every application within 72 hours. If you\'re a fit for the founding cohort (serious small businesses pursuing federal R&D funding), you\'re invited to onboard.',
    details: [
      '72-hour review SLA by Eric personally',
      'Brief onboarding call to set expectations',
      'Accepted applicants get an invite link to register',
    ],
  },
  {
    number: '03',
    title: 'Onboard',
    body: 'Your admin registers, uploads initial company documents (capability statement, past performance, key personnel bios), and activates your monthly subscription via Stripe.',
    details: [
      'Admin creates account, verifies email',
      'Upload foundational company docs (become your AI team\'s library)',
      'Activate $299/month subscription',
      'Your isolated AI agents are provisioned',
    ],
  },
  {
    number: '04',
    title: 'Spotlight',
    body: 'Every day, our pipeline ingests SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals. Expert-curated opportunities that match your tech areas surface at the top. You get deadline reminders and your monthly 15-min Ask-the-Expert call.',
    details: [
      'Daily ingestion from 4+ federal opportunity sources',
      'Expert-curated compliance matrix for every opportunity',
      'Ranked and filtered to your company\'s tech areas',
      'Notifications for new matches and upcoming deadlines',
    ],
  },
  {
    number: '05',
    title: 'Purchase a Proposal Portal',
    body: 'When you find an opportunity worth pursuing, purchase a proposal portal ($999 Phase I, $1,999 Phase II). Eric builds your curated compliance matrix within 72 hours. Your custom AI team drafts sections against your uploaded library.',
    details: [
      'Per-proposal purchase — no annual commitment',
      '72-hour expert curation by Eric',
      'Stage-gated workspace: draft → review → revise → accept',
      'Collaborator access controls by section and phase',
    ],
  },
  {
    number: '06',
    title: 'Submit + Learn',
    body: "You submit your proposal to the agency. Every curation decision, every verified compliance value, and every successful submission makes the AI smarter for your next proposal on the same program. The system gets more accurate and less expensive each cycle.",
    details: [
      'Export-ready submission package (PDFs, forms, attachments)',
      'Post-submission debrief stored in your library',
      'Future cycles of same program pre-fill from prior verified data',
      'Your library grows — so does the AI\'s accuracy for your company',
    ],
  },
];

const guardrails = [
  {
    title: 'Data isolation per customer',
    body: 'Your company data, documents, and proposal drafts are fully isolated. Your AI agents only see your data. No data from any other customer ever touches your context window.',
  },
  {
    title: 'Expert gate at every high-stakes step',
    body: 'Eric reviews your application, curates every solicitation you pursue, and is available for pre-submission review. The AI drafts; the expert verifies.',
  },
  {
    title: 'Collaborator controls',
    body: 'Invite partners, subcontractors, and internal reviewers to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly.',
  },
];

export default function Page() {
  return (
    <>
      <Hero
        eyebrow="How It Works"
        headline={<>From application to <span className="text-brand-400">submitted proposal</span></>}
        subheadline="A single workflow that starts with a qualifying application and ends with a compliant, expert-curated proposal ready to submit. Every step is designed for small businesses that can't afford to waste time on opportunities that won't convert."
        primaryCta={{ label: 'Apply Now', href: '/apply' }}
        secondaryCta={{ label: 'See Pricing', href: '/pricing' }}
      />

      <Section variant="white">
        <SectionHeader
          eyebrow="The Workflow"
          title="Six stages from curious applicant to compliant submission"
          subtitle="Designed so you get value in week one, not month six."
        />
        <div className="mt-16 max-w-3xl mx-auto relative">
          <div className="absolute left-6 top-6 bottom-6 w-0.5 bg-brand-100" aria-hidden />
          {steps.map((step) => (
            <ProcessStep key={step.number} {...step} />
          ))}
        </div>
      </Section>

      <Section variant="gray">
        <SectionHeader
          eyebrow="Built-in Guardrails"
          title="Trust is engineered into every stage"
          subtitle="Federal R&D buyers care about data security, provenance, and compliance. We designed for that audience from day one."
        />
        <div className="mt-12">
          <FeatureGrid columns={3} items={guardrails} />
        </div>
      </Section>

      <CtaSection
        eyebrow="Ready to apply?"
        headline="Founding cohort is limited to 20 small businesses"
        subheadline="Applications reviewed weekly. $299/month after acceptance. Cancel anytime."
        cta={{ label: 'Start Your Application', href: '/apply' }}
      />
    </>
  );
}
