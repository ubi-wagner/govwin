import {
  Hero,
  Section,
  SectionHeader,
  FeatureGrid,
  CtaSection,
} from '@/components/marketing/section-layout';
import { getPageBlocks, buildLookup, single, many, type ContentRow } from '@/lib/cms';

export const revalidate = 60;

export const metadata = {
  title: 'Security & Data Isolation — RFP Pipeline',
  description:
    'Federal R&D customers have unique security requirements. Every customer gets isolated AI agents, isolated storage, isolated processing. Your data never touches another customer\'s context window.',
};

const isolationLayers = [
  {
    title: 'Customer-level isolation',
    body: 'Every customer account is rooted at a unique storage prefix and queried with tenant-scoped RLS (Row-Level Security) on every memory and document table. Your company data, uploaded files, and proposal drafts are cryptographically isolated from every other customer.',
  },
  {
    title: 'Proposal-level isolation',
    body: 'Each purchased proposal portal gets its own sandboxed workspace. AI agents working on your Phase I cannot read data from your Phase II (or any other customer\'s proposal) unless you explicitly grant cross-proposal library access.',
  },
  {
    title: 'Collaborator-level isolation',
    body: 'Invite subcontractors, subject-matter experts, or team members to specific sections of specific proposals. Control access by role, document, and proposal phase. Revoke instantly. Collaborators see only what you authorize.',
  },
  {
    title: 'AI-level isolation',
    body: 'AI agents are spun up per-customer and per-proposal. Your agents can only read data you uploaded or authorized them to access. Even a bug in the agent layer cannot cross the tenant boundary — the storage and database layers enforce isolation independently.',
  },
];

const contracts = [
  {
    title: 'Your IP stays yours',
    body: 'Uploaded documents, proposal drafts, and company library materials are your intellectual property. We never use your data to train models, never share it with other customers, never sell it, and never use it for any purpose outside your own proposals and pipeline.',
  },
  {
    title: 'Federal contracting aware',
    body: 'Eric has 25+ years of federal R&D funding experience. We understand ITAR, EAR, and export-control concerns common in DoD and DARPA work. The system is designed to support (not hinder) customers with such requirements.',
  },
  {
    title: 'Prompt injection defense',
    body: 'User-uploaded content is clearly delimited from system instructions in every AI prompt. Malicious content in an uploaded document cannot instruct the AI to exfiltrate your data — a hard guardrail built into the prompt architecture.',
  },
  {
    title: 'No model-training on your data',
    body: 'We use Anthropic\'s Claude API for AI. Your data is sent as input for each request but is never used to train the underlying model. Claude\'s enterprise API has strict no-training terms we rely on.',
  },
];

const infrastructure = [
  {
    title: 'Hosting',
    body: 'Railway platform. US-based infrastructure. HTTPS everywhere. Session cookies secure and httpOnly. Database at rest encryption.',
  },
  {
    title: 'Authentication',
    body: 'NextAuth v5 with bcrypt password hashing (cost=12). Session-based. Forced password change on first login. No passwords sent via email.',
  },
  {
    title: 'Audit',
    body: 'Every action logged to our system_events stream: who did what, when, with what actor and correlation ID. Exportable by your admin for your own compliance records.',
  },
  {
    title: 'Migrations',
    body: 'All database schema changes are additive-only, verified idempotent, and deployed via CI/CD. No destructive changes in production without explicit guard rails.',
  },
];

