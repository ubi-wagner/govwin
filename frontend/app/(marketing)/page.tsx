import Link from 'next/link';

export const metadata = {
  title: 'RFP Pipeline — A Proposal Engine, Not a Proposal Gamble',
  description:
    'RFP Pipeline pairs isolated, company-specific AI with 25 years of hands-on federal R&D expertise — so small businesses can pursue SBIR, STTR, BAA, and OTA funding without burning a month of payroll on every submission.',
};

export default function LandingPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-cream-50">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-36">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">
            AI + Expert &middot; From Application to Submission
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-black text-navy-900 leading-[1.05]">
            A proposal<br />engine, <span className="font-prose italic text-brand-500">not</span> a<br />proposal<br />gamble.
          </h1>
          <p className="mt-8 text-xl md:text-2xl text-navy-600 font-prose italic leading-relaxed max-w-2xl">
            RFP Pipeline pairs isolated, company-specific AI with 25 years of hands-on
            federal R&amp;D expertise — so small businesses can pursue SBIR, STTR, BAA,
            and OTA funding without burning a month of payroll on every submission.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href="/apply"
              className="inline-flex items-center justify-center px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl"
            >
              Apply for Founding Cohort
            </Link>
            <Link
              href="/value"
              className="inline-flex items-center justify-center px-8 py-4 border-2 border-navy-200 hover:border-brand-400 text-navy-700 text-lg font-semibold rounded-lg transition-colors"
            >
              See How It Works
            </Link>
          </div>
          <p className="mt-5 text-sm text-navy-400">
            Platform launches June 2026. 20 founding-cohort seats. Applications reviewed weekly.
          </p>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-navy-900 border-y border-navy-800">
        <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { number: '4+', label: 'Federal Sources Ingested' },
            { number: '72h', label: 'Expert-Review SLA' },
            { number: '20', label: 'Founding Cohort Cap' },
            { number: '25+', label: 'Years of Fed R&D Expertise' },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-4xl md:text-5xl font-display font-black text-white">
                {stat.number.replace(/h$/, '')}
                {stat.number.endsWith('h') && (
                  <span className="font-prose italic text-citrus">h</span>
                )}
                {stat.number.endsWith('+') ? '' : ''}
              </div>
              <div className="mt-2 text-xs text-navy-400 uppercase tracking-widest">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Six stages */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="flex flex-col md:flex-row items-baseline gap-6 mb-16">
            <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">
              Six stages from curious <span className="font-prose italic text-brand-500">applicant</span> to
              compliant proposal <span className="font-prose italic text-brand-500">submission</span>.
            </h2>
            <p className="text-sm uppercase tracking-widest text-navy-400 shrink-0">
              Value from Day One —<br />Not Six Months From Now
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-px bg-navy-100 border border-navy-100 rounded-xl overflow-hidden">
            {[
              { num: '01', title: 'Apply', subtitle: 'Short application.', body: 'Company info, SAM.gov status, prior awards, tech summary. Filters tire-kickers. Nothing paid yet.' },
              { num: '02', title: 'Accepted', subtitle: 'Expert reviews every one.', body: 'Personal review within 72 hours. Brief onboarding call. If you\'re a fit for the cohort, you get an invite link.' },
              { num: '03', title: 'Onboard', subtitle: 'Your library goes live.', body: 'Upload capability statement, past performance, key personnel. Activate subscription. Your AI agents provisioned.' },
              { num: '04', title: 'Spotlight', subtitle: 'Daily curated pipeline.', body: 'SAM.gov, SBIR.gov, Grants.gov, and agency portals ingested every day. Expert-curated matches ranked to your technology innovation areas.' },
              { num: '05', title: 'Purchase Portal', subtitle: 'Pay per build.', body: 'Purchase individual Proposal Portal when you find a fit. Expert builds the compliance matrix in 72 hours. AI drafts against your library. Your team revises.' },
              { num: '06', title: 'Submit & Learn', subtitle: 'The system gets smarter.', body: 'Every submission, every verified value, every debrief feeds future cycles. The AI gets more accurate — and intelligent — enabling proposal development at scale.' },
            ].map((step) => (
              <div key={step.num} className="bg-cream-50 p-8">
                <p className="text-xs font-semibold text-brand-500 uppercase tracking-widest mb-2">
                  {step.num} — {step.title}
                </p>
                <h3 className="font-display text-lg font-bold text-navy-900">
                  {step.subtitle.split(/(\*[^*]+\*)/g).map((part, i) =>
                    part.startsWith('*') ? (
                      <span key={i} className="font-prose italic text-brand-500">{part.slice(1, -1)}</span>
                    ) : part
                  )}
                </h3>
                <p className="mt-3 text-sm text-navy-600 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing snapshot */}
      <section className="bg-navy-900">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-4">How We Charge</p>
          <h2 className="font-display text-3xl md:text-4xl font-black text-white leading-tight">
            One subscription.<br />
            Per-proposal <span className="font-prose italic text-citrus">portals</span>.
          </h2>
          <p className="mt-4 text-lg text-navy-300 font-prose italic max-w-2xl leading-relaxed">
            Priced and built specifically for small businesses, not enterprise. Low cost subscription
            provides find and remind capabilities. Per proposal pricing ensures you only pay for
            builds you choose.
          </p>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            <div className="bg-navy-800 border border-navy-700 rounded-xl p-8">
              <p className="text-xs uppercase tracking-widest text-citrus-400 mb-1">Required &middot; Monthly</p>
              <h3 className="font-display text-xl font-bold text-white">Spotlight <span className="font-prose italic text-citrus">Subscription</span>.</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-display font-black text-white">$299</span>
                <span className="text-navy-400">/mo</span>
              </div>
              <p className="mt-3 text-sm text-navy-300 leading-relaxed">
                Daily ingestion. AI-powered ranking against your profile. Expert-curated compliance matrix.
                Deadline alerts. 15 min of Ask-the-Expert each month (rolls over).
              </p>
              <p className="mt-4 text-xs text-navy-500 uppercase tracking-wider">Required to purchase any portal</p>
            </div>
            <div className="bg-navy-800 border border-navy-700 rounded-xl p-8">
              <p className="text-xs uppercase tracking-widest text-brand-400 mb-1">Per-Proposal</p>
              <h3 className="font-display text-xl font-bold text-white">Phase I — <span className="font-prose italic text-brand-400">Like Effort</span>.</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-display font-black text-white">$999</span>
                <span className="text-navy-400">per proposal</span>
              </div>
              <p className="mt-3 text-sm text-navy-300 leading-relaxed">
                SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form. 72-hour curation by Expert.
                Stage-gated workspace. Custom AI drafting.
              </p>
            </div>
            <div className="bg-navy-800 border border-navy-700 rounded-xl p-8">
              <p className="text-xs uppercase tracking-widest text-brand-400 mb-1">Per-Proposal</p>
              <h3 className="font-display text-xl font-bold text-white">Phase II — <span className="font-prose italic text-brand-400">Like Effort</span>.</h3>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-4xl font-display font-black text-white">$1,999</span>
                <span className="text-navy-400">per proposal</span>
              </div>
              <p className="mt-3 text-sm text-navy-300 leading-relaxed">
                SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20-50+ page tech volumes.
                Commercialization plans included.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Expert gate */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">The Expert Gate</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900 leading-tight">
                The AI drafts.<br />The Expert <span className="font-prose italic text-brand-500">verifies</span>.<br />Your Team collaborates.
              </h2>
            </div>
            <div className="bg-white border border-cream-200 rounded-xl p-8">
              <p className="text-xs uppercase tracking-widest text-brand-500 mb-2">Eric Wagner — Founder &amp; Architect</p>
              <h3 className="font-prose italic text-2xl text-navy-800">
                25 years of federal R&amp;D funding.
              </h3>
              <p className="mt-4 text-sm text-navy-600 leading-relaxed">
                The Expert personally reviews every application, curates every solicitation
                released into your Spotlight, and is available for pre-submission review.
                As the service scales, additional experts will join the roster — you will
                always know which expert reviewed your pipeline.
              </p>
              <ul className="mt-6 space-y-2 text-sm text-navy-600">
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-award rounded-full" /> 72-hour application &amp; curation SLA</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-award rounded-full" /> 15 min of strategy calls per month</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-award rounded-full" /> Agency-specific: DoD, NSF, DOE, DARPA, DOT</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-award rounded-full" /> Additional time on demand — $500/hr</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Quote */}
      <section className="bg-cream-100 border-y border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <blockquote className="font-prose italic text-2xl md:text-3xl text-navy-800 leading-relaxed">
            &ldquo;Free trials attract tire-kickers who waste expert time that serious applicants need.
            The application itself is the qualifier.&rdquo;
          </blockquote>
          <p className="mt-6 text-xs uppercase tracking-widest text-navy-400">— Why No Free Trial</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-4">
            Applications Open &middot; Launch 01 Jun 2026
          </p>
          <h2 className="font-display text-3xl md:text-5xl font-black text-white leading-tight">
            Apply today. Draft your <span className="font-prose italic text-citrus">first</span><br />
            proposal on launch day.
          </h2>
          <div className="mt-10">
            <Link
              href="/apply"
              className="inline-flex items-center justify-center px-10 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl"
            >
              Apply Now
            </Link>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-navy-400">
            <span>Founder &amp; Architect</span>
            <span className="text-cream-200 font-semibold">Eric Wagner</span>
            <a href="mailto:eric@rfppipeline.com" className="text-citrus-400 hover:text-citrus-300">eric@rfppipeline.com</a>
          </div>
        </div>
      </section>
    </>
  );
}
