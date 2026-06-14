import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';
import { WaitlistForm } from '@/components/marketing/waitlist-form';
import { MarketingIcon } from '@/components/marketing/icons';

export const revalidate = 60;

export const metadata = {
  title: 'Federal R&D 101 — Non-dilutive funding for innovative small businesses',
  description:
    'New to federal R&D funding? There are billions a year in non-dilutive, grant-like money for small-business R&D through SBIR, STTR, and more. Here’s what it is, whether you qualify, and how to start.',
};

const DEFAULT_WHAT = [
  { title: "It's non-dilutive.", icon: 'non-dilutive', body: "Unlike venture capital, federal R&D funding doesn't take equity. You keep ownership of your company and your IP — it's closer to a grant than an investment." },
  { title: "It's billions a year.", icon: 'billions', body: 'Federal agencies set aside billions every year for small-business R&D through programs like SBIR and STTR — across defense, energy, health, climate, space, and more.' },
  { title: 'You probably qualify.', icon: 'qualify', body: "If you're a U.S. small business doing genuinely innovative work, there's likely a program for you. Most companies never apply, because the process looks impenetrable. It isn't — with the right help." },
];

const DEFAULT_ELIGIBILITY = [
  'A U.S.-based, for-profit small business (500 or fewer employees)',
  'More than 50% owned by U.S. individuals',
  'Doing genuinely innovative R&D — hardware, software, materials, bio, climate, or defense-adjacent',
  'Willing to perform the work in the United States',
  'Open to non-dilutive funding instead of — or alongside — venture capital',
];

function Check() {
  return (
    <svg className="mt-1 w-5 h-5 text-brand-500 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 10.5l3.5 3.5L15 6.5" />
    </svg>
  );
}

export default async function FederalRd101Page() {
  const blocks = await getPageBlocks('federal-rd-101');
  const lookup = buildLookup(blocks, 'federal-rd-101');
  const hero = single(lookup['hero']);
  const what = many(lookup['what']);
  const eligHeader = single(lookup['eligibility-header']);
  const eligibility = many(lookup['eligibility']);
  const capture = single(lookup['capture']);
  const cta = single(lookup['cta']);
  const resolvedWhat = what.length > 0 ? what.map((w) => ({ title: w.title, body: w.body, icon: (w.metadata as { icon?: string })?.icon })) : DEFAULT_WHAT;
  const resolvedElig = eligibility.length > 0 ? eligibility.map((e) => e.body || e.title || '') : DEFAULT_ELIGIBILITY;

  return (
    <>
      {/* Hero */}
      <section className="bg-cream-50">
        <div className="max-w-4xl mx-auto px-6 py-20 md:py-28">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Federal R&D 101'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            <RichText text={hero?.title ?? "There's *non-dilutive* money for your R&D. You probably qualify."} accent={(hero?.metadata as { accent?: string })?.accent ?? 'award'} />
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-2xl leading-relaxed">
            {hero?.body ?? 'Federal agencies hand out billions every year to help small businesses fund innovative R&D — grant-like money you keep your equity on. Here’s what it is, whether it’s for you, and how to start without a BD department.'}
          </p>
        </div>
      </section>

      {/* What it is */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 grid md:grid-cols-3 gap-8">
          {resolvedWhat.map((w, i) => (
            <div key={i} className="bg-cream-50 border border-cream-200 rounded-xl p-8">
              <MarketingIcon name={w.icon} className="h-9 w-9 text-brand-600 mb-4" />
              <h2 className="font-display text-2xl font-black text-navy-900">{w.title}</h2>
              <p className="mt-3 text-navy-600 leading-relaxed">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Eligibility */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{eligHeader?.excerpt ?? 'Is this you?'}</p>
          <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">{eligHeader?.title ?? 'You may qualify if you are…'}</h2>
          <ul className="mt-8 space-y-4">
            {resolvedElig.map((item, i) => (
              <li key={i} className="flex items-start gap-3 text-lg text-navy-700 leading-relaxed">
                <Check />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-navy-500">{eligHeader?.body ?? 'Not sure? That’s exactly what the application is for — Eric reviews every one and tells you honestly whether it’s a fit.'}</p>
        </div>
      </section>

      {/* Capture — soft lead magnet */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-3xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{capture?.excerpt ?? 'Not ready to apply yet?'}</p>
          <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">{capture?.title ?? 'Get the federal R&D starter guide.'}</h2>
          <p className="mt-3 text-lg text-navy-600">{capture?.body ?? 'A plain-English primer on SBIR/STTR, what agencies fund, and how to position your company — plus a heads-up when a newcomer track opens.'}</p>
          <div className="mt-8">
            <WaitlistForm source="federal-rd-101" cta="Send me the guide" />
          </div>
        </div>
      </section>

      {/* CTA — ready ones apply */}
      <section className="bg-cream-100 border-t border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900 leading-tight">{cta?.title ?? 'Already know it’s for you?'}</h2>
          <p className="mt-3 text-lg text-navy-600 max-w-2xl mx-auto">{cta?.body ?? 'Apply to the founding cohort — Eric reviews every application within 72 hours.'}</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center">
            <Link href={(cta?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'} className="inline-flex items-center justify-center px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl">
              {(cta?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Apply to the Founding Cohort'}
            </Link>
            <Link href="/value" className="inline-flex items-center justify-center px-8 py-4 border-2 border-navy-200 hover:border-brand-400 text-navy-700 hover:text-brand-700 text-lg font-semibold rounded-lg transition-colors">
              See why it works
            </Link>
          </div>
        </div>
      </section>

      <CustomSections pageKey="federal-rd-101" blocks={blocks} />
    </>
  );
}
