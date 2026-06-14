import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';
import { ValueComparison, rowsFromBlocks } from '@/components/marketing/value-comparison';
import { ModelDiagram, FlywheelRing } from '@/components/marketing/diagrams';

export const revalidate = 60;

export const metadata = {
  title: 'Why RFP Pipeline — The fastest, cheapest way to win federal R&D funding',
  description:
    'Federal R&D funding is non-dilutive — you keep your equity. RFP Pipeline replaces a $5,000/mo monitoring service and a 10%-of-award consultant with $299/mo and a flat per-proposal fee. Expert + AI + Process.',
};

const DEFAULT_PAINS = [
  { excerpt: 'New to federal R&D', title: "There's money you don't know exists.", body: 'Federal agencies award billions a year in grant-like R&D funding. It is non-dilutive — you keep your equity and your IP. Most qualifying companies never apply, because the process looks impenetrable. It is not, with the right system behind you.' },
  { excerpt: 'Already in the game', title: "You're bleeding time and margin.", body: 'You know the drill: a monitoring service you overpay for, a consultant who takes a cut of your award, deadlines that slip, and your best engineer pulled off the product to write proposals. There is a better stack — and it costs a fraction of what you pay now.' },
];

const DEFAULT_DRIVERS = [
  { title: 'Your data. Your AI.', body: 'Every company gets isolated AI agents that see only their data. No shared context, no cross-contamination, no leakage between tenants.' },
  { title: 'The AI drafts. The expert verifies.', body: 'Every opportunity is curated by a human with 25 years of federal R&D experience. Every AI draft is marked and reviewed. Nothing unvetted reaches your submission.' },
  { title: 'Stage-gated quality.', body: 'Proposals move through defined stages with compliance checks at every gate. No shortcutting the review. No submitting without verification.' },
];

const DEFAULT_FLYWHEEL = [
  { title: 'Your library grows.', body: 'Every upload, every proposal section, every past-performance narrative becomes reusable material. Your AI team gets smarter with every document.' },
  { title: 'Compliance pre-fills.', body: 'Verified values from your last cycle auto-suggest for the next. Page limits, font rules, submission format — the system remembers what the expert already verified.' },
  { title: 'Your win rate compounds.', body: 'More proposals submitted. Higher quality each time. Less time per cycle. Your cost-per-proposal drops while your pipeline scales — no BD department required.' },
];

const DEFAULT_HOW = [
  { title: 'Find', body: 'Daily ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals — expert-curated and ranked to your tech areas.' },
  { title: 'Build', body: 'Buy a portal when you find a fit. Your isolated AI drafts against your library; you and your team revise in a stage-gated workspace.' },
  { title: 'Submit & improve', body: 'Export a compliant, submission-ready package. Every cycle feeds the next — the system gets more accurate and less expensive over time.' },
];

