import {
  Hero,
  Section,
  SectionHeader,
  FeatureGrid,
  CtaSection,
} from '@/components/marketing/section-layout';

export const metadata = {
  title: 'Eric Wagner — Founder & Expert | RFP Pipeline',
  description:
    '25+ years in technology commercialization. Hundreds of millions in SBIR, STTR, BAA, and OTA funding secured. Former president of a $300M aerospace & defense company. The human expert behind every RFP Pipeline curation.',
};

const credentials = [
  {
    title: 'Funding Secured',
    body: 'Personally secured hundreds of millions of dollars in SBIR, STTR, OTA, BAA, and related federal R&D funding across two decades — both for companies Eric led and for small businesses he advised. Phase I through Phase III, across DoD, NSF, DOE, DARPA, and more.',
  },
  {
    title: 'Operations Scale',
    body: 'Former President of D&S Consultants (DSCI), an aerospace and defense commercialization company. Grew the company from 400 to 750+ employees at 70% CAGR, with 15 worldwide office locations and over $270M in annual revenue at time of departure.',
  },
  {
    title: 'Startup Launch Track Record',
    body: 'Oversaw the successful launch of 22+ startups through The Ohio State University\'s commercialization office. Co-founded Converge Technologies (commercialization services) and served as Co-Fund Manager at Ohio Gateway Tech Fund (pre-seed venture).',
  },
  {
    title: 'Executive Leadership',
    body: 'Chief Executive Officer at Ubihere (2023-2026), Chief Strategy Officer at Lighthouse Avionics and Converge Technologies, Associate Director at Ohio State\'s Center for Design and Manufacturing Excellence. Active startup investor via OTAF and individually.',
  },
];

const timeline = [
  {
    period: '2026 – Present',
    role: 'Founder & CEO',
    company: 'RFP Pipeline',
    body: 'Founded to help small businesses identify, engage, and win non-dilutive federal R&D funding. The company combines the proven commercialization playbook with custom AI agents trained per-customer and curated by human experts.',
  },
  {
    period: '2023 – 2026',
    role: 'Chief Executive Officer',
    company: 'Ubihere',
    body: 'Led the geospatial AI company toward commercialization of patented positioning analytics for asset tracking and vision-based business intelligence. Built the engineering and support teams that realized founder Dr. Alper Yilmaz\'s vision.',
  },
  {
    period: '2023 – 2024',
    role: 'Co-Fund Manager',
    company: 'Ohio Gateway Tech Fund',
    body: 'Led pre-seed investments in Ohio-based technology startups. Established partnership with Ohio Third Frontier\'s Pre-Seed Fund Capitalization Program. Direct role in due diligence and portfolio growth.',
  },
  {
    period: '2019 – 2023',
    role: 'VP, Government Programs',
    company: 'Ubihere',
    body: 'Drove federal program capture for the geospatial analytics company, securing R&D funding that fueled the core patented technology platform.',
  },
  {
    period: '2015 – 2018',
    role: 'Associate Director, CDME',
    company: 'The Ohio State University',
    body: 'Built a statewide support system for manufacturing-ecosystem technology commercialization. Led development of new programs including the Manufacturing Extension Partnership (MEP) and student experiential entrepreneurship (E3) programs.',
  },
  {
    period: '2013 – 2015',
    role: 'Senior Business Analyst',
    company: 'OSU Technology Commercialization Office',
    body: 'Evaluated university technologies and determined the best commercialization path — licensing, partnership, joint venture, or new startup. Oversaw the successful launch of 22+ companies founded on licensed OSU IP.',
  },
  {
    period: '2009 – 2012',
    role: 'President / Chief Strategy Officer',
    company: 'D&S Consultants (DSCI)',
    body: 'Led strategic vision, acquisitions, and organic growth for the aerospace & defense commercialization company. Grew from 400 to 750+ employees with 70% CAGR and $270M+ in annual revenue. 15 global offices.',
  },
  {
    period: '2003 – 2009',
    role: 'SVP & Director / COO',
    company: 'D&S Consultants',
    body: 'Established a new operating division that grew from 14 to 110+ revenue-generating employees via organic growth alone. Launched the company\'s first commercial software product (awarded a patent). Assisted in two synergistic acquisitions.',
  },
  {
    period: '2000 – 2003',
    role: 'Senior Program Manager',
    company: 'D&S Consultants',
    body: 'Technically managed custom software development for federal customers. Grew to 14 employees across 4 programs and established the company\'s overseas presence in Germany (now 30% of company revenue).',
  },
  {
    period: '1998 – 2000',
    role: 'Research Analyst / Program Lead',
    company: 'Southwest Research Institute (SWRI)',
    body: 'Technical lead on a $1.5M/year development effort requiring detailed requirements gathering and analysis. Grew from software developer into program lead. Received multiple customer satisfaction and product awards.',
  },
];

