import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, FeatureCard, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { FeaturesPageContent } from '@/types'

const STATIC_CONTENT: FeaturesPageContent = {
  hero: {
    title: 'Your Entire BD Team in One Platform',
    description: 'Every capability you would need to hire for — opportunity scanning, fit analysis, proposal structure, AI drafting, content management, and team collaboration — built into one system that costs less than a single consultant meeting.',
  },
  features: [
    { title: 'Opportunity Matching', description: 'AI scans SBIR.gov, SAM.gov, and Grants.gov across all 11 agencies daily. Topics are matched to your technology profile before you log in.', icon: 'search' },
    { title: 'Fit Scoring', description: 'Every opportunity is scored against your capabilities using NAICS codes, research keywords, TRL level, and agency history. Know what to pursue before investing time.', icon: 'chart' },
    { title: 'Deadline Intelligence', description: 'SBIR release cycles, pre-solicitation windows, and agency timelines — all mapped. Get notified at exactly the right time, not the last minute.', icon: 'clock' },
    { title: 'Expert-Derived Templates', description: 'Proposal structures built from real winning submissions. Agency-aligned, section-by-section, with evaluation criteria baked in.', icon: 'document' },
    { title: 'AI Writing Workspace', description: 'Guided drafting that pulls from your content library. The AI learns from decades of winning proposals — it doesn\'t guess, it builds on what works.', icon: 'pencil' },
    { title: 'Compound Learning Library', description: 'Team bios, past performance, technical narratives — stored and indexed. Every proposal makes the next one faster. Your 5th takes half the effort of your 1st.', icon: 'library' },
    { title: 'Partner Collaboration', description: 'Invite STTR research partners, subcontractors, and consultants with proposal-level access controls. Everyone works in one place.', icon: 'users' },
    { title: 'Pipeline Management', description: 'Track every opportunity from discovery through submission in a single dashboard. See what\'s closing, what\'s in progress, and where to focus.', icon: 'pipeline' },
    { title: 'Smart Notifications', description: 'Deadline alerts tied to SBIR release cycles, not just due dates. New high-match opportunities, pipeline updates, and team activity.', icon: 'bell' },
    { title: 'Secure Document Storage', description: 'All proposal assets in one encrypted vault. Version-controlled, permission-managed, and ready for your next submission.', icon: 'shield' },
  ],
}

const STATIC_META = {
  title: 'Features | RFP Pipeline',
  description: 'Explore every tool inside the SBIR Engine — opportunity matching, fit scoring, AI writing workspace, proposal templates, and more.',
}

/* ── Icon map ─────────────────────────────────────── */

function FeatureIcon({ name }: { name: string }) {
  const cls = "h-6 w-6"
  const props = { className: cls, fill: "none" as const, viewBox: "0 0 24 24", strokeWidth: 1.5, stroke: "currentColor" }

  switch (name) {
    case 'search':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
        </svg>
      )
    case 'document':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
        </svg>
      )
    case 'pencil':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
        </svg>
      )
    case 'library':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
        </svg>
      )
    case 'users':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
        </svg>
      )
    case 'pipeline':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
        </svg>
      )
    case 'bell':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
        </svg>
      )
    case 'shield':
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      )
    default:
      return (
        <svg {...props}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
        </svg>
      )
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('features')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function FeaturesPage() {
  const published = await getPageContent('features')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            Platform Features
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            {content.hero.title}
          </h1>
          <p className="mx-auto mt-6 max-w-3xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Feature grid */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Core Capabilities"
          title="Everything a BD team does — without the team"
          description="We built every capability you would need to hire for. From opportunity scanning to proposal submission, nothing falls through the cracks."
        />
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {content.features.map((feature, i) => (
            <FeatureCard
              key={feature.title}
              icon={<FeatureIcon name={feature.icon} />}
              title={feature.title}
              description={feature.description}
              index={i}
            />
          ))}
        </div>
      </Section>

      {/* CTA */}
      <CtaSection
        title="Ready to see it in action?"
        description="Launching May 15, 2026. Join the waitlist as a Beta Tester and get the first 3 months of Pipeline Engine free and priority access to our Builders."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="See Pricing"
        secondaryHref="/pricing"
      />
    </>
  )
}
