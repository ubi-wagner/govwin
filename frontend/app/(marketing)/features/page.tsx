import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many, type ContentRow } from '@/lib/cms';
import { CmsCard } from '@/components/marketing/cms-card';
import { RichText } from '@/components/marketing/rich-text';

export const revalidate = 60;

export const metadata = {
  title: 'Features — RFP Pipeline',
  description: 'Source Scout, AI Drafting, Content Library, Compliance Engine, and more. Everything you need to win federal R&D contracts.',
};

const DEFAULT_FEATURES = [
  { heading: 'Source Scout', description: 'Automated monitoring of SAM.gov, SBIR.gov, and agency portals. Source Scout detects new opportunities, tracks changes to existing solicitations, and alerts your team before deadlines sneak up. Every source is HITL-verified by our expert curator.' },
  { heading: 'RFP Curation', description: 'Every solicitation is reviewed by a federal R&D expert with 25 years of experience. Topics are scored, categorized, and annotated with compliance requirements before they reach your pipeline. No AI hallucinations in your opportunity feed.' },
  { heading: 'Spotlight Feed', description: 'Your personalized opportunity feed, scored against your company profile. NAICS codes, keywords, agency priorities, and set-aside types all factor into your match score. Pin the opportunities that matter and pass on the rest.' },
  { heading: 'Proposal Workspace', description: 'A structured, stage-gated workspace for building federal proposals. Draft, review, and finalize with your team. Invite internal contributors and external partners with role-based, section-level access control.' },
  { heading: 'AI Drafting', description: 'Your tenant gets its own isolated AI team. Agents draft sections using your content library, past proposals, and the solicitation requirements. Every draft is clearly marked as AI-generated and requires human review before acceptance.' },
  { heading: 'Content Library', description: 'Build a reusable catalog of proven content atoms — technical descriptions, past performance narratives, capability statements, and more. Tag winning content, track usage across proposals, and let the AI find the right atom for each section.' },
  { heading: 'Compliance Engine', description: 'Automated compliance matrix tracking against solicitation requirements. Every requirement is mapped to a proposal section with status tracking. Know exactly what is addressed, what is partial, and what is missing before you submit.' },
  { heading: 'Export Package', description: 'Generate submission-ready document packages that meet federal formatting requirements. Page limits, font specifications, margin requirements, and section ordering are all enforced by the canvas rules engine.' },
];

export default async function FeaturesPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = await props.searchParams;
  const isPreview = searchParams?._preview === '1';
  const blocks = await getPageBlocks('features', isPreview);
  const lookup = buildLookup(blocks, 'features');
  const hero = single(lookup['hero']);
  const cmsFeatures = many(lookup['items']);
  const ctaBlock = single(lookup['cta']);

  const features = cmsFeatures.length > 0
    ? cmsFeatures.map((f: ContentRow) => ({ heading: f.title, description: f.body, image: f.featuredImage, icon: (f.metadata as { icon?: string })?.icon, href: (f.metadata as { href?: string })?.href }))
    : DEFAULT_FEATURES;

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'Platform Features'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            <RichText
              text={hero?.title ?? 'Everything you need to *win*.'}
              accent={(hero?.metadata as { accent?: string })?.accent ?? 'award'}
            />
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            {hero?.body ?? 'From opportunity discovery to submission-ready packages. Expert curation, isolated AI, and structured workflows — designed for small businesses pursuing federal R&D funding.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="grid md:grid-cols-2 gap-8">
            {features.map((feature, i) => (
              <CmsCard
                key={i}
                image={'image' in feature ? (feature as { image?: string | null }).image : null}
                icon={'icon' in feature ? (feature as { icon?: string }).icon : undefined}
                href={'href' in feature ? (feature as { href?: string }).href : undefined}
                title={feature.heading}
                body={feature.description}
                className="bg-cream-50 border border-cream-200 rounded-xl"
              />
            ))}
          </div>
        </div>
      </section>

      <section className="bg-navy-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-3xl font-bold mb-6">{ctaBlock?.title ?? 'Ready to see it in action?'}</h2>
          <p className="text-navy-300 text-lg mb-8">
            {ctaBlock?.body ?? 'Join the founding cohort and get early access to every feature.'}
          </p>
          <Link href={(ctaBlock?.metadata as { cta?: { href?: string } })?.cta?.href ?? '/apply'} className="inline-block px-8 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-semibold transition-colors">
            {(ctaBlock?.metadata as { cta?: { label?: string } })?.cta?.label ?? 'Apply Now'}
          </Link>
        </div>
      </section>
    </>
  );
}
