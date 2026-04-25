import Link from 'next/link';

export const metadata = {
  title: 'Value — RFP Pipeline',
  description: 'Spotlight finds. Portals build. Experts curate. AI learns. The more you use, the better we get.',
};

export default function ValuePage() {
  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">The Value Loop</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900 leading-tight">
            The more you use it, the <span className="font-prose italic text-brand-500">better</span> it gets.
          </h1>
          <p className="mt-6 text-lg text-navy-600 max-w-2xl">
            Every verified compliance value, every submitted proposal, every expert decision
            makes the next cycle cheaper, faster, and more accurate for your company.
          </p>
        </div>
      </section>

      {/* Spotlight */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">01</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">$299/mo &middot; Cancel Anytime</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">Spotlight</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            Never miss a relevant opportunity again. We ingest SAM.gov, SBIR.gov, Grants.gov,
            and agency-specific portals daily. Expert-curated compliance matrices are built for
            every ingested solicitation. Opportunities ranked to your tech areas surface at the
            top. Deadline reminders keep you on track. 15 minutes of Ask-the-Expert every month.
          </p>
          <p className="mt-4 text-sm text-navy-400">
            Low-cost entry. High-value signal. The foundation that makes everything else work.
          </p>
        </div>
      </section>

      {/* Pay-to-play Portals */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">02</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">$999 Phase I &middot; $1,999 Phase II</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">Proposal Portals</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            When you see something worth pursuing, buy a portal. Eric builds the compliance matrix
            within 72 hours. Your custom AI team drafts the technical volume, cost volume, and abstract
            against your uploaded library. Stage-gated workflow: draft, review, revise, accept.
            Collaborators assigned by section, document, and phase.
          </p>
          <p className="mt-4 text-sm text-navy-400">
            Pay per pursuit. Only when you&rsquo;re serious. No annual commitment beyond Spotlight.
          </p>
        </div>
      </section>

      {/* Expert Curation */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">03</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">72-hour SLA</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">Expert Curation</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            Every solicitation released into your Spotlight has been reviewed by a human with
            real federal R&amp;D experience. Every compliance matrix is verified against the
            source document. Every portal is built by an expert who knows the difference between
            a winning Phase I and a waste of your team&rsquo;s month.
          </p>
          <p className="mt-4 text-sm text-navy-400">
            The AI drafts. The expert verifies. No unvetted AI output reaches your submission.
          </p>
        </div>
      </section>

      {/* Virtuous cycle */}
      <section className="bg-navy-900 border-t">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-navy-700">04</span>
            <div>
              <p className="text-xs text-citrus uppercase tracking-widest font-semibold">The Flywheel</p>
              <h2 className="font-display text-3xl font-black text-white mt-1">
                Use it. Win. Use it <span className="font-prose italic text-citrus">more</span>.
              </h2>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mt-10">
            <div>
              <h3 className="font-display text-lg font-bold text-cream">Your library grows.</h3>
              <p className="mt-2 text-sm text-navy-300 leading-relaxed">
                Every upload, every proposal section, every past-performance narrative becomes
                reusable material for future proposals. Your AI team gets smarter with every document.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-cream">Compliance pre-fills.</h3>
              <p className="mt-2 text-sm text-navy-300 leading-relaxed">
                Verified values from your last DoD SBIR cycle auto-suggest for the next one.
                Page limits, font rules, submission format — the system remembers what the expert
                already verified.
              </p>
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-cream">Your win rate compounds.</h3>
              <p className="mt-2 text-sm text-navy-300 leading-relaxed">
                More proposals submitted. Higher quality per submission. Less time per cycle.
                Your cost-per-proposal drops. Your BD pipeline scales without hiring a BD department.
              </p>
            </div>
          </div>
          <Link href="/apply" className="inline-flex mt-12 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg transition-colors">
            Start the Flywheel
          </Link>
        </div>
      </section>
    </>
  );
}
