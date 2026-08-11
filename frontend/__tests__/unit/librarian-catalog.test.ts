import { describe, it, expect } from 'vitest';
import { parseLibrarianCatalog } from '@/lib/atom-review';

/**
 * The librarian catalog is model-produced and UNVALIDATED (a raw string in
 * agent_task_results.output.result.text). parseLibrarianCatalog must: keep only assessments
 * whose atom_id is a real tenant atom, use the REAL atom title (never the model's echo),
 * validate merge targets + recommended rejects, and never throw on garbage.
 */

const ID1 = 'aaaaaaaa-0000-0000-0000-000000000001';
const ID2 = 'aaaaaaaa-0000-0000-0000-000000000002';
const FAKE = 'ffffffff-9999-9999-9999-999999999999';
const valid = new Map<string, string | null>([[ID1, 'Real Atom One'], [ID2, 'Real Atom Two']]);

const catalog = JSON.stringify({
  assessments: [
    { atom_id: ID1, quality_score: 0.9, relevance_score: 0.8, freshness: 'current', title: 'MODEL ECHO (ignore me)',
      recommendation: { action: 'keep', reason: 'Strong, specific.', merge_into_atom_id: null }, summary: 'Good.' },
    { atom_id: ID2, quality_score: 0.3, relevance_score: 0.2, recommendation: { action: 'reject', reason: 'Boilerplate.' } },
    { atom_id: FAKE, quality_score: 0.5, recommendation: { action: 'reject', reason: 'hallucinated id — must drop' } },
  ],
  package_notes: 'Two solid atoms, one boilerplate.',
  recommended_rejects: [ID2, FAKE],
});

describe('parseLibrarianCatalog', () => {
  it('keeps only real-atom assessments, uses the real title, validates rejects', () => {
    const l = parseLibrarianCatalog(catalog, valid, '2026-08-11T12:00:00Z')!;
    expect(l.assessments.map((a) => a.atomId)).toEqual([ID1, ID2]); // hallucinated FAKE dropped
    expect(l.assessments[0].title).toBe('Real Atom One');           // real title, not the model echo
    expect(l.assessments[0].action).toBe('keep');
    expect(l.assessments[0].qualityScore).toBe(0.9);
    expect(l.assessments[1].action).toBe('reject');
    expect(l.recommendedRejectIds).toEqual([ID2]);                  // FAKE filtered out
    expect(l.packageNotes).toBe('Two solid atoms, one boilerplate.');
    expect(l.generatedAt).toBe('2026-08-11T12:00:00Z');
  });

  it('returns null for malformed JSON (never throws)', () => {
    expect(parseLibrarianCatalog('{not valid json', valid, 'x')).toBeNull();
    expect(parseLibrarianCatalog(null, valid, 'x')).toBeNull();
    expect(parseLibrarianCatalog('"a string"', valid, 'x')).toBeNull();
  });

  it('returns null when nothing survives validation', () => {
    const c = JSON.stringify({ assessments: [{ atom_id: FAKE, recommendation: { action: 'reject' } }], recommended_rejects: [FAKE] });
    expect(parseLibrarianCatalog(c, valid, 'x')).toBeNull();
  });

  it('nulls a merge target that is not a real atom, and rejects an unknown action', () => {
    const c = JSON.stringify({ assessments: [
      { atom_id: ID1, recommendation: { action: 'merge', merge_into_atom_id: FAKE } },
      { atom_id: ID2, recommendation: { action: 'explode', reason: 'bad action' } },
    ] });
    const l = parseLibrarianCatalog(c, valid, 'x')!;
    expect(l.assessments[0].mergeIntoAtomId).toBeNull(); // invalid merge target nulled
    expect(l.assessments[1].action).toBeNull();          // unknown action → null
  });
});
