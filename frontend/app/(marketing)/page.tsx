import Link from 'next/link';

export const metadata = {
  title: 'RFP Pipeline — Win More Government Contracts',
  description:
    'The AI-powered proposal workspace for SBIR, STTR, BAA, and OTA awards. Discover curated opportunities, score your fit, draft sections with an AI copilot, and submit with confidence.',
};

export default function Page() {
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-brand-50 to-white">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <h1 className="font-display text-4xl md:text-6xl font-bold text-navy-800 leading-tight">
            Win more federal contracts.
            <br />
            <span className="text-brand-700">Without the guesswork.</span>
          </h1>
          <p className="mt-6 text-lg md:text-xl text-gray-600 max-w-3xl">
            The AI-powered proposal workspace for SBIR, STTR, BAA, and OTA
            awards. Discover curated opportunities, score your fit, draft
            sections with an AI copilot, and submit with confidence.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/get-started"
              className="inline-flex items-center justify-center px-8 py-3 bg-brand-600 hover:bg-brand-700 text-white font-semibold rounded-lg shadow-sm transition-colors"
            >
              Start free trial
            </Link>
            <Link
              href="/pricing"
              className="inline-flex items-center justify-center px-8 py-3 bg-white border border-gray-300 hover:border-brand-600 text-gray-700 hover:text-brand-700 font-semibold rounded-lg transition-colors"
            >
              See pricing
            </Link>
          </div>
          <p className="mt-6 text-sm text-gray-500">
            No credit card required. 14-day trial on the Finder plan.
          </p>
        </div>
      </section>

      {/* Value props */}
      <section className="border-t bg-white">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800 text-center">
            Everything you need, in one place
          </h2>
          <p className="mt-4 text-lg text-gray-600 text-center max-w-2xl mx-auto">
            Stop juggling SAM.gov searches, compliance checklists, and
            scattered Word docs. RFP Pipeline gives your team one workspace
            for the entire proposal lifecycle.
          </p>
          <div className="mt-12 grid md:grid-cols-3 gap-8">
            <ValueProp
              title="Curated opportunities"
              body="We ingest SAM.gov, SBIR.gov, and Grants.gov every night. Our experts pre-shred each solicitation into structured compliance data — page limits, eval criteria, required sections — so you never miss a requirement."
            />
            <ValueProp
              title="AI-scored fit"
              body="Our scoring engine ranks every opportunity against your company profile, NAICS codes, past awards, and tech focus. High-fit matches surface first. No more drowning in 500 daily listings."
            />
            <ValueProp
              title="Proposal workspace"
              body="When you purchase a proposal, we clone the outline, compliance matrix, and required documents straight from our curation. Your AI copilot helps draft each section against your own library of past work."
            />
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-t bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-16 md:py-24">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-navy-800 text-center">
            Built for small federal contractors
          </h2>
          <div className="mt-10 grid md:grid-cols-2 gap-8">
            <Audience
              title="SBIR / STTR firms"
              body="Phase I and Phase II workflows, topic tracking across DoD, NSF, NIH, DOE, NASA, and USDA. Namespace memory recognizes repeat solicitations and pre-fills compliance data from prior cycles."
            />
            <Audience
              title="BAA and OTA teams"
              body="Broad Agency Announcements and Other Transaction Authority awards get the same treatment: structured eval criteria, full-text search, collaborative drafting, and export-ready packaging."
            />
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t bg-navy-800">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-white">
            Ready to stop losing to bigger shops?
          </h2>
          <p className="mt-4 text-lg text-brand-200 max-w-2xl mx-auto">
            Join the contractors who are using AI to level the playing field.
            Start your free trial today — no credit card, no commitment.
          </p>
          <Link
            href="/get-started"
            className="mt-8 inline-flex items-center justify-center px-8 py-3 bg-white hover:bg-brand-50 text-brand-700 font-semibold rounded-lg shadow-sm transition-colors"
          >
            Start free trial
          </Link>
        </div>
      </section>
    </>
  );
}

function ValueProp({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 rounded-lg border border-gray-200 bg-white hover:border-brand-300 hover:shadow-sm transition-all">
      <h3 className="font-display text-xl font-semibold text-navy-800">
        {title}
      </h3>
      <p className="mt-3 text-gray-600 leading-relaxed">{body}</p>
    </div>
  );
}

function Audience({ title, body }: { title: string; body: string }) {
  return (
    <div className="p-6 rounded-lg bg-white border border-gray-200">
      <h3 className="font-display text-xl font-semibold text-navy-800">
        {title}
      </h3>
      <p className="mt-3 text-gray-600 leading-relaxed">{body}</p>
    </div>
  );
}
