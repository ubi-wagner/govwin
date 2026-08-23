/**
 * WHAT IS STILL OUTSTANDING, AND WHERE — the gate as a live checklist.
 *
 * The gates exist (`proposal-advance`, the Studio's three loops, the full-draft review gate) and
 * every one of them is a single boolean: passed or not. None can say "these four findings are
 * resolved and those two are not", because nothing grouped findings by the thing they are about.
 *
 * Now they can be grouped. A colour-team finding IS a `proposal_comments` row with
 * `recommendation_type='ai_review'`, carrying `resolved` (since the beginning) and `anchor` (since
 * mig 183, and since mig 207 the scope the reviewer was actually pointed at). So the checklist is a
 * read, not a new storage model.
 *
 * The rule under test is CONTAINMENT, and it is decided WITHOUT the document. A gate runs
 * server-side against a proposal, not against a rendered canvas, so `findingsInScope` is handed the
 * node/section ids the query scope covers (from `resolveScope`, at the call site that has the doc)
 * and decides from those. That keeps the pure function honest — it cannot quietly disagree with the
 * ladder, because it is fed by the ladder.
 *
 * ADVISORY, ALWAYS. An unresolved AI finding is a recommendation, not a compliance failure, so it
 * surfaces as a WARNING and never hard-blocks a submission. The agent invariants are explicit that
 * agent output never advances or blocks a gate; a checklist that could refuse a submission on an
 * AI's opinion would break that in the other direction.
 */
import { describe, it, expect } from 'vitest';
import { findingsInScope, checklistFor, type Finding } from '@/lib/proposal/scoped-findings';

const f = (over: Partial<Finding> = {}): Finding => ({
  id: 'c1', sectionId: 'sec-a', sectionTitle: 'Technical Approach',
  resolved: false, createdAt: '2026-08-20T10:00:00Z',
  scopeLevel: 'section', scopeRef: null, scopeLabel: 'Technical Approach',
  excerpt: 'The work plan does not name a principal investigator.',
  ...over,
});

describe('containment — which findings a scope covers', () => {
  const findings = [
    f({ id: 'sec-a-whole', scopeLevel: 'section' }),
    f({ id: 'node-1', scopeLevel: 'node', scopeRef: { nodeId: 'sec-a__n1' } }),
    f({ id: 'node-2', scopeLevel: 'node', scopeRef: { nodeId: 'sec-a__n2' } }),
    f({ id: 'group-1', scopeLevel: 'group', scopeRef: { groupId: 'sec-a__g1' } }),
    f({ id: 'sec-b-whole', sectionId: 'sec-b', sectionTitle: 'Work Plan', scopeLevel: 'section' }),
    f({ id: 'pages-2-4', scopeLevel: 'pages', scopeRef: { pages: { start: 2, end: 4 } } }),
    f({ id: 'doc', sectionId: 'sec-a', scopeLevel: 'document' }),
  ];
  const ids = (r: Finding[]) => r.map((x) => x.id).sort();

  it('the document scope covers everything', () => {
    expect(ids(findingsInScope(findings, { level: 'document' }))).toEqual(ids(findings));
  });

  it('a section covers its own findings and not another section’s', () => {
    const got = ids(findingsInScope(findings, { level: 'section', sectionIds: ['sec-a'] }));
    expect(got).toContain('sec-a-whole');
    expect(got).toContain('node-1');
    expect(got).not.toContain('sec-b-whole');
  });

  it('a node covers only the finding anchored at it', () => {
    expect(ids(findingsInScope(findings, { level: 'node', nodeIds: ['sec-a__n1'] }))).toEqual(['node-1']);
  });

  it('a group covers its own anchor AND the nodes inside it', () => {
    const got = ids(findingsInScope(findings, {
      level: 'group', groupIds: ['sec-a__g1'], nodeIds: ['sec-a__n2'],
    }));
    expect(got).toEqual(['group-1', 'node-2']);
  });

  it('a page range covers overlapping page findings and the nodes on those pages', () => {
    const got = ids(findingsInScope(findings, {
      level: 'pages', pages: { start: 3, end: 5 }, nodeIds: ['sec-a__n1'],
    }));
    expect(got).toContain('pages-2-4');   // 2–4 overlaps 3–5
    expect(got).toContain('node-1');
    expect(got).not.toContain('sec-b-whole');
  });

  it('a page range that overlaps nothing covers nothing', () => {
    // SENSITIVITY: without this, "pages covers page findings" would pass even if the overlap test
    // were `true`.
    expect(findingsInScope(findings, { level: 'pages', pages: { start: 40, end: 50 } })).toEqual([]);
  });

  it('a document-scoped FINDING is covered by a section query, because it is about that section too', () => {
    // A whole-document review still files against a section (the write-back needs one). Excluding it
    // from that section's checklist would hide a finding a person is looking straight at.
    const got = ids(findingsInScope(findings, { level: 'section', sectionIds: ['sec-a'] }));
    expect(got).toContain('doc');
  });
});

