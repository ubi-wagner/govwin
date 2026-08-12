import { describe, it, expect } from 'vitest';
import { renderCanvasBodyHtml } from '@/lib/export/canvas-html';
import { CANVAS_PRESETS, type CanvasDocument, type TableCell } from '@/lib/types/canvas-document';

const tableDoc = (cell: TableCell): CanvasDocument => ({
  version: 1, document_id: 'd', canvas: CANVAS_PRESETS.letter_standard,
  nodes: [{
    id: 't', type: 'table',
    content: { headers: ['H'], rows: [[cell]] } as unknown as CanvasDocument['nodes'][number]['content'],
    style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false,
  }],
  metadata: { title: '', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
});

describe('table cell styling → html/pdf (fg + per-cell border)', () => {
  it('text color (fg) renders', () => {
    expect(renderCanvasBodyHtml(tableDoc({ text: 'X', style: { fg: '#FF0000' } }))).toContain('color:#FF0000');
  });
  it('thick border renders a heavier rule', () => {
    expect(renderCanvasBodyHtml(tableDoc({ text: 'X', style: { border: 'thick' } }))).toContain('border:2px solid #334155');
  });
  it('none border removes the rule', () => {
    expect(renderCanvasBodyHtml(tableDoc({ text: 'X', style: { border: 'none' } }))).toContain('border:0');
  });
  it('default cell keeps the thin rule', () => {
    expect(renderCanvasBodyHtml(tableDoc({ text: 'X' }))).toContain('border:1px solid #cbd5e1');
  });
});
