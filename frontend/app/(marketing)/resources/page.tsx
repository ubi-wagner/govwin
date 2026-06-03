import Link from 'next/link';
import { getPublishedContentByTypes, getPageBlocks, buildLookup, single, many } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import ResourcesFilter from '@/components/marketing/resources-filter';
import { CustomSections } from '@/components/marketing/custom-sections';

export const metadata = {
  title: 'Resources — RFP Pipeline',
  description: 'Blog, guides, federal R&D funding insights, and links to your RFP portals.',
};

// Revalidate every 60 seconds so published changes show up quickly
export const revalidate = 60;

export default async function ResourcesPage() {
  const allContent = await getPublishedContentByTypes(['resource', 'guide', 'blog_post']);
  const blocks = await getPageBlocks('resources');
  const lookup = buildLookup(blocks, 'resources');
  const hero = single(lookup['hero']);
  const programsHeader = single(lookup['programs-header']);
  const programs = many(lookup['programs']);
  const insightsHeader = single(lookup['insights-header']);
  const portalsHeader = single(lookup['portals-header']);
  const portals = many(lookup['portals']);
  const cta = single(lookup['cta']);
  const ctaMeta = (cta?.metadata ?? {}) as { ctaLabel?: string; ctaHref?: string };

  const DEFAULT_PROGRAMS = [
    { title: 'SBIR', body: 'Small Business Innovation Research — Phase I through Phase III across all DoD branches, NSF, DOE, NIH, and more.' },
    { title: 'STTR', body: 'Small Business Technology Transfer — requires a research institution partner. Same agencies, different collaboration model.' },
    { title: 'BAA', body: 'Broad Agency Announcements — open-ended R&D solicitations from DARPA, AFRL, Army Research Lab, and others.' },
    { title: 'OTA', body: 'Other Transaction Authority — non-FAR contracting for prototype development. Faster timelines, different compliance.' },
    { title: 'CSO', body: 'Commercial Solutions Openings — typically Air Force (AFWERX). Slide-deck format, short-form proposals.' },
    { title: 'Grants / NOFO', body: 'Grants.gov Notices of Funding Opportunity — NSF, DOE, NIH. CFDA-based, different compliance structure.' },
  ];
  const DEFAULT_PORTALS = [
    { title: 'Spotlight Dashboard', body: 'Your ranked opportunity feed, deadline reminders, and pinned topics.', linkLabel: 'Login to access', linkHref: '/login' },
    { title: 'Proposal Portals', body: 'Your purchased proposal workspaces — drafts, collaborators, and submission packages.', linkLabel: 'Login to access', linkHref: '/login' },
  ];
  const resolvedPrograms = programs.length > 0
    ? programs.map((p) => ({ title: p.title, body: p.body }))
    : DEFAULT_PROGRAMS;
  const resolvedPortals = portals.length > 0
    ? portals.map((p) => { const m = (p.metadata ?? {}) as { linkLabel?: string; linkHref?: string }; return { title: p.title, body: p.body, linkLabel: m.linkLabel ?? 'Login to access', linkHref: m.linkHref ?? '/login' }; })
    : DEFAULT_PORTALS;

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Resources'}</p>
          <h1 className="font-display text-4xl md:text-5xl font-black text-navy-900">
            <RichText text={hero?.title ?? 'Insights, guides, and your *portals*.'} accent={(hero?.metadata as { accent?: string })?.accent ?? 'brand-500'} />
          </h1>
          <p className="mt-4 text-lg text-navy-600">
            {hero?.body ?? 'Federal R&D funding intelligence. Updated as we curate.'}
          </p>
        </div>
      </section>

      {/* Programs grid */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-8">{programsHeader?.title ?? 'Programs We Cover'}</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {resolvedPrograms.map((prog) => (
              <div key={prog.title} className="p-5 bg-cream-50 border border-cream-200 rounded-lg">
                <h3 className="font-display font-bold text-navy-900">{prog.title}</h3>
                <p className="mt-2 text-sm text-navy-600 leading-relaxed">{prog.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Dynamic content from CMS */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between mb-8">
            <h2 className="font-display text-2xl font-bold text-navy-900">{insightsHeader?.title ?? 'Latest Insights'}</h2>
          </div>

          {allContent.length === 0 ? (
            <p className="text-navy-500 text-center py-12">Resources coming soon.</p>
          ) : (
            <ResourcesFilter content={JSON.parse(JSON.stringify(allContent))} />
          )}
        </div>
      </section>

      {/* Subscriber portal links */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-16">
          <h2 className="font-display text-2xl font-bold text-navy-900 mb-3">{portalsHeader?.title ?? 'Subscriber Portals'}</h2>
          <p className="text-sm text-navy-500 mb-8">{portalsHeader?.body ?? 'Logged-in subscribers access their portals via the dashboard.'}</p>
          <div className="grid md:grid-cols-2 gap-6">
            {resolvedPortals.map((portal) => (
              <div key={portal.title} className="p-6 border border-cream-200 rounded-lg bg-cream-50">
                <h3 className="font-display font-bold text-navy-900">{portal.title}</h3>
                <p className="mt-2 text-sm text-navy-600">{portal.body}</p>
                <Link href={portal.linkHref} className="mt-4 inline-flex text-sm text-brand-500 hover:text-brand-700 font-medium">
                  {portal.linkLabel} &rarr;
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-navy-900">
        <div className="max-w-4xl mx-auto px-6 py-16 text-center">
          <h2 className="font-display text-2xl font-bold text-white">
            {cta?.title ?? 'Ready to build your federal R&D pipeline?'}
          </h2>
          <Link href={ctaMeta.ctaHref ?? '/apply'} className="inline-flex mt-6 px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white font-bold rounded-lg transition-colors">
            {ctaMeta.ctaLabel ?? 'Apply Now'}
          </Link>
        </div>
      </section>

      <CustomSections pageKey="resources" blocks={blocks} />
    </>
  );
}
