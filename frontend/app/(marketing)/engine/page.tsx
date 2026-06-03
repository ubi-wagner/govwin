import Link from 'next/link';
import { getPageBlocks, buildLookup, single, many, type ContentRow } from '@/lib/cms';
import { RichText } from '@/components/marketing/rich-text';
import { CustomSections } from '@/components/marketing/custom-sections';

export const revalidate = 60;

export const metadata = {
  title: 'The Engine — RFP Pipeline',
  description: 'How RFP Pipeline combines expert curation, AI agents, and structured workflows to win federal R&D contracts.',
};

const DEFAULT_STEPS = [
  { number: '01', title: 'Source Scout Finds', description: 'Automated monitoring scans SAM.gov, SBIR.gov, DSIP, and agency portals daily. New solicitations, amendments, and deadline changes are captured and queued for expert review.', detail: 'No opportunity slips through the cracks. Source Scout runs on a schedule, compares page snapshots, and flags meaningful changes using Claude classification.' },
  { number: '02', title: 'Expert Curates', description: 'Every solicitation is reviewed by Eric Wagner — 25 years of federal R&D experience. Topics are scored, compliance requirements are extracted, and volumes are structured before anything reaches your feed.', detail: 'This is not a raw data dump. Every opportunity in your pipeline has been human-verified, annotated with expert notes, and structured for proposal development.' },
  { number: '03', title: 'AI Structures', description: 'Once curated, AI agents extract compliance matrices, map required sections, identify page limits and formatting rules, and build proposal outlines automatically.', detail: 'Your isolated AI team works only with your data. No cross-contamination between tenants. The compliance engine catches requirements that humans miss.' },
  { number: '04', title: 'Customer Writes', description: 'You and your team fill in the proposal using the structured workspace. The content library suggests proven atoms from your past proposals. Section-level collaboration keeps everyone focused.', detail: 'Stage-gated progression ensures quality: draft, review, finalize. Role-based access means your PI sees their sections, your contracts person sees theirs, and external partners see only what you share.' },
  { number: '05', title: 'AI Assists', description: 'AI agents draft sections using your content library, the solicitation requirements, and the compliance matrix. Every draft is clearly marked and requires human review.', detail: 'The AI does not submit for you. It drafts. You review, edit, accept, or reject. The compliance engine checks every section against the requirements matrix in real time.' },
  { number: '06', title: 'Expert Reviews', description: 'Before submission, your proposal goes through a structured review process. Compliance checks, page counts, formatting verification, and expert feedback ensure submission readiness.', detail: 'The gold team review is where proposals go from good to winning. Our system tracks every requirement, every page limit, and every formatting rule so nothing is missed.' },
];

const DEFAULT_DIFFERENTIATORS = [
  { label: 'Isolation', title: 'Your Data. Your AI.', body: 'Every tenant gets isolated AI agents that only see their data. No shared context windows, no cross-contamination, no data leakage between companies.' },
  { label: 'Accountability', title: 'Human in the Loop.', body: 'Every AI output is clearly marked and requires human review. Every solicitation is expert-curated. Every submission decision is yours.' },
  { label: 'Structure', title: 'Stage-Gated Quality.', body: 'Proposals progress through defined stages with compliance checks at every gate. No shortcutting the review process. No submitting without verification.' },
];

export default async function EnginePage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const params = await searchParams
  const isPreview = params?._preview === '1'
  const blocks = await getPageBlocks('engine', isPreview);
  const lookup = buildLookup(blocks, 'engine');
  const hero = single(lookup['hero']);
  const stepsHeader = single(lookup['steps_header']);
  const cmsSteps = many(lookup['steps']);
  const diffsHeader = single(lookup['differentiators_header']);
  const cmsDiffs = many(lookup['differentiators']);
  const ctaBlock = single(lookup['cta']);

  const resolvedSteps = cmsSteps.length > 0
    ? cmsSteps.map((s: ContentRow) => ({ number: (s.metadata as { number?: string })?.number ?? '', title: s.title, description: s.body, detail: s.excerpt ?? '' }))
    : DEFAULT_STEPS;

  const resolvedDiffs = cmsDiffs.length > 0
    ? cmsDiffs.map((d: ContentRow) => ({ label: d.excerpt ?? '', title: d.title, body: d.body }))
    : DEFAULT_DIFFERENTIATORS;

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">{hero?.excerpt ?? 'The Engine'}</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            <RichText
              text={hero?.title ?? 'Expert + AI + Process = *Win*.'}
              accent={(hero?.metadata as { accent?: string })?.accent ?? 'award'}
            />
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            {hero?.body ?? 'RFP Pipeline is not just software and not just a consultant. It is a structured system where expert curation, isolated AI, and stage-gated workflows work together at every step of the proposal lifecycle.'}
          </p>
        </div>
      </section>

      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="font-display text-3xl font-bold text-navy-900 text-center mb-16">{stepsHeader?.title ?? 'How It Works'}</h2>
          <div className="space-y-16">
            {resolvedSteps.map((step, i) => (
              <div
                key={step.number}
                className={`flex flex-col md:flex-row gap-8 items-start ${i % 2 === 1 ? 'md:flex-row-reverse' : ''}`}
              >
                <div className="flex-shrink-0 w-16 h-16 rounded-full bg-brand-500 text-white flex items-center justify-center font-display text-xl font-bold">
                  {step.number}
                </div>
                <div className="flex-1">
                  <h3 className="font-display text-2xl font-bold text-navy-900 mb-3">{step.title}</h3>
                  <p className="text-navy-600 text-lg leading-relaxed mb-3">{step.description}</p>
                  <p className="text-navy-400 text-sm leading-relaxed">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="font-display text-3xl font-bold text-navy-900 text-center mb-12">{diffsHeader?.title ?? 'Why This Model Works'}</h2>
          <div className="grid md:grid-cols-3 gap-8">
            {resolvedDiffs.map((diff, i) => (
              <div key={i} className="p-8 bg-white border border-cream-200 rounded-xl">
                <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">{diff.label}</p>
                <h3 className="font-display text-lg font-bold text-navy-900 mb-3">{diff.title}</h3>
                <p className="text-navy-600 leading-relaxed text-sm">{diff.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-navy-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-3xl font-bold mb-6">{ctaBlock?.title ?? 'See the engine in action.'}</h2>
          <p className="text-navy-300 text-lg mb-8">
            {ctaBlock?.body ?? 'Join the founding cohort and experience the full workflow.'}
          </p>
          <Link href={(ctaBlock?.metadata as { ctaHref?: string })?.ctaHref ?? '/apply'} className="inline-block px-8 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-semibold transition-colors">
            {(ctaBlock?.metadata as { ctaLabel?: string })?.ctaLabel ?? 'Apply Now'}
          </Link>
        </div>
      </section>

      <CustomSections pageKey="engine" blocks={blocks} />
    </>
  );
}
