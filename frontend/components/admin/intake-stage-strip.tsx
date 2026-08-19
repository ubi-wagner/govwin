/**
 * The discovery river, drawn as one queue (#176).
 *
 * Four admin surfaces do the work of getting an opportunity from "somewhere on the internet" to
 * "on a customer's card": Sources → Scout Monitor → Intake → RFP Curation → Opportunity Cards.
 * They were built one at a time and they read that way — five sibling entries in a nav list, in
 * no particular order, each ending without saying what comes next. An admin who has not built
 * the thing cannot tell from the screen that a scout finding is *upstream* of curation, or that
 * something waiting in Intake is blocking the cards.
 *
 * This is the strip that says so. It renders on all of them, marks where you are, and carries the
 * live count of what is WAITING at each stage — so the queue's backlog is visible from any point
 * in it, and the next step is one click away.
 *
 * Deliberately not a new mega-page: the four surfaces each do a real job well. What was missing
 * was the sentence connecting them.
 */
import Link from 'next/link';

export type IntakeStageKey = 'sources' | 'scouts' | 'intake' | 'curation' | 'cards';

interface Stage {
  key: IntakeStageKey;
  href: string;
  label: string;
  /** What this stage DOES, in the fewest words that are still true. */
  role: string;
}

const STAGES: Stage[] = [
  { key: 'sources', href: '/admin/sources', label: 'Sources', role: 'where we look' },
  { key: 'scouts', href: '/admin/scouts', label: 'Scout Monitor', role: 'what we found' },
  { key: 'intake', href: '/admin/intake', label: 'Intake', role: 'staged for reading' },
  { key: 'curation', href: '/admin/rfp-curation', label: 'RFP Curation', role: 'read & approved' },
  { key: 'cards', href: '/admin/cards', label: 'Opportunity Cards', role: 'live for tenants' },
];

export interface IntakeStageCounts {
  /** Findings a human has not yet released or dismissed. */
  scouts?: number;
  /** Staged solicitations not yet curated. */
  intake?: number;
  /** Curated solicitations awaiting approval/push. */
  curation?: number;
}

export default function IntakeStageStrip({
  current,
  counts = {},
}: {
  current: IntakeStageKey;
  counts?: IntakeStageCounts;
}) {
  return (
    <nav aria-label="Opportunity intake stages" className="mb-6 overflow-x-auto">
      <ol className="flex items-stretch gap-1 min-w-max">
        {STAGES.map((s, i) => {
          const active = s.key === current;
          const waiting = counts[s.key as keyof IntakeStageCounts];
          return (
            <li key={s.key} className="flex items-stretch">
              <Link
                href={s.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col justify-center rounded-md border px-3 py-2 transition-colors ${
                  active
                    ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200'
                    : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span className={`text-sm font-medium ${active ? 'text-blue-900' : 'text-gray-800'}`}>
                    {s.label}
                  </span>
                  {/* A count only when something is actually waiting — a row of zeroes is noise,
                      and an amber badge that is always there stops meaning "look here". */}
                  {typeof waiting === 'number' && waiting > 0 && (
                    <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 tabular-nums">
                      {waiting}
                    </span>
                  )}
                </span>
                <span className={`text-[11px] ${active ? 'text-blue-700' : 'text-gray-500'}`}>{s.role}</span>
              </Link>
              {i < STAGES.length - 1 && (
                <span aria-hidden="true" className="self-center px-1 text-gray-300">→</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
