import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many, type ContentRow } from '@/lib/cms';

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript\s*:/gi, 'blocked:');
}

export const revalidate = 60;

export const metadata = {
  title: 'Security & Data Isolation — RFP Pipeline',
  description: 'Pre-trained isolated agents per customer. No model training on your IP. Structured memory architecture. Collaboration controls you own.',
};

export default async function InfoSecPage() {
  const blocks = await getPageBlocks('infosec');
  const lookup = buildLookup(blocks, 'infosec');
  const hero = single(lookup['hero']);
  const cmsIsolation = many(lookup['isolation']);
  const cmsPromise = many(lookup['promise']);
  const cmsCollab = many(lookup['collab']);
  const certBlock = single(lookup['certifications']);
  const ctaBlock = single(lookup['cta']);
  const DEFAULT_ISOLATION = [
    { label: 'Customer Isolation', title: 'Row-Level Security, tenant-scoped.', body: 'Unique storage prefix per account. Database queries are RLS-scoped to your tenant ID. Your AI context window never includes another customer\'s data — enforced at the database and storage layers, not just application logic.' },
    { label: 'Proposal Isolation', title: 'Sandboxed per portal.', body: 'Each proposal portal is its own workspace. Agents working on Proposal A cannot read Proposal B\'s data unless you explicitly enable cross-proposal library access. Access control is set by your admin, not ours.' },
    { label: 'Agent Isolation', title: 'Pre-trained. Individually provisioned.', body: 'Your company gets its own AI team at signup. These agents are pre-trained on federal R&D compliance patterns but provisioned with access ONLY to your data. They learn from your uploads, your corrections, and your verified decisions — nobody else\'s.' },
    { label: 'Collaborator Isolation', title: 'Section-level. Role-level. Revocable.', body: 'Invite subcontractors and SMEs to specific sections of specific proposals at specific phases. View, comment, edit — each permission is granular. Revoke access instantly. Every action is audited with actor, timestamp, and change record.' },
  ];

  const DEFAULT_PROMISE = [
    { label: 'The Claude Promise', title: 'No model training on your data. Ever.', body: 'Built on Anthropic\'s Claude API with strict enterprise no-training terms. Your proposals, your company data, your compliance decisions are sent as input for each request — but are never used to train or fine-tune the underlying model. Your IP stays yours.' },
    { label: 'Structured Memory Architecture', title: 'We remember for you. Not about you.', body: 'Our proprietary structured memory system stores verified compliance decisions, expert curation history, and proposal templates in tenant-isolated database rows — not in model weights. Your memory is retrievable, auditable, and deletable. It belongs to you, not to a training pipeline.' },
  ];

  const DEFAULT_COLLAB = [
    { title: 'Internal Team', body: 'Your admin invites team members by email. Each gets role-based access to the proposals they\'re assigned to. All-proposals or per-proposal — your admin decides.' },
    { title: 'External Collaborators', body: 'Subcontractors, university partners, and SMEs get stage-scoped access to specific sections. They upload their materials, review their sections, and see nothing else. Revoke when the phase closes.' },
    { title: 'Full Audit Trail', body: 'Every login, every edit, every comment, every access grant and revocation is logged with actor name, timestamp, and IP. Exportable for your own compliance records.' },
  ];

  const isolation = cmsIsolation.length > 0 ? cmsIsolation.map((b: ContentRow) => ({ label: b.excerpt ?? '', title: b.title, body: b.body })) : DEFAULT_ISOLATION;
  const promise = cmsPromise.length > 0 ? cmsPromise.map((b: ContentRow) => ({ label: b.excerpt ?? '', title: b.title, body: b.body })) : DEFAULT_PROMISE;
  const collab = cmsCollab.length > 0 ? cmsCollab.map((b: ContentRow) => ({ title: b.title, body: b.body })) : DEFAULT_COLLAB;

  return (
    <>
      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Security & Data Isolation'}</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-white leading-tight">
            {hero?.title ?? <>Your data. Your agents.<br /><span className="font-prose italic text-citrus">Nobody else&rsquo;s.</span></>}
          </h1>
          <p className="mt-6 text-lg text-navy-300 max-w-2xl">
            {hero?.body ?? 'Federal R&D proposals contain sensitive IP, pricing strategy, and team composition. We built the architecture assuming that — not as an afterthought.'}
          </p>
        </div>
      </section>

      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-10">Four layers of isolation. Independently enforced.</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {isolation.map((item, i) => (
              <div key={i} className="p-8 bg-white border border-cream-200 rounded-xl">
                <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-2">{item.label}</p>
                <h3 className="font-display text-xl font-bold text-navy-900">{item.title}</h3>
                <p className="mt-3 text-navy-600 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="grid md:grid-cols-2 gap-12">
            {promise.map((item, i) => (
              <div key={i}>
                <p className="text-xs text-citrus uppercase tracking-widest font-semibold mb-3">{item.label}</p>
                <h2 className="font-display text-3xl font-black text-white">{item.title}</h2>
                <p className="mt-4 text-navy-300 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold mb-4">Collaboration Administration</p>
          <h2 className="font-display text-3xl font-bold text-navy-900 mb-8">Easy for admins. Clear for collaborators.</h2>
          <div className="grid md:grid-cols-3 gap-6">
            {collab.map((item, i) => (
              <div key={i} className="p-6 bg-cream-50 border border-cream-200 rounded-lg">
                <h3 className="font-display font-bold text-navy-900">{item.title}</h3>
                <p className="mt-2 text-sm text-navy-600 leading-relaxed">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-4">{certBlock?.title ?? 'What we are. What we aren\'t. Yet.'}</h2>
          <div className="space-y-4 text-navy-600 leading-relaxed">
            {certBlock?.body ? (
              certBlock.body.split('\n\n').map((p: string, i: number) => (
                <p key={i} dangerouslySetInnerHTML={{ __html: sanitizeHtml(p) }} />
              ))
            ) : (
              <>
                <p><strong className="text-navy-900">We are:</strong> A SaaS platform with strong tenant isolation, audit logging, encryption at rest and in transit, and a binding commitment to never train on your data.</p>
                <p><strong className="text-navy-900">We are not (yet):</strong> SOC 2 Type II, FedRAMP, or ITAR certified. Most SBIR/STTR proposal development work doesn&rsquo;t require those — but we&rsquo;re honest about it.</p>
                <p><strong className="text-navy-900">Roadmap:</strong> SOC 2 targeted for Year 2. Contract management and compliance tracking coming in Year 1. Additional certifications based on customer requirements.</p>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            {ctaBlock?.title ?? 'Questions about security? Ask Eric directly.'}
          </h2>
          <p className="mt-3 text-navy-400">
            {ctaBlock?.body ?? 'Raise them in your application. We\'ll tell you honestly whether we\'re a fit today.'}
          </p>
          <Link href="/apply" className="inline-flex mt-8 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            Start an Application
          </Link>
        </div>
      </section>
    </>
  );
}
