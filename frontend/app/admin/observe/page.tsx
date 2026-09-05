import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { observe, clampWindow, type Observation } from '@/lib/observe';
import CompanionButton from '@/components/admin/companion-button';
import CompanionGuide from './companion-guide';

export const dynamic = 'force-dynamic';

/**
 * /admin/observe — what the system actually did, while you were driving it.
 *
 * ── WHAT THIS IS FOR ─────────────────────────────────────────────────────────────────────────
 * Take an action anywhere in the product, then open this. It shows the consequences: the events
 * that fired, the work items raised, the mail reserved, the agents that ran, the workflows that
 * started — and the discrepancies between them.
 *
 * It exists because every defect found this week was invisible from the surface that caused it. A
 * form posted 201 while sending no session. An accept route provisioned six things and not the
 * seventh. A column recorded v1 for a v4 signature. In each case the page said "done" and was
 * telling the truth about the only thing it knew.
 *
 * ── THE FINDINGS ARE ARITHMETIC; THE COMPANION IS JUDGEMENT ──────────────────────────────────
 * Every finding computed HERE is countable — a start with no end, a reserve with no confirm, a
 * task assigned to a role no queue reads. That makes it free to run, correct when the model is
 * down, and testable, which is why it stays deterministic and why the companion does not repeat it.
 *
 * The companion button reads the same window and says what counting cannot catch: a sequence that
 * completed but skipped the step the next screen needs, a thing that is right today only because a
 * value happened to be null. It is advisory, it runs under the platform spend caps as an
 * archetype, and it is instructed never to reassure — an empty window means nothing happened, not
 * that nothing is wrong. docs/ADMIN_COMPANION_DESIGN.md §4.
 */

const WINDOWS = [5, 15, 60, 240];

function Card({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-baseline justify-between border-b border-gray-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-xs tabular-nums text-gray-400">{count}</span>
      </header>
      <div className="max-h-72 overflow-y-auto">{children}</div>
    </section>
  );
}

const Empty = ({ what }: { what: string }) => (
  <p className="px-4 py-6 text-center text-xs text-gray-400">no {what} in this window</p>
);

/** A server component: a UTC stamp is deterministic on both sides, so no clock is read in render. */
const clock = (d: Date) => new Date(d).toISOString().slice(11, 19);

