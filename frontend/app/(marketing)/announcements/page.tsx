import type { Metadata } from 'next'
import { Section, SectionHeader, ContentCard, CtaSection } from '@/components/page-sections'

export const metadata: Metadata = {
  title: 'News & Announcements | RFP Finder',
  description: 'Latest news, product updates, and announcements from RFP Finder.',
}

const announcements = [
  {
    date: 'March 2026',
    category: 'Product',
    title: 'RFP Finder Platform Launch',
    excerpt: 'We are excited to announce the official launch of the RFP Finder platform. After months of development and beta testing, our AI-powered government opportunity intelligence platform is now available to clients. The platform includes automated SAM.gov scanning, multi-factor scoring, deadline alerts, and secure multi-tenant workspaces.',
  },
  {
    date: 'March 2026',
    category: 'Feature',
    title: 'AI-Powered Opportunity Scoring Now Live',
    excerpt: 'Our scoring engine now evaluates every opportunity against your business profile using NAICS codes, keyword matching, set-aside eligibility, agency history, contract type preferences, and timeline analysis. Each opportunity receives a composite score to help you prioritize your pipeline.',
  },
  {
    date: 'March 2026',
    category: 'Feature',
    title: 'Automated Deadline Alerts and Reminders',
    excerpt: 'Never miss a response deadline again. RFP Finder now sends automated email notifications when tracked opportunities approach their close dates, with configurable lead times for 30-day, 14-day, and 7-day reminders.',
  },
  {
    date: 'February 2026',
    category: 'Company',
    title: 'Eric Wagner Launches RFP Finder',
    excerpt: 'After two decades of supporting startups and federal contracting, Eric Wagner has founded RFP Finder to bring enterprise-grade opportunity intelligence to small businesses. Drawing on his experience securing over $100M in non-dilutive capital and advising 40+ startups on SBIR/STTR programs, Eric is building the tool he wished existed.',
  },
  {
    date: 'February 2026',
    category: 'Partnership',
    title: 'Accelerator Program Integration',
    excerpt: 'RFP Finder is now available as a batch onboarding solution for startup accelerator programs. Cohort managers can set up workspaces for all participants, enabling centralized pipeline tracking and mentorship support across the program.',
  },
  {
    date: 'January 2026',
    category: 'Product',
    title: 'Beta Testing Complete: Results Exceed Expectations',
    excerpt: 'Our beta program with a select group of defense technology startups and small businesses has concluded. Beta participants reported an average 85% reduction in opportunity search time and identified 3x more relevant opportunities compared to manual SAM.gov searches.',
  },
]

export default function AnnouncementsPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          eyebrow="News & Announcements"
          title="What's new at RFP Finder"
          description="Product updates, company news, and important announcements for our customers and community."
        />
      </section>

      <Section className="bg-surface-50">
        <div className="mx-auto max-w-3xl space-y-5">
          {announcements.map((item, i) => (
            <ContentCard
              key={i}
              date={item.date}
              category={item.category}
              title={item.title}
              excerpt={item.excerpt}
            />
          ))}
        </div>
      </Section>

      <CtaSection
        title="Stay informed"
        description="Contact us to learn more about upcoming features and how RFP Finder can help your business."
        primaryLabel="Get Started"
        primaryHref="/get-started"
        secondaryLabel="See our tips & tools"
        secondaryHref="/tips"
      />
    </>
  )
}
