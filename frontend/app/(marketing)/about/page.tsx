import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, StatHighlight, CtaSection } from '@/components/page-sections'

export const metadata: Metadata = {
  title: 'About RFP Finder | Government Opportunity Intelligence',
  description: 'Learn how RFP Finder helps companies discover, score, and win federal government contracts using AI-powered opportunity matching.',
}

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <Section>
        <div className="mx-auto max-w-3xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">About RFP Finder</p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">
            Built by people who know federal contracting
          </h1>
          <p className="mt-6 text-lg text-gray-600">
            RFP Finder was created by a team with over two decades of experience in government contracting,
            SBIR/STTR programs, and technology commercialization. We built the tool we wished we had.
          </p>
        </div>
      </Section>

      {/* Mission */}
      <Section className="bg-gray-50">
        <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader
              eyebrow="Our Mission"
              title="Level the playing field for small businesses"
              center={false}
            />
            <p className="mt-6 text-sm leading-relaxed text-gray-600">
              Federal procurement is a $700B+ market, but navigating it is overwhelming. Small businesses
              spend countless hours searching SAM.gov, filtering through irrelevant postings, and missing
              deadlines on opportunities they should have won.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-gray-600">
              RFP Finder changes that. Our AI-powered platform continuously scans federal procurement sources,
              scores every opportunity against your unique business profile, and delivers a prioritized pipeline
              so you can focus on what matters: writing winning proposals.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
              <p className="text-3xl font-bold text-brand-600">AI</p>
              <p className="mt-2 text-sm font-medium text-gray-900">Scoring Engine</p>
              <p className="mt-1 text-xs text-gray-500">Multi-factor relevance scoring using NAICS, keywords, set-asides, and agency history</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
              <p className="text-3xl font-bold text-brand-600">24/7</p>
              <p className="mt-2 text-sm font-medium text-gray-900">Monitoring</p>
              <p className="mt-1 text-xs text-gray-500">Continuous scanning of SAM.gov and federal procurement sources</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
              <p className="text-3xl font-bold text-brand-600">SaaS</p>
              <p className="mt-2 text-sm font-medium text-gray-900">Multi-Tenant</p>
              <p className="mt-1 text-xs text-gray-500">Secure, isolated workspaces for every client organization</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-sm border border-gray-100">
              <p className="text-3xl font-bold text-brand-600">Fast</p>
              <p className="mt-2 text-sm font-medium text-gray-900">Setup</p>
              <p className="mt-1 text-xs text-gray-500">Enter your profile, get scored opportunities in minutes — not weeks</p>
            </div>
          </div>
        </div>
      </Section>

      {/* What we solve */}
      <Section>
        <SectionHeader
          eyebrow="The Problem We Solve"
          title="Federal contracting is broken for small businesses"
        />
        <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-gray-200 bg-gray-200 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { title: 'Information Overload', desc: 'Thousands of new opportunities posted daily — most irrelevant to your business.' },
            { title: 'Missed Deadlines', desc: 'Critical response windows close before you even discover the opportunity.' },
            { title: 'Manual Searching', desc: 'Hours spent on SAM.gov with clunky filters that return noisy results.' },
            { title: 'No Prioritization', desc: 'Every opportunity looks the same — no way to focus on what you can actually win.' },
            { title: 'Fragmented Tools', desc: 'Spreadsheets, email chains, and browser bookmarks instead of a real pipeline.' },
            { title: 'Wasted Proposals', desc: 'Time spent pursuing opportunities that were never a good fit to begin with.' },
          ].map(item => (
            <div key={item.title} className="bg-white p-6">
              <h3 className="text-sm font-semibold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm text-gray-600">{item.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact / Get Started */}
      <Section className="bg-gray-50" id="contact">
        <SectionHeader
          eyebrow="Get Started"
          title="Ready to transform your federal pipeline?"
          description="Contact us for a demo or to learn more about how RFP Finder can help your business win government contracts."
        />
        <div className="mx-auto mt-10 max-w-lg rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600">
              Reach out to discuss your needs and get set up with a personalized workspace.
            </p>
            <div className="space-y-2">
              <a
                href="mailto:eric@rfpfinder.com"
                className="block rounded-lg bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700 hover:bg-brand-100 transition-colors"
              >
                eric@rfpfinder.com
              </a>
            </div>
            <p className="text-xs text-gray-400">
              We typically respond within one business day.
            </p>
          </div>
        </div>
      </Section>

      <CtaSection
        title="Start winning government contracts today"
        description="Join companies already using RFP Finder to find their next federal opportunity."
        primaryLabel="Contact Us"
        primaryHref="/about#contact"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
