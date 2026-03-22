import Link from 'next/link'
import { Section, SectionHeader, FeatureCard, StatHighlight, CtaSection } from '@/components/page-sections'

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pb-16 pt-20 sm:px-6 sm:pb-20 sm:pt-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(45%_40%_at_50%_60%,rgba(59,130,246,0.06),transparent)]" />
        <div className="mx-auto max-w-4xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">
            Government Opportunity Intelligence
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Find and win federal contracts{' '}
            <span className="text-brand-600">before your competitors</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-600">
            RFP Finder uses AI-powered scoring to surface the government opportunities most relevant to
            your business. Stop searching. Start winning.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/about#contact" className="btn-primary px-6 py-2.5 text-base">
              Request a Demo
            </Link>
            <Link href="/about" className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors">
              Learn how it works &rarr;
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-gray-100 bg-gray-50 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-8 sm:grid-cols-4">
          <StatHighlight value="$100M+" label="Non-Dilutive Capital" description="Secured for clients" />
          <StatHighlight value="100%" label="Recent Win Rate" description="13/13 SBIR/STTR awards" />
          <StatHighlight value="50+" label="Startups Supported" description="Early-stage technology companies" />
          <StatHighlight value="20+" label="Years Experience" description="Federal contracting expertise" />
        </div>
      </section>

      {/* Features */}
      <Section>
        <SectionHeader
          eyebrow="Platform Capabilities"
          title="Everything you need to win government contracts"
          description="From opportunity discovery to proposal submission, RFP Finder streamlines the entire federal procurement process."
        />
        <div className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <FeatureCard
            icon={<SearchIcon />}
            title="Smart Opportunity Discovery"
            description="Automated scanning of SAM.gov and federal procurement sources. Never miss a relevant RFP, RFI, or sources sought notice."
          />
          <FeatureCard
            icon={<ChartIcon />}
            title="AI-Powered Scoring"
            description="Each opportunity is scored against your company profile, NAICS codes, keywords, set-aside eligibility, and past performance."
          />
          <FeatureCard
            icon={<BellIcon />}
            title="Deadline Alerts"
            description="Automated notifications for approaching deadlines, new high-scoring matches, and status changes on opportunities you're tracking."
          />
          <FeatureCard
            icon={<ShieldIcon />}
            title="Set-Aside Matching"
            description="Instant identification of small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides that match your certifications."
          />
          <FeatureCard
            icon={<DocumentIcon />}
            title="Document Management"
            description="Centralized storage for capability statements, past performance records, and proposal templates — ready when you need them."
          />
          <FeatureCard
            icon={<TeamIcon />}
            title="Multi-Tenant Workspaces"
            description="Each client gets their own secure workspace with customized scoring profiles, opportunity pipelines, and team access."
          />
        </div>
      </Section>

      {/* How it works */}
      <Section className="bg-gray-50">
        <SectionHeader
          eyebrow="How It Works"
          title="From search to submission in three steps"
        />
        <div className="mt-12 grid grid-cols-1 gap-8 md:grid-cols-3">
          {[
            {
              step: '01',
              title: 'Profile Your Business',
              description: 'Enter your NAICS codes, keywords, set-aside certifications, and target agencies. Our scoring engine learns what matters to you.',
            },
            {
              step: '02',
              title: 'Review Scored Opportunities',
              description: 'Every day, new federal opportunities are automatically scored and ranked. Focus on the highest-value matches first.',
            },
            {
              step: '03',
              title: 'Pursue & Win',
              description: 'Track your pipeline, collaborate with your team, and leverage AI insights to craft winning proposals.',
            },
          ].map(item => (
            <div key={item.step} className="relative rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
              <span className="text-4xl font-bold text-brand-100">{item.step}</span>
              <h3 className="mt-2 text-lg font-semibold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <CtaSection
        title="Ready to find your next contract?"
        description="Join the companies already using RFP Finder to discover and win government opportunities faster."
        primaryLabel="Get Started Today"
        secondaryLabel="See customer wins"
        secondaryHref="/customers"
      />
    </>
  )
}

/* ── Inline SVG icons ────────────────────────────── */

function SearchIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  )
}

function DocumentIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  )
}

function TeamIcon() {
  return (
    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" />
    </svg>
  )
}
