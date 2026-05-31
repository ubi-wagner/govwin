/**
 * Task urgency — the in-app nudge logic. A due date in the past is 'overdue';
 * within 24h is 'soon'; otherwise 'normal'. This is what makes a deadline felt
 * on the landing page without an email: overdue/soon tasks sort first and are
 * visually escalated. Pure + deterministic (inject `now` for tests).
 */
export type Urgency = 'overdue' | 'soon' | 'normal';

export const SOON_WINDOW_MS = 24 * 3600 * 1000;

export function urgencyOf(dueAt: string | null, now: number = Date.now()): Urgency {
  if (!dueAt) return 'normal';
  const t = new Date(dueAt).getTime();
  if (!Number.isFinite(t)) return 'normal';
  if (t < now) return 'overdue';
  if (t - now < SOON_WINDOW_MS) return 'soon';
  return 'normal';
}

export function urgencyRank(u: Urgency): number {
  return u === 'overdue' ? 0 : u === 'soon' ? 1 : 2;
}

/** Sort tasks most-urgent first, then soonest due. */
export function sortByUrgency<T extends { dueAt: string | null }>(
  tasks: T[],
  now: number = Date.now(),
): T[] {
  return [...tasks].sort((a, b) => {
    const d = urgencyRank(urgencyOf(a.dueAt, now)) - urgencyRank(urgencyOf(b.dueAt, now));
    if (d !== 0) return d;
    const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
    const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
    return at - bt;
  });
}
