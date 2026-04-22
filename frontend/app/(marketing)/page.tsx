import Link from 'next/link';

export const metadata = {
  title: 'RFP Pipeline — AI + Expert Federal R&D Proposal Intelligence',
  description:
    'Stop chasing SBIR, STTR, BAA, and OTA solicitations alone. RFP Pipeline combines AI-powered opportunity analysis with hands-on expert curation to help small businesses identify, pursue, and win non-dilutive federal R&D funding.',
};

export default function Page() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-navy-900 to-navy-800">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-36">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold text-brand-400 uppercase tracking-wider mb-4">
              Now Accepting Applications &mdash; Founding Cohort Limited to 20
            </p>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-white leading-tight">
              Your AI team.
              <br />
              Your expert.
              <br />
              <span className="text-brand-400">Your federal R&amp;D pipeline.</span>
            </h1>
            <p className="mt-8 text-lg md:text-xl text-gray-300 leading-relaxed">
              RFP Pipeline pairs custom AI agents with hands-on expert curation to help
              small businesses identify, analyze, and win SBIR, STTR, BAA, OTA, and other
              non-dilutive federal R&amp;D funding. Every opportunity is expert-reviewed.
              Every proposal portal is built specifically for your company. Your data never
              touches another customer&rsquo;s.
            </p>
            <div className="mt-10 flex flex-col sm:flex-row gap-4">
              <Link
                href="/apply"
                className="inline-flex items-center justify-center px-8 py-4 bg-brand-600 hover:bg-brand-500 text-white text-lg font-semibold rounded-lg shadow-lg transition-all hover:shadow-xl"
              >
                Apply for Access
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center justify-center px-8 py-4 border border-gray-500 hover:border-brand-400 text-gray-300 hover:text-white text-lg font-semibold rounded-lg transition-colors"
              >
                See How It Works
              </Link>
            </div>
            <p className="mt-6 text-sm text-gray-500">
              $299/month after acceptance. No free trial. Cancel anytime.
            </p>
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="bg-white border-t">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">
              Small businesses shouldn&rsquo;t need a full BD department to win federal R&amp;D funding
            </h2>
            <p className="mt-6 text-lg text-gray-600 leading-relaxed">
              You built something innovative. The government wants to fund it. But between
              SAM.gov&rsquo;s firehose, 50-page solicitations, compliance matrices, and the
              crushing time pressure of a 30-day response window, most small businesses
              either miss the right opportunities or submit proposals that don&rsquo;t comply.
            </p>
          </div>
          <div className="mt-16 grid md:grid-cols-3 gap-8">
            <ProblemCard
              number="01"
              title="Opportunities buried in noise"
              body="SAM.gov publishes thousands of listings daily. SBIR.gov, Grants.gov, and agency-specific portals add more. Finding the ones aligned with YOUR technology takes hours every day."
            />
            <ProblemCard
              number="02"
              title="Compliance is a minefield"
              body="Page limits, font requirements, required sections, evaluation criteria, partner caps, PI rules, ITAR restrictions. Miss one and your proposal is non-compliant on page one."
            />
            <ProblemCard
              number="03"
              title="Proposal development is brutal"
              body="Building a Phase I proposal from scratch takes 80-120 hours. For a small team already doing the actual R&D, that's an impossible time tax. Most give up or submit weak proposals."
            />
          </div>
        </div>
      </section>

      {/* Three Pillars */}
      <section className="bg-gray-50 border-t">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center">
            <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">How We Solve It</p>
            <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">
              Three services. One platform. Zero guesswork.
            </h2>
          </div>
          <div className="mt-16 grid md:grid-cols-3 gap-10">
            <Pillar
              label="Service 1"
              title="Spotlight"
              subtitle="$299/month"
              features={[
                'Daily ingestion from SAM.gov, SBIR.gov, Grants.gov, and agency portals',
                'AI-powered analysis and ranking against your company profile',
                'Expert-curated compliance matrices for every opportunity',
                'Notifications and deadline reminders for your tech areas',
                'Monthly 15-minute Ask-the-Expert call with Eric (rolls over)',
                'Cancel anytime. No contracts.',
              ]}
              highlighted={false}
            />
            <Pillar
              label="Service 2"
              title="Proposal Portal"
              subtitle="From $999 per proposal"
              features={[
                'Expert-reviewed compliance matrix within 72 hours of purchase',
                'Stage-gated proposal workspace with automated drafting',
                'AI agents trained exclusively on YOUR company data',
                'Collaborator access controls by section, phase, and role',
                'Draft generation: technical volume, cost volume, abstract',
                'Review-revise-accept workflow with version tracking',
              ]}
              highlighted={true}
            />
            <Pillar
              label="Service 3"
              title="Expert Access"
              subtitle="Included + on-demand"
              features={[
                '15 min/month included with Spotlight (accumulates unused)',
                'Additional consulting at $500/hour based on availability',
                'Pre-submission review and strategy sessions',
                'Pursuit / no-pursuit recommendations with rationale',
                'Agency-specific guidance: DoD, NSF, DOE, DARPA, DOT',
                'Direct access to Eric &mdash; not a help desk',
              ]}
              highlighted={false}
            />
          </div>
        </div>
      </section>

      {/* Why Different */}
      <section className="bg-white border-t">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-16 items-start">
            <div>
              <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Why We&rsquo;re Different</p>
              <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">
                AI + Expert, not AI instead of Expert
              </h2>
              <p className="mt-6 text-lg text-gray-600 leading-relaxed">
                Every other &ldquo;AI proposal tool&rdquo; gives you a generic LLM pointed at your
                document. That&rsquo;s a recipe for confident-sounding non-compliance.
              </p>
              <p className="mt-4 text-lg text-gray-600 leading-relaxed">
                RFP Pipeline is different. Every solicitation that enters our system is
                reviewed and curated by a human expert with 25+ years of federal R&amp;D
                funding experience. The AI agents assigned to your company are trained
                exclusively on your data and our expert-curated compliance intelligence.
                They never see another customer&rsquo;s information.
              </p>
            </div>
            <div className="space-y-6">
              <DiffPoint
                title="Your data is yours alone"
                body="Every customer gets isolated AI agents, isolated storage, and isolated processing. Your company data, uploaded documents, and proposal drafts are never accessible to other customers or used to train models."
              />
              <DiffPoint
                title="The AI gets smarter each cycle"
                body="Every compliance value our expert verifies becomes training data for future cycles of the same program. By your third proposal, the AI pre-fills 80%+ of the compliance matrix automatically."
              />
              <DiffPoint
                title="Collaborate without risk"
                body="Invite partners, subcontractors, and team members to specific sections of specific proposals. Control access by role, document, and proposal phase. Revoke instantly."
              />
            </div>
          </div>
        </div>
      </section>

      {/* Program Types */}
      <section className="bg-gray-50 border-t">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="text-center">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">
              Built for small businesses pursuing federal R&amp;D funding
            </h2>
            <p className="mt-4 text-lg text-gray-600 max-w-3xl mx-auto">
              If you&rsquo;re commercializing innovative technology and want non-dilutive funding
              from DoD, NSF, DOE, DARPA, DOT, or other federal agencies, this is for you.
            </p>
          </div>
          <div className="mt-12 grid sm:grid-cols-2 md:grid-cols-4 gap-6">
            {([
              { label: 'SBIR Phase I & II', desc: 'Small Business Innovation Research across all agencies' },
              { label: 'STTR', desc: 'Small Business Technology Transfer with university research partners' },
              { label: 'BAA', desc: 'Broad Agency Announcements for advanced research programs' },
              { label: 'OTA & CSO', desc: 'Other Transaction Authority and Commercial Solutions Openings' },
            ] as const).map((item) => (
              <div key={item.label} className="p-5 bg-white rounded-lg border border-gray-200 hover:border-brand-300 transition-colors">
                <h3 className="font-display font-bold text-navy-800">{item.label}</h3>
                <p className="mt-2 text-sm text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Expert Teaser */}
      <section className="bg-white border-t">
        <div className="max-w-4xl mx-auto px-6 py-20 md:py-28 text-center">
          <p className="text-sm font-semibold text-brand-600 uppercase tracking-wider mb-3">Your Expert</p>
          <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800">
            Eric Wagner
          </h2>
          <p className="mt-6 text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            25+ years in technology commercialization. Hundreds of millions in SBIR, STTR, BAA, and OTA
            funding secured. Former president of a $300M aerospace &amp; defense company. Ohio State
            commercialization veteran who launched 22+ startups. Executive MBA + BS Computer Science.
          </p>
          <p className="mt-4 text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Eric personally reviews every solicitation, curates every compliance matrix, and is available
            for direct consultation. This is not a help desk. This is a senior BD partner who happens to
            have built the AI that supports him.
          </p>
          <Link
            href="/the-expert"
            className="mt-8 inline-flex items-center text-brand-600 hover:text-brand-800 font-semibold transition-colors"
          >
            Read Eric&rsquo;s full background &rarr;
          </Link>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white">
            Ready to stop leaving federal R&amp;D money on the table?
          </h2>
          <p className="mt-4 text-lg text-gray-300 max-w-2xl mx-auto leading-relaxed">
            We&rsquo;re accepting 20 founding members for our initial cohort. Apply now and
            join the small businesses turning AI + expertise into a competitive
            advantage for federal R&amp;D funding.
          </p>
          <Link
            href="/apply"
            className="mt-10 inline-flex items-center justify-center px-10 py-4 bg-brand-600 hover:bg-brand-500 text-white text-lg font-semibold rounded-lg shadow-lg transition-all hover:shadow-xl"
          >
            Apply for Founding Membership
          </Link>
          <p className="mt-4 text-sm text-gray-500">
            $299/month after acceptance. Includes Spotlight + monthly expert call. Cancel anytime.
          </p>
        </div>
      </section>
    </>
  );
}

function ProblemCard({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="relative p-6">
      <span className="text-5xl font-bold text-brand-100 font-display">{number}</span>
      <h3 className="mt-2 font-display text-xl font-semibold text-navy-800">{title}</h3>
      <p className="mt-3 text-gray-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Pillar({
  label, title, subtitle, features, highlighted,
}: {
  label: string; title: string; subtitle: string; features: string[]; highlighted: boolean;
}) {
  return (
    <div className={`p-8 rounded-xl border-2 ${
      highlighted ? 'border-brand-500 bg-white shadow-lg' : 'border-gray-200 bg-white'
    }`}>
      <p className="text-xs font-semibold text-brand-600 uppercase tracking-wider">{label}</p>
      <h3 className="mt-2 font-display text-2xl font-bold text-navy-800">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{subtitle}</p>
      <ul className="mt-6 space-y-3">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
            <span className="mt-1.5 w-1.5 h-1.5 bg-brand-500 rounded-full shrink-0" />
            <span dangerouslySetInnerHTML={{ __html: f }} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffPoint({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-5 bg-gray-50 rounded-lg border border-gray-100">
      <h3 className="font-display font-semibold text-navy-800">{title}</h3>
      <p className="mt-2 text-sm text-gray-600 leading-relaxed">{body}</p>
    </div>
  );
}
