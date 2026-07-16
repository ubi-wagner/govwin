import { describe, expect, it } from 'vitest';
import { resolveArtifactFormat, assembleArtifactCanvas } from '@/lib/export/artifact-export';

describe('resolveArtifactFormat', () => {
  it('honors an explicit, valid requested format', () => {
    expect(resolveArtifactFormat('narrative', 'letter', 'pdf')).toBe('pdf');
    expect(resolveArtifactFormat('cost', 'spreadsheet', 'docx')).toBe('docx');
    expect(resolveArtifactFormat(null, null, 'pptx')).toBe('pptx');
    expect(resolveArtifactFormat(null, null, 'xlsx')).toBe('xlsx');
  });

  it('ignores an invalid requested format and falls back to auto', () => {
    expect(resolveArtifactFormat('narrative', 'letter', 'exe')).toBe('docx');
    expect(resolveArtifactFormat('cost', 'spreadsheet', '')).toBe('xlsx');
  });

  it('auto-resolves slides → pptx', () => {
    expect(resolveArtifactFormat('narrative', 'slide_16_9')).toBe('pptx');
    expect(resolveArtifactFormat('other', 'slide_4_3')).toBe('pptx');
  });

  it('auto-resolves spreadsheet / cost → xlsx', () => {
    expect(resolveArtifactFormat('narrative', 'spreadsheet')).toBe('xlsx');
    expect(resolveArtifactFormat('cost', 'letter')).toBe('xlsx');
  });

  it('defaults to docx for narrative/letter', () => {
    expect(resolveArtifactFormat('narrative', 'letter')).toBe('docx');
    expect(resolveArtifactFormat(null, null)).toBe('docx');
  });
});

describe('assembleArtifactCanvas', () => {
  const sec = (title: string, nodes: unknown[], canvas?: unknown) =>
    ({ title, content: JSON.stringify({ version: 1, ...(canvas ? { canvas } : {}), nodes }) });

  it('merges multiple sections with a page break between them', () => {
    const doc = assembleArtifactCanvas(
      [sec('A', [{ type: 'heading', content: { level: 1, text: 'A' } }]), sec('B', [{ type: 'heading', content: { level: 1, text: 'B' } }])],
      'narrative', 'Technical Volume',
    );
    const types = doc.nodes.map((n) => n.type);
    expect(types).toEqual(['heading', 'page_break', 'heading']);
    expect(doc.metadata.title).toBe('Technical Volume');
  });

  it('adopts the first section canvas that carries one', () => {
    const doc = assembleArtifactCanvas(
      [sec('A', [{ type: 'text_block', content: { text: 'x' } }], { format: 'slide_16_9', width: 960, height: 540 })],
      'narrative', 'Deck',
    );
    expect(doc.canvas.format).toBe('slide_16_9');
  });

  it('skips empty / malformed section content, not fatal', () => {
    const doc = assembleArtifactCanvas(
      [{ title: 'bad', content: '{not json' }, { title: 'empty', content: JSON.stringify({ nodes: [] }) }, sec('C', [{ type: 'text_block', content: { text: 'ok' } }])],
      'narrative', 'V',
    );
    // only the one valid, non-empty section contributes — no leading page break
    expect(doc.nodes.map((n) => n.type)).toEqual(['text_block']);
  });

  it('falls back to a preset canvas by type when no section carries one', () => {
    const cost = assembleArtifactCanvas([sec('t', [{ type: 'table', content: { headers: [], rows: [] } }])], 'cost', 'Cost');
    expect(cost.canvas.format).toBe('spreadsheet');
    const narr = assembleArtifactCanvas([sec('t', [{ type: 'text_block', content: { text: 'x' } }])], 'narrative', 'Tech');
    expect(narr.canvas.format).toBe('letter');
  });
});
