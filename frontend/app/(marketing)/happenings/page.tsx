import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, ContentCard, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { HappeningsPageContent } from '@/types'

const STATIC_CONTENT: HappeningsPageContent = {
  hero: {
    title: 'Insights, Updates, and SBIR Strategy',
    description: 'Product news, funding tips, and tools to sharpen your federal R&D strategy.',
  },
  categories: [
    { slug: 'all', label: 'All' },
    { slug: 'product', label: 'Product Updates' },
    { slug: 'strategy', label: 'SBIR Tips' },
    { slug: 'resources', label: 'Tools & Resources' },
  ],
  items: [
    {
      date: 'April 2026',
      category: 'Product',
      title: 'SBIR Engine Now Covers All 11 Agencies',
      excerpt: 'Full coverage across DoD, NIH, NSF, DOE, NASA, USDA, EPA, DHS, DOT, ED, and DOC. Every open SBIR/STTR solicitation, scored and matched to your technology profile.',
    },
    {
      date: 'March 2026',
      category: 'Product',
      title: 'New Fit Scoring Algorithm Released',
      excerpt: 'Our updated scoring model weighs NAICS codes, research keywords, TRL level, agency history, and past performance to deliver sharper opportunity-to-capability matching.',
    },
    {
      date: 'March 2026',
      category: 'Product',
      title: 'Grants.gov Integration Live',
      excerpt: 'GovWin now ingests and indexes grants from Grants.gov alongside SBIR.gov and SAM.gov sources, giving you a single pane of glass for federal R&D funding.',
    },
    {
      date: 'February 2026',
      category: 'Product',
      title: 'Phase II Build Templates Available',
      excerpt: 'Pre-structured proposal templates for Phase II submissions across all major agencies. Drop in your technical narrative and budget, and the template handles formatting and compliance.',
    },
    {
      date: 'March 2026',
      category: 'Strategy',
      title: 'How to Decide What to Pursue',
      excerpt: 'Not every solicitation is worth your time. Learn the five-factor framework we use to evaluate whether an SBIR topic is a strong fit before committing resources.',
    },
    {
      date: 'March 2026',
      category: 'Strategy',
      title: '5 Common SBIR Proposal Mistakes',
      excerpt: 'Weak commercialization plans, ignoring evaluation criteria, and three other preventable errors that cost small businesses their shot at non-dilutive funding.',
    },
    {
      date: 'February 2026',
      category: 'Strategy',
      title: 'Understanding SBIR Release Cycles',
      excerpt: 'DoD opens annually, NIH has three receipt dates per year, and NSF accepts proposals year-round. Map the calendar so you are never scrambling at the last minute.',
    },
    {
      date: 'February 2026',
      category: 'Strategy',
      title: 'Phase I vs Phase II: What Changes',
      excerpt: 'Phase II proposals demand stronger preliminary data, a clear commercialization path, and a larger budget justification. Here is what shifts between the two stages.',
    },
  ],
  resources: [
    {
      title: 'SBIR Proposal Checklist',
      description: 'A step-by-step checklist covering every required section for SBIR Phase I and Phase II proposals across major agencies.',
      type: 'Template',
    },
    {
      title: 'Agency Comparison Guide',
      description: 'Side-by-side comparison of SBIR programs across DoD, NIH, NSF, DOE, and NASA including award sizes, timelines, and evaluation criteria.',
      type: 'Guide',
    },
    {
      title: 'Budget Template',
      description: 'Pre-built spreadsheet for SBIR cost volumes with line items, indirect rate calculations, and agency-specific formatting.',
      type: 'Template',
    },
    {
      title: 'Capability Statement Builder',
      description: 'Interactive tool to assemble a federal-ready capability statement with your core competencies, past performance, and differentiators.',
      type: 'Tool',
    },
  ],
}

const STATIC_META = {
  title: 'Happenings | RFP Pipeline',
  description: 'Product updates, SBIR tips, and resources to sharpen your federal R&D strategy. Stay current with GovWin insights.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('happenings')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function HappeningsPage() {
  const published = await getPageContent('happenings')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  const productItems = content.items.filter(item => item.category === 'Product')
  const strategyItems = content.items.filter(item => item.category === 'Strategy')

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          title={content.hero.title}
          description={content.hero.description}
        />

        {/* Category filter tabs */}
        <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-2">
          {content.categories.map(cat => (
            <span
              key={cat.slug}
              className="inline-flex cursor-pointer items-center rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider bg-brand-50 text-brand-600 ring-1 ring-brand-600/10 transition-colors hover:bg-brand-100"
            >
              {cat.label}
            </span>
          ))}
        </div>
      </section>

      {/* Section 1: Product Updates */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Product"
          title="Latest updates"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {productItems.map((item, i) => (
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

      {/* Section 2: SBIR Tips */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Strategy"
          title="SBIR tips and guidance"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2">
          {strategyItems.map((item, i) => (
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

      {/* Section 3: Tools & Resources */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Resources"
          title="Tools and resources"
        />
        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {content.resources.map(resource => (
            <div
              key={resource.title}
              className="group rounded-2xl border border-gray-200/80 bg-white p-6 shadow-card transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900">{resource.title}</h3>
                <span className="inline-flex items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700 ring-1 ring-brand-600/10">
                  {resource.type}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-gray-500">{resource.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Newsletter CTA */}
      <Section className="bg-white">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
            Want strategy straight to your inbox?
          </h2>
          <p className="mt-4 text-base leading-relaxed text-gray-500">
            Get SBIR tips, product updates, and funding intel delivered weekly. No spam, just signal.
          </p>
          <div className="mx-auto mt-8 flex max-w-md items-center gap-3 rounded-xl border border-gray-200 bg-surface-50 p-2">
            <div className="flex-1 rounded-lg bg-white px-4 py-2.5 text-sm text-gray-400 ring-1 ring-gray-200">
              you@company.com
            </div>
            <Link
              href="/get-started"
              className="inline-flex shrink-0 items-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
            >
              Subscribe
            </Link>
          </div>
          <p className="mt-3 text-xs text-gray-400">
            Join 500+ SBIR practitioners. Unsubscribe anytime.
          </p>
        </div>
      </Section>

      <CtaSection
        title="Ready to find your next SBIR opportunity?"
        description="GovWin scans every solicitation, scores it against your tech profile, and helps you build winning proposals."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="See how it works"
        secondaryHref="/about"
      />
    </>
  )
}
