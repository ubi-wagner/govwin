/**
 * The colour-team rollup, once a review can be narrower than a section.
 *
 * The file this tests exists because 36 of 68 queued reviews failed silently and the customer was
 * told "N reviews queued" and nothing else. Scoping reopens exactly that wound in a new place: the
 * rollup grouped by `section_id`, and several node-scoped reviews now share one. Grouped that way,
 * the newest attempt is shown and the rest vanish — a customer told a section was reviewed while
 * three of its four scoped reviews sit invisible.
 *
 * So the properties under test are the ones that decide whether the loop still tells the truth:
 *
 *   · every distinct scope gets its own row
 *   · retries within a scope still collapse to the latest attempt
 *   · NULL keeps meaning "whole section" — pre-scope rows land where they always did
 *   · the headline stops saying "section" when the reviews were not sections
 *
 * `summarize` is pure, so this runs against constructed rows rather than the database. The SQL that
 * produces them is proven separately, live, by verify-db-crud.
 */
import { describe, it, expect } from 'vitest';
import { summarize, scopeLabelOf } from '@/lib/proposal-color-team';

type Row = Parameters<typeof summarize>[0][number];

const row = (over: Partial<Row> = {}): Row => ({
  sectionId: 'sec-a',
  sectionTitle: 'Technical Approach',
  status: 'completed',
  error: null,
  comments: 1,
  createdAt: '2026-08-20T10:00:00Z',
  completedAt: '2026-08-20T10:01:00Z',
  scopeLevel: null,
  scopeRef: null,
  ...over,
});

describe('scoped reviews do not hide each other', () => {
  it('three reviews in one section are three rows, not one', () => {
    // The exact regression: all three share sectionId, and DISTINCT ON (section_id) shows one.
    const s = summarize([
      row({ scopeLevel: 'node', scopeRef: { nodeId: 'n-1' } }),
      row({ scopeLevel: 'node', scopeRef: { nodeId: 'n-2' } }),
      row({ scopeLevel: 'group', scopeRef: { groupId: 'g-1' } }),
    ]);
    expect(s.total).toBe(3);
    expect(s.sections.map((x) => x.scopeLabel)).toEqual([
      'Element in Technical Approach', 'Element in Technical Approach', 'Group in Technical Approach',
    ]);
  });

  it('a failed figure review is still visible beside a completed section review', () => {
    const s = summarize([
      row({ scopeLevel: null }),
      row({ scopeLevel: 'node', scopeRef: { nodeId: 'n-9' }, status: 'failed',
            error: 'Tenant exceeded the hourly call limit' }),
    ]);
    expect(s.completed).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.headline).toContain('Tenant exceeded the hourly call limit');
  });
});

describe('NULL still means whole section', () => {
  it('a pre-scope row reports as a section review named by its section', () => {
    const [x] = summarize([row()]).sections;
    expect(x.scopeLevel).toBe('section');
    expect(x.scopeRef).toBeNull();
    expect(x.scopeLabel).toBe('Technical Approach');
  });

  it('an unrecognised level degrades to section rather than reaching the customer raw', () => {
    const [x] = summarize([row({ scopeLevel: 'paragraph' })]).sections;
    expect(x.scopeLevel).toBe('section');
    expect(x.scopeLabel).toBe('Technical Approach');
  });
});

describe('the headline follows the data', () => {
  it('says "sections" when every review was one', () => {
    expect(summarize([row(), row({ sectionId: 'sec-b' })]).headline).toBe('All 2 sections reviewed.');
  });

  it('says "reviews" once any of them was not', () => {
    // SENSITIVITY: without this the wording could hardcode "section" and the test above still passes.
    const s = summarize([row(), row({ scopeLevel: 'pages', scopeRef: { pages: { start: 2, end: 4 } } })]);
    expect(s.headline).toBe('All 2 reviews reviewed.');
    expect(s.headline).not.toContain('section');
  });

  it('leads with the failure, as it always did', () => {
    const s = summarize([
      row({ status: 'failed', error: 'rate limited' }),
      row({ sectionId: 'sec-b', status: 'completed' }),
    ]);
    expect(s.headline.startsWith('1 of 2')).toBe(true);
    expect(s.headline).toContain('Retry the failed ones');
  });

  it('still reports nothing requested as nothing requested', () => {
    expect(summarize([]).headline).toBe('No color-team review has been requested for this proposal yet.');
  });
});

describe('what a scope is called', () => {
  it('names a section by its own title', () => {
    expect(scopeLabelOf('section', null, 'Work Plan')).toBe('Work Plan');
  });

  it('names a single page and a range differently', () => {
    expect(scopeLabelOf('pages', { pages: { start: 3, end: 3 } }, 'X')).toBe('Page 3');
    expect(scopeLabelOf('pages', { pages: { start: 3, end: 5 } }, 'X')).toBe('Pages 3–5');
  });

  it('degrades a malformed page ref to a name rather than to "Pages undefined–undefined"', () => {
    expect(scopeLabelOf('pages', {}, 'X')).toBe('Page range');
    expect(scopeLabelOf('pages', null, 'X')).toBe('Page range');
  });

  it('says where a node or group lives, so a list of them is distinguishable', () => {
    expect(scopeLabelOf('node', { nodeId: 'n-1' }, 'Key Personnel')).toBe('Element in Key Personnel');
    expect(scopeLabelOf('group', { groupId: 'g-1' }, 'Key Personnel')).toBe('Group in Key Personnel');
  });

  it('names the document without borrowing a section title', () => {
    expect(scopeLabelOf('document', null, 'Technical Approach')).toBe('Whole document');
  });
});