export default async function ObservePage({
  searchParams,
}: { searchParams: Promise<{ w?: string }> }) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role as Role | undefined;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) redirect('/login');

  const sp = await searchParams;
  const mins = clampWindow(sp.w);

  let o: Observation | null = null;
  let loadError: string | null = null;
  try { o = await observe(mins); } catch (e) {
    // Said out loud. A window that renders empty when its query failed reports "nothing happened",
    // which during a live drive is the most misleading thing it could say (B131).
    console.error('[admin/observe] failed:', e);
    loadError = 'The observation window could not be loaded.';
  }

  const findings = o?.discrepancies.filter((d) => d.severity === 'finding') ?? [];
  const notes = o?.discrepancies.filter((d) => d.severity === 'note') ?? [];

  return (
    <div className="p-6 max-w-[1500px]">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Observe</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500">
            What the system actually did, for the last {mins} minutes. Take an action anywhere in
            the product, then look here — the page that caused it can only tell you what it knew.
          </p>
        </div>
        <div className="flex items-center gap-1 text-sm">
          {WINDOWS.map((w) => (
            <Link key={w} href={`/admin/observe?w=${w}`}
              className={`rounded border px-2 py-1 ${w === mins
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
              {w < 60 ? `${w}m` : `${w / 60}h`}
            </Link>
          ))}
        </div>
      </div>

      {loadError && (
        <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{loadError}</div>
      )}

      {o && (
        <>
          {/* The companion sits ABOVE the arithmetic, because it reads what counting cannot
              catch — and below the window's own findings, because those are free and always right. */}
          {/* The guide sits ABOVE the ask, because everything in it is something you want to
              know BEFORE you spend a call — how to phrase the "doing" line, and what the answer
              will and will not cover. Collapsed by default; it is a reference, not a banner. */}
          <CompanionGuide />
          <div className="mb-5"><CompanionButton minutes={mins} /></div>

          {/* ── the discrepancies, first, because they are the point ─────────────────────── */}
          <section className="mb-6" data-testid="observe-discrepancies">
            {findings.length === 0 && notes.length === 0 ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <span className="font-medium">Nothing inconsistent in this window.</span>{' '}
                {o.eventCount === 0
                  ? 'Also nothing happened — an empty window is not a clean bill of health.'
                  : `${o.eventCount} event(s) observed, each with a recorded outcome.`}
              </div>
            ) : (
              <div className="space-y-2">
                {[...findings, ...notes].map((d, i) => (
                  <div key={i} className={`rounded-lg border px-4 py-3 ${d.severity === 'finding'
                    ? 'border-rose-200 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className={`text-sm font-medium ${d.severity === 'finding' ? 'text-rose-900' : 'text-amber-900'}`}>
                      {d.severity === 'finding' ? '✗ ' : '⚠ '}{d.what}
                    </div>
                    {d.detail && <div className="mt-0.5 text-xs text-gray-600">{d.detail}</div>}
                    <div className="mt-1 text-xs italic text-gray-500">{d.meaning}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Events" count={o.events.length}>
              {o.events.length === 0 ? <Empty what="events" /> : (
                <ul className="divide-y divide-gray-50 text-sm">
                  {o.events.slice(0, 60).map((e) => (
                    <li key={e.id} className="px-4 py-2">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className={e.error ? 'text-rose-700' : 'text-gray-800'}>{e.sentence}</span>
                        <span className="shrink-0 text-xs tabular-nums text-gray-400">{clock(e.createdAt)}</span>
                      </div>
                      <div className="text-xs text-gray-400">
                        {e.namespace}:{e.type}
                        {e.phase !== 'single' && ` · ${e.phase}`}
                        {e.actorEmail && ` · ${e.actorEmail}`}
                        {e.durationMs != null && ` · ${e.durationMs}ms`}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Work items raised" count={o.tasks.length}>
              {o.tasks.length === 0 ? <Empty what="ToDos" /> : (
                <ul className="divide-y divide-gray-50 text-sm">
                  {o.tasks.map((t) => (
                    <li key={t.id} className="px-4 py-2">
                      <div className="text-gray-800">{t.title}</div>
                      <div className="text-xs text-gray-400">
                        {t.taskType} · {t.assigneeRole ?? 'broadcast'} · {t.tenantId ? 'tenant' : 'platform'} · {clock(t.createdAt)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Mail" count={o.mail.length}>
              {o.mail.length === 0 ? <Empty what="sends" /> : (
                <ul className="divide-y divide-gray-50 text-sm">
                  {o.mail.map((m, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-gray-800">{m.template ?? '—'} <span className="text-gray-400">→ {m.toEmail}</span></span>
                      <span className={`shrink-0 text-xs ${m.status === 'sent' ? 'text-emerald-700'
                        : m.status === 'failed' ? 'text-rose-700' : 'text-amber-700'}`}>{m.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Agents + workflows" count={o.agents.length + o.workflows.length}>
              {o.agents.length + o.workflows.length === 0 ? <Empty what="agent or workflow activity" /> : (
                <ul className="divide-y divide-gray-50 text-sm">
                  {o.agents.map((a, i) => (
                    <li key={`a${i}`} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-gray-800">{a.toolName}</span>
                      <span className={`shrink-0 text-xs ${a.success ? 'text-emerald-700' : 'text-rose-700'}`}>
                        {a.success ? 'ok' : a.errorCode ?? 'failed'}{a.durationMs != null && ` · ${a.durationMs}ms`}
                      </span>
                    </li>
                  ))}
                  {o.workflows.map((w) => (
                    <li key={w.id} className="flex items-baseline justify-between gap-3 px-4 py-2">
                      <span className="text-gray-800">{w.workflowName}</span>
                      <span className="shrink-0 text-xs text-gray-500">{w.status} · step {w.currentStep ?? '?'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}

      <p className="mt-4 text-xs text-gray-500">
        Read-only, and no AI — every finding above is a countable mismatch, so it is free to run and
        correct when the model is down. The full stream is in{' '}
        <Link href="/admin/events" className="text-blue-600 hover:underline">Event Stream</Link>;
        live workflow graphs are in{' '}
        <Link href="/admin/workflows" className="text-blue-600 hover:underline">Workflows</Link>.
      </p>
    </div>
  );
}
