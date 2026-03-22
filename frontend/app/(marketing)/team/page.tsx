import type { Metadata } from 'next'
import { Section, SectionHeader, TeamCard, StatHighlight, CtaSection } from '@/components/page-sections'
import { getPageContent, mergeContent, mergeMetadata } from '@/lib/content'
import type { TeamPageContent } from '@/types'

const STATIC_CONTENT: TeamPageContent = {
  hero: {
    eyebrow: 'Our Team',
    title: 'Led by a proven federal contracting expert',
    description: 'RFP Pipeline is built on decades of hands-on experience securing federal funding, launching startups, and navigating government procurement.',
  },
  members: [
    {
      name: 'Eric Wagner',
      title: 'Founder & CEO',
      linkedIn: 'https://www.linkedin.com/in/eric-wagner-7480385/',
      bio: [
        'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience. He launched RFP Pipeline in early 2026 to solve a problem he has seen firsthand: small businesses and startups struggle to find and win the federal contracts they deserve.',
        'Eric is the co-founder, CSO and EVP of Business Development at Converge Technologies, a technology commercialization company with a successful history of supporting early-stage technology startups. He is also the co-founder and CEO of Converge Ventures, an $11 million startup studio developing high-potential companies from innovation at Ohio universities and federal laboratories.',
        'Prior to founding Converge, Eric was a founding executive at Ohio State University\'s Center for Design and Manufacturing Excellence (CDME), where he created and program-managed the Manufacturing Extension Partnership (MEP) program supporting small businesses across 35+ counties. At CDME, Eric supported the growth of over 50 early-stage technology companies and led the formation and launch of 20+ technology-focused startups from Ohio State.',
        'Eric served as President of D&S Consultants, an aerospace and defense commercialization company with annual revenues exceeding $270 million and more than 800 employees. He held positions of increasing responsibility over 12 years — from Vice President to COO to President — overseeing mergers and acquisitions, commercial product development, and strategic growth.',
        'Most recently, Eric led a Dayton regional technology accelerator funded by Parallax Advanced Research, graduating 8 startups that rapidly advanced their growth. He also serves as a senior advisory consultant to the Air Force\'s APEX commercialization program, where he has advised more than 40 startups on SBIR/STTR participation. Eric is considered an expert in non-dilutive capital — his most recent cohort submitted 13 proposals and received 13 awards, an unheard-of 100% success rate. Over the last decade, he has led or supported the acquisition of more than $100 million in non-dilutive capital.',
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
    { value: '40+', label: 'Startups Advised', description: 'On Air Force APEX program' },
    { value: '50+', label: 'Companies Supported', description: 'Early-stage technology ventures' },
    { value: '20+', label: 'Startups Launched', description: 'From Ohio State University' },
    { value: '$270M+', label: 'Annual Revenue', description: 'Led as President of D&S Consultants' },
    { value: '800+', label: 'Employees Managed', description: 'Aerospace & defense operations' },
    { value: '$11M', label: 'Startup Studio', description: 'Converge Ventures fund' },
  ],
export const metadata: Metadata = {
  title: 'Our Team | RFP Pipeline',
  description: 'Meet the team behind RFP Pipeline — decades of experience in federal contracting, technology commercialization, and startup support.',
}

const STATIC_META = {
  title: 'Our Team | RFP Pipeline',
  description: 'Meet the team behind RFP Pipeline — decades of experience in federal contracting, technology commercialization, and startup support.',
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
      {/* Hero */}
      <section className="relative overflow-hidden bg-white px-4 pt-16 pb-8 sm:px-6 sm:pt-24 sm:pb-12 lg:px-8">
        <div className="absolute inset-0 -z-10 bg-hero-mesh" />
        <SectionHeader
          eyebrow={content.hero.eyebrow}
          title={content.hero.title}
          description={content.hero.description}
          eyebrow="Our Team"
          title="Led by a proven federal contracting expert"
          description="RFP Pipeline is built on decades of hands-on experience securing federal funding, launching startups, and navigating government procurement."
        />
      </section>

      <Section className="bg-surface-50">
        <div className="mx-auto max-w-3xl">
          {content.members.map((member, i) => (
            <TeamCard
              key={i}
              name={member.name}
              title={member.title}
              linkedIn={member.linkedIn}
              bio={member.bio}
              credentials={member.credentials}
            />
          ))}
          <TeamCard
            name="Eric Wagner"
            title="Founder & CEO"
            linkedIn="https://www.linkedin.com/in/eric-wagner-7480385/"
            bio={[
              'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience. He launched RFP Pipeline in early 2026 to solve a problem he has seen firsthand: small businesses and startups struggle to find and win the federal contracts they deserve.',
              'Eric is the co-founder, CSO and EVP of Business Development at Converge Technologies, a technology commercialization company with a successful history of supporting early-stage technology startups. He is also the co-founder and CEO of Converge Ventures, an $11 million startup studio developing high-potential companies from innovation at Ohio universities and federal laboratories.',
              'Prior to founding Converge, Eric was a founding executive at Ohio State University\'s Center for Design and Manufacturing Excellence (CDME), where he created and program-managed the Manufacturing Extension Partnership (MEP) program supporting small businesses across 35+ counties. At CDME, Eric supported the growth of over 50 early-stage technology companies and led the formation and launch of 20+ technology-focused startups from Ohio State.',
              'Eric served as President of D&S Consultants, an aerospace and defense commercialization company with annual revenues exceeding $270 million and more than 800 employees. He held positions of increasing responsibility over 12 years — from Vice President to COO to President — overseeing mergers and acquisitions, commercial product development, and strategic growth.',
              'Most recently, Eric led a Dayton regional technology accelerator funded by Parallax Advanced Research, graduating 8 startups that rapidly advanced their growth. He also serves as a senior advisory consultant to the Air Force\'s APEX commercialization program, where he has advised more than 40 startups on SBIR/STTR participation. Eric is considered an expert in non-dilutive capital — his most recent cohort submitted 13 proposals and received 13 awards, an unheard-of 100% success rate. Over the last decade, he has led or supported the acquisition of more than $100 million in non-dilutive capital.',
            ]}
            credentials={[
              'BS in Computer Science (cum laude) — The Ohio State University',
              'Executive MBA (magna cum laude, Salutatorian, Pace Setter Award) — The Ohio State University',
              'Ohio TechAngels member and active angel investor',
              'I-Corps@Ohio founding instructor (Engineering & Physical Sciences)',
            ]}
          />
        </div>
      </Section>

      {/* Track record stats */}
      <Section className="bg-white">
        <SectionHeader
          eyebrow="Track Record"
          title="Numbers that speak for themselves"
        />
        <div className="mx-auto mt-14 grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          {content.stats.slice(0, 4).map((s, i) => (
            <StatHighlight key={i} value={s.value} label={s.label} description={s.description} />
          ))}
        </div>
        {content.stats.length > 4 && (
          <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
            {content.stats.slice(4).map((s, i) => (
              <StatHighlight key={i} value={s.value} label={s.label} description={s.description} />
            ))}
          </div>
        )}
      </Section>

      <CtaSection
        title="Work with a team that knows federal funding"
        description="Whether you're a first-time SBIR applicant or a seasoned contractor, our expertise helps you compete and win."
        primaryLabel="Start Free Trial"
        primaryHref="/get-started"
        secondaryLabel="Learn about the platform"
        secondaryHref="/about"
      />
    </>
  )
}
