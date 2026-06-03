import Link from 'next/link';
import { getPublishedContent, getPageBlocks, buildLookup, single } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';

export const metadata = {
  title: 'Team — RFP Pipeline',
  description: 'Meet the team behind RFP Pipeline — federal R&D veterans and technologists.',
};

export const revalidate = 60;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams;
  const isPreview = params?._preview === '1';
  const teamMembers = await getPublishedContent('team_member');
  const lookup = buildLookup(await getPageBlocks('team', isPreview), 'team');
  const hero = single(lookup['hero']);
  const empty = single(lookup['empty']);
  const cta = single(lookup['cta']);
  const ctaMeta = (cta?.metadata ?? {}) as { ctaLabel?: string; ctaHref?: string };

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Team'}</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900">
            <RichText text={hero?.title ?? 'Built by *practitioners*.'} accent={(hero?.metadata as { accent?: string })?.accent ?? 'brand-500'} />
          </h1>
          <p className="mt-4 text-lg text-navy-600">
            {hero?.body ?? '25 years of federal R&D experience, translated into software.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          {teamMembers.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-navy-500 text-lg">{empty?.title ?? 'Team page coming soon.'}</p>
              <p className="mt-2 text-sm text-navy-400">
                {empty?.body ?? 'We are finalizing our team profiles.'}
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {teamMembers.map((member) => {
                const meta = (member.metadata ?? {}) as {
                  linkedin_url?: string;
                  email?: string;
                };
                return (
                  <div
                    key={member.id}
                    className="bg-cream-50 border border-cream-200 rounded-lg overflow-hidden"
                  >
                    {/* Photo */}
                    {member.featuredImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={member.featuredImage}
                        alt={member.title}
                        className="w-full h-64 object-cover bg-cream-200"
                      />
                    ) : (
                      <div className="w-full h-64 bg-cream-200 flex items-center justify-center">
                        <span className="text-cream-400 text-6xl font-display font-bold">
                          {member.title.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}

                    <div className="p-6">
                      {/* Name */}
                      <h3 className="font-display text-xl font-bold text-navy-900">
                        {member.title}
                      </h3>

                      {/* Role (stored in excerpt) */}
                      {member.excerpt && (
                        <p className="text-brand-500 font-medium text-sm mt-1">
                          {member.excerpt}
                        </p>
                      )}

                      {/* Bio */}
                      {member.body && (
                        <p className="mt-3 text-sm text-navy-600 leading-relaxed">
                          {member.body}
                        </p>
                      )}

                      {/* Links */}
                      {(meta.linkedin_url || meta.email) && (
                        <div className="mt-4 flex items-center gap-4">
                          {meta.linkedin_url && (
                            <a
                              href={meta.linkedin_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm text-navy-500 hover:text-brand-500 transition-colors"
                            >
                              LinkedIn
                            </a>
                          )}
                          {meta.email && (
                            <a
                              href={`mailto:${meta.email}`}
                              className="text-sm text-navy-500 hover:text-brand-500 transition-colors"
                            >
                              Email
                            </a>
                          )}
                        </div>
                      )}
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
            {cta?.title ?? 'Work with our team.'}
          </h2>
          <p className="mt-3 text-navy-300 max-w-xl mx-auto">
            {cta?.body ?? 'Apply for our founding cohort and get direct access to federal R&D veterans.'}
          </p>
          <Link href={ctaMeta.ctaHref ?? '/apply'} className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            {ctaMeta.ctaLabel ?? 'Apply Now'}
          </Link>
        </div>
      </section>
    </>
  );
}
