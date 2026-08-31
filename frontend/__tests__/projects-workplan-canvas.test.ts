/**
 * The `workplan` canvas: a WBS grid projected from rows, and the one exemption it gets from the
 * compliance floor.
 *
 * ── WHY THE EXEMPTION NEEDS A TEST AND NOT JUST A COMMENT ────────────────────────────────────
 * A check that quietly does nothing is how `/admin/storage` shipped a red error banner past every
 * lens (B131). An exemption is a check that does nothing ON PURPOSE, which is the same shape, so it
 * has to be asserted in both directions:
 *
 *   · a 400-row workplan produces NO page violation — a large project is not a violation
 *   · the exemption does NOT leak: the same oversized content in a `letter` canvas still violates
 *
 * The second assertion is the one that matters. Without it, an exemption that accidentally disabled
 * the page cap for every format would pass the first and look correct.
 */
import { describe, it, expect } from 'vitest';
import {
  CANVAS_PRESETS, validateStandaloneCanvas, validateCanvasAgainstSpec,
  type CanvasDocument, type CanvasNode,
} from '@/lib/types/canvas-document';
import { toWorkplanCanvas, WORKPLAN_COLUMNS, WORKPLAN_READONLY_COLUMNS, type WbsNode } from '@/lib/projects/wbs';

function node(i: number, over: Partial<WbsNode> = {}): WbsNode {
  return {
    id: `1111111${String(i).padStart(4, '0')}-1111-4111-8111-111111111111`,
    projectId: 'p1', clinId: null,
    code: `1.${i}`, title: `Task ${i}`,
    // Frozen and current DELIBERATELY DIFFER. A fixture where they match would pass just as
    // happily against the shape this file used to test — one where the "Baseline" columns were
    // aliases of the current plan — and that is the defect migration 229 went back for.
    baselineDate: '2026-03-31', baselineCost: '1000.00',
    plannedStart: '2026-01-15', plannedEnd: '2026-04-15', plannedCost: '1250.00',
    actualCost: '400.00', sortIndex: i,
    ...over,
  };
}

/**
 * A long letter document, used to show the page cap DOES still fire for other formats.
 *
 * `text_block`, not `paragraph` — the first version of this fixture used a node type that does not
 * exist, so `getNodeText` returned '' for every node, the ruler counted zero pages, and this test
 * reported the exemption as LEAKING against code where it does not. The finding was the fixture.
 * A leak test built on an invalid document proves nothing in either direction.
 */
function longLetter(paragraphs: number): CanvasDocument {
  const nodes: CanvasNode[] = Array.from({ length: paragraphs }, (_, i) => ({
    id: `n${i}`, type: 'text_block',
    content: { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20) },
    style: {}, provenance: { source: 'template' }, history: [], library_eligible: false,
  } as unknown as CanvasNode));
  return {
    version: 1, title: 'Long volume',
    canvas: { ...CANVAS_PRESETS.letter, max_pages: 2 },
    nodes,
  } as unknown as CanvasDocument;
}

