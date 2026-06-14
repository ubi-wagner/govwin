import Link from 'next/link';
import type { ContentRow } from '@/lib/cms';

/**
 * ValueComparison — the "cost of doing it the old way" money moment.
 *
 * A high-contrast Today-vs-RFP-Pipeline section: what each piece of the status
 * quo costs, struck through, against our price, with a one-line payoff. Figures
 * are the approved published numbers. Heading is overridable (block-editable);
 * rows can be overridden via props but default to the approved set.
 */
export interface ComparisonRow {
  replaces: string;
  statusQuo: string;
  statusQuoNote?: string;
  ours: string;
  payoff: string;
}

export const DEFAULT_COMPARISON_ROWS: ComparisonRow[] = [
  {
    replaces: 'Active opportunity monitoring',
    statusQuo: '$5,000 / mo',
    statusQuoNote: 'what our founder paid for a monitoring service',
    ours: '$299 / mo',
    payoff: 'Expert-curated monitoring for ~6% of the price — a human reads every solicitation, not just a keyword feed.',
  },
  {
    replaces: 'A proposal consultant',
    statusQuo: '10% of award',
    statusQuoNote: 'a $1M Phase II ⇒ $100,000 — or a heavy monthly retainer',
    ours: '$999 / $1,999 flat',
    payoff: 'Keep the $100K. Pay for the build, never a cut of your win.',
  },
  {
    replaces: 'An in-house BD hire',
    statusQuo: '$90–150K / yr',
    statusQuoNote: 'loaded salary — plus the months to find and ramp them',
    ours: '$299/mo + per-proposal',
    payoff: 'Your business-development department, without the headcount.',
  },
  {
    replaces: "Your founder's nights & weekends",
    statusQuo: 'Your scarcest hours',
    statusQuoNote: 'your best engineer pulled off the product to chase RFPs',
    ours: 'Hours back',
    payoff: 'Stop trading product velocity for proposal paperwork.',
  },
];

/**
 * Map a page's `comparison-row` blocks to ComparisonRow[] (single editable source
 * of the cost comparison — lives on /value, reused by /pricing). Falls back to the
 * approved defaults when none are seeded. Block fields: title = what it replaces,
 * excerpt = status-quo cost, body = payoff; metadata = { statusQuoNote, ours }.
 */
export function rowsFromBlocks(blocks: ContentRow[]): ComparisonRow[] {
  const rows = blocks.filter((b) => b.section === 'comparison-row');
  if (rows.length === 0) return DEFAULT_COMPARISON_ROWS;
  return rows.map((b) => {
    const m = (b.metadata ?? {}) as { statusQuoNote?: string; ours?: string };
    return {
      replaces: b.title ?? '',
      statusQuo: b.excerpt ?? '',
      statusQuoNote: m.statusQuoNote,
      ours: m.ours ?? '',
      payoff: b.body ?? '',
    };
  });
}

export function ValueComparison({
  eyebrow = 'The cost of the old way',
  title = 'What you pay today vs. what you pay us.',
  subtitle = 'Small businesses chase federal R&D the expensive way: a monitoring service, a consultant who takes a cut, a BD hire, or the founder’s own nights. Here’s the same job, re-priced.',
  rows = DEFAULT_COMPARISON_ROWS,
  cta = { label: 'See pricing', href: '/pricing' },
}: {
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  rows?: ComparisonRow[];
  cta?: { label: string; href: string } | null;
}) {
  return (
    <section className="bg-navy-900 border-t border-navy-800">
      <div className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <p className="text-xs font-semibold text-citrus uppercase tracking-[0.3em] mb-4">{eyebrow}</p>
        <h2 className="font-display text-3xl md:text-4xl font-black text-white leading-tight max-w-3xl">{title}</h2>
        {subtitle && <p className="mt-4 text-lg text-navy-300 max-w-2xl leading-relaxed">{subtitle}</p>}

        <div className="mt-12 space-y-4">
          {rows.map((r) => (
            <div key={r.replaces} className="bg-navy-800 border border-navy-700 rounded-xl p-6 md:p-7">
              <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 md:gap-6 items-center">
                {/* Today */}
                <div>
                  <p className="text-xs uppercase tracking-widest text-navy-400 mb-1">{r.replaces}</p>
                  <p className="font-display text-2xl md:text-3xl font-black text-navy-400 line-through decoration-2 decoration-navy-600">
                    {r.statusQuo}
                  </p>
                  {r.statusQuoNote && <p className="mt-1 text-xs text-navy-500">{r.statusQuoNote}</p>}
                </div>
                {/* Arrow (drawn) */}
                <div className="hidden md:flex items-center justify-center text-citrus" aria-hidden="true">
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h15M13 6l6 6-6 6" />
                  </svg>
                </div>
                {/* With RFP Pipeline */}
                <div>
                  <p className="text-xs uppercase tracking-widest text-citrus mb-1">With RFP Pipeline</p>
                  <p className="font-display text-2xl md:text-3xl font-black text-white">{r.ours}</p>
                </div>
              </div>
              <p className="mt-4 pt-4 border-t border-navy-700 text-sm text-navy-200 leading-relaxed">{r.payoff}</p>
            </div>
          ))}
        </div>

        {cta && (
          <div className="mt-10">
            <Link
              href={cta.href}
              className="inline-flex items-center justify-center px-8 py-4 bg-brand-500 hover:bg-brand-600 text-white text-lg font-bold rounded-lg shadow-lg transition-all hover:shadow-xl"
            >
              {cta.label}
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