describe('the checklist a gate can state', () => {
  it('counts resolved and open, and leads with what is outstanding', () => {
    const c = checklistFor([
      f({ id: '1', resolved: true }),
      f({ id: '2', resolved: true }),
      f({ id: '3', resolved: false }),
    ], { level: 'document' });
    expect(c.total).toBe(3);
    expect(c.resolved).toBe(2);
    expect(c.open).toBe(1);
    expect(c.headline).toBe('1 of 3 findings still open.');
  });

  it('says so plainly when everything is resolved', () => {
    const c = checklistFor([f({ id: '1', resolved: true })], { level: 'document' });
    expect(c.open).toBe(0);
    expect(c.headline).toBe('All 1 finding resolved.');
  });

  it('says nothing has been reviewed rather than implying success', () => {
    // "0 open" on an unreviewed proposal reads as a clean bill of health. It is not one.
    const c = checklistFor([], { level: 'document' });
    expect(c.headline).toBe('No review findings on this scope yet.');
    expect(c.open).toBe(0);
  });

  it('groups the open ones by the scope they are about', () => {
    const c = checklistFor([
      f({ id: '1', scopeLevel: 'node', scopeRef: { nodeId: 'n1' }, scopeLabel: 'Figure 2' }),
      f({ id: '2', scopeLevel: 'node', scopeRef: { nodeId: 'n1' }, scopeLabel: 'Figure 2' }),
      f({ id: '3', scopeLevel: 'section', scopeLabel: 'Technical Approach' }),
      f({ id: '4', scopeLevel: 'section', scopeLabel: 'Technical Approach', resolved: true }),
    ], { level: 'document' });
    expect(c.byScope).toEqual([
      { level: 'node', label: 'Figure 2', open: 2, total: 2 },
      { level: 'section', label: 'Technical Approach', open: 1, total: 2 },
    ]);
  });

  it('orders the groups by how much is outstanding — the gate leads with the worst', () => {
    const c = checklistFor([
      f({ id: '1', scopeLevel: 'section', scopeLabel: 'Quiet' }),
      f({ id: '2', scopeLevel: 'node', scopeRef: { nodeId: 'n' }, scopeLabel: 'Loud' }),
      f({ id: '3', scopeLevel: 'node', scopeRef: { nodeId: 'n' }, scopeLabel: 'Loud' }),
      f({ id: '4', scopeLevel: 'node', scopeRef: { nodeId: 'n' }, scopeLabel: 'Loud' }),
    ], { level: 'document' });
    expect(c.byScope[0].label).toBe('Loud');
  });

  it('is ADVISORY — it never reports itself as a hard blocker', () => {
    const c = checklistFor([f({ id: '1' })], { level: 'document' });
    expect(c.severity).toBe('warning');
  });
});
