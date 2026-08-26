/**
 * Provenance: the rule that a value the product did not read from the source must never look like
 * one it did.
 *
 * The badge is the whole user-visible consequence, so the badge is what is asserted. Two cases
 * carry almost all of the weight:
 *
 *   · **no provenance row at all reads UNVERIFIED, not neutral.** Silence about where a number came
 *     from is the same claim as "we made it up", and rendering it as ordinary is how a default
 *     becomes indistinguishable from a fact.
 *   · **a citation with no value is a DEFERRAL, not a blank.** "The delivery schedule is set out in
 *     the Task Order" is not a missing date; it is the contract telling you where the answer lives,
 *     and it must say so with the citation attached.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sqlMock } = vi.hoisted(() => {
  const state: { rows: unknown[]; queries: string[] } = { rows: [], queries: [] };
  const sqlMock = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.queries.push(strings.raw.join(' ? ').replace(/\s+/g, ' ').trim());
      void values;
      return Promise.resolve(state.rows);
    },
    { state },
  );
  return { sqlMock };
});
vi.mock('@/lib/db', () => ({ sql: sqlMock, auditLog: vi.fn(async () => {}) }));

import {
  TRUST_ORDER, trustRank, outranks, badgeFor, recordProvenance, type FieldProvenance,
} from '@/lib/delivery/provenance';

beforeEach(() => {
  sqlMock.state.rows = [{ id: 'p1' }];
  sqlMock.state.queries.length = 0;
});

describe('the trust order', () => {
  it('is the same order the proposal spine uses', () => {
    // Same words, same meanings. Someone who has read docs/INGEST_PROVENANCE.md must not have to
    // learn a second vocabulary for the same idea.
    expect([...TRUST_ORDER]).toEqual(['hitl', 'verified', 'override', 'pattern_match', 'ai', 'default']);
  });

  it('ranks a human above a machine, and anything above a default', () => {
    expect(trustRank('hitl')).toBeLessThan(trustRank('ai'));
    expect(trustRank('pattern_match')).toBeLessThan(trustRank('default'));
    expect(trustRank('nonsense')).toBeGreaterThanOrEqual(TRUST_ORDER.length);
  });

  it('a re-assertion of the SAME method is not a promotion', () => {
    // Otherwise a repeated `ai` guess creeps upward simply by being written twice.
    expect(outranks('ai', 'ai')).toBe(false);
    expect(outranks('hitl', 'ai')).toBe(true);
    expect(outranks('default', 'hitl')).toBe(false);
    expect(outranks('default', null)).toBe(true);
  });
});

describe('recordProvenance', () => {
  it('refuses a citing method with nothing to cite', async () => {
    // This is the failure the whole module exists to prevent: a field rendering "Read from source"
    // against a source nobody can open.
    for (const method of ['verified', 'pattern_match'] as const) {
      const wrote = await recordProvenance({
        tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'pop_end',
        method,
      });
      expect(wrote, method).toBe(false);
    }
    expect(sqlMock.state.queries, 'a refusal must not reach the database').toEqual([]);
  });

  it('accepts a citing method WITH a source document', async () => {
    const wrote = await recordProvenance({
      tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'pop_end',
      method: 'verified', sourceDocId: 'doc-1', page: 12, excerpt: 'Period of performance ends…',
    });
    expect(wrote).toBe(true);
  });

  it('accepts a non-citing method without one — a default is honest about being a default', async () => {
    expect(await recordProvenance({
      tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'pop_end',
      method: 'default',
    })).toBe(true);
    expect(await recordProvenance({
      tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'pop_end',
      method: 'hitl',
    })).toBe(true);
  });

  it('refuses an unknown method rather than storing it', async () => {
    const wrote = await recordProvenance({
      tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'x',
      method: 'guessed' as never,
    });
    expect(wrote).toBe(false);
  });

  it('the upsert only wins when the new method OUTRANKS the old one', async () => {
    await recordProvenance({
      tenantId: 't', projectId: 'p', targetTable: 'delivery_clins', targetId: 'c', field: 'pop_end',
      method: 'default',
    });
    const q = sqlMock.state.queries.join(' ');
    // Comparing at the WRITE, not at the read: a read-time comparison leaves two rows to disagree.
    expect(q).toMatch(/ON CONFLICT/i);
    expect(q).toMatch(/array_position/i);
  });
});

describe('badgeFor — what a person actually sees', () => {
  const cite = (over: Partial<FieldProvenance> = {}): FieldProvenance => ({
    field: 'pop_end', method: 'verified', sourceDocId: 'd1', page: 12,
    excerpt: 'set out in the Task Order', charOffset: 800, filename: 'contract.pdf', ...over,
  });

  it('NO provenance row reads unverified, not neutral', () => {
    const b = badgeFor(undefined, true);
    expect(b.tone).toBe('unverified');
    expect(b.label).toBe('Unverified');
  });

  it('a citation WITH a value reads "Read from source", naming the document and page', () => {
    const b = badgeFor(cite(), true);
    expect(b.tone).toBe('sourced');
    expect(b.label).toBe('Read from source');
    expect(b.detail).toBe('contract.pdf, p.12');
  });

  it('a citation with NO value is a deferral — "Set elsewhere", with the excerpt', () => {
    // ABSENCE IS A FINDING. The alternative is a fabricated date, which is the thing the whole
    // ingest-provenance doctrine exists to forbid.
    const b = badgeFor(cite(), false);
    expect(b.tone).toBe('elsewhere');
    expect(b.label).toBe('Set elsewhere');
    expect(b.detail).toBe('set out in the Task Order');
  });

  it('a human entry is distinguishable from a source reading', () => {
    expect(badgeFor(cite({ method: 'hitl' }), true).label).toBe('Entered by a person');
    expect(badgeFor(cite({ method: 'override' }), true).tone).toBe('entered');
  });

  it('an AI suggestion is unverified, and says so', () => {
    const b = badgeFor(cite({ method: 'ai' }), true);
    expect(b.tone).toBe('unverified');
    expect(b.label).toMatch(/AI-suggested/);
  });

  it('a default is unverified with no detail to imply a source', () => {
    const b = badgeFor(cite({ method: 'default' }), true);
    expect(b.tone).toBe('unverified');
    expect(b.label).toBe('Default — unverified');
    expect(b.detail).toBeNull();
  });
});
