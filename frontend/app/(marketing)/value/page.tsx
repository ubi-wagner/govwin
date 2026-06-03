import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';

export const revalidate = 60;

export const metadata = {
  title: 'Value — RFP Pipeline',
  description: 'Spotlight finds. Portals build. Experts curate. AI learns. The more you use, the better we get.',
};

const DEFAULT_FLYWHEEL = [
  { title: 'Your library grows.', body: 'Every upload, every proposal section, every past-performance narrative becomes reusable material for future proposals. Your AI team gets smarter with every document.' },
  { title: 'Compliance pre-fills.', body: 'Verified values from your last DoD SBIR cycle auto-suggest for the next one. Page limits, font rules, submission format — the system remembers what the expert already verified.' },
  { title: 'Your win rate compounds.', body: 'More proposals submitted. Higher quality per submission. Less time per cycle. Your cost-per-proposal drops. Your BD pipeline scales without hiring a BD department.' },
];

export default async function ValuePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const isPreview = params?._preview === '1'
  const blocks = await getPageBlocks('value', isPreview);
  const lookup = buildLookup(blocks, 'value');
  const hero = single(lookup['hero']);
  const spotlight = single(lookup['spotlight']);
  const portals = single(lookup['portals']);
  const curation = single(lookup['curation']);
  const flywheelHeader = single(lookup['flywheel-header']);
  const flywheel = many(lookup['flywheel']);

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'The Value Loop'}</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900 leading-tight">
            <RichText
              text={hero?.title ?? 'The more you use it, the *better* it gets.'}
              accent={(hero?.metadata as { accent?: string })?.accent ?? 'brand-500'}
            />
          </h1>
          <p className="mt-6 text-lg text-navy-600 max-w-2xl">
            {hero?.body ?? 'Every verified compliance value, every submitted proposal, every expert decision makes the next cycle cheaper, faster, and more accurate for your company.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">01</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">{(spotlight?.metadata as { price_label?: string })?.price_label ?? '$299/mo · Cancel Anytime'}</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">{spotlight?.title ?? 'Spotlight'}</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            {spotlight?.body ?? 'Never miss a relevant opportunity again. We ingest SAM.gov, SBIR.gov, Grants.gov, and agency-specific portals daily. Expert-curated compliance matrices are built for every ingested solicitation. Opportunities ranked to your tech areas surface at the top. Deadline reminders keep you on track. 15 minutes of Ask-the-Expert every month.'}
          </p>
          <p className="mt-4 text-sm text-navy-400">
            {spotlight?.excerpt ?? 'Low-cost entry. High-value signal. The foundation that makes everything else work.'}
          </p>
        </div>
      </section>

      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">02</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">{(portals?.metadata as { price_label?: string })?.price_label ?? '$999 Phase I · $1,999 Phase II'}</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">{portals?.title ?? 'Proposal Portals'}</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            {portals?.body ?? 'When you see something worth pursuing, buy a portal. Eric builds the compliance matrix within 72 hours. Your custom AI team drafts the technical volume, cost volume, and abstract against your uploaded library. Stage-gated workflow: draft, review, revise, accept. Collaborators assigned by section, document, and phase.'}
          </p>
          <p className="mt-4 text-sm text-navy-400">
            {portals?.excerpt ?? 'Pay per pursuit. Only when you\'re serious. No annual commitment beyond Spotlight.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-brand-100">03</span>
            <div>
              <p className="text-xs text-brand-500 uppercase tracking-widest font-semibold">{(curation?.metadata as { sla_label?: string })?.sla_label ?? '72-hour SLA'}</p>
              <h2 className="font-display text-3xl font-black text-navy-900 mt-1">{curation?.title ?? 'Expert Curation'}</h2>
            </div>
          </div>
          <p className="text-lg text-navy-600 max-w-3xl">
            {curation?.body ?? 'Every solicitation released into your Spotlight has been reviewed by a human with real federal R&D experience. Every compliance matrix is verified against the source document. Every portal is built by an expert who knows the difference between a winning Phase I and a waste of your team\'s month.'}
          </p>
          <p className="mt-4 text-sm text-navy-400">
            {curation?.excerpt ?? 'The AI drafts. The expert verifies. No unvetted AI output reaches your submission.'}
          </p>
        </div>
      </section>

      <section className="bg-navy-900 border-t">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <div className="flex items-start gap-6 mb-6">
            <span className="text-5xl font-display font-black text-navy-700">04</span>
            <div>
              <p className="text-xs text-citrus uppercase tracking-widest font-semibold">{flywheelHeader?.excerpt ?? 'The Flywheel'}</p>
              <h2 className="font-display text-3xl font-black text-white mt-1">
                <RichText
                  text={flywheelHeader?.title ?? 'Use it. Win. Use it *more*.'}
                  accent={(flywheelHeader?.metadata as { accent?: string })?.accent ?? 'citrus'}
                />
              </h2>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-8 mt-10">
            {(flywheel.length > 0 ? flywheel : DEFAULT_FLYWHEEL).map((item, i) => (
              <div key={i}>
                <h3 className="font-display text-lg font-bold text-cream">{'title' in item ? item.title : ''}</h3>
                <p className="mt-2 text-sm text-navy-300 leading-relaxed">{'body' in item ? item.body : ''}</p>
              </div>
            ))}
          </div>
          <Link href={(flywheelHeader?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'} className="inline-flex mt-12 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg transition-colors">
            {(flywheelHeader?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Start the Flywheel'}
          </Link>
        </div>
      </section>

      <CustomSections pageKey="value" blocks={blocks} />
    </>
  );
}
