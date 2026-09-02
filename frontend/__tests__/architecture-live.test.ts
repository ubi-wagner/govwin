/**
 * The live layer classifies tables by what the DATABASE says touched them. These tests exist
 * because the first version of that classification was wrong in a way that looked right.
 *
 * It used `n_live_tup` to decide whether a table held anything. On a restored database that column
 * reads 0 until autovacuum analyses — so `library_atoms`, sitting on 29,426 index scans and four
 * updates, classified as INERT. Had it shipped, the architecture map would have painted a
 * load-bearing table as dead, which is worse than painting nothing at all: a false red trains the
 * reader to ignore a true one.
 *
 * So the rule is asserted against inputs with known answers, and the specific shape that broke it
 * is one of them.
 */
import { describe, it, expect } from 'vitest';
import { classifyActivity } from '@/lib/architecture-live';

const row = (table: string, ins = 0, upd = 0, del = 0, reads = 0) => ({ table, ins, upd, del, reads });

describe('classifyActivity — the four classes', () => {
  it('separates the four cases exactly', () => {
    const { tables, counts } = classifyActivity([
      row('system_events', 316, 0, 9, 11546),   // written and read
      row('reference_codes', 0, 0, 0, 530),     // read, never written this epoch
      row('write_only_ledger', 12, 0, 0, 0),    // rows go in, nothing selects them
      row('deploy_baseline'),                    // nothing on either end
    ]);
    expect(tables.system_events.klass).toBe('live');
    expect(tables.reference_codes.klass).toBe('read_only');
    expect(tables.write_only_ledger.klass).toBe('written_unread');
    expect(tables.deploy_baseline.klass).toBe('untouched');
    expect(counts).toEqual({ live: 1, read_only: 1, written_unread: 1, untouched: 1 });
  });

  it('counts an UPDATE as a write — a table nothing inserts into is not idle', () => {
    // `tenants` in the sandbox: 0 inserts, 6 updates, 9,074 scans. Rows predate the epoch; the
    // table is plainly in use. Keying off inserts alone would call it read-only and hide the writes.
    const { tables } = classifyActivity([row('tenants', 0, 6, 0, 9074)]);
    expect(tables.tenants.klass).toBe('live');
    expect(tables.tenants.writes).toBe(6);
  });

  it('THE REGRESSION: a populated, heavily-read table is never "untouched"', () => {
    // The exact row that broke the first version — n_live_tup would have read 0 here.
    const { tables, untouched } = classifyActivity([row('library_atoms', 0, 4, 0, 29426)]);
    expect(tables.library_atoms.klass).toBe('live');
    expect(untouched).toEqual([]);
  });

  it('a table with reads and no writes is read_only, not untouched', () => {
    const { tables, untouched } = classifyActivity([row('atom_tags', 0, 0, 0, 29994)]);
    expect(tables.atom_tags.klass).toBe('read_only');
    expect(untouched).toEqual([]);
  });
});

describe('classifyActivity — the lists the map paints', () => {
  it('collects written_unread and untouched, sorted, and nothing else', () => {
    const r = classifyActivity([
      row('zeta_queue', 5, 0, 0, 0),
      row('alpha_queue', 3, 0, 0, 0),
      row('busy', 1, 1, 1, 10),
      row('nobody_b'),
      row('nobody_a'),
    ]);
    expect(r.writtenUnread).toEqual(['alpha_queue', 'zeta_queue']);
    expect(r.untouched).toEqual(['nobody_a', 'nobody_b']);
  });

  it('ranks the hottest by total write volume and omits tables with no writes', () => {
    const r = classifyActivity([
      row('a', 10, 0, 0, 1), row('b', 1, 400, 0, 1), row('c', 0, 0, 0, 999),
    ]);
    expect(r.hottest.map((h) => h.table)).toEqual(['b', 'a']);
    expect(r.hottest[0].writes).toBe(401);
  });

  it('is total: an empty database classifies to empty, not to a finding', () => {
    const r = classifyActivity([]);
    expect(r.counts).toEqual({ live: 0, read_only: 0, written_unread: 0, untouched: 0 });
    expect(r.writtenUnread).toEqual([]);
    expect(r.untouched).toEqual([]);
    expect(r.hottest).toEqual([]);
  });
});
