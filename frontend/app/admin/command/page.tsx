import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { TaskQueue } from '@/components/tasks/task-queue';
import { getReviewQueue, type QueueSection } from '@/lib/admin/review-queue';

// Mobile-first admin Command Center — the ONE "what needs my attention" review queue. It fuses the
// scout candidates, the curation state-machine, and open amendments (getReviewQueue) plus the ToDo
// inbox (TaskQueue) that were previously spread across /admin/scouts + /admin/rfp-curation + the
// dashboard, and deep-links into each detail view. Cross-tenant admin read (owner pool in the lib).
export const dynamic = 'force-dynamic';

// Quick "create" entry points — the top of the funnel, one tap from the queue.
const QUICK_ACTIONS = [
  { label: 'Upload RFP', href: '/admin/rfp-curation/upload', icon: '📤' },
  { label: 'New intake', href: '/admin/intake', icon: '➕' },
  { label: 'Scout sources', href: '/admin/sources', icon: '🔭' },
  { label: 'Triage queue', href: '/admin/rfp-curation', icon: '📋' },
];

const TONE: Record<QueueSection['tone'], { card: string; pill: string; label: string }> = {
  action: { card: 'border-amber-300 bg-amber-50/40', pill: 'bg-amber-500 text-white', label: 'text-amber-900' },
  progress: { card: 'border-blue-200 bg-blue-50/30', pill: 'bg-blue-500 text-white', label: 'text-blue-900' },
  info: { card: 'border-gray-200 bg-white', pill: 'bg-gray-400 text-white', label: 'text-gray-800' },
};

function SectionCard({ s }: { s: QueueSection }) {
  const t = TONE[s.tone];
  return (
    <section className={`rounded-xl border ${t.card} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className={`text-sm font-semibold ${t.label}`}>{s.title}</h2>
        <span className={`inline-flex items-center justify-center min-w-6 h-6 px-2 rounded-full text-xs font-bold ${t.pill}`}>
          {s.count}
        </span>
      </div>
      <ul className="mt-3 divide-y divide-black/5">
        {s.items.map((it) => (
          <li key={it.id}>
            <Link
              href={it.href}
              className="flex items-center justify-between gap-3 min-h-11 py-2 -mx-1 px-1 rounded-lg hover:bg-black/5 active:bg-black/10 transition-colors"
            >
              <span className="min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{it.title}</span>
                {it.subtitle && <span className="block text-xs text-gray-500 truncate">{it.subtitle}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                {it.meta && <span className="text-[11px] text-gray-400 tabular-nums">{it.meta}</span>}
                <span className="text-gray-300" aria-hidden>›</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {s.count > s.items.length && (
        <Link href={s.href} className="mt-2 inline-block text-xs font-medium text-blue-600 hover:text-blue-800">
          See all {s.count} →
        </Link>
      )}
    </section>
  );
}

export default async function CommandCenterPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const firstName = (session.user.name ?? session.user.email ?? 'there').split(/[\s@]/)[0];

  let queue;
  try {
    queue = await getReviewQueue();
  } catch (e) {
    console.error('[admin/command] getReviewQueue failed:', e);
    queue = { sections: [], actionable: 0 };
  }

  const active = queue.sections.filter((s) => s.count > 0);
  const actionCards = active.filter((s) => s.tone === 'action');
  const progressCards = active.filter((s) => s.tone !== 'action');

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <header className="mb-5">
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="text-sm text-gray-500 mt-1">
          {queue.actionable > 0
            ? <>Hi {firstName} — <span className="font-semibold text-amber-700">{queue.actionable}</span> item{queue.actionable === 1 ? '' : 's'} need your decision.</>
            : <>Hi {firstName} — nothing needs a decision right now. 🎉</>}
        </p>
      </header>

      {/* Quick create actions — horizontally scrollable on a phone, never overflows the body */}
      <div className="-mx-1 mb-5 flex gap-2 overflow-x-auto pb-1">
        {QUICK_ACTIONS.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="shrink-0 inline-flex items-center gap-2 min-h-11 px-4 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 active:bg-gray-100 transition-colors"
          >
            <span aria-hidden>{a.icon}</span>{a.label}
          </Link>
        ))}
      </div>

      {/* The prioritized review feed */}
      {active.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <p className="text-sm text-gray-500">Your review queue is clear. New scout finds and RFPs will land here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {actionCards.map((s) => <SectionCard key={s.key} s={s} />)}
          {progressCards.map((s) => <SectionCard key={s.key} s={s} />)}
        </div>
      )}

      {/* The workflow ToDo inbox — the existing shared component (one query, one component) */}
      <div className="mt-6">
        <TaskQueue apiBase="/api/admin/tasks" title="Your To-Dos" />
      </div>
    </div>
  );
}
