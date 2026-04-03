import type { Metadata } from 'next'
import Link from 'next/link'
import { Section, SectionHeader, TeamCard, StatHighlight, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { TeamPageContent } from '@/types'

const STATIC_CONTENT: TeamPageContent = {
  hero: {
    eyebrow: 'Leadership',
    title: 'Built by someone who has done it 100+ times',
    description: 'RFP Pipeline was not built by software engineers guessing about government contracting. It was built by someone who has personally helped secure over $100M in non-dilutive funding.',
  },
  members: [
    {
      name: 'Eric Wagner',
      title: 'Founder & CEO',
      linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
      bio: [
        'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience. He launched RFP Pipeline to solve a problem he has seen firsthand hundreds of times: brilliant small businesses struggle to find and win the federal contracts they deserve — not because their technology is weak, but because the procurement process is opaque, fragmented, and unforgiving.',
        'Eric is the co-founder, CSO and EVP of Business Development at Converge Technologies, and the co-founder and CEO of Converge Ventures, an $11 million startup studio developing high-potential companies from innovation at Ohio universities and federal laboratories.',
        'He created and program-managed the Manufacturing Extension Partnership (MEP) program at Ohio State University\'s CDME, supporting small businesses across 35+ counties and leading the formation of 20+ technology-focused startups. He served as President of D&S Consultants, an aerospace and defense company with $270M in annual revenue and 800+ employees.',
        'Most recently, Eric served as a senior advisory consultant to the Air Force\'s APEX commercialization program, where he advised 40+ startups on SBIR/STTR participation. His most recent cohort submitted 13 proposals and received 13 awards — an unheard-of 100% success rate.',
      ],
      credentials: [
        'BS in Computer Science (cum laude) — The Ohio State University',
        'Executive MBA (magna cum laude, Salutatorian, Pace Setter Award) — The Ohio State University',
        'Ohio TechAngels member and active angel investor',
        'I-Corps@Ohio founding instructor (Engineering & Physical Sciences)',
      ],
    },
  ],
  stats: [
    { value: '$100M+', label: 'Non-Dilutive Capital', description: 'Acquired for clients and portfolio companies' },
    { value: '13/13', label: 'SBIR/STTR Awards', description: '100% success rate in most recent cohort' },
    { value: '40+', label: 'Startups Advised', description: 'Through Air Force APEX program' },
    { value: '50+', label: 'Companies Supported', description: 'Early-stage technology ventures' },
    { value: '20+', label: 'Startups Launched', description: 'From Ohio State University' },
    { value: '$270M+', label: 'Revenue Managed', description: 'As President of D&S Consultants' },
    { value: '800+', label: 'Employees Led', description: 'Aerospace & defense operations' },
    { value: '$11M', label: 'Startup Studio', description: 'Converge Ventures fund' },
  ],
}

const STATIC_META = {
  title: 'Our Team | RFP Pipeline',
  description: 'Meet Eric Wagner — 20+ years of technology commercialization, $100M+ in non-dilutive capital secured, and a 13/13 SBIR/STTR win rate.',
}

export async function generateMetadata(): Promise<Metadata> {
  const published = await getPageContent('team')
  return mergeMetadata(published?.metadata ?? null, STATIC_META)
}

export default async function TeamPage() {
  const published = await getPageContent('team')
  const content = mergeContent(published?.content ?? null, STATIC_CONTENT)

  return (
    <>
      {/* ───── Hero ───── */}
      <section className="relative overflow-hidden bg-white px-4 pt-20 pb-12 sm:px-6 sm:pt-28 sm:pb-16 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <div className="absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-brand-500/5 blur-3xl" />

        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-brand-600/10">
            {content.hero.eyebrow}
          </div>
          <h1 className="mt-6 text-4xl font-extrabold tracking-tight text-gray-900 sm:text-5xl lg:text-6xl">
            Built by someone who has{' '}
            <span className="bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">done it 100+ times</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-gray-600">
            {content.hero.description}
          </p>
        </div>
      </section>

      {/* ───── Key stats banner ───── */}
      <section className="border-y border-gray-100 bg-gray-950 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {content.stats.slice(0, 4).map((s, i) => (
            <div key={i} className="text-center">
              <p className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{s.value}</p>
              <p className="mt-1 text-sm font-semibold text-gray-300">{s.label}</p>
              <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ───── Founder profile ───── */}
      <Section className="bg-white">
        <div className="mx-auto max-w-4xl">
          {content.members.map((member, i) => (
            <div key={i} className="rounded-2xl border border-gray-200/80 bg-white shadow-card overflow-hidden">
              {/* Header bar */}
              <div className="bg-gradient-to-r from-gray-950 to-gray-800 px-8 py-6">
                <div className="flex items-center gap-5">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-sm text-white border border-white/10">
                    <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{member.name}</h2>
                    <p className="text-sm font-semibold text-brand-300">{member.title}</p>
                    {member.linkedIn && (
                      <a
                        href={member.linkedIn}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors"
                      >
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                        Connect on LinkedIn
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {/* Bio */}
              <div className="px-8 py-8">
                <div className="space-y-4">
                  {member.bio.map((paragraph, j) => (
                    <p key={j} className="text-sm leading-relaxed text-gray-600">{paragraph}</p>
                  ))}
                </div>

                {member.credentials && member.credentials.length > 0 && (
                  <div className="mt-8 border-t border-gray-100 pt-6">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-gray-400">Education & Credentials</h4>
                    <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {member.credentials.map((c, j) => (
                        <li key={j} className="flex items-start gap-2.5 rounded-xl bg-surface-50 px-4 py-3 text-sm text-gray-600">
                          <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 0 0-.491 6.347A48.62 48.62 0 0 1 12 20.904a48.62 48.62 0 0 1 8.232-4.41 60.46 60.46 0 0 0-.491-6.347m-15.482 0a50.636 50.636 0 0 0-2.658-.813A59.906 59.906 0 0 1 12 3.493a59.903 59.903 0 0 1 10.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0 1 12 13.489a50.702 50.702 0 0 1 7.74-3.342" />
                          </svg>
                          {c}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* ───── Extended track record ───── */}
      {content.stats.length > 4 && (
        <Section className="bg-surface-50">
          <SectionHeader
            eyebrow="Full Track Record"
            title="The numbers behind the expertise"
          />
          <div className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-6 sm:grid-cols-4">
            {content.stats.slice(4).map((s, i) => (
              <div key={i} className="rounded-2xl border border-gray-200/80 bg-white p-6 text-center shadow-card">
                <p className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-brand-600 to-brand-500 bg-clip-text text-transparent">{s.value}</p>
                <p className="mt-1.5 text-sm font-bold text-gray-900">{s.label}</p>
                <p className="mt-0.5 text-xs text-gray-500">{s.description}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ───── CTA ───── */}
      <CtaSection
        title="Work with a team that knows federal funding"
        description="Whether you are a first-time SBIR applicant or a seasoned contractor, our expertise is built into every score, every template, and every recommendation."
        primaryLabel="Get Started"
        primaryHref="/get-started"
        secondaryLabel="See our wins"
        secondaryHref="/customers"
      />
    </>
  )
}
