import Link from 'next/link';
import { getPublishedContent, getPageBlocks, buildLookup, single, many } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';
import { AgencyMark } from '@/components/marketing/agency-mark';

export const metadata = {
  title: 'Track Record — RFP Pipeline',
  description:
    'A 25-year record of funded outcomes. The expertise behind RFP Pipeline has secured hundreds of millions in SBIR, STTR, BAA, and OTA funding across DoD, NSF, DOE, and DARPA.',
};

export const revalidate = 60;

const DEFAULT_OUTCOMES = [
  { title: 'Hundreds of $M', body: 'in SBIR, STTR, BAA & OTA funding secured' },
  { title: '$270M', body: 'annual revenue at the A&D company Eric led' },
  { title: '22+', body: 'startups launched through OSU commercialization' },
  { title: 'Phase I–III', body: 'across DoD, NSF, DOE, DARPA & more' },
];

export default async function TrackRecordPage() {
  const testimonials = await getPublishedContent('testimonial');
  const blocks = await getPageBlocks('customers');
  const lookup = buildLookup(blocks, 'customers');
  const hero = single(lookup['hero']);
  const outcomes = many(lookup['outcomes']);
  const agencies = single(lookup['agencies']);
  const testimonialsHeader = single(lookup['testimonials-header']);
  const empty = single(lookup['empty']);
  const cta = single(lookup['cta']);
  const ctaMeta = (cta?.metadata ?? {}) as { ctaLabel?: string; ctaHref?: string };
  const resolvedOutcomes = outcomes.length > 0 ? outcomes.map((o) => ({ title: o.title, body: o.body })) : DEFAULT_OUTCOMES;
  const agencyList = ((agencies?.metadata as { items?: string[] })?.items) ?? ['DoD', 'NSF', 'DOE', 'DARPA', 'DOT', 'AFWERX'];

  return (
    <>
      {/* Hero */}
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-20 md:py-24">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Track Record'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            <RichText text={hero?.title ?? 'A 25-year record of *funded* outcomes.'} accent={(hero?.metadata as { accent?: string })?.accent ?? 'award'} />
          </h1>
          <p className="mt-6 text-lg text-navy-600 max-w-2xl leading-relaxed">
            {hero?.body ?? "We're a new platform — but the expertise behind it isn't. Eric Wagner has spent 25 years turning innovative small businesses into federally funded ones. That playbook is what RFP Pipeline delivers as software."}
          </p>
        </div>
      </section>

      {/* Outcomes */}
      <section className="bg-cream-100 border-y border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
          {resolvedOutcomes.map((o, i) => (
            <div key={i}>
              <div className="font-display text-3xl md:text-4xl font-black text-brand-600">{o.title}</div>
              <div className="mt-2 text-xs text-navy-500 uppercase tracking-widest leading-relaxed">{o.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Agencies funded */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-16">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-3">{agencies?.excerpt ?? 'Funded across'}</p>
          <h2 className="font-display text-2xl md:text-3xl font-black text-navy-900">{agencies?.title ?? 'Agencies our expert has won with.'}</h2>
          <div className="mt-8 flex flex-wrap gap-3">
            {agencyList.map((a) => (
              <span key={a} className="inline-flex items-center gap-2.5 px-5 py-2.5 rounded-lg border border-cream-200 bg-cream-50 font-display font-bold text-navy-700">
                <AgencyMark name={a} title={a} className="h-6 w-6 text-brand-600 shrink-0" />
                {a}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Customer stories (render when they exist) */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl md:text-3xl font-black text-navy-900 mb-8">{testimonialsHeader?.title ?? 'From the founding cohort'}</h2>
          {testimonials.length === 0 ? (
            <div className="rounded-xl border border-cream-200 bg-white p-10 text-center">
              <p className="text-navy-600 text-lg">{empty?.title ?? 'Founding-cohort stories are on the way.'}</p>
              <p className="mt-2 text-sm text-navy-400">{empty?.body ?? 'Our first customers are onboarding now. Their results will appear here as they win.'}</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {testimonials.map((testimonial) => {
                const meta = (testimonial.metadata ?? {}) as { company?: string; title?: string; role?: string };
                return (
                  <div key={testimonial.id} className="bg-white border border-cream-200 rounded-lg p-8 flex flex-col">
                    <div className="flex-1">
                      <svg className="h-8 w-8 text-brand-300 mb-4" fill="currentColor" viewBox="0 0 32 32" aria-hidden="true">
                        <path d="M10 8c-3.3 0-6 2.7-6 6v10h10V14H8c0-1.1.9-2 2-2V8zm14 0c-3.3 0-6 2.7-6 6v10h10V14h-6c0-1.1.9-2 2-2V8z" />
                      </svg>
                      <p className="text-navy-700 leading-relaxed">{testimonial.body}</p>
                    </div>
                    <div className="mt-6 flex items-center gap-4 pt-6 border-t border-cream-200">
                      {testimonial.featuredImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={testimonial.featuredImage} alt={testimonial.title} className="h-12 w-12 rounded-full object-cover bg-cream-200" />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-brand-100 flex items-center justify-center">
                          <span className="text-brand-600 font-bold text-lg">{testimonial.title.charAt(0).toUpperCase()}</span>
                        </div>
                      )}
                      <div>
                        <p className="font-display font-bold text-navy-900 text-sm">{testimonial.title}</p>
                        {(meta.title || meta.role) && <p className="text-xs text-navy-500">{meta.title || meta.role}</p>}
                        {meta.company && <p className="text-xs text-navy-400">{meta.company}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="bg-cream-100 border-t border-cream-200">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-navy-900">{cta?.title ?? 'Put that track record to work for you.'}</h2>
          <p className="mt-3 text-navy-600 max-w-xl mx-auto">{cta?.body ?? 'Apply to the founding cohort and get the same expertise behind your next proposal.'}</p>
          <Link href={ctaMeta.ctaHref ?? '/apply'} className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            {ctaMeta.ctaLabel ?? 'Apply Now'}
          </Link>
        </div>
      </section>

      <CustomSections pageKey="customers" blocks={blocks} />
    </>
  );
}
