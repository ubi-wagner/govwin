import type { Metadata } from 'next'
import { Section, SectionHeader, ContentCard, CtaSection } from '@/components/page-sections'

export const metadata: Metadata = {
  title: 'Tips & Tools | RFP Finder',
  description: 'Expert guidance on federal contracting, SBIR/STTR programs, proposal writing, and winning government contracts.',
}

const tips = [
  {
    date: 'March 2026',
    category: 'SBIR/STTR',
    title: 'How to Write a Winning SBIR Phase I Proposal',
    excerpt: 'A step-by-step guide to structuring your SBIR Phase I proposal for maximum impact. Covers technical objectives, commercialization plans, and common pitfalls that reviewers flag.',
  },
  {
    date: 'March 2026',
    category: 'Getting Started',
    title: 'SAM.gov Registration: The Complete Checklist',
    excerpt: 'Before you can bid on any federal contract, you need to be registered in SAM.gov. This checklist walks you through UEI, CAGE code, entity registration, and common delays to avoid.',
  },
  {
    date: 'March 2026',
    category: 'Strategy',
    title: 'Understanding Set-Aside Categories and How to Leverage Them',
    excerpt: 'Small business, SDVOSB, WOSB, HUBZone, and 8(a) set-asides can dramatically improve your win probability. Learn which certifications apply to your business and how to use them strategically.',
  },
  {
    date: 'February 2026',
    category: 'Tools',
    title: 'Building Your Capability Statement: A Template and Guide',
    excerpt: 'Your capability statement is your first impression with federal buyers. We break down the four essential sections and provide a template that government contracting officers actually want to see.',
  },
  {
    date: 'February 2026',
    category: 'SBIR/STTR',
    title: 'Non-Dilutive Capital: Why SBIR/STTR Is the Best Funding for Deep Tech',
    excerpt: 'For technology startups, SBIR/STTR grants offer something venture capital cannot: funding without equity dilution. Learn how to build a sustainable federal R&D funding strategy.',
  },
  {
    date: 'February 2026',
    category: 'Strategy',
    title: 'How to Read a Federal Solicitation in 15 Minutes',
    excerpt: 'Federal RFPs can be hundreds of pages long. Learn the key sections to focus on, how to identify evaluation criteria, and the red flags that signal an opportunity is wired for an incumbent.',
  },
  {
    date: 'January 2026',
    category: 'Tools',
    title: 'NAICS Code Selection: Getting It Right the First Time',
    excerpt: 'Choosing the wrong NAICS codes means missing opportunities. This guide explains how to select primary and secondary codes that maximize your visibility in federal procurement searches.',
  },
  {
    date: 'January 2026',
    category: 'Strategy',
    title: 'The Art of the Sources Sought Response',
    excerpt: 'Sources sought notices are your chance to shape a future solicitation. Learn how to write a response that positions your company as a credible contender before the RFP even drops.',
  },
]

const tools = [
  {
    name: 'SBIR/STTR Eligibility Checker',
    description: 'Quick assessment of whether your company qualifies for Small Business Innovation Research or Small Business Technology Transfer programs.',
    status: 'Available',
  },
  {
    name: 'Capability Statement Template',
    description: 'Professional template following federal formatting standards. Includes sections for core competencies, past performance, differentiators, and company data.',
    status: 'Available',
  },
  {
    name: 'NAICS Code Lookup',
    description: 'Search and identify the NAICS codes most relevant to your products and services for federal procurement matching.',
    status: 'Available',
  },
  {
    name: 'Proposal Cost Volume Calculator',
    description: 'Spreadsheet tool for building compliant cost volumes for SBIR Phase I and Phase II proposals.',
    status: 'Coming Soon',
  },
  {
    name: 'Past Performance Tracker',
    description: 'Template for organizing your past performance references in the format federal evaluators expect.',
    status: 'Coming Soon',
  },
]

export default function TipsPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          eyebrow="Tips & Tools"
          title="Expert resources for federal contracting"
          description="Practical guidance from a team that has helped secure over $100M in non-dilutive federal funding. Updated regularly with new strategies and tools."
        />
      </section>

      {/* Tips / Articles */}
      <Section className="bg-surface-50">
        <SectionHeader
          eyebrow="Latest Tips"
          title="Strategies that win federal contracts"
        />
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {tips.map((tip, i) => (
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
          {tools.map(tool => (
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
        description="Our team has helped over 40 startups navigate SBIR/STTR programs with a 100% success rate in our most recent cohort."
        primaryLabel="Start Free Trial"
        primaryHref="/get-started"
        secondaryLabel="Meet the expert"
        secondaryHref="/team"
      />
    </>
  )
}
