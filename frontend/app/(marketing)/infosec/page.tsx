import Link from 'next/link';

export const metadata = {
  title: 'Security & Data Isolation — RFP Pipeline',
  description: 'Pre-trained isolated agents per customer. No model training on your IP. Structured memory architecture. Collaboration controls you own.',
};

export default function InfoSecPage() {
  return (
    <>
      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-6">Security &amp; Data Isolation</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-white leading-tight">
            Your data. Your agents.<br />
            <span className="font-prose italic text-citrus">Nobody else&rsquo;s.</span>
          </h1>
          <p className="mt-6 text-lg text-navy-300 max-w-2xl">
            Federal R&amp;D proposals contain sensitive IP, pricing strategy, and team composition.
            We built the architecture assuming that — not as an afterthought.
          </p>
        </div>
      </section>

      {/* Isolation layers */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-10">Four layers of isolation. Independently enforced.</h2>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-2">Customer Isolation</p>
              <h3 className="font-display text-xl font-bold text-navy-900">Row-Level Security, tenant-scoped.</h3>
              <p className="mt-3 text-navy-600 leading-relaxed">
                Unique storage prefix per account. Database queries are RLS-scoped to your tenant ID.
                Your AI context window never includes another customer&rsquo;s data — enforced at the
                database and storage layers, not just application logic.
              </p>
            </div>
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-2">Proposal Isolation</p>
              <h3 className="font-display text-xl font-bold text-navy-900">Sandboxed per portal.</h3>
              <p className="mt-3 text-navy-600 leading-relaxed">
                Each proposal portal is its own workspace. Agents working on Proposal A cannot read
                Proposal B&rsquo;s data unless you explicitly enable cross-proposal library access.
                Access control is set by your admin, not ours.
              </p>
            </div>
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-2">Agent Isolation</p>
              <h3 className="font-display text-xl font-bold text-navy-900">Pre-trained. Individually provisioned.</h3>
              <p className="mt-3 text-navy-600 leading-relaxed">
                Your company gets its own AI team at signup. These agents are pre-trained on federal
                R&amp;D compliance patterns but provisioned with access ONLY to your data. They learn
                from your uploads, your corrections, and your verified decisions — nobody else&rsquo;s.
              </p>
            </div>
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-2">Collaborator Isolation</p>
              <h3 className="font-display text-xl font-bold text-navy-900">Section-level. Role-level. Revocable.</h3>
              <p className="mt-3 text-navy-600 leading-relaxed">
                Invite subcontractors and SMEs to specific sections of specific proposals at specific
                phases. View, comment, edit — each permission is granular. Revoke access instantly.
                Every action is audited with actor, timestamp, and change record.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* No model training */}
      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="grid md:grid-cols-2 gap-12">
            <div>
              <p className="text-xs text-citrus uppercase tracking-widest font-semibold mb-3">The Claude Promise</p>
              <h2 className="font-display text-3xl font-black text-white">No model training on your data. Ever.</h2>
              <p className="mt-4 text-navy-300 leading-relaxed">
                Built on Anthropic&rsquo;s Claude API with strict enterprise no-training terms. Your
                proposals, your company data, your compliance decisions are sent as input for each
                request — but are never used to train or fine-tune the underlying model. Your IP
                stays yours.
              </p>
            </div>
            <div>
              <p className="text-xs text-citrus uppercase tracking-widest font-semibold mb-3">Structured Memory Architecture</p>
              <h2 className="font-display text-3xl font-black text-white">We remember for you. Not about you.</h2>
              <p className="mt-4 text-navy-300 leading-relaxed">
                Our proprietary structured memory system stores verified compliance decisions, expert
                curation history, and proposal templates in tenant-isolated database rows — not in
                model weights. Your memory is retrievable, auditable, and deletable. It belongs to
                you, not to a training pipeline.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Collaboration admin */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-4">Collaboration Administration</p>
          <h2 className="font-display text-3xl font-bold text-navy-900 mb-8">
            Easy for admins. Clear for collaborators.
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            <div className="p-6 bg-cream-50 border border-cream-200 rounded-lg">
              <h3 className="font-display font-bold text-navy-900">Internal Team</h3>
              <p className="mt-2 text-sm text-navy-600 leading-relaxed">
                Your admin invites team members by email. Each gets role-based access to the proposals
                they&rsquo;re assigned to. All-proposals or per-proposal — your admin decides.
              </p>
            </div>
            <div className="p-6 bg-cream-50 border border-cream-200 rounded-lg">
              <h3 className="font-display font-bold text-navy-900">External Collaborators</h3>
              <p className="mt-2 text-sm text-navy-600 leading-relaxed">
                Subcontractors, university partners, and SMEs get stage-scoped access to specific
                sections. They upload their materials, review their sections, and see nothing else.
                Revoke when the phase closes.
              </p>
            </div>
            <div className="p-6 bg-cream-50 border border-cream-200 rounded-lg">
              <h3 className="font-display font-bold text-navy-900">Full Audit Trail</h3>
              <p className="mt-2 text-sm text-navy-600 leading-relaxed">
                Every login, every edit, every comment, every access grant and revocation is logged
                with actor name, timestamp, and IP. Exportable for your own compliance records.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Honest about certifications */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-4">What we are. What we aren&rsquo;t. Yet.</h2>
          <div className="space-y-4 text-navy-600 leading-relaxed">
            <p>
              <strong className="text-navy-900">We are:</strong> A SaaS platform with strong tenant isolation,
              audit logging, encryption at rest and in transit, and a binding commitment to never train
              on your data.
            </p>
            <p>
              <strong className="text-navy-900">We are not (yet):</strong> SOC 2 Type II, FedRAMP, or
              ITAR certified. Most SBIR/STTR proposal development work doesn&rsquo;t require those —
              but we&rsquo;re honest about it. Do not upload classified information or CUI requiring
              specific safeguarding.
            </p>
            <p>
              <strong className="text-navy-900">Roadmap:</strong> SOC 2 targeted for Year 2. If your
              situation has specific requirements, raise them during the application process.
            </p>
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            Questions about security? Ask Eric directly.
          </h2>
          <p className="mt-3 text-navy-400">
            Raise them in your application. We&rsquo;ll tell you honestly whether we&rsquo;re a fit today.
          </p>
          <Link href="/apply" className="inline-flex mt-8 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            Start an Application
          </Link>
        </div>
      </section>
    </>
  );
}
