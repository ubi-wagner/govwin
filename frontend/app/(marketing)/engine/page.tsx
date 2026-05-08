import Link from 'next/link';
import { sql } from '@/lib/db';

export const metadata = {
  title: 'The Engine — RFP Pipeline',
  description: 'How RFP Pipeline combines expert curation, AI agents, and structured workflows to win federal R&D contracts.',
};

const STEPS = [
  {
    number: '01',
    title: 'Source Scout Finds',
    description:
      'Automated monitoring scans SAM.gov, SBIR.gov, DSIP, and agency portals daily. New solicitations, amendments, and deadline changes are captured and queued for expert review.',
    detail: 'No opportunity slips through the cracks. Source Scout runs on a schedule, compares page snapshots, and flags meaningful changes using Claude classification.',
  },
  {
    number: '02',
    title: 'Expert Curates',
    description:
      'Every solicitation is reviewed by Eric Wagner — 25 years of federal R&D experience. Topics are scored, compliance requirements are extracted, and volumes are structured before anything reaches your feed.',
    detail: 'This is not a raw data dump. Every opportunity in your pipeline has been human-verified, annotated with expert notes, and structured for proposal development.',
  },
  {
    number: '03',
    title: 'AI Structures',
    description:
      'Once curated, AI agents extract compliance matrices, map required sections, identify page limits and formatting rules, and build proposal outlines automatically.',
    detail: 'Your isolated AI team works only with your data. No cross-contamination between tenants. The compliance engine catches requirements that humans miss.',
  },
  {
    number: '04',
    title: 'Customer Writes',
    description:
      'You and your team fill in the proposal using the structured workspace. The content library suggests proven atoms from your past proposals. Section-level collaboration keeps everyone focused.',
    detail: 'Stage-gated progression ensures quality: draft, review, finalize. Role-based access means your PI sees their sections, your contracts person sees theirs, and external partners see only what you share.',
  },
  {
    number: '05',
    title: 'AI Assists',
    description:
      'AI agents draft sections using your content library, the solicitation requirements, and the compliance matrix. Every draft is clearly marked and requires human review.',
    detail: 'The AI does not submit for you. It drafts. You review, edit, accept, or reject. The compliance engine checks every section against the requirements matrix in real time.',
  },
  {
    number: '06',
    title: 'Expert Reviews',
    description:
      'Before submission, your proposal goes through a structured review process. Compliance checks, page counts, formatting verification, and expert feedback ensure submission readiness.',
    detail: 'The gold team review is where proposals go from good to winning. Our system tracks every requirement, every page limit, and every formatting rule so nothing is missed.',
  },
];

export default async function EnginePage() {
  // ── Pull dynamic blocks if available ──────────────────────────────
  interface CmsBlock {
    slug: string;
    title: string;
    body: string;
  }

  let cmsBlocks: CmsBlock[] = [];
  try {
    cmsBlocks = await sql<CmsBlock[]>`
      SELECT slug, title, body
      FROM cms_content
      WHERE content_type = 'page_block'
        AND tags @> '{engine}'
        AND published = true
      ORDER BY display_order ASC, created_at ASC
    `;
  } catch {
    // CMS content is optional
  }

  return (
    <>
      <section className="bg-cream-50">
        <div className="max-w-5xl mx-auto px-6 py-24 md:py-32">
          <p className="text-xs font-semibold text-brand-600 uppercase tracking-[0.3em] mb-6">The Engine</p>
          <h1 className="font-display text-4xl md:text-6xl font-black text-navy-900 leading-tight">
            Expert + AI + Process = <span className="font-prose italic text-award">Win</span>.
          </h1>
          <p className="mt-8 text-xl text-navy-600 max-w-3xl leading-relaxed">
            RFP Pipeline is not just software and not just a consultant. It is a structured system where
            expert curation, isolated AI, and stage-gated workflows work together at every step of the
            proposal lifecycle.
          </p>
        </div>
      </section>

      {/* CMS blocks override section */}
      {cmsBlocks.length > 0 && (
        <section className="bg-white border-t border-cream-200">
          <div className="max-w-5xl mx-auto px-6 py-16">
            {cmsBlocks.map((block) => (
              <div key={block.slug} className="mb-10 last:mb-0">
                <h3 className="font-display text-2xl font-bold text-navy-900 mb-4">{block.title}</h3>
                <p className="text-navy-600 text-lg leading-relaxed">{block.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Step-by-step process */}
      <section className="bg-white border-t border-cream-200">
        <div className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="font-display text-3xl font-bold text-navy-900 text-center mb-16">How It Works</h2>
          <div className="space-y-16">
            {STEPS.map((step, i) => (
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

      {/* Differentiators */}
      <section className="bg-cream-50 border-t border-cream-200">
        <div className="max-w-6xl mx-auto px-6 py-20">
          <h2 className="font-display text-3xl font-bold text-navy-900 text-center mb-12">
            Why This Model Works
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">Isolation</p>
              <h3 className="font-display text-lg font-bold text-navy-900 mb-3">Your Data. Your AI.</h3>
              <p className="text-navy-600 leading-relaxed text-sm">
                Every tenant gets isolated AI agents that only see their data. No shared context windows,
                no cross-contamination, no data leakage between companies.
              </p>
            </div>
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">Accountability</p>
              <h3 className="font-display text-lg font-bold text-navy-900 mb-3">Human in the Loop.</h3>
              <p className="text-navy-600 leading-relaxed text-sm">
                Every AI output is clearly marked and requires human review. Every solicitation is
                expert-curated. Every submission decision is yours.
              </p>
            </div>
            <div className="p-8 bg-white border border-cream-200 rounded-xl">
              <p className="text-xs text-brand-500 uppercase tracking-widest mb-2 font-semibold">Structure</p>
              <h3 className="font-display text-lg font-bold text-navy-900 mb-3">Stage-Gated Quality.</h3>
              <p className="text-navy-600 leading-relaxed text-sm">
                Proposals progress through defined stages with compliance checks at every gate.
                No shortcutting the review process. No submitting without verification.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-navy-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="font-display text-3xl font-bold mb-6">See the engine in action.</h2>
          <p className="text-navy-300 text-lg mb-8">
            Join the founding cohort and experience the full workflow.
          </p>
          <Link
            href="/apply"
            className="inline-block px-8 py-3 bg-brand-500 hover:bg-brand-600 text-white rounded-lg font-semibold transition-colors"
          >
            Apply Now
          </Link>
        </div>
      </section>
    </>
  );
}
