/**
 * `withEventBracket` — the bracket that cannot be dropped.
 *
 * Thirty-one handlers left a `start` row unterminated whenever they threw, and every one of them
 * had made the same forced choice: `const startId` declared inside the `try` is not in scope in the
 * `catch`, so closing the bracket there was a syntax error rather than a decision (B139). This
 * helper exists so new code never faces that choice.
 *
 * The three properties below are the whole contract, and the third is what makes it safe to adopt:
 * instrumentation must not change control flow. A helper that closed the bracket and swallowed the
 * error would silently stop every caller's error handling from running, turning a 500 into a 200.
 *
 * The real `withEventBracket` is imported and driven — `sql` is mocked underneath it, so the
 * assertions are about the rows the shipped code writes. An earlier draft of this file
 * re-implemented the helper locally and asserted on the copy, which would have passed against any
 * shipped implementation at all, including a broken one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Every `sql` tagged-template call the module makes, as its interpolated values. */
const calls: unknown[][] = [];
vi.mock('@/lib/db', () => {
  const sql = (strings: TemplateStringsArray, ...vals: unknown[]) => {
    calls.push(vals);
    const text = strings.join('?');
    // emitEventStart: INSERT … RETURNING id
    if (text.includes('INSERT INTO system_events') && text.includes('RETURNING id')) {
      return Promise.resolve([{ id: 'start-id-1' }]);
    }
    // emitEventEnd: re-reads the start row for namespace/type/actor before inserting the end.
    if (text.includes('SELECT namespace')) {
      return Promise.resolve([{
        namespace: 'finder', type: 'thing.done', actorType: 'user',
        actorId: 'u1', actorEmail: null, tenantId: null,
      }]);
    }
    return Promise.resolve([]);
  };
  return { sql: Object.assign(sql, { json: (v: unknown) => v }) };
});
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

const { withEventBracket } = await import('@/lib/events');

const params = {
  namespace: 'finder',
  type: 'thing.done',
  actor: { type: 'user' as const, id: 'u1' },
};

/**
 * The rows written to system_events, in order, as {phase, result, error}.
 *
 * `phase` is a SQL literal in both INSERTs, not an interpolated value, so the two are told apart by
 * how many values they bind: the start binds 8, the end binds 10 (it adds parent_event_id, error
 * and duration_ms, and drops nothing). Indices read off `lib/events.ts` rather than guessed — a
 * first pass assumed 9 and 11 and silently classified every row as neither.
 */
function writtenRows() {
  return calls
    .filter((v) => v.length === 8 || v.length === 10)
    .map((v) => (v.length === 8 ? { phase: 'start' } : { phase: 'end', result: v[7], error: v[8] }));
}

beforeEach(() => { calls.length = 0; });

describe('withEventBracket', () => {
  it('closes the bracket with a result on success', async () => {
    const out = await withEventBracket(params, async () => ({
      result: { sourceId: 's1' },
      value: 'the-response',
    }));
    expect(out).toBe('the-response');
    const rows = writtenRows();
    expect(rows.map((r) => r.phase)).toEqual(['start', 'end']);
    expect(rows[1].error).toBeNull();
    expect(rows[1].result).toEqual({ sourceId: 's1' });
  });

  it('closes the bracket with an error when the body throws', async () => {
    await expect(
      withEventBracket(params, async () => { throw new Error('database connection lost'); }),
    ).rejects.toThrow('database connection lost');

    const rows = writtenRows();
    expect(rows.map((r) => r.phase)).toEqual(['start', 'end']);
    // The `error` COLUMN is populated — the poll loop's failed-op guard reads that, not the payload.
    expect(rows[1].error).toMatchObject({ message: 'database connection lost', code: 'HANDLER_THREW' });
  });

  it('RETHROWS, so the caller still shapes its own response', async () => {
    let callerSawIt = false;
    try {
      await withEventBracket(params, async () => { throw new Error('boom'); });
    } catch {
      callerSawIt = true;
    }
    expect(callerSawIt).toBe(true);
  });

  it('writes exactly one end per start, on either path', async () => {
    await withEventBracket(params, async () => ({ value: 1 }));
    await withEventBracket(params, async () => { throw new Error('x'); }).catch(() => {});
    const rows = writtenRows();
    expect(rows.filter((r) => r.phase === 'start')).toHaveLength(2);
    expect(rows.filter((r) => r.phase === 'end')).toHaveLength(2);
  });
});
