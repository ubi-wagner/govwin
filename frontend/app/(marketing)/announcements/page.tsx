import type { Metadata } from 'next'
import { Section, SectionHeader, ContentCard, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AnnouncementsPageContent } from '@/types'

// Static defaults — used when no published content exists in DB
const STATIC_CONTENT: AnnouncementsPageContent = {
  hero: {
    eyebrow: 'News & Announcements',
    title: "What's new at GovWin",
    description: 'Product updates, company news, and announcements about our SBIR/STTR opportunity intelligence platform.',
  },
  items: [
    {
      date: 'April 2026',
      category: 'Product',
      title: 'GovWin SBIR/STTR Intelligence Platform — Launching Soon',
      excerpt: 'We are building the definitive platform for small businesses pursuing SBIR, STTR, OTA, and BAA opportunities. GovWin combines 24/7 opportunity scanning across SAM.gov, SBIR.gov, and agency portals with AI-powered technology matching, deadline intelligence, and expert-reviewed proposal builds. Join the waitlist for early access.',
    },
    {
      date: 'March 2026',
      category: 'Feature',
      title: 'Technology Match Scoring Engine',
      excerpt: 'Our scoring engine evaluates every SBIR/STTR topic against your technology profile using research areas, NAICS codes, TRL level, agency history, and keyword analysis. Each opportunity receives a composite match score so you can focus on the topics built for your technology.',
    },
    {
      date: 'March 2026',
      category: 'Feature',
      title: 'Compound Learning Library',
      excerpt: 'Every proposal you build with GovWin adds to your reusable content library. Team bios, past performance narratives, technical capabilities, and facility descriptions are stored and indexed. The AI learns your language, making each subsequent proposal faster to assemble.',
    },
    {
      date: 'February 2026',
      category: 'Company',
      title: 'Eric Wagner Founds GovWin',
      excerpt: 'After 20+ years helping startups win SBIR/STTR awards — including a recent 13/13 win rate and over $100M in non-dilutive capital secured — Eric Wagner has founded GovWin to bring expert-level SBIR/STTR intelligence to every small tech business. The platform combines the scanning and scoring tools with the proposal expertise that produced those results.',
    },
    {
      date: 'February 2026',
      category: 'Feature',
      title: 'Proposal Build Service: $499 Phase I / $999 Phase II',
      excerpt: 'GovWin now offers expert-reviewed proposal templates with AI-assisted content assembly. Purchase a proposal build, receive a custom template matched to your solicitation within one week, and use our section-by-section workspace to assemble your submission. SBIR consultants charge $3K-$10K. We charge $499.',
    },
    {
      date: 'January 2026',
      category: 'Partnership',
      title: 'Accelerator and University Partnership Program',
      excerpt: 'GovWin is now available for startup accelerators, university tech transfer offices, and innovation programs. Batch onboard your cohort and give every participant a scored SBIR/STTR pipeline from day one. Partners include Air Force APEX, Parallax Advanced Research, Ohio State CDME, and Converge Ventures.',
    },
  ],
}

const STATIC_META = {
  title: 'News & Announcements | GovWin',
  description: 'Latest news, product updates, and announcements from GovWin SBIR/STTR Intelligence.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('announcements')
  const meta = mergeMetadata(published?.metadata ?? null, STATIC_META)
  return meta
}

export default async function AnnouncementsPage() {
  const published = await getPageContent('announcements')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          eyebrow={content.hero.eyebrow}
          title={content.hero.title}
          description={content.hero.description}
        />
      </section>

      <Section className="bg-surface-50">
        <div className="mx-auto max-w-3xl space-y-5">
          {content.items.map((item, i) => (
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
        title="Join the waitlist"
        description="Be the first to know when GovWin launches. Early subscribers get priority onboarding and launch pricing."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="SBIR/STTR resources"
        secondaryHref="/tips"
      />
    </>
  )
}
