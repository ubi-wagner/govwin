import type { Metadata } from 'next'
import { Section, SectionHeader, ContentCard, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { TipsPageContent } from '@/types'

const STATIC_CONTENT: TipsPageContent = {
  hero: {
    eyebrow: 'SBIR/STTR Resources',
    title: 'Expert guidance for winning federal research funding',
    description: 'Practical tips from a team with a 13/13 SBIR/STTR win rate and $100M+ in non-dilutive capital secured. Everything you need to find, pursue, and win SBIR/STTR awards.',
  },
  tips: [
    { date: 'March 2026', category: 'Proposal Writing', title: 'How to Write a Winning SBIR Phase I Proposal', excerpt: 'A step-by-step guide to structuring your SBIR Phase I proposal for maximum reviewer impact. Covers technical objectives, innovation significance, commercialization strategy, and the common pitfalls that cost small businesses their first award.' },
    { date: 'March 2026', category: 'Solicitation Cycle', title: 'Understanding the SBIR/STTR Release Calendar', excerpt: 'SBIR and STTR solicitations follow agency-specific release cycles. DoD opens annually, NIH has three receipt dates per year, and NSF accepts proposals year-round. Knowing the rhythm means you are never caught off guard.' },
    { date: 'March 2026', category: 'Agency Guidance', title: 'DoD SBIR: What AFRL, DARPA, and Service Branches Actually Want', excerpt: 'Each DoD component evaluates SBIR proposals differently. AFRL values TRL advancement, DARPA wants breakthrough concepts, and the service branches prioritize operational relevance. Tailor your approach to the evaluator.' },
    { date: 'February 2026', category: 'Common Mistakes', title: '7 Mistakes That Kill SBIR Proposals (and How to Avoid Them)', excerpt: 'From weak commercialization plans to ignoring evaluation criteria weighting, these are the errors we see most often. Every one of them is preventable with the right preparation.' },
    { date: 'February 2026', category: 'Proposal Writing', title: 'STTR Proposals: Navigating the Research Institution Partnership', excerpt: 'STTR requires a formal partnership with a research institution performing at least 30% of the work. Learn how to structure the partnership agreement, divide responsibilities, and present a cohesive technical approach.' },
    { date: 'February 2026', category: 'Strategy', title: 'Phase I to Phase II: Building Your Transition Strategy from Day One', excerpt: 'Phase II success starts during Phase I. Learn how to design your Phase I technical plan to generate the results and data that Phase II reviewers want to see. The transition is not automatic — you need to earn it.' },
    { date: 'January 2026', category: 'Agency Guidance', title: 'NIH SBIR/STTR: Specific Aims, Study Sections, and Review Criteria', excerpt: 'NIH uses a peer review process with study sections that score on significance, approach, innovation, investigators, and environment. Understanding this system is essential for biotech and medtech applicants.' },
    { date: 'January 2026', category: 'Strategy', title: 'Non-Dilutive Capital Strategy: Building a Multi-Agency SBIR Pipeline', excerpt: 'The most successful SBIR companies do not rely on a single agency. Learn how to identify parallel topics across DoD, NIH, NSF, DOE, and NASA to build a diversified pipeline of non-dilutive funding.' },
  ],
  tools: [
    { name: 'SBIR.gov', description: 'The official U.S. government portal for SBIR and STTR solicitations, awards, and program information across all participating agencies.', status: 'Available' },
    { name: 'SAM.gov', description: 'System for Award Management — required registration for all federal contracting. Search active solicitations, entity registrations, and contract award data.', status: 'Available' },
    { name: 'SBIR/STTR Eligibility Checker', description: 'Quick assessment of whether your company meets the size, ownership, and organizational requirements for SBIR and STTR programs.', status: 'Available' },
    { name: 'Proposal Cost Volume Calculator', description: 'Spreadsheet tool for building compliant cost volumes for SBIR Phase I ($50K-$275K) and Phase II ($500K-$1.5M) proposals across agencies.', status: 'Available' },
    { name: 'Agency SBIR Portal Directory', description: 'Direct links to SBIR/STTR portals for DoD, NIH, NSF, DOE, NASA, DHS, USDA, EPA, and all other participating agencies.', status: 'Available' },
  ],
}

const STATIC_META = {
  title: 'SBIR/STTR Tips & Resources | RFP Pipeline',
  description: 'Expert guidance on SBIR/STTR proposal writing, solicitation cycles, agency-specific strategies, and common mistakes to avoid. From a team with a 13/13 win rate.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('tips')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function TipsPage() {
  const published = await getPageContent('tips')
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

      {/* Tips / Articles */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Latest Tips"
          title="Strategies that win federal contracts"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {content.tips.map((tip, i) => (
            <ContentCard
              key={i}
              date={tip.date}
              category={tip.category}
              title={tip.title}
              excerpt={tip.excerpt}
            />
          ))}
        </div>
      </Section>

      {/* Tools */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Free Tools"
          title="Resources to accelerate your federal pipeline"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {content.tools.map(tool => (
            <div key={tool.name} className="group rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900">{tool.name}</h3>
                <span className={tool.status === 'Available' ? 'badge-green' : 'badge-yellow'}>
                  {tool.status}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-500">{tool.description}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaSection
        title="Need personalized guidance?"
        description="Our team has helped 50+ startups navigate SBIR/STTR programs with a 100% recent win rate. Start your free trial and get expert-backed opportunity intelligence."
        primaryLabel="Start Free Trial"
        primaryHref="/get-started"
        secondaryLabel="Meet the Founder"
        secondaryHref="/team"
      />
    </>
  )
}