export default async function Page() {
  const blocks = await getPageBlocks('security');
  const lookup = buildLookup(blocks, 'security');
  const hero = single(lookup['hero']);
  const cmsIsolation = many(lookup['isolation']);
  const cmsContracts = many(lookup['contracts']);
  const cmsInfra = many(lookup['infrastructure']);
  const ctaBlock = single(lookup['cta']);

  const resolvedIsolation = cmsIsolation.length > 0
    ? cmsIsolation.map((b: ContentRow) => ({ title: b.title, body: b.body, image: b.featuredImage ?? undefined, icon: (b.metadata as { icon?: string })?.icon, href: (b.metadata as { href?: string })?.href }))
    : isolationLayers;
  const resolvedContracts = cmsContracts.length > 0
    ? cmsContracts.map((b: ContentRow) => ({ title: b.title, body: b.body, image: b.featuredImage ?? undefined, icon: (b.metadata as { icon?: string })?.icon, href: (b.metadata as { href?: string })?.href }))
    : contracts;
  const resolvedInfra = cmsInfra.length > 0
    ? cmsInfra.map((b: ContentRow) => ({ title: b.title, body: b.body, image: b.featuredImage ?? undefined, icon: (b.metadata as { icon?: string })?.icon, href: (b.metadata as { href?: string })?.href }))
    : infrastructure;

  return (
    <>
      <Hero
        variant="dark"
        eyebrow={hero?.excerpt ?? "Security & Data Isolation"}
        headline={hero?.title ?? <>Federal-grade isolation. <br /><span className="text-brand-400">No cross-contamination, ever.</span></>}
        subheadline={hero?.body ?? "Federal R&D customers have unique security needs — and we designed for that audience from day one. Every customer gets isolated AI, isolated storage, isolated processing. Your data never touches another customer's workspace."}
        primaryCta={(hero?.metadata as { primary_cta?: { label: string; href: string } })?.primary_cta ?? { label: 'Apply Now', href: '/apply' }}
      />

      <Section variant="white">
        <SectionHeader
          eyebrow="Four Layers of Isolation"
          title="Isolation at every level, enforced by the system"
          subtitle="Not a policy promise — a technical architecture. Each layer is independently enforced, so a bug in one layer cannot compromise the others."
        />
        <div className="mt-12">
          <FeatureGrid columns={2} items={resolvedIsolation} />
        </div>
      </Section>

      <Section variant="gray">
        <SectionHeader
          eyebrow="Our Contracts With You"
          title="What we promise about your data"
        />
        <div className="mt-12">
          <FeatureGrid columns={2} items={resolvedContracts} />
        </div>
      </Section>

      <Section variant="white">
        <SectionHeader
          eyebrow="Infrastructure"
          title="The technical stack that enforces all of the above"
          subtitle="Built on mature, auditable open-source components. Deployed via immutable containers with traceable change control."
        />
        <div className="mt-12">
          <FeatureGrid columns={2} items={resolvedInfra} />
        </div>
      </Section>

      <Section variant="gray">
        <div className="max-w-3xl mx-auto">
          <SectionHeader
            eyebrow="What We're Not (Yet)"
            title="Honest about our certifications"
            align="left"
          />
          <div className="mt-6 space-y-4 text-gray-700 leading-relaxed">
            <p>
              RFP Pipeline is a young company. We don&rsquo;t yet have SOC 2 Type II, FedRAMP,
              or ITAR certifications. Most customers pursuing SBIR/STTR don&rsquo;t need
              those for proposal development work &mdash; but we want to be clear about
              what we are and aren&rsquo;t.
            </p>
            <p>
              <strong className="text-navy-800">What we ARE:</strong> A SaaS platform with
              strong tenant isolation, audit logging, encryption at rest and in transit,
              and a commitment to never train models on your data.
            </p>
            <p>
              <strong className="text-navy-800">What we ARE NOT (yet):</strong> A certified
              CUI or classified processing environment. Do not upload classified
              information, CUI requiring specific safeguarding, or ITAR-controlled
              technical data to the platform.
            </p>
            <p>
              <strong className="text-navy-800">Certification roadmap:</strong> SOC 2 Type
              II is targeted for Year 2. Customers who require it before that should
              contact us to discuss their specific needs &mdash; we may be able to provide
              a bridge arrangement.
            </p>
          </div>
        </div>
      </Section>

      <CtaSection
        eyebrow={ctaBlock?.excerpt ?? "Questions about security?"}
        headline={ctaBlock?.title ?? "Ask Eric directly"}
        subheadline={ctaBlock?.body ?? "If your situation has specific security requirements, reach out during the application process. We'll tell you honestly whether we're a fit today or what we'd need to build to become one."}
        cta={(ctaBlock?.metadata as { cta?: { label: string; href: string } })?.cta ?? { label: 'Start an Application', href: '/apply' }}
      />
    </>
  );
}
