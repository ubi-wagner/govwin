/**
 * Open admin triage ToDos panel (Scouting Spine M2 / C2.b).
 *
 * Read-only server component for the curation dashboard: surfaces open `tasks`
 * targeting the admin role buckets (`rfp_admin` / `master_admin`) so a freshly
 * detected batch of opportunities announces itself as an actionable ToDo instead
 * of silently filling the queue. Completion lives elsewhere (completeTask, via
 * the task detail/queue actions) — this panel only lists.
 */
import Link from 'next/link';
import { listOpenAdminTriageTasks, type TaskRow } from '@/lib/tasks/tasks';

// Where a task points. Triage-detection ToDos carry entity_type='source'
// (params hold the run's counts); solicitation-scoped tasks open the workspace.
// Everything else falls back to the curation queue.
function entityHref(t: TaskRow): string {
  if (t.entityType === 'source' && t.entityId) {
    return `/admin/sources/${t.entityId}`;
  }
  if ((t.entityType === 'solicitation' || t.entityType === 'curated_solicitation') && t.entityId) {
    return `/admin/rfp-curation/${t.entityId}`;
  }
  return '/admin/rfp-curation';
}

// Short, human source/entity label for the row.
function entityLabel(t: TaskRow): string {
  if (t.entityType === 'source') return 'Source';
  if (t.entityType === 'solicitation' || t.entityType === 'curated_solicitation') return 'Solicitation';
  return t.entityType ?? 'Task';
}

// Coarse "how old" — days, else hours, else minutes. Always relative to now.
function ageLabel(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return '';
  const ms = Date.now() - created;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Due date — calendar date plus an at-a-glance overdue/soon hint.
function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;
  const overdue = due.getTime() < Date.now();
  const text = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { text, overdue };
}

export default async function TriageTodos() {
  let tasks: TaskRow[] = [];
  try {
    tasks = await listOpenAdminTriageTasks();
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'digest' in e) throw e; // re-throw NEXT_REDIRECT
    console.error('[admin/rfp-curation/triage-todos] query failed:', e);
  }

  if (tasks.length === 0) {
    return (
      <div className="mb-6 rounded border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">Open triage ToDos</h2>
        <p className="mt-1 text-sm text-gray-500">No open admin triage tasks.</p>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-gray-900">Open triage ToDos</h2>
        <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
          {tasks.length} open
        </span>
      </div>
      <ul className="divide-y divide-gray-100">
        {tasks.map((t) => {
          const due = dueLabel(t.dueAt);
          return (
            <li key={t.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <Link
                    href={entityHref(t)}
                    className="text-sm font-medium text-blue-600 hover:underline"
                  >
                    {t.title}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <span>{entityLabel(t)}</span>
                    <span aria-hidden="true">&middot;</span>
                    <span>{ageLabel(t.createdAt)}</span>
                    {t.status === 'in_progress' && (
                      <>
                        <span aria-hidden="true">&middot;</span>
                        <span className="text-amber-600">in progress</span>
                      </>
                    )}
                  </div>
                </div>
                {due && (
                  <span
                    className={`shrink-0 text-xs ${due.overdue ? 'font-medium text-red-600' : 'text-gray-500'}`}
                  >
                    Due {due.text}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
