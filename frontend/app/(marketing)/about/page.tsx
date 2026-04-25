import Link from 'next/link';

export const metadata = {
  title: 'About — RFP Pipeline',
  description: 'Expert + AI + Automation + Collaboration = WIN. How RFP Pipeline works and why it exists.',
};

export default function AboutPage() {
  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">About RFP Pipeline</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            Expert + AI + Automation + Collaboration = <span className="font-prose italic text-award">Win</span>.
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            Most AI tools give you speed without accuracy. Most consultants give you accuracy without
            scale. We built the thing that does both — and gets better every time you use it.
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12">
          <div className="p-8 bg-cream-50 border border-cream-200 rounded-xl">
            <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">The Expert</p>
            <h3 className="font-display text-2xl font-bold text-navy-900">25 years in the arena.</h3>
            <p className="mt-4 text-navy-600 leading-relaxed">
              Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA
              funding. He reviews every application, curates every solicitation, and is available
              for strategy calls. You always know who curated your pipeline — and why.
            </p>
          </div>
          <div className="p-8 bg-cream-50 border border-cream-200 rounded-xl">
            <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">The AI</p>
            <h3 className="font-display text-2xl font-bold text-navy-900">Isolated. Trained on you.</h3>
            <p className="mt-4 text-navy-600 leading-relaxed">
              Your company gets its own AI team provisioned at signup. Your agents only see your data.
              They learn from your uploads, your past proposals, and your verified compliance decisions.
              No cross-contamination. No shared context windows.
            </p>
          </div>
          <div className="p-8 bg-cream-50 border border-cream-200 rounded-xl">
            <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">The Automation</p>
            <h3 className="font-display text-2xl font-bold text-navy-900">Stage-gated, not free-form.</h3>
            <p className="mt-4 text-navy-600 leading-relaxed">
              Proposal development follows a structured pipeline: draft, review, revise, accept.
              Every stage has compliance checks, deadline tracking, and role-gated access. Your
              admin controls who sees what at every phase.
            </p>
          </div>
          <div className="p-8 bg-cream-50 border border-cream-200 rounded-xl">
            <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">The Collaboration</p>
            <h3 className="font-display text-2xl font-bold text-navy-900">Your team. Your rules.</h3>
            <p className="mt-4 text-navy-600 leading-relaxed">
              Invite internal team members and external collaborators to specific sections
              of specific proposals. Control access by role, document, and phase. Revoke instantly.
              Every edit is audited. Every version is tracked.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs text-citrus uppercase tracking-widest mb-4 font-semibold">Founder &amp; Architect</p>
          <h2 className="font-display text-3xl font-black text-white">Eric Wagner</h2>
          <div className="mt-6 text-navy-300 leading-relaxed space-y-4 max-w-3xl">
            <p>
              Built RFP Pipeline to replicate the playbook that generated hundreds of
              millions in federal R&amp;D funding across 25+ years — with AI doing the
              mechanical work and the expert handling the judgment.
            </p>
            <p>
              Former President of D&amp;S Consultants ($270M revenue, 750 employees).
              Associate Director at Ohio State&rsquo;s CDME. CEO of Ubihere.
              B.S. Computer Science and Executive MBA from The Ohio State University.
              Phase I through Phase III, across DoD, NSF, DOE, DARPA.
            </p>
          </div>
          <Link href="/apply" className="inline-flex mt-8 px-6 py-3 bg-citrus hover:bg-citrus-400 text-navy-900 text-sm font-bold rounded-lg transition-colors">
            Apply to Work with Eric
          </Link>
        </div>
      </section>
    </>
  );
}
