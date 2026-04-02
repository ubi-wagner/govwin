import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AboutPageContent } from '@/types'

const STATIC_CONTENT: AboutPageContent = {
  hero: {
    eyebrow: 'About GovWin',
    title: 'Built by people who win SBIR/STTR awards',
    description: 'GovWin was created by a team with 20+ years of SBIR/STTR experience, a 13/13 recent win rate, and over $100M in non-dilutive capital secured for small tech businesses. We built the platform we wished existed.',
  },
  mission: {
    eyebrow: 'Our Mission',
    title: 'Democratize access to federal research funding',
    paragraphs: [
      'The federal government invests billions annually in small business R&D through SBIR, STTR, OTA, and BAA programs. But finding the right opportunities and writing competitive proposals requires expertise that most small businesses cannot afford. The result: great technologies never get funded.',
      'GovWin changes that. Our platform scans every SBIR/STTR solicitation across all federal agencies, scores each topic against your technology profile, and provides expert-reviewed proposal templates with AI-assisted assembly. Every proposal you build makes the next one faster through our compound learning library. Our vision is simple: your 5th proposal should take a fraction of the effort of your first.',
    ],
  },
  features: [
    { icon: '13/13', title: 'Win Rate', description: '100% recent SBIR/STTR success across Phase I and Phase II awards' },
    { icon: '$100M', title: 'Capital Secured', description: 'Non-dilutive funding secured for clients through SBIR, STTR, and related programs' },
    { icon: '50+', title: 'Startups', description: 'Deep tech, defense, biotech, and university spinoff companies supported' },
    { icon: '20+', title: 'Years', description: 'Federal R&D funding, SBIR/STTR programs, and technology commercialization' },
  ],
  howItWorks: [
    { step: '01', title: 'Missed Opportunities', description: 'SBIR/STTR topics are released on unpredictable schedules across dozens of agency portals. Great-fit topics close before you find them.' },
    { step: '02', title: 'Scattered Sources', description: 'SBIR.gov, SAM.gov, agency-specific portals, and email lists — there is no single source of truth for all federal R&D opportunities.' },
    { step: '03', title: 'Proposal Paralysis', description: 'You found a topic, but the 30-page proposal template is intimidating. Where do you start? What does this agency actually want to see?' },
    { step: '04', title: 'Starting From Scratch', description: 'Every proposal feels like the first. Team bios, past performance, facility descriptions — rewritten from zero each time.' },
    { step: '05', title: 'Consultant Costs', description: 'SBIR consultants charge $3K-$10K per proposal. For a small business exploring federal R&D, that math does not work.' },
    { step: '06', title: 'No Feedback Loop', description: 'Win or lose, there is no system to capture what worked and apply it to the next proposal. Institutional knowledge walks out the door.' },
  ],
}

const STATIC_META = {
  title: 'About GovWin | SBIR/STTR Expertise for Small Business',
  description: '20+ years of SBIR/STTR expertise. 13/13 recent win rate. $100M+ in non-dilutive capital secured. Learn how GovWin helps small tech businesses win federal research funding.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('about')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function AboutPage() {
  const published = await getPageContent('about')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl">
            {content.hero.title.includes('federal contracting') ? (
              <>
                Built by people who know{' '}
                <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
                  federal contracting
                </span>
              </>
            ) : (
              content.hero.title
            )}
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* Mission */}
      <Section className="bg-surface-50">
        <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <SectionHeader
              eyebrow={content.mission.eyebrow}
              title={content.mission.title}
              center={false}
            />
            {content.mission.paragraphs.map((p, i) => (
              <p key={i} className={`${i === 0 ? 'mt-6' : 'mt-4'} text-sm leading-relaxed text-gray-600`}>
                {p}
              </p>
            ))}
            <div className="mt-8">
              <Link href="/get-started" className="btn-primary">
                Start Free Trial
                <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            {content.features.map(item => (
              <div key={item.icon} className="group rounded-2xl bg-white p-5 shadow-card border border-gray-200/60 transition-all duration-300 hover:shadow-card-hover hover:-translate-y-0.5">
                <p className="text-3xl font-extrabold bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">{item.icon}</p>
                <p className="mt-2 text-sm font-bold text-gray-900">{item.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      {/* What we solve */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="The Problem We Solve"
          title="Federal contracting is broken for small businesses"
        />
        <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-gray-200 bg-gray-200/60 sm:grid-cols-2 lg:grid-cols-3">
          {content.howItWorks.map(item => (
            <div key={item.step} className="relative bg-white p-6 group hover:bg-brand-50/30 transition-colors">
              <span className="absolute right-4 top-4 text-3xl font-black text-gray-100 group-hover:text-brand-100 transition-colors">{item.step}</span>
              <h3 className="text-sm font-bold text-gray-900">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Contact / Get Started */}
      <Section className="bg-surface-50" id="contact">
        <SectionHeader
          eyebrow="Get Started"
          title="Ready to transform your federal pipeline?"
          description="Contact us to learn how GovWin can help your business find and win SBIR/STTR awards."
        />
        <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-gray-200/80 bg-white p-8 shadow-card">
          <div className="space-y-5 text-center">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50">
              <svg className="h-7 w-7 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
            </div>
            <p className="text-sm text-gray-600">
              Reach out to discuss your SBIR/STTR goals and how we can help you win.
            </p>
            <a
              href="mailto:eric@rfppipeline.com"
              className="block rounded-xl bg-brand-50 px-4 py-3.5 text-sm font-bold text-brand-700 hover:bg-brand-100 transition-all ring-1 ring-brand-600/10"
            >
              eric@rfppipeline.com
            </a>
            <p className="text-xs text-gray-400">
              We typically respond within one business day.
            </p>
          </div>
        </div>
      </Section>

      <CtaSection
        title="Ready to win your next SBIR?"
        description="Join the companies using GovWin to find and win SBIR/STTR awards faster."
        primaryLabel="Join the Waitlist"
        primaryHref="/get-started"
        secondaryLabel="Meet the founder"
        secondaryHref="/team"
      />
    </>
  )
}
