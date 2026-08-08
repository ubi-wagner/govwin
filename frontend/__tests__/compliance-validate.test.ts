import { describe, expect, it } from 'vitest';
import {
  validateCanvasAgainstSpec,
  CANVAS_PRESETS,
  type CanvasDocument,
  type CanvasNode,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';

// ── minimal builders ────────────────────────────────────────────────
const meta = {
  title: 'T', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
  created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'ai_drafted' as const,
};
const node = (type: CanvasNode['type'], content: unknown, style: Record<string, unknown> = {}): CanvasNode => ({
  id: `${type}-${Math.random().toString(36).slice(2, 7)}`, type, content: content as CanvasNode['content'],
  style: style as CanvasNode['style'], provenance: { source: 'manual' }, history: [], library_eligible: false,
});
const para = (text: string, style: Record<string, unknown> = {}) => node('text_block', { text }, style);
const doc = (nodes: CanvasNode[], canvasOverride: Partial<CanvasDocument['canvas']> = {}): CanvasDocument => ({
  version: 1, document_id: 'd',
  canvas: { ...CANVAS_PRESETS.letter_sbir_phase1, ...canvasOverride } as CanvasDocument['canvas'],
  nodes, metadata: meta,
});
const spec = (o: Partial<ComplianceSpec> = {}): ComplianceSpec => ({
  max_pages: null, max_slides: null, min_font_size: null, images_allowed: true,
  required_sections: [], header_required: false, footer_required: false, ...o,
});

describe('validateCanvasAgainstSpec (compliance floor E4)', () => {
  it('returns [] when the document satisfies every limit', () => {
    // letter_sbir_phase1 carries font_default 10pt + a header + a footer.
    const d = doc([para('Hello world, this is compliant.')]);
    expect(validateCanvasAgainstSpec(d, spec({ min_font_size: 10, max_pages: 15, header_required: true, footer_required: true }))).toEqual([]);
  });

  it('flags a font below the RFP floor (and reports the actual size)', () => {
    const v = validateCanvasAgainstSpec(doc([para('tiny', { size: 8 })]), spec({ min_font_size: 11 }));
    expect(v.map((x) => x.code)).toContain('font_too_small');
    expect(v.find((x) => x.code === 'font_too_small')?.actual).toBe(8);
  });

  it('flags a document over the page limit', () => {
    const v = validateCanvasAgainstSpec(doc([para('x '.repeat(20000))]), spec({ max_pages: 1 }));
    expect(v.map((x) => x.code)).toContain('over_page_limit');
  });

  it('flags a disallowed image', () => {
    const v = validateCanvasAgainstSpec(doc([node('image', { storage_key: 'k', alt: 'a' })]), spec({ images_allowed: false }));
    expect(v.map((x) => x.code)).toContain('image_not_allowed');
  });

  it('flags missing required header/footer', () => {
    const v = validateCanvasAgainstSpec(doc([para('x')], { header: null, footer: null }), spec({ header_required: true, footer_required: true }));
    expect(v.map((x) => x.code)).toEqual(expect.arrayContaining(['missing_header', 'missing_footer']));
  });

  it('treats a null limit as unconstrained', () => {
    expect(validateCanvasAgainstSpec(doc([para('x', { size: 4 })]), spec())).toEqual([]);
  });
});
