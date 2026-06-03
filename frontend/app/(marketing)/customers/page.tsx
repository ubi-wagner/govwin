import Link from 'next/link';
import { getPublishedContent, getPageBlocks, buildLookup, single } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';

export const metadata = {
  title: 'Customers — RFP Pipeline',
  description: 'Hear from government contractors who use RFP Pipeline to discover and win federal R&D opportunities.',
};

export const revalidate = 60;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const isPreview = params?._preview === '1';
  const testimonials = await getPublishedContent('testimonial');
  const lookup = buildLookup(await getPageBlocks('customers', isPreview), 'customers');
  const hero = single(lookup['hero']);
  const empty = single(lookup['empty']);
  const cta = single(lookup['cta']);
  const ctaMeta = (cta?.metadata ?? {}) as { ctaLabel?: string; ctaHref?: string };

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Customers'}</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900">
            <RichText text={hero?.title ?? 'Trusted by *federal innovators*.'} accent={(hero?.metadata as { accent?: string })?.accent ?? 'brand-500'} />
          </h1>
          <p className="mt-4 text-lg text-navy-600">
            {hero?.body ?? 'Hear from the small businesses building their federal R&D pipeline with us.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          {testimonials.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-navy-500 text-lg">{empty?.title ?? 'Customer stories coming soon.'}</p>
              <p className="mt-2 text-sm text-navy-400">
                {empty?.body ?? 'We are onboarding our founding cohort. Check back for their stories.'}
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {testimonials.map((testimonial) => {
                const meta = (testimonial.metadata ?? {}) as {
                  company?: string;
                  title?: string;
                  role?: string;
                };
                return (
                  <div
                    key={testimonial.id}
                    className="bg-cream-50 border border-cream-200 rounded-lg p-8 flex flex-col"
                  >
                    {/* Quote */}
                    <div className="flex-1">
                      <svg
                        className="h-8 w-8 text-brand-300 mb-4"
                        fill="currentColor"
                        viewBox="0 0 32 32"
                      >
                        <path d="M10 8c-3.3 0-6 2.7-6 6v10h10V14H8c0-1.1.9-2 2-2V8zm14 0c-3.3 0-6 2.7-6 6v10h10V14h-6c0-1.1.9-2 2-2V8z" />
                      </svg>
                      <p className="text-navy-700 leading-relaxed">
                        {testimonial.body}
                      </p>
                    </div>

                    {/* Author */}
                    <div className="mt-6 flex items-center gap-4 pt-6 border-t border-cream-200">
                      {testimonial.featuredImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={testimonial.featuredImage}
                          alt={testimonial.title}
                          className="h-12 w-12 rounded-full object-cover bg-cream-200"
                        />
                      ) : (
                        <div className="h-12 w-12 rounded-full bg-brand-100 flex items-center justify-center">
                          <span className="text-brand-600 font-bold text-lg">
                            {testimonial.title.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="font-display font-bold text-navy-900 text-sm">
                          {testimonial.title}
                        </p>
                        {(meta.title || meta.role) && (
                          <p className="text-xs text-navy-500">
                            {meta.title || meta.role}
                          </p>
                        )}
                        {meta.company && (
                          <p className="text-xs text-navy-400">{meta.company}</p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            {cta?.title ?? 'Join our founding cohort.'}
          </h2>
          <p className="mt-3 text-navy-300 max-w-xl mx-auto">
            {cta?.body ?? 'Be among the first small businesses to build a federal R&D pipeline powered by AI.'}
          </p>
          <Link href={ctaMeta.ctaHref ?? '/apply'} className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            {ctaMeta.ctaLabel ?? 'Apply Now'}
          </Link>
        </div>
      </section>
    </>
  );
}
