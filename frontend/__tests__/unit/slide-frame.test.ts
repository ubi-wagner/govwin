import { describe, it, expect } from 'vitest';
import { slideFrame, estimateSlideCount, CANVAS_PRESETS, type CanvasDocument } from '@/lib/types/canvas-document';
import { renderCanvasPreviewHtml } from '@/lib/export/canvas-html';

describe('slideFrame — aspect-ratio frame dimensions', () => {
  it('16:9 widescreen is 960×540 (13.33″×7.5″)', () => {
    expect(slideFrame('slide_16_9')).toEqual({ width: 960, height: 540 });
  });
  it('4:3 standard is 720×540 (10″×7.5″)', () => {
    expect(slideFrame('slide_4_3')).toEqual({ width: 720, height: 540 });
  });
  it('both share a 540pt height (switching aspect only reflows width)', () => {
    expect(slideFrame('slide_16_9').height).toBe(slideFrame('slide_4_3').height);
    expect(slideFrame('slide_16_9').width).toBeGreaterThan(slideFrame('slide_4_3').width);
  });
});

const slideDoc = (background?: string): CanvasDocument => ({
  version: 1,
  document_id: 'd',
  canvas: { ...CANVAS_PRESETS.slide_cso, background },
  nodes: [
    { id: 'h', type: 'heading', content: { level: 1, text: 'Title' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
    { id: 't', type: 'text_block', content: { text: 'Body' }, style: {}, provenance: { source: 'manual' }, history: [], library_eligible: false },
  ],
  metadata: { title: '', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '', created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted' },
});

describe('deck background — WYSIWYG parity (editor preview → export)', () => {
  it('the preview HTML paints the configured background (not the hardcoded white)', () => {
    const html = renderCanvasPreviewHtml(slideDoc('#0F172A'));
    expect(html).toContain('background: #0F172A');
  });
  it('falls back to white when no background is set', () => {
    const html = renderCanvasPreviewHtml(slideDoc(undefined));
    expect(html).toContain('background: #fff');
  });
  it('adding a background does not change the slide count estimate', () => {
    expect(estimateSlideCount(slideDoc('#123456'))).toBe(estimateSlideCount(slideDoc(undefined)));
  });
});
