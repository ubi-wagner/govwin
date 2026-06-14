import Link from 'next/link';
import { getPageBlocks, getPublishedContent, buildLookup, single, many, type ContentRow } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';
import { MarketingIcon } from '@/components/marketing/icons';

export const revalidate = 60;

export const metadata = {
  title: 'RFP Pipeline — A Proposal Engine, Not a Proposal Gamble',
  description:
    'Win non-dilutive federal R&D funding without burning a month of payroll on every submission. 25 years of hands-on expertise plus isolated, company-specific AI — replacing a $5,000/mo monitoring service and a 10%-of-award consultant for $299/mo and flat per-proposal fees.',
};

export default async function LandingPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const isPreview = searchParams?._preview === '1';
  const blocks = await getPageBlocks('homepage', isPreview);
  const lookup = buildLookup(blocks, 'homepage');
  const hero = single(lookup['hero']);
  const stats = many(lookup['stats']);
  const valueBand = single(lookup['value-band']);
  const stagesHeader = single(lookup['stages-header']);
  const how = many(lookup['how']);
  const pricingHero = single(lookup['pricing-hero']);
  const pricingCards = many(lookup['pricing']);
  const expertGate = single(lookup['expert-gate']);
  const insightsHeader = single(lookup['insights-header']);
  const quote = single(lookup['quote']);
  const cta = single(lookup['cta']);
  const blogPosts = await getPublishedContent('blog_post', 3);
  const DEFAULT_STATS = [
    { title: '4+', body: 'Federal Sources Ingested' },
    { title: '72h', body: 'Expert-Review SLA' },
    { title: '20', body: 'Founding Cohort Cap' },
    { title: '25+', body: 'Years of Fed R&D Expertise' },
  ];

  // Condensed 3-beat teaser of the journey (the full 6 stages live on /how-it-works).
  const HOME_HOW = [
    { title: 'Find', icon: 'source-scout', body: 'Daily, expert-curated ingestion across SAM.gov, SBIR.gov, Grants.gov, and agency portals — ranked to your tech areas.' },
    { title: 'Build', icon: 'workspace', body: 'Buy a portal when you find a fit. Your isolated AI drafts against your library; your team revises in a stage-gated workspace.' },
    { title: 'Submit & improve', icon: 'export', body: 'Export a compliant, submission-ready package. Every cycle makes the next cheaper, faster, and more accurate.' },
  ];

  const DEFAULT_PRICING = [
    { excerpt: 'Required · Monthly', title: 'Spotlight Subscription', body: 'Daily ingestion. AI-powered ranking against your profile. Expert-curated compliance matrix. Deadline alerts. 15 min of Ask-the-Expert each month (rolls over).', metadata: { price: '$299', period: '/mo', note: 'Required to purchase any portal' } },
    { excerpt: 'Per-Proposal', title: 'Phase I — Like Effort', body: 'SBIR/STTR Phase I, smaller BAA topics, OTA/CSO short-form. 72-hour curation by Expert. Stage-gated workspace. Custom AI drafting.', metadata: { price: '$999', period: 'per proposal' } },
    { excerpt: 'Per-Proposal', title: 'Phase II — Like Effort', body: 'SBIR/STTR Phase II, larger BAA, OTA prototypes, complex NOFOs. 20-50+ page tech volumes. Commercialization plans included.', metadata: { price: '$1,999', period: 'per proposal' } },
  ];

  const resolvedStats = stats.length > 0 ? stats.map((s: ContentRow) => ({ title: s.title, body: s.body })) : DEFAULT_STATS;
  const resolvedHow = how.length > 0 ? how.map((h: ContentRow) => ({ title: h.title, body: h.body, icon: (h.metadata as { icon?: string })?.icon })) : HOME_HOW;
  const resolvedPricing = pricingCards.length > 0 ? pricingCards.map((p: ContentRow) => ({ excerpt: p.excerpt, title: p.title, body: p.body, metadata: p.metadata })) : DEFAULT_PRICING;

  return (
    <>
      {/* Hero */}
      <section className="bg-cream-50">
        <div className="max-w-6xl mx-auto px-6 py-24 md:py-36">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">
            {hero?.excerpt ?? 'AI + Expert · From Application to Submission'}
          </p>
          <h1 className="font-display text-5xl md:text-7xl font-black text-navy-900 leading-[1.05]">
            <RichText text={hero?.title ?? 'A proposal\nengine, *not* a\nproposal\ngamble.'} accent="brand-500" />
          </h1>
          <p className="mt-8 text-xl md:text-2xl text-navy-600 font-prose italic leading-relaxed max-w-2xl">
            {hero?.body ?? 'Win non-dilutive federal R&D funding — without burning a month of payroll on every submission. We pair 25 years of hands-on expertise with isolated, company-specific AI, so you pursue more opportunities and submit better proposals. (SBIR, STTR, BAA, OTA.)'}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              href={(hero?.metadata as { primary_cta?: { href?: string } })?.primary_cta?.href ?? '/apply'}
              className="inline-flex items-center justify-center px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl"
            >
              {(hero?.metadata as { primary_cta?: { label?: string } })?.primary_cta?.label ?? 'Apply for Founding Cohort'}
            </Link>
            <Link
              href={(hero?.metadata as { secondary_cta?: { href?: string } })?.secondary_cta?.href ?? '/value'}
              className="inline-flex items-center justify-center px-8 py-4 border-2 border-navy-200 hover:border-brand-400 text-navy-700 text-lg font-semibold rounded-lg transition-colors"
            >
              {(hero?.metadata as { secondary_cta?: { label?: string } })?.secondary_cta?.label ?? 'See why it works'}
            </Link>
          </div>
          <p className="mt-5 text-sm text-navy-400">
            {(hero?.metadata as { note?: string })?.note ?? 'Platform launches July 2026. 20 founding-cohort seats. Applications reviewed weekly.'}
          </p>
        </div>
      </section>

      {/* Stats bar */}
      <section className="bg-navy-900 border-y border-navy-800">
        <div className="max-w-6xl mx-auto px-6 py-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {resolvedStats.map((stat) => (
            <div key={stat.body}>
              <div className="text-4xl md:text-5xl font-display font-black text-white">
                {stat.title.replace(/h$/, '')}
                {stat.title.endsWith('h') && (
                  <span className="font-prose italic text-citrus">h</span>
                )}
              </div>
              <div className="mt-2 text-xs text-navy-400 uppercase tracking-widest">{stat.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Value band — newcomer hook + ROI anchor */}
      <section className="bg-cream-100 border-b border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-2 gap-8 md:gap-12 md:divide-x md:divide-cream-300">
          <div className="md:pr-6">
            <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-2">{valueBand?.excerpt ?? 'New to federal R&D?'}</p>
            <p className="text-lg text-navy-700 leading-relaxed">
              {valueBand?.body ?? 'There are billions a year in non-dilutive federal R&D funding — grant-like money you keep your equity and IP on. Most qualifying small businesses never apply. We make it accessible.'}
            </p>
            <Link href="/federal-rd-101" className="inline-flex mt-3 text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">Start here &rarr;</Link>
          </div>
          <div className="md:pl-6">
            <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-2">{(valueBand?.metadata as { roiLabel?: string })?.roiLabel ?? 'The math'}</p>
            <p className="text-lg text-navy-700 leading-relaxed">
              {(valueBand?.metadata as { roi?: string })?.roi ?? 'Replaces a $5,000/mo monitoring service and a 10%-of-award consultant — for $299/mo and a flat $999 / $1,999 per proposal. No success fee.'}
            </p>
            <Link href="/pricing" className="inline-flex mt-3 text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">See pricing &rarr;</Link>
          </div>
        </div>
      </section>

      {/* How it works — condensed teaser (full 6-stage journey on /how-it-works) */}
      <section className="bg-white">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-12">
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{stagesHeader?.excerpt ?? 'How it works'}</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">
                <RichText text={stagesHeader?.title ?? 'From application to submitted *proposal* — one workflow.'} accent="brand-500" />
              </h2>
            </div>
            <Link href="/how-it-works" className="text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors shrink-0">See the full 6-stage workflow &rarr;</Link>
          </div>
          <div className="grid md:grid-cols-3 gap-px bg-navy-100 border border-navy-100 rounded-xl overflow-hidden">
            {resolvedHow.map((step, i) => (
              <div key={i} className="bg-cream-50 p-8">
                <MarketingIcon name={step.icon} className="h-7 w-7 text-brand-600 mb-3" />
                <p className="text-xs font-semibold text-brand-500 uppercase tracking-widest mb-2">{String(i + 1).padStart(2, '0')} — {step.title}</p>
                <p className="mt-1 text-sm text-navy-600 leading-relaxed">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing snapshot */}
      <section className="bg-navy-900">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-4">{pricingHero?.excerpt ?? 'How We Charge'}</p>
          <h2 className="font-display text-3xl md:text-4xl font-black text-white leading-tight">
            <RichText text={pricingHero?.title ?? 'One subscription.\nPer-proposal *portals*.'} accent="citrus" />
          </h2>
          <p className="mt-4 text-lg text-navy-300 font-prose italic max-w-2xl leading-relaxed">
            {pricingHero?.body ?? 'Priced and built specifically for small businesses, not enterprise. Low cost subscription provides find and remind capabilities. Per proposal pricing ensures you only pay for builds you choose.'}
          </p>

          <div className="mt-14 grid md:grid-cols-3 gap-6">
            {resolvedPricing.map((card, i) => {
              const meta = card.metadata as { price?: string; period?: string; note?: string };
              const isFirst = i === 0;
              return (
                <div key={i} className="bg-navy-800 border border-navy-700 rounded-xl p-8">
                  <p className={`text-xs uppercase tracking-widest ${isFirst ? 'text-citrus-400' : 'text-brand-400'} mb-1`}>{card.excerpt}</p>
                  <h3 className="font-display text-xl font-bold text-white">{card.title}</h3>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-display font-black text-white">{meta?.price}</span>
                    <span className="text-navy-400">{meta?.period}</span>
                  </div>
                  <p className="mt-3 text-sm text-navy-300 leading-relaxed">{card.body}</p>
                  {meta?.note && <p className="mt-4 text-xs text-navy-500 uppercase tracking-wider">{meta.note}</p>}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Expert gate */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-4">{expertGate?.excerpt ?? 'The Expert Gate'}</p>
              <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900 leading-tight">
                <RichText text={expertGate?.title ?? 'The AI drafts.\nThe Expert *verifies*.\nYour Team collaborates.'} accent="brand-500" />
              </h2>
            </div>
            <div className="bg-white border border-cream-200 rounded-xl p-8">
              <div className="flex items-center gap-4 mb-4">
                <a href="https://www.linkedin.com/in/eric-c-wagner/" target="_blank" rel="noopener noreferrer" className="shrink-0">
                  <div className="w-16 h-16 rounded-full bg-navy-100 flex items-center justify-center overflow-hidden">
                    <svg className="w-10 h-10 text-navy-400" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z" />
                    </svg>
                  </div>
                </a>
                <div>
                  <a href="https://www.linkedin.com/in/eric-c-wagner/" target="_blank" rel="noopener noreferrer" className="text-xs uppercase tracking-widest text-brand-500 font-semibold hover:text-brand-700 transition-colors">
                    {(expertGate?.metadata as { expert_name?: string })?.expert_name ?? 'Eric Wagner'} — Founder &amp; Architect
                  </a>
                  <h3 className="font-prose italic text-2xl text-navy-800">
                    25 years of federal R&amp;D funding.
                  </h3>
                </div>
              </div>
              <p className="mt-4 text-sm text-navy-600 leading-relaxed">
                {expertGate?.body ?? 'The Expert personally reviews every application, curates every solicitation released into your Spotlight, and is available for pre-submission review. As the service scales, additional experts will join the roster — you will always know which expert reviewed your pipeline.'}
              </p>
              <ul className="mt-6 space-y-2 text-sm text-navy-600">
                {((expertGate?.metadata as { bullets?: string[] })?.bullets ?? [
                  '72-hour application & curation SLA',
                  '15 min of strategy calls per month',
                  'Agency-specific: DoD, NSF, DOE, DARPA, DOT',
                  'Additional time on demand — $500/hr',
                ]).map((bullet: string, i: number) => (
                  <li key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 bg-award rounded-full" /> {bullet}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Latest Insights */}
      {blogPosts.length > 0 && (
        <section className="bg-white border-t border-cream-200">
          <div className="max-w-6xl mx-auto px-6 py-20 md:py-28">
            <div className="flex items-baseline justify-between mb-12">
              <div>
                <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{insightsHeader?.excerpt ?? 'Latest Insights'}</p>
                <h2 className="font-display text-3xl md:text-4xl font-black text-navy-900">
                  <RichText text={insightsHeader?.title ?? 'From the *blog*.'} accent="brand-500" />
                </h2>
              </div>
              <Link href="/resources" className="text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors hidden md:block">
                View all posts &rarr;
              </Link>
            </div>
            <div className="grid md:grid-cols-3 gap-8">
              {blogPosts.map((post) => (
                <Link key={post.id} href={`/resources/${post.slug}`} className="group">
                  <article className="h-full flex flex-col">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {(post.tags ?? []).slice(0, 2).map((tag: string) => (
                        <span key={tag} className="text-xs px-2 py-0.5 bg-cream-100 text-navy-500 rounded-full uppercase tracking-wider">{tag}</span>
                      ))}
                    </div>
                    <h3 className="font-display text-lg font-bold text-navy-900 group-hover:text-brand-600 transition-colors leading-snug">
                      {post.title}
                    </h3>
                    {post.excerpt && (
                      <p className="mt-2 text-sm text-navy-600 leading-relaxed line-clamp-3 flex-1">
                        {post.excerpt}
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-4 text-xs text-navy-400">
                      {post.author && <span>{post.author}</span>}
                      {post.publishedAt && (
                        <>
                          <span>&middot;</span>
                          <span>{new Date(post.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                        </>
                      )}
                    </div>
                  </article>
                </Link>
              ))}
            </div>
            <div className="mt-8 text-center md:hidden">
              <Link href="/resources" className="text-sm font-semibold text-brand-600 hover:text-brand-800 transition-colors">
                View all posts &rarr;
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* Quote */}
      <section className="bg-cream-100 border-y border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <blockquote className="font-prose italic text-2xl md:text-3xl text-navy-800 leading-relaxed">
            &ldquo;{quote?.body ?? 'Free trials attract tire-kickers who waste expert time that serious applicants need. The application itself is the qualifier.'}&rdquo;
          </blockquote>
          <p className="mt-6 text-xs uppercase tracking-widest text-navy-400">— {quote?.excerpt ?? 'Why No Free Trial'}</p>
        </div>
      </section>

      {/* Final CTA */}
      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-4">
            {cta?.excerpt ?? 'Applications Open · Launch July 2026'}
          </p>
          <h2 className="font-display text-3xl md:text-5xl font-black text-white leading-tight">
            <RichText text={cta?.title ?? 'Apply today. Draft your *first*\nproposal on launch day.'} accent="citrus" />
          </h2>
          <div className="mt-10 flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href={(cta?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'}
              className="inline-flex items-center justify-center px-10 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl"
            >
              {(cta?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Apply Now'}
            </Link>
            <Link
              href={(cta?.metadata as { secondary?: { href?: string } })?.secondary?.href ?? '/federal-rd-101'}
              className="inline-flex items-center justify-center px-8 py-4 border-2 border-navy-600 hover:border-brand-400 text-navy-200 hover:text-white text-lg font-semibold rounded-lg transition-colors"
            >
              {(cta?.metadata as { secondary?: { label?: string } })?.secondary?.label ?? 'New to federal R&D? Start here'}
            </Link>
          </div>
          <div className="mt-8 flex items-center justify-center gap-6 text-sm text-navy-400">
            <span>{(cta?.metadata as { footer?: { role?: string } })?.footer?.role ?? 'Founder & Architect'}</span>
            <span className="text-cream-200 font-semibold">{(cta?.metadata as { footer?: { name?: string } })?.footer?.name ?? 'Eric Wagner'}</span>
            <a href={`mailto:${(cta?.metadata as { footer?: { email?: string } })?.footer?.email ?? 'eric@rfppipeline.com'}`} className="text-citrus-400 hover:text-citrus-300">{(cta?.metadata as { footer?: { email?: string } })?.footer?.email ?? 'eric@rfppipeline.com'}</a>
          </div>
        </div>
      </section>

      <CustomSections pageKey="homepage" blocks={blocks} />
    </>
  );
}