export default async function WhyPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const isPreview = params?._preview === '1';
  const blocks = await getPageBlocks('value', isPreview);
  const lookup = buildLookup(blocks, 'value');
  const hero = single(lookup['hero']);
  const pains = many(lookup['pains']);
  const comparison = single(lookup['comparison']);
  const whyHeader = single(lookup['why-header']);
  const drivers = many(lookup['drivers']);
  const flywheelHeader = single(lookup['flywheel-header']);
  const flywheel = many(lookup['flywheel']);
  const howHeader = single(lookup['how-header']);
  const how = many(lookup['how']);
  const proof = single(lookup['proof']);
  const cta = single(lookup['cta']);

  const resolvedPains = pains.length > 0 ? pains.map((p) => ({ excerpt: p.excerpt, title: p.title, body: p.body })) : DEFAULT_PAINS;
  const resolvedDrivers = drivers.length > 0 ? drivers.map((d) => ({ title: d.title, body: d.body })) : DEFAULT_DRIVERS;
  const resolvedFlywheel = flywheel.length > 0 ? flywheel.map((f) => ({ title: f.title, body: f.body })) : DEFAULT_FLYWHEEL;
  const resolvedHow = how.length > 0 ? how.map((h) => ({ title: h.title, body: h.body })) : DEFAULT_HOW;
  const cmeta = (comparison?.metadata ?? {}) as { eyebrow?: string };

  return (
    <>
      {/* Hero — the dual-audience, non-dilutive hook */}
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-28">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Why RFP Pipeline'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight max-w-4xl">
            <RichText
              text={hero?.title ?? 'The fastest, cheapest way to win *non-dilutive* federal R&D funding.'}
              accent={(hero?.metadata as { accent?: string })?.accent ?? 'award'}
            />
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            {hero?.body ?? "Whether you've never heard of SBIR or you've already won three, the bottleneck is the same: finding the right opportunities and building compliant proposals without burning a month of payroll. We remove it."}
          </p>
        </div>
      </section>

      {/* The two worlds — pains for each audience */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-2 gap-8">
          {resolvedPains.map((p, i) => (
            <div key={i} className="bg-cream-50 border border-cream-200 rounded-xl p-8">
              <p className="text-xs font-semibold text-brand-500 uppercase tracking-widest mb-3">{p.excerpt}</p>
              <h2 className="font-display text-2xl font-black text-navy-900">{p.title}</h2>
              <p className="mt-3 text-navy-600 leading-relaxed">{p.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The gain — cost of the old way (money moment) */}
      <ValueComparison
        eyebrow={comparison?.excerpt ?? cmeta.eyebrow ?? 'The cost of the old way'}
        title={comparison?.title ?? 'What you pay today vs. what you pay us.'}
        subtitle={comparison?.body ?? 'Small businesses chase federal R&D the expensive way: a monitoring service, a consultant who takes a cut, a BD hire, or the founder’s own nights. Here’s the same job, re-priced.'}
        rows={rowsFromBlocks(blocks)}
        cta={{ label: 'See full pricing', href: '/pricing' }}
      />

      {/* Why it wins — the model */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">{whyHeader?.excerpt ?? 'Why it wins'}</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900 leading-tight">
                <RichText text={whyHeader?.title ?? 'Expert + AI + Process.'} accent={(whyHeader?.metadata as { accent?: string })?.accent ?? 'brand-500'} />
              </h2>
              <p className="mt-4 text-lg text-navy-600 leading-relaxed">
                {whyHeader?.body ?? 'Not just software. Not just a consultant. A structured system where a human expert, your own isolated AI, and a stage-gated process do what neither people nor tools do alone.'}
              </p>
            </div>
            <div className="flex justify-center">
              <ModelDiagram className="w-full max-w-sm" />
            </div>
          </div>

          <div className="mt-16 grid md:grid-cols-3 gap-8">
            {resolvedDrivers.map((d, i) => (
              <div key={i} className="border-t-2 border-brand-100 pt-5">
                <h3 className="font-display text-lg font-bold text-navy-900">{d.title}</h3>
                <p className="mt-2 text-sm text-navy-600 leading-relaxed">{d.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The flywheel — compounding gain */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-[auto_1fr] gap-12 items-center">
            <div className="flex justify-center">
              <FlywheelRing className="w-64 md:w-72" />
            </div>
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">{flywheelHeader?.excerpt ?? 'The compounding advantage'}</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900 leading-tight">
                <RichText text={flywheelHeader?.title ?? 'Every cycle gets *cheaper*, faster, and better.'} accent={(flywheelHeader?.metadata as { accent?: string })?.accent ?? 'brand-500'} />
              </h2>
              <div className="mt-8 grid sm:grid-cols-3 gap-6">
                {resolvedFlywheel.map((f, i) => (
                  <div key={i}>
                    <h3 className="font-display text-base font-bold text-navy-900">{f.title}</h3>
                    <p className="mt-1.5 text-sm text-navy-600 leading-relaxed">{f.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works — condensed, linking to the full journey */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{howHeader?.excerpt ?? 'How it works'}</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">{howHeader?.title ?? 'Find. Build. Submit. Improve.'}</h2>
            </div>
            <Link href="/how-it-works" className="text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">
              See the full 6-stage workflow &rarr;
            </Link>
          </div>
          <div className="grid md:grid-cols-3 gap-px bg-cream-200 border border-cream-200 rounded-xl overflow-hidden">
            {resolvedHow.map((h, i) => (
              <div key={i} className="bg-white p-8">
                <span className="font-display text-3xl font-black text-brand-100">{String(i + 1).padStart(2, '0')}</span>
                <h3 className="font-display text-lg font-bold text-navy-900 mt-2">{h.title}</h3>
                <p className="mt-2 text-sm text-navy-600 leading-relaxed">{h.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Proof — the expert */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">{proof?.excerpt ?? 'The proof'}</p>
          <h2 className="font-display text-3xl font-black text-navy-900 max-w-3xl leading-tight">
            {proof?.title ?? "Curated by an expert who's done it for 25 years."}
          </h2>
          <p className="mt-4 text-lg text-navy-600 max-w-3xl leading-relaxed">
            {proof?.body ?? 'Eric Wagner has personally secured hundreds of millions in SBIR, STTR, BAA, and OTA funding. He reviews every application and curates every opportunity in your pipeline — you always know who curated it, and why.'}
          </p>
          <Link href="/the-expert" className="inline-flex mt-6 text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">
            Meet the expert &rarr;
          </Link>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-cream-100 border-t border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">{cta?.excerpt ?? 'Applications open · Founding cohort'}</p>
          <h2 className="font-display text-3xl md:text-5xl font-black text-navy-900 leading-tight">
            {cta?.title ?? 'Make federal R&D your next non-dilutive raise.'}
          </h2>
          <p className="mt-4 text-lg text-navy-600 max-w-2xl mx-auto">
            {cta?.body ?? 'Apply to the founding cohort. Eric reviews every application within 72 hours.'}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={(cta?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'} className="inline-flex items-center justify-center px-10 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl">
              {(cta?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Apply to the Founding Cohort'}
            </Link>
            <Link href={(cta?.metadata as { secondary?: { href?: string } })?.secondary?.href ?? '/how-it-works'} className="inline-flex items-center justify-center px-8 py-4 border-2 border-navy-200 hover:border-brand-400 text-navy-700 hover:text-brand-700 text-lg font-semibold rounded-lg transition-colors">
              {(cta?.metadata as { secondary?: { label?: string } })?.secondary?.label ?? 'See how it works'}
            </Link>
          </div>
        </div>
      </section>

      <CustomSections pageKey="value" blocks={blocks} />
    </>
  );
}
