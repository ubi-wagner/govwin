import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many } from '@/lib/cms';

export const revalidate = 60;

export const metadata = {
  title: 'About — RFP Pipeline',
  description: 'Expert + AI + Automation + Collaboration = WIN. How RFP Pipeline works and why it exists.',
};

const DEFAULT_PILLARS = [
  { label: 'The Expert', heading: '25 years in the arena.', body: 'Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA funding. He reviews every application, curates every solicitation, and is available for strategy calls. You always know who curated your pipeline — and why.' },
  { label: 'The AI', heading: 'Isolated. Trained on you.', body: 'Your company gets its own AI team provisioned at signup. Your agents only see your data. They learn from your uploads, your past proposals, and your verified compliance decisions. No cross-contamination. No shared context windows.' },
  { label: 'The Automation', heading: 'Stage-gated, not free-form.', body: 'Proposal development follows a structured pipeline: draft, review, revise, accept. Every stage has compliance checks, deadline tracking, and role-gated access. Your admin controls who sees what at every phase.' },
  { label: 'The Collaboration', heading: 'Your team. Your rules.', body: 'Invite internal team members and external collaborators to specific sections of specific proposals. Control access by role, document, and phase. Revoke instantly. Every edit is audited. Every version is tracked.' },
];

export default async function AboutPage() {
  const blocks = await getPageBlocks('about');
  const lookup = buildLookup(blocks, 'about');
  const hero = single(lookup['hero']);
  const pillars = many(lookup['pillars']);
  const founder = single(lookup['founder']);

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'About RFP Pipeline'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            {hero?.title ?? <>Expert + AI + Automation + Collaboration = <span className="font-prose italic text-award">Win</span>.</>}
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            {hero?.body ?? 'Most AI tools give you speed without accuracy. Most consultants give you accuracy without scale. We built the thing that does both — and gets better every time you use it.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-12">
          {(pillars.length > 0 ? pillars : DEFAULT_PILLARS).map((p, i) => {
            const label = 'excerpt' in p ? (p as { excerpt: string | null }).excerpt : ('label' in p ? (p as { label: string }).label : '');
            const heading = 'title' in p ? (p as { title: string }).title : ('heading' in p ? (p as { heading: string }).heading : '');
            const body = (p as { body: string }).body;
            return (
              <div key={i} className="p-8 bg-cream-50 border border-cream-200 rounded-xl">
                <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">{label}</p>
                <h3 className="font-display text-2xl font-bold text-navy-900">{heading}</h3>
                <p className="mt-4 text-navy-600 leading-relaxed">{body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs text-citrus uppercase tracking-widest mb-4 font-semibold">{founder?.excerpt ?? 'Founder & Architect'}</p>
          <h2 className="font-display text-3xl font-black text-white">{founder?.title ?? 'Eric Wagner'}</h2>
          <div className="mt-6 text-navy-300 leading-relaxed space-y-4 max-w-3xl">
            {(founder?.body ?? 'Built RFP Pipeline to replicate the playbook that generated hundreds of millions in federal R&D funding across 25+ years — with AI doing the mechanical work and the expert handling the judgment.\n\nFormer President of D&S Consultants ($270M revenue, 750 employees). Associate Director at Ohio State’s CDME. CEO of Ubihere. B.S. Computer Science and Executive MBA from The Ohio State University. Phase I through Phase III, across DoD, NSF, DOE, DARPA.').split('\n\n').map((paragraph: string, i: number) => (
              <p key={i}>{paragraph}</p>
            ))}
          </div>
          <Link href={(founder?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'} className="inline-flex mt-8 px-6 py-3 bg-citrus hover:bg-citrus-400 text-navy-900 text-sm font-bold rounded-lg transition-colors">
            {(founder?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Apply to Work with Eric'}
          </Link>
        </div>
      </section>
    </>
  );
}
