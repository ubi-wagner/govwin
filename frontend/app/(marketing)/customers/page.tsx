import type { Metadata } from 'next'
import { Section, SectionHeader, StatHighlight, CtaSection } from '@/components/page-sections'

export const metadata: Metadata = {
  title: 'Customer Wins | RFP Finder',
  description: 'See how companies are using RFP Finder to discover and win government contracts.',
}

/* ── Easy-to-update content arrays ───────────────── */

const successStories = [
  {
    company: 'Defense Technology Startup',
    industry: 'Aerospace & Defense',
    result: 'Won first SBIR Phase I award within 60 days of onboarding',
    quote: 'RFP Finder surfaced an Air Force opportunity we would have completely missed. The scoring told us it was a 94% match — and they were right.',
    metrics: ['$150K SBIR Phase I', 'First federal contract', '94 relevance score'],
  },
  {
    company: 'Advanced Materials Company',
    industry: 'Manufacturing',
    result: 'Secured $1.2M in federal contracts within first year',
    quote: 'We used to spend 10 hours a week searching SAM.gov. Now we spend 20 minutes reviewing our scored pipeline. The ROI is incredible.',
    metrics: ['$1.2M total awards', '85% time saved', '6 contracts won'],
  },
  {
    company: 'Cybersecurity Firm',
    industry: 'Information Technology',
    result: 'Identified and won a sole-source opportunity through early discovery',
    quote: 'The deadline alert saved us. We had 5 days to respond to a sources-sought notice that turned into a sole-source award.',
    metrics: ['$340K sole-source', '5-day response window', 'Ongoing IDIQ vehicle'],
  },
  {
    company: 'Environmental Services Startup',
    industry: 'Environmental & Energy',
    result: 'Built a federal pipeline from zero to 15 active pursuits',
    quote: 'As a small WOSB, set-aside matching is critical. RFP Finder automatically flags every WOSB set-aside in our NAICS codes.',
    metrics: ['15 active pursuits', 'WOSB set-aside focus', '3 wins in 6 months'],
  },
]

const clientTypes = [
  { label: 'Small Businesses', desc: 'Leverage set-aside matching and SBIR/STTR expertise to compete effectively.' },
  { label: 'SBIR/STTR Applicants', desc: 'Find topics, track deadlines, and improve win rates with data-driven scoring.' },
  { label: 'Defense Contractors', desc: 'Monitor DoD opportunities and track contract vehicles across agencies.' },
  { label: 'Technology Startups', desc: 'Identify non-dilutive federal funding opportunities to fuel your R&D.' },
  { label: 'Accelerator Cohorts', desc: 'Batch onboarding and pipeline tracking for startup accelerator programs.' },
  { label: 'University Spinouts', desc: 'Navigate federal funding for research commercialization and tech transfer.' },
]

/* ── Page ────────────────────────────────────────── */

export default function CustomersPage() {
  return (
    <>
      <Section>
        <SectionHeader
          eyebrow="Customer Wins"
          title="Real results from real companies"
          description="Our clients are winning federal contracts, securing SBIR/STTR awards, and building sustainable government revenue streams."
        />
      </Section>

      {/* Stats */}
      <Section className="bg-gray-50">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          <StatHighlight value="100%" label="Recent Win Rate" description="SBIR/STTR cohort" />
          <StatHighlight value="85%" label="Time Saved" description="vs. manual search" />
          <StatHighlight value="60 Days" label="Avg. First Win" description="From onboarding" />
          <StatHighlight value="$100M+" label="Capital Secured" description="Across all clients" />
        </div>
      </Section>

      {/* Success stories */}
      <Section>
        <SectionHeader
          eyebrow="Success Stories"
          title="How our clients are winning"
        />
        <div className="mt-12 space-y-6">
          {successStories.map((story, i) => (
            <div key={i} className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
              <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="badge-blue">{story.industry}</span>
                  </div>
                  <h3 className="mt-3 text-lg font-semibold text-gray-900">{story.company}</h3>
                  <p className="mt-1 text-sm font-medium text-brand-600">{story.result}</p>
                  <blockquote className="mt-4 border-l-2 border-brand-200 pl-4 text-sm italic text-gray-600">
                    &ldquo;{story.quote}&rdquo;
                  </blockquote>
                </div>
                <div className="flex flex-wrap gap-2 md:flex-col md:items-end">
                  {story.metrics.map((m, j) => (
                    <span key={j} className="rounded-lg bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-100">
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Who we serve */}
      <Section className="bg-gray-50">
        <SectionHeader
          eyebrow="Who We Serve"
          title="Built for companies pursuing federal contracts"
        />
        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {clientTypes.map(ct => (
            <div key={ct.label} className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-gray-900">{ct.label}</h3>
              <p className="mt-2 text-sm text-gray-600">{ct.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaSection
        title="Join our growing list of winners"
        description="Find out how RFP Finder can help your company win federal contracts."
        primaryLabel="Request a Demo"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