export default function Page() {
  return (
    <>
      <Hero
        variant="light"
        eyebrow="Your Expert"
        headline={<>Eric Wagner</>}
        subheadline="Founder and CEO of RFP Pipeline. 25+ years in technology commercialization. Hundreds of millions in SBIR, STTR, BAA, and OTA funding secured. Former president of a $300M aerospace & defense company. Ohio State commercialization veteran who launched 22+ startups."
      />

      {/* Intro */}
      <Section variant="white">
        <div className="max-w-3xl mx-auto">
          <SectionHeader
            eyebrow="About"
            title="Why I built this"
            align="left"
          />
          <div className="mt-6 space-y-4 text-lg text-gray-700 leading-relaxed">
            <p>
              I&rsquo;ve spent the last two and a half decades helping technology companies
              commercialize innovative work through federal R&amp;D funding. From running a
              750-employee aerospace &amp; defense commercialization company, to leading
              Ohio State&rsquo;s efforts launching 22+ university startups, to directly managing
              pursuit and capture for small businesses, one pattern became impossible to ignore:
            </p>
            <p className="font-semibold text-navy-800">
              Small businesses with genuinely innovative technology routinely lose federal
              R&amp;D funding to bigger shops with dedicated BD departments &mdash; not because
              their technology is weaker, but because they can&rsquo;t dedicate the time to the
              BD work.
            </p>
            <p>
              They miss the right opportunities. They misread compliance requirements. They
              run out of time to write a competitive proposal. And every other tool in the
              market either drowns them in undifferentiated listings or hands them a generic
              LLM that confidently produces non-compliant drafts.
            </p>
            <p>
              I built RFP Pipeline to solve that problem the way I&rsquo;ve been solving it
              manually for 25 years &mdash; except now with AI doing the mechanical work
              (ingestion, pre-extraction, drafting against a verified library) while I
              handle the high-judgment work (curation, strategy, pursuit calls). The
              result is my commercialization playbook, delivered as software, but without
              removing the human expertise that makes it actually work.
            </p>
            <p>
              Our initial cohort is small by design. I want to be hands-on with every
              customer for the first year and prove the value compounds the way I&rsquo;ve
              designed it to. If you&rsquo;re a small business pursuing SBIR, STTR, BAA,
              OTA, or similar federal R&amp;D funding, I&rsquo;d like to help.
            </p>
            <p className="pt-4 text-navy-800 font-display font-semibold">
              &mdash; Eric Wagner
            </p>
          </div>
        </div>
      </Section>

      <Section variant="gray">
        <SectionHeader
          eyebrow="Credentials"
          title="25+ years of proven commercialization"
          subtitle="The track record behind every RFP Pipeline curation decision."
        />
        <div className="mt-12">
          <FeatureGrid columns={2} items={credentials} />
        </div>
      </Section>

      <Section variant="white">
        <SectionHeader
          eyebrow="Career History"
          title="From software engineer to CEO to founder"
          subtitle="Every step has been about turning innovative technology into commercial outcomes, often through federal funding."
        />
        <div className="mt-12 max-w-4xl mx-auto">
          {timeline.map((entry, i) => (
            <div key={i} className="relative pl-8 pb-10 border-l-2 border-brand-100 last:border-l-0 last:pb-0">
              <div className="absolute left-[-9px] top-0 w-4 h-4 bg-brand-500 rounded-full border-4 border-white" />
              <div className="text-sm font-semibold text-brand-600">{entry.period}</div>
              <div className="mt-1 font-display text-lg font-bold text-navy-800">{entry.role}</div>
              <div className="text-gray-500 text-sm">{entry.company}</div>
              <p className="mt-3 text-gray-600 leading-relaxed">{entry.body}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section variant="gray">
        <div className="max-w-3xl mx-auto">
          <SectionHeader
            eyebrow="Education"
            title="The Ohio State University"
            align="left"
          />
          <div className="mt-8 space-y-6">
            <div className="p-6 bg-white rounded-lg border border-gray-200">
              <h3 className="font-display font-bold text-navy-800">Executive MBA</h3>
              <p className="text-gray-600 mt-1">Business Administration, Management and Operations &middot; 2008 – 2009</p>
            </div>
            <div className="p-6 bg-white rounded-lg border border-gray-200">
              <h3 className="font-display font-bold text-navy-800">B.S., Computer Science</h3>
              <p className="text-gray-600 mt-1">The Ohio State University &middot; 1995 – 1998</p>
            </div>
          </div>
        </div>
      </Section>

      <Section variant="white">
        <div className="max-w-3xl mx-auto">
          <SectionHeader
            eyebrow="Recognition"
            title="A recognized lean-launch and commercialization development professional"
            align="left"
          />
          <ul className="mt-8 space-y-3 text-lg text-gray-700 leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="mt-2 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
              Adjunct instructor (3 years) for I-Corps@Ohio &mdash; training scientists and engineers in lean startup methods
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
              Trustee at Clintonville-Beechwold Community Resources Center (2012&ndash;2013), on the finance committee during their successful capital campaign
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
              Awarded patent for early commercial software launch at DSCI
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
              Employee of the Year (DSCI)
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-2 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
              Active startup investor &mdash; OTAF and individual investments in early-stage tech companies
            </li>
          </ul>
        </div>
      </Section>

      <CtaSection
        eyebrow="Ready to work together?"
        headline="I'm taking 20 founding members. Apply if you're serious."
        subheadline="If you're commercializing innovative technology and want non-dilutive federal R&D funding, let's talk."
        cta={{ label: 'Apply Now', href: '/apply' }}
      />
    </>
  );
}