describe('toWorkplanCanvas', () => {
  it('renders one row per WBS node, in sort order', () => {
    const doc = toWorkplanCanvas([node(1), node(2), node(3)], [], 'Ohio TVSF');
    const table = doc.nodes?.[0] as unknown as { content: { headers: string[]; rows: string[][] } };
    expect(table.content.headers).toEqual([...WORKPLAN_COLUMNS]);
    expect(table.content.rows).toHaveLength(3);
    expect(table.content.rows[0][0]).toBe('1.1');
    expect(table.content.rows[0][1]).toBe('Task 1');
  });

  it('shows the baseline BESIDE the current plan — variance is the number a PM reads', () => {
    const doc = toWorkplanCanvas([node(1)], [], 'P');
    const row = (doc.nodes?.[0] as unknown as { content: { rows: string[][] } }).content.rows[0];
    expect(row[3]).toBe('2026-03-31');   // baseline date — what was promised
    expect(row[6]).toBe('2026-04-15');   // planned end — fifteen days later, and visible
  });

  it('the baseline columns render the FROZEN values, never the current plan', () => {
    // The regression this file exists to catch. When `project_milestones` had no `baseline_cost`,
    // `listWbs` aliased `planned_cost` into the baseline column — so a greyed-out cell labelled
    // "Baseline cost" showed the current plan, and cost variance was a column subtracted from
    // itself: structurally zero, forever, and reading as a project perfectly on budget.
    const doc = toWorkplanCanvas([node(1)], [], 'P');
    const row = (doc.nodes?.[0] as unknown as { content: { rows: string[][] } }).content.rows[0];
    expect(row[4], 'baseline cost').toBe('1000.00');
    expect(row[7], 'planned cost').toBe('1250.00');
    expect(row[4]).not.toBe(row[7]);
  });

  it('a milestone with no baseline renders EMPTY, not a stand-in', () => {
    // Before baselining there is no promise. An empty cell says so; anything else invents one.
    const doc = toWorkplanCanvas([node(1, { baselineDate: null, baselineCost: null })], [], 'P');
    const row = (doc.nodes?.[0] as unknown as { content: { rows: string[][] } }).content.rows[0];
    expect(row[3]).toBe('');
    expect(row[4]).toBe('');
    expect(row[7], 'and the current plan is still shown').toBe('1250.00');
  });

  it('marks the baseline columns read-only', () => {
    // The database refuses to move them (migration 216's trigger), so an editable-looking cell
    // would be a lie the UI tells until the save fails.
    const doc = toWorkplanCanvas([node(1)], [], 'P');
    const meta = (doc as unknown as { metadata: { workplan: { readonlyColumns: number[] } } }).metadata;
    expect(meta.workplan.readonlyColumns).toEqual(WORKPLAN_READONLY_COLUMNS);
    for (const i of meta.workplan.readonlyColumns) {
      expect(WORKPLAN_COLUMNS[i]).toMatch(/^Baseline/);
    }
  });

  it('binds each rendered row to its database row id', () => {
    // "Cells bound to rows rather than to a blob" is this, concretely. The ids live in metadata
    // rather than in cell text, where a person could see and edit them.
    const nodes = [node(1), node(2)];
    const doc = toWorkplanCanvas(nodes, [], 'P');
    const meta = (doc as unknown as { metadata: { workplan: { rowIds: string[] } } }).metadata;
    expect(meta.workplan.rowIds).toEqual(nodes.map((n) => n.id));
  });

  it('renders the CLIN number, not the CLIN uuid', () => {
    const doc = toWorkplanCanvas(
      [node(1, { clinId: 'c1' })],
      [{ id: 'c1', clinNumber: '0002AA' }],
      'P',
    );
    const row = (doc.nodes?.[0] as unknown as { content: { rows: string[][] } }).content.rows[0];
    expect(row[2]).toBe('0002AA');
  });
});

describe('the compliance-floor exemption', () => {
  it('a 400-row workplan produces no page violation', () => {
    const doc = toWorkplanCanvas(Array.from({ length: 400 }, (_, i) => node(i)), [], 'Big');
    const violations = validateStandaloneCanvas(doc);
    expect(violations.map((v) => v.code)).not.toContain('over_page_limit');
    expect(violations, 'a large project is not a violation').toEqual([]);
  });

  it('a workplan is exempt EVEN IF a page cap is supplied from elsewhere', () => {
    // The realistic way a cap reaches one: a caller passes a proposal's spec without looking at the
    // format. Its own rules declare null caps, so this guard is the belt.
    const doc = toWorkplanCanvas(Array.from({ length: 400 }, (_, i) => node(i)), [], 'Big');
    const violations = validateCanvasAgainstSpec(doc, {
      max_pages: 2, max_slides: 1, min_font_size: null, images_allowed: true, required_sections: [],
    } as never);
    expect(violations.map((v) => v.code)).not.toContain('over_page_limit');
    expect(violations.map((v) => v.code)).not.toContain('over_slide_limit');
  });

  it('THE EXEMPTION DOES NOT LEAK — a letter document over its cap still violates', () => {
    // The assertion that makes the two above mean something. An exemption that accidentally
    // disabled the page cap everywhere would satisfy them both and look correct.
    const violations = validateStandaloneCanvas(longLetter(60));
    expect(violations.map((v) => v.code)).toContain('over_page_limit');
  });

  it('a workplan still honours a font floor — it is not a blanket skip', () => {
    // Only the SIZE caps are exempt. A workplan can honour a font minimum, and a blanket early
    // return would have silently dropped that too.
    const doc = toWorkplanCanvas([node(1)], [], 'P');
    (doc as unknown as { canvas: { font_default: { size: number } } }).canvas.font_default.size = 6;
    const violations = validateCanvasAgainstSpec(doc, {
      max_pages: null, max_slides: null, min_font_size: 10, images_allowed: true, required_sections: [],
    } as never);
    expect(violations.map((v) => v.code)).toContain('font_too_small');
  });
});
