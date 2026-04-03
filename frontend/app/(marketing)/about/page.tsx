import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { AboutPageContent } from '@/types'

const STATIC_CONTENT: AboutPageContent = {
  hero: {
    eyebrow: 'Our Mission',
    title: 'We Built It So You Don\'t Have To',
    description:
      'We always wanted this system but didn\'t have the team to build it. So we built it — so you don\'t need a team to succeed.',
  },
  problem: {
    eyebrow: 'The Problem We Solve',
    title: 'Innovation Shouldn\'t Die in a SAM.gov Search Bar',
    paragraphs: [
      'Every small tech company knows the pain. You have brilliant technology — but winning federal contracts means drowning in procurement paperwork, navigating scattered opportunity databases, and decoding evaluation criteria written for insiders.',
      'To compete, you needed a BD team, proposal writers, a pipeline manager, and consultants. That is a six-figure investment before you submit a single proposal.',
      'Most companies can\'t afford that. So the best ideas never get funded, the best technology never gets fielded, and innovation stalls — not because the talent isn\'t there, but because the system is broken.',
      'We refused to let that stand.',
    ],
  },
  flow: [
    {
      step: '01',
      label: 'Scan',
      description: 'AI agents continuously monitor SAM.gov, grants.gov, and agency forecasts to surface relevant opportunities in real time.',
    },
    {
      step: '02',
      label: 'Score',
      description: 'Every opportunity is evaluated against your capabilities, past performance, and win probability — not just keyword matches.',
    },
    {
      step: '03',
      label: 'Build',
      description: 'Guided proposal development with expert-trained templates, compliance checks, and section-by-section AI assistance.',
    },
    {
      step: '04',
      label: 'Win',
      description: 'Submit stronger proposals in less time. Track outcomes. Learn from every cycle to sharpen the next one.',
    },
  ],
  approach: {
    eyebrow: 'Our Approach',
    title: 'AI Agents Trained by the Best to Be the Best',
    paragraphs: [
      'RFP Pipeline is not generic AI bolted onto a government database. Every score, every template, every recommendation comes from someone who has actually won — decades of real-world capture management, proposal development, and federal R&D strategy baked into the system.',
      'The AI doesn\'t guess. It learned from decades of wins. It knows what evaluators look for, how to structure a technical volume, when a topic is worth pursuing, and when it isn\'t.',
      'Built on decades of expert knowledge to deliver high-impact, low-friction, cost-effective opportunity-to-proposal-to-win capabilities — without the cost of a team or external consultants.',
    ],
  },
}

const STATIC_META = {
  title: 'About | RFP Pipeline',
  description:
    'We built the SBIR/STTR system we always wanted — so you don\'t need a team to succeed. AI agents trained by the best to be the best.',
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
      {/* Hero — The Manifesto */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            We Built It So You{' '}
            <span className="bg-gradient-to-r from-brand-600 to-cyan-500 bg-clip-text text-transparent">
              Don&apos;t Have To
            </span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* The Problem We Solve */}
      <Section className="bg-white">
        <div className="mx-auto max-w-3xl">
          <SectionHeader
            eyebrow={content.problem.eyebrow}
            title={content.problem.title}
            center={false}
          />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-gray-600">
            {content.problem.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </Section>

      {/* What We Built — System Overview */}
      <section className="bg-slate-900 px-4 py-20 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-brand-400">
              What We Built
            </p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              From Opportunity to Win — One System
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">
              RFP Pipeline replaces the team you could never afford with an
              integrated workflow that handles the entire capture lifecycle.
            </p>
          </div>

          {/* Flow steps */}
          <div className="relative mt-16 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {content.flow.map((item, i) => (
              <div key={item.step} className="relative rounded-xl border border-slate-700/60 bg-slate-800/50 p-6">
                {/* Connector arrow (hidden on last item and on mobile) */}
                {i < content.flow.length - 1 && (
                  <div className="absolute -right-4 top-1/2 z-10 hidden -translate-y-1/2 text-brand-400 lg:block">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 20 20" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10h10m-4-4 4 4-4 4" />
                    </svg>
                  </div>
                )}
                <p className="text-xs font-bold uppercase tracking-widest text-brand-400">
                  {item.step}
                </p>
                <h3 className="mt-2 text-xl font-bold text-white">{item.label}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Our Approach */}
      <section className="bg-surface-50 px-4 py-20 sm:px-6 sm:py-24 lg:px-8 border-y border-gray-200/60">
        <div className="mx-auto max-w-3xl">
          <SectionHeader
            eyebrow={content.approach.eyebrow}
            title={content.approach.title}
            center={false}
          />
          <div className="mt-8 space-y-5 text-base leading-relaxed text-gray-600">
            {content.approach.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Card */}
      <Section className="bg-white">
        <div className="mx-auto max-w-2xl">
          <div className="rounded-2xl border border-gray-200/80 bg-gradient-to-br from-brand-50 to-white p-8 text-center shadow-card sm:p-10">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl">
              Ready to Win Without the Overhead?
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-gray-600">
              See how RFP Pipeline turns scattered opportunities into winning
              proposals — without the cost of a BD team.
            </p>
            <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/get-started"
                className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 transition-colors"
              >
                Start Free Trial
              </Link>
              <Link
                href="/team"
                className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-400 transition-colors"
              >
                Meet the Founder
              </Link>
            </div>
          </div>
        </div>
      </Section>
    </>
  )
}
