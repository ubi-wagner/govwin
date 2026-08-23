/**
 * A PARTIAL canvas must never crash a reader (bug log B73 · B78).
 *
 * The shape is real and it is in the database today: four sections of the Foundation TVSF proposal
 * carry `canvas: {width, height, margins}` with no `font_default`. B73 found it in the RULER, where
 * `c.font_default.size` threw and took out the page gauge, the layout route and the readiness
 * verdict. The fix defaulted inside `flowMetrics` — which fixed exactly one caller.
 *
 * B78 is what that cost. `CanvasRenderer` reads `canvas.font_default.family` directly, and the
 * proposal WORKSPACE renders section previews through it, so opening the build showed the tenant
 * "Something went wrong — this page failed to load". It threw in a client component, so nothing
 * reached the server log, and Next served the boundary with HTTP 200 — a capture harness watching
 * status codes called it a pass. Meanwhile the same volume still downloaded as a correct PDF,
 * because `canvasBaseCss` defaults every field it reads.
 *
 * These lock the invariant one level up from either fix: `normalizeCanvas` is the single answer to
 * "what does a missing canvas field mean", it agrees with the exporter, and it does not invent a
 * frame the exporter would not draw.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeCanvas, withCanvasDefaults, paginate, CANVAS_PRESETS,
  type CanvasDocument, type CanvasRules,
} from '@/lib/types/canvas-document';

/** The exact stored shape — three frame keys, nothing else. */
const STORED_PARTIAL = { width: 612, height: 792, margins: { top: 72, right: 72, bottom: 72, left: 72 } };

const doc = (canvas: unknown): CanvasDocument => ({
  version: 1,
  canvas,
  nodes: [{ id: 'n1', type: 'text_block', content: { text: 'Interlaminar shear strength held within band.' }, style: {}, provenance: { source: 'human' }, history: [] }],
  metadata: { title: 't', status: 'draft' },
} as unknown as CanvasDocument);

describe('normalizeCanvas — the one definition of a missing canvas field', () => {
  it('fills a font_default-less canvas with what the exporter draws', () => {
    const c = normalizeCanvas(STORED_PARTIAL as Partial<CanvasRules>);
    expect(c.font_default).toEqual({ family: 'Times New Roman', size: 12 });
    expect(c.line_spacing).toBe(1.15);
    expect(c.format).toBe('letter');
  });

  it('agrees field-for-field with letter_standard on an empty canvas', () => {
    // The guard against the defaults drifting away from the preset the exporter uses: if these two
    // ever disagree, the ruler measures a document the exporter will not produce.
    expect(normalizeCanvas(undefined)).toEqual(CANVAS_PRESETS.letter_standard);
    expect(normalizeCanvas(null)).toEqual(CANVAS_PRESETS.letter_standard);
    expect(normalizeCanvas({})).toEqual(CANVAS_PRESETS.letter_standard);
  });

  it('keeps every field the stored canvas DOES declare', () => {
    const c = normalizeCanvas({ width: 792, height: 612, margins: { top: 36, right: 36, bottom: 36, left: 36 }, font_default: { family: 'Arial', size: 10 } } as Partial<CanvasRules>);
    expect(c.width).toBe(792);
    expect(c.margins.top).toBe(36);
    expect(c.font_default).toEqual({ family: 'Arial', size: 10 });
  });

  it('distinguishes "no header" from "a header with no font"', () => {
    // null means the document has no running header — a real and different thing from a header
    // whose font the row omitted. Conflating them either invents furniture or crashes on it.
    expect(normalizeCanvas(STORED_PARTIAL as Partial<CanvasRules>).header).toBeNull();
    const withHdr = normalizeCanvas({ ...STORED_PARTIAL, header: { template: '{company_name}', height: 36 } } as unknown as Partial<CanvasRules>);
    expect(withHdr.header?.font).toEqual({ family: 'Times New Roman', size: 10 });
    expect(withHdr.header?.template).toBe('{company_name}');
  });

  it('inherits the declared body family into unstated furniture', () => {
    const c = normalizeCanvas({ ...STORED_PARTIAL, font_default: { family: 'Arial', size: 11 }, footer: { template: 'Page {n}', height: 36 } } as unknown as Partial<CanvasRules>);
    expect(c.footer?.font).toEqual({ family: 'Arial', size: 10 });
  });
});

describe('withCanvasDefaults — the doc-level wrapper', () => {
  it('returns a complete document unchanged, by identity', () => {
    const d = doc(CANVAS_PRESETS.letter_standard);
    expect(withCanvasDefaults(d)).toBe(d);
  });

  it('does NOT wave through a header that has no font', () => {
    // The old fast path checked format/width/height/margins/font_default/line_spacing and stopped —
    // so `{...letter_sbir_phase1, header: {template, height}}` passed the check untouched and then
    // crashed on `canvas.header.font.family`. Furniture is a field like any other.
    const d = doc({ ...CANVAS_PRESETS.letter_standard, header: { template: 'x', height: 36 } });
    const out = withCanvasDefaults(d);
    expect(out).not.toBe(d);
    expect(out.canvas.header?.font?.family).toBe('Times New Roman');
  });

  it('fills the stored partial so every field a renderer indexes into is present', () => {
    const c = withCanvasDefaults(doc(STORED_PARTIAL)).canvas;
    for (const read of [
      () => c.font_default.family, () => c.font_default.size, () => c.line_spacing,
      () => c.margins.left, () => c.margins.top, () => c.width, () => c.height, () => c.format,
    ]) expect(read).not.toThrow();
  });
});

describe('the ruler and the renderer resolve a partial canvas the SAME way', () => {
  it('measures the partial exactly as it measures the explicit preset', () => {
    expect(paginate(doc(STORED_PARTIAL)).totalPages)
      .toBe(paginate(doc(CANVAS_PRESETS.letter_standard)).totalPages);
  });

  it('does not throw on a canvas that is missing everything', () => {
    expect(() => paginate(doc({}))).not.toThrow();
    expect(() => paginate(doc(undefined))).not.toThrow();
  });
});
