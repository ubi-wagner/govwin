import type { Metadata } from 'next'
import { Section, SectionHeader, TeamCard, StatHighlight, CtaSection } from '@/components/page-sections'

export const metadata: Metadata = {
  title: 'Our Team | RFP Finder',
  description: 'Meet the team behind RFP Finder — decades of experience in federal contracting, technology commercialization, and startup support.',
}

export default function TeamPage() {
  return (
    <>
      <Section>
        <SectionHeader
          eyebrow="Our Team"
          title="Led by a proven federal contracting expert"
          description="RFP Finder is built on decades of hands-on experience securing federal funding, launching startups, and navigating government procurement."
        />

        <div className="mx-auto mt-12 max-w-3xl">
          <TeamCard
            name="Eric Wagner"
            title="Founder & CEO"
            linkedIn="https://www.linkedin.com/in/eric-wagner-7480385/"
            bio={[
              'Eric Wagner is a C-Suite executive, inventor, entrepreneur, and investor with more than 20 years of technology commercialization experience. He launched RFP Finder in early 2026 to solve a problem he has seen firsthand: small businesses and startups struggle to find and win the federal contracts they deserve.',
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
      <Section className="bg-gray-50">
        <SectionHeader
          eyebrow="Track Record"
          title="Numbers that speak for themselves"
        />
        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          <StatHighlight value="$100M+" label="Non-Dilutive Capital" description="Acquired for clients and portfolio companies" />
          <StatHighlight value="13/13" label="SBIR/STTR Awards" description="100% success rate in most recent cohort" />
          <StatHighlight value="40+" label="Startups Advised" description="On Air Force APEX program" />
          <StatHighlight value="50+" label="Companies Supported" description="Early-stage technology ventures" />
        </div>
        <div className="mx-auto mt-8 grid max-w-4xl grid-cols-2 gap-8 sm:grid-cols-4">
          <StatHighlight value="20+" label="Startups Launched" description="From Ohio State University" />
          <StatHighlight value="$270M+" label="Annual Revenue" description="Led as President of D&S Consultants" />
          <StatHighlight value="800+" label="Employees Managed" description="Aerospace & defense operations" />
          <StatHighlight value="$11M" label="Startup Studio" description="Converge Ventures fund" />
        </div>
      </Section>

      <CtaSection
        title="Work with a team that knows federal funding"
        description="Whether you're a first-time SBIR applicant or a seasoned contractor, our expertise helps you compete and win."
        primaryLabel="Get Started"
        secondaryLabel="Learn about the platform"
        secondaryHref="/about"
      />
    </>
  )
}
