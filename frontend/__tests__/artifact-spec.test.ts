/**
 * E2 — artifact-spec builder: TEXT spec parsing + frozen CanvasRules/ComplianceSpec.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFontPt,
  parseMarginsToPt,
  parseLineSpacing,
  buildArtifactSpecs,
} from '@/lib/artifact-spec';

describe('parseFontPt', () => {
  it('parses "12pt", "10 pt", bare numbers, and numeric input', () => {
    expect(parseFontPt('12pt')).toBe(12);
    expect(parseFontPt('10 pt')).toBe(10);
    expect(parseFontPt('11')).toBe(11);
    expect(parseFontPt(9.5)).toBe(9.5);
  });
  it('returns null for unparseable input', () => {
    expect(parseFontPt('default')).toBeNull();
    expect(parseFontPt(null)).toBeNull();
    expect(parseFontPt(undefined)).toBeNull();
  });
});

describe('parseMarginsToPt', () => {
  it('converts inches and units to points (72pt = 1in)', () => {
    expect(parseMarginsToPt('1 inch all sides')).toBe(72);
    expect(parseMarginsToPt('0.5 in')).toBe(36);
    expect(parseMarginsToPt('1"')).toBe(72);
    expect(parseMarginsToPt('2.54cm')).toBe(72); // 2.54cm ≈ 1in
  });
  it('defaults to 72 (1in) when unparseable', () => {
    expect(parseMarginsToPt('standard')).toBe(72);
    expect(parseMarginsToPt(null)).toBe(72);
  });
});

describe('parseLineSpacing', () => {
  it('maps single/double/explicit values', () => {
    expect(parseLineSpacing('single')).toBe(1.0);
    expect(parseLineSpacing('double')).toBe(2.0);
    expect(parseLineSpacing('1.5')).toBe(1.5);
    expect(parseLineSpacing('1.0')).toBe(1.0);
  });
  it('defaults to 1.0 when unparseable', () => {
    expect(parseLineSpacing('whatever')).toBe(1.0);
    expect(parseLineSpacing(null)).toBe(1.0);
  });
});

describe('buildArtifactSpecs', () => {
  it('freezes item-level specs over the matrix for a narrative volume', () => {
    const { formatSpec, complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [
        {
          itemType: 'word_doc',
          pageLimit: 15,
          fontSize: '10pt',
          minFontSize: 10,
          margins: '1 inch all sides',
          lineSpacing: 'single',
          requiredSections: ['Technical Approach', 'Work Plan'],
          headerFormat: '{company} — {topic}',
        },
      ],
      compliance: { pageLimitTechnical: 20, fontSize: '12pt', imagesTablesAllowed: true },
    });

    expect(formatSpec.format).toBe('letter');
    expect(formatSpec.max_pages).toBe(15); // single item's budget (== its sum) wins over matrix 20
    expect(formatSpec.font_default.size).toBe(10);
    expect(formatSpec.margins).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
    expect(formatSpec.line_spacing).toBe(1.0);
    expect(formatSpec.min_font_size).toBe(10);
    expect(formatSpec.images_allowed).toBe(true);

    expect(complianceSpec.max_pages).toBe(15);
    expect(complianceSpec.min_font_size).toBe(10);
    expect(complianceSpec.required_sections).toEqual(['Technical Approach', 'Work Plan']);
    expect(complianceSpec.header_required).toBe(true);
  });

  it('sums per-section page budgets into the whole-volume cap (not Math.max)', () => {
    // A DSIP Technical Volume: multiple sections each carrying their own page budget. The volume
    // cap is their SUM (2+1+3+1+1+1+1 = 10), NOT the largest single section (3) — the bug that
    // throttled a 10-page Technical Volume to its 3-page SOW section.
    const { formatSpec, complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [
        { itemType: 'word_doc', pageLimit: 2 }, { itemType: 'word_doc', pageLimit: 1 },
        { itemType: 'word_doc', pageLimit: 3 }, { itemType: 'word_doc', pageLimit: 1 },
        { itemType: 'word_doc', pageLimit: 1 }, { itemType: 'word_doc', pageLimit: 1 },
        { itemType: 'word_doc', pageLimit: 1 }, { itemType: 'word_doc' /* no budget */ },
      ],
      compliance: { pageLimitTechnical: 10, minFontSize: 10 },
    });
    expect(formatSpec.max_pages).toBe(10);
    expect(complianceSpec.max_pages).toBe(10);
  });

  it('falls back to the matrix volume limit when no item declares a page budget', () => {
    const { formatSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'word_doc' }],
      compliance: { pageLimitTechnical: 10 },
    });
    expect(formatSpec.max_pages).toBe(10);
  });

  it('uses the spreadsheet preset for a cost artifact', () => {
    const { formatSpec } = buildArtifactSpecs({
      artifactType: 'cost',
      items: [{ itemType: 'spreadsheet' }],
      compliance: {},
    });
    expect(formatSpec.format).toBe('spreadsheet');
  });

  it('uses the slide preset and slide limit for a slide deck', () => {
    const { formatSpec, complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'slide_deck', slideLimit: 25 }],
      compliance: {},
    });
    expect(formatSpec.format).toBe('slide_16_9');
    expect(formatSpec.max_slides).toBe(25);
    expect(complianceSpec.max_slides).toBe(25);
  });

  it('falls back to the matrix when items omit specs', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [],
      compliance: {
        pageLimitTechnical: 20,
        minFontSize: 11,
        imagesTablesAllowed: false,
        requiredSections: [{ name: 'Cover Page' }, 'Abstract'],
      },
    });
    expect(complianceSpec.max_pages).toBe(20);
    expect(complianceSpec.min_font_size).toBe(11);
    expect(complianceSpec.images_allowed).toBe(false);
    // object {name} and string forms both normalized
    expect(complianceSpec.required_sections).toEqual(['Cover Page', 'Abstract']);
  });

  // ── Bug-sweep regressions (postgres.js NUMERIC-as-string + spec precedence) ──

  it('preserves min_font_size when it arrives as a STRING (NUMERIC from postgres.js)', () => {
    // postgres.js returns NUMERIC columns as strings; the freeze must not drop it.
    const { formatSpec, complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'word_doc', minFontSize: '10' }],
      compliance: { minFontSize: '11' },
    });
    expect(complianceSpec.min_font_size).toBe(10); // item wins, parsed from string
    expect(formatSpec.min_font_size).toBe(10);

    const matrixOnly = buildArtifactSpecs({
      artifactType: 'narrative', items: [{ itemType: 'word_doc' }], compliance: { minFontSize: '11.5' },
    });
    expect(matrixOnly.complianceSpec.min_font_size).toBe(11.5);
  });

  it('freezes the COST page limit (not the technical one) for a cost artifact', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'cost',
      items: [{ itemType: 'spreadsheet' }], // no per-item page limit (the normal case)
      compliance: { pageLimitTechnical: 20, pageLimitCost: 5 },
    });
    expect(complianceSpec.max_pages).toBe(5);
  });

  it('UNIONs item-level and matrix-level required sections (no silent drop)', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'word_doc', requiredSections: ['Item Subsection'] }],
      compliance: { requiredSections: ['Cover', 'Abstract', 'Technical Approach'] },
    });
    expect(complianceSpec.required_sections).toEqual([
      'Item Subsection', 'Cover', 'Abstract', 'Technical Approach',
    ]);
  });

  it('gates limits by format: slide deck has no page cap; doc has no slide cap', () => {
    const slide = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'slide_deck', slideLimit: 25 }],
      compliance: { pageLimitTechnical: 30, slideLimit: 25 },
    });
    expect(slide.complianceSpec.max_pages).toBeNull();
    expect(slide.complianceSpec.max_slides).toBe(25);

    const doc = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ itemType: 'word_doc', pageLimit: 15 }],
      compliance: { pageLimitTechnical: 15, slideLimit: 25 },
    });
    expect(doc.complianceSpec.max_slides).toBeNull();
    expect(doc.complianceSpec.max_pages).toBe(15);
  });
});
