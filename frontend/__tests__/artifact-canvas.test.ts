import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_FORMAT, sectionsToCanvasDoc, tableToCanvasSheet, flattenNodes,
} from '@/lib/library/artifact-canvas';

// Pure builders behind the native-format house artifacts (Terms→doc, Calendar→sheet).
// The full canvas→.docx/.xlsx export + atom ingest is proven against the DB.
describe('artifact-canvas builders', () => {
  it('maps each artifact FORM to its native file format', () => {
    expect(ARTIFACT_FORMAT).toEqual({ doc: 'docx', ppt: 'pptx', pdf: 'pdf', sheet: 'xlsx' });
  });

  it('sectionsToCanvasDoc → a doc with a heading+body per section', () => {
    const doc = sectionsToCanvasDoc('Terms', [
      { title: '1. A', body: 'alpha' },
      { title: '2. B', body: '' },
    ]);
    expect(doc.version).toBe(2);
    expect(doc.sections).toHaveLength(2);
    const s0 = doc.sections[0].groups[0].nodes;
    expect(s0[0]).toMatchObject({ type: 'heading' });
    expect((s0[0].content as { text: string }).text).toBe('1. A');
    expect(s0[1]).toMatchObject({ type: 'text_block' });
    // an empty body yields heading-only (no text_block)
    expect(doc.sections[1].groups[0].nodes).toHaveLength(1);
  });

  it('tableToCanvasSheet → a spreadsheet with one table node', () => {
    const headers = ['When', 'Duration', 'Status', 'Booked by'];
    const rows = [['Jul 28', '15', 'open', ''], ['Jul 28', '30', 'booked', 'x@y.z']];
    const doc = tableToCanvasSheet('Schedule', headers, rows, 'Sched');
    expect(doc.canvas.format).toBe('spreadsheet');
    const nodes = flattenNodes(doc);
    const table = nodes.find((n) => n.type === 'table');
    expect(table).toBeTruthy();
    const tc = table!.content as { headers: string[]; rows: string[][]; sheet_name: string };
    expect(tc.headers).toEqual(headers);
    expect(tc.rows).toEqual(rows);
    expect(tc.sheet_name).toBe('Sched');
  });

  it('flattenNodes collects every node across sections/groups', () => {
    const doc = sectionsToCanvasDoc('D', [
      { title: 'A', body: 'x' },   // 2 nodes
      { title: 'B', body: 'y' },   // 2 nodes
    ]);
    expect(flattenNodes(doc)).toHaveLength(4);
  });
});
