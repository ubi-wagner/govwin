import { describe, expect, it } from 'vitest';
import { urgencyOf, urgencyRank, sortByUrgency } from '@/lib/tasks/urgency';

const NOW = Date.parse('2026-05-31T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ahead = (ms: number) => new Date(NOW + ms).toISOString();

describe('urgencyOf', () => {
  it('past due = overdue', () => {
    expect(urgencyOf(ago(1000), NOW)).toBe('overdue');
  });
  it('within 24h = soon', () => {
    expect(urgencyOf(ahead(3600_000), NOW)).toBe('soon');
    expect(urgencyOf(ahead(23 * 3600_000), NOW)).toBe('soon');
  });
  it('beyond 24h = normal', () => {
    expect(urgencyOf(ahead(48 * 3600_000), NOW)).toBe('normal');
  });
  it('no due date = normal', () => {
    expect(urgencyOf(null, NOW)).toBe('normal');
  });
});

describe('sortByUrgency', () => {
  it('orders overdue, then soon, then normal; soonest-due within a tier', () => {
    const tasks = [
      { id: 'normal', dueAt: ahead(72 * 3600_000) },
      { id: 'overdue-old', dueAt: ago(48 * 3600_000) },
      { id: 'soon', dueAt: ahead(3600_000) },
      { id: 'overdue-recent', dueAt: ago(1000) },
      { id: 'no-date', dueAt: null },
    ];
    const order = sortByUrgency(tasks, NOW).map((t) => t.id);
    // both overdue first (older overdue sorts first by due time), then soon, then normals
    expect(order.slice(0, 2)).toEqual(['overdue-old', 'overdue-recent']);
    expect(order[2]).toBe('soon');
    expect(order.slice(3)).toEqual(['normal', 'no-date']);
  });

  it('does not mutate the input array', () => {
    const tasks = [{ id: 'a', dueAt: ahead(1000) }, { id: 'b', dueAt: ago(1000) }];
    const copy = [...tasks];
    sortByUrgency(tasks, NOW);
    expect(tasks).toEqual(copy);
  });
});

describe('urgencyRank', () => {
  it('overdue < soon < normal', () => {
    expect(urgencyRank('overdue')).toBeLessThan(urgencyRank('soon'));
    expect(urgencyRank('soon')).toBeLessThan(urgencyRank('normal'));
  });
});
