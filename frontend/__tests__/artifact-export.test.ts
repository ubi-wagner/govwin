import { describe, expect, it } from 'vitest';
import { resolveArtifactFormat, assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { sectionsToNodes } from '@/lib/types/canvas-document';

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

  it('merges multiple molds as FLOW sections — no forced page break between them', () => {
    const doc = assembleArtifactCanvas(
      [sec('A', [{ type: 'heading', content: { level: 1, text: 'A' } }]), sec('B', [{ type: 'heading', content: { level: 1, text: 'B' } }])],
      'narrative', 'Technical Volume',
    );
    expect(doc.version).toBe(2);
    expect(doc.sections).toHaveLength(2); // one flow section per mold
    expect(doc.sections!.every((s) => s.layout.mode === 'flow')).toBe(true);
    expect(doc.sections!.every((s) => !s.layout.break_before)).toBe(true);
    // content is continuous — no page_break node injected between molds
    const types = sectionsToNodes(doc.sections!).map((n) => n.type);
    expect(types).toEqual(['heading', 'heading']);
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
    // only the one valid, non-empty mold contributes — one flow section, no breaks
    expect(doc.sections).toHaveLength(1);
    expect(sectionsToNodes(doc.sections!).map((n) => n.type)).toEqual(['text_block']);
  });

  it('falls back to a preset canvas by type when no section carries one', () => {
    const cost = assembleArtifactCanvas([sec('t', [{ type: 'table', content: { headers: [], rows: [] } }])], 'cost', 'Cost');
    expect(cost.canvas.format).toBe('spreadsheet');
    const narr = assembleArtifactCanvas([sec('t', [{ type: 'text_block', content: { text: 'x' } }])], 'narrative', 'Tech');
    expect(narr.canvas.format).toBe('letter');
  });
});
