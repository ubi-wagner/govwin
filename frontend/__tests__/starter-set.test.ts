import { describe, it, expect } from 'vitest';
import { GENERIC_STARTERS, STARTER_SET } from '@/lib/library/starter-set';
import { ARTIFACT_FORMAT } from '@/lib/library/artifact-canvas';
import { renderCanvas } from '@/lib/export/artifact-export';

// The dogfooded starter set (P4). Pure proof: each builds a valid v2 canvas,
// renders to its native format via the REAL exporters, and the taxonomy is sound.
describe('starter set (P4.1 generics)', () => {
  it('each starter builds a valid v2 CanvasDocument with the right form/preset', () => {
    for (const s of GENERIC_STARTERS) {
      const d = s.build();
      expect(d.version).toBe(2);
      expect((d.sections ?? []).length, s.slug).toBeGreaterThanOrEqual(1);
      const fmt = d.canvas.format;
      if (s.form === 'sheet') expect(fmt, s.slug).toBe('spreadsheet');
      else if (s.form === 'ppt') expect(fmt.startsWith('slide'), s.slug).toBe(true);
      else expect(['letter', 'custom'], s.slug).toContain(fmt);
    }
  });

  it('each starter renders to its native format (real exporter, valid zip)', async () => {
    for (const s of GENERIC_STARTERS) {
      const buf = await renderCanvas(ARTIFACT_FORMAT[s.form], s.build(), {});
      expect(Buffer.isBuffer(buf), s.slug).toBe(true);
      expect(buf.length, s.slug).toBeGreaterThan(500);
      expect(buf.slice(0, 2).toString('latin1'), s.slug).toBe('PK'); // docx/pptx/xlsx are OpenXML zips
    }
  });

  it('taxonomy is well-formed: unique slugs, valid form/kind, a context', () => {
    const slugs = STARTER_SET.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of GENERIC_STARTERS) {
      expect(['doc', 'ppt', 'pdf', 'sheet'], s.slug).toContain(s.form);
      expect(['template', 'document'], s.slug).toContain(s.kind);
      expect(s.context, s.slug).toBeTruthy();
    }
    // the generics cover the three exportable office forms
    expect(new Set(GENERIC_STARTERS.map((s) => s.form))).toEqual(new Set(['doc', 'ppt', 'sheet']));
  });
});
