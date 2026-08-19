import { describe, it, expect } from 'vitest';
import {
  countCharacters,
  countDocCharacters,
  validateCanvasAgainstSpec,
  CANVAS_PRESETS,
  type CanvasDocument,
  type CanvasNode,
  type ComplianceSpec,
} from '@/lib/types/canvas-document';
import { buildArtifactSpecs } from '@/lib/artifact-spec';
import { extractByPattern } from '@/lib/ingest/pattern-extract';

/**
 * The CHARACTER ruler — the third compliance size dimension beside pages and slides.
 *
 * A large family of required documents is capped in characters, not pages: the DoW SBIR cover
 * sheet's technical abstract and anticipated-benefits discussion ("Each section should be no more
 * than 3,000 characters"), NSF project summaries, grants.gov narrative fields. The agency portal
 * pastes them into a fixed-size form field and TRUNCATES at the cap, so an over-length narrative
 * does not lose points — it loses its ending. Before this the product could not represent that
 * rule at all: it would provision such a document with no limit, gauge it in pages, and pass it
 * at the export gate.
 */

const text = (s: string): CanvasNode => ({
  id: crypto.randomUUID(), type: 'text_block', content: { text: s },
} as unknown as CanvasNode);

const heading = (s: string): CanvasNode => ({
  id: crypto.randomUUID(), type: 'heading', content: { text: s, level: 1 },
} as unknown as CanvasNode);

const image = (): CanvasNode => ({
  id: crypto.randomUUID(), type: 'image',
  content: { storage_key: 'k', alt_text: 'a', width: 100, height: 100, caption: '' },
} as unknown as CanvasNode);

const doc = (nodes: CanvasNode[]): CanvasDocument => ({
  version: 1, document_id: crypto.randomUUID(),
  canvas: JSON.parse(JSON.stringify(CANVAS_PRESETS.letter_standard)),
  nodes,
  metadata: { version_number: 1, status: 'draft' },
} as unknown as CanvasDocument);

const spec = (over: Partial<ComplianceSpec>): ComplianceSpec => ({
  max_pages: null, max_slides: null, min_font_size: null, images_allowed: true,
  required_sections: [], header_required: false, footer_required: false, ...over,
});

describe('countCharacters — the ruler', () => {
  it('counts the visible narrative, one separator between blocks', () => {
    // "abc" + sep + "de" = 3 + 1 + 2
    expect(countCharacters([text('abc'), text('de')])).toBe(6);
  });

  it('collapses whitespace the way an agency form field does', () => {
    // The canvas carries its own indentation and wrapping; the form field does not. Counting
    // canvas whitespace against the offeror's budget would report a compliant narrative as over.
    expect(countCharacters([text('a   b\n\n  c')])).toBe(countCharacters([text('a b c')]));
    expect(countCharacters([text('  padded  ')])).toBe('padded'.length);
  });

  it('counts headings and table text — anything the offeror typed', () => {
    expect(countCharacters([heading('Title')])).toBe(5);
  });

  it('ignores images and empty blocks — they never reach the form field', () => {
    expect(countCharacters([image()])).toBe(0);
    expect(countCharacters([text('abc'), text('   '), image(), text('de')])).toBe(6);
  });

  it('is zero for an empty document, never NaN', () => {
    expect(countDocCharacters(doc([]))).toBe(0);
  });
});

describe('the compliance floor enforces the cap', () => {
  it('flags a narrative over its whole-artifact character cap', () => {
    const v = validateCanvasAgainstSpec(doc([text('x'.repeat(3001))]), spec({ max_characters: 3000 }));
    expect(v.map((x) => x.code)).toContain('over_character_limit');
    expect(v[0].actual).toBe(3001);
    expect(v[0].limit).toBe(3000);
  });

  it('passes a narrative exactly AT the cap — the limit is inclusive', () => {
    expect(validateCanvasAgainstSpec(doc([text('x'.repeat(3000))]), spec({ max_characters: 3000 }))).toEqual([]);
  });

  it('leaves a document with no character cap unconstrained', () => {
    // Every paginated volume. A null cap must never behave like a zero cap.
    expect(validateCanvasAgainstSpec(doc([text('x'.repeat(50_000))]), spec({ max_characters: null }))).toEqual([]);
    expect(validateCanvasAgainstSpec(doc([text('x'.repeat(50_000))]), spec({}))).toEqual([]);
  });

  it('flags a per-SECTION cap, so one volume can hold two separately capped narratives', () => {
    // The real DoW cover sheet: Project Summary and Anticipated Benefits, 3,000 each, one volume.
    const d = {
      version: 2, document_id: crypto.randomUUID(),
      canvas: JSON.parse(JSON.stringify(CANVAS_PRESETS.letter_standard)),
      sections: [
        { id: 'a', layout: { mode: 'flow', character_budget: 3000 },
          groups: [{ id: 'g1', nodes: [heading('Project Summary'), text('x'.repeat(3200))] }] },
        { id: 'b', layout: { mode: 'flow', character_budget: 3000 },
          groups: [{ id: 'g2', nodes: [heading('Anticipated Benefits'), text('y'.repeat(100))] }] },
      ],
      metadata: { version_number: 1, status: 'draft' },
    } as unknown as CanvasDocument;
    const v = validateCanvasAgainstSpec(d, spec({}));
    const overs = v.filter((x) => x.code === 'section_over_characters');
    expect(overs).toHaveLength(1);
    // Only the first section is over, and the message names it.
    expect(overs[0].message).toContain('Project Summary');
  });
});

describe('buildArtifactSpecs — where the cap comes from', () => {
  const compliance = { pageLimitTechnical: 10, characterLimitNarrative: 3000 };

  it('sums the volume items’ character caps into the artifact total', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ characterLimit: 3000 }, { characterLimit: 3000 }],
      compliance,
    });
    expect(complianceSpec.max_characters).toBe(6000);
  });

  it('NEVER applies the matrix narrative cap to a volume whose items declare none', () => {
    // The bug this locks: character_limit_narrative states the cap on the cover sheet's narrative
    // documents. Used as a whole-volume fallback it would cap the 10-page Technical Volume at
    // 3,000 characters — roughly one page — failing every compliant technical volume at the export
    // gate against a rule the solicitation never states about it.
    const { complianceSpec, formatSpec } = buildArtifactSpecs({
      artifactType: 'narrative',
      items: [{ pageLimit: 3 }, { pageLimit: 7 }],
      compliance,
    });
    expect(complianceSpec.max_characters).toBeNull();
    expect(complianceSpec.max_pages).toBe(10); // the page ruler still governs it
    expect(formatSpec.max_pages).toBe(10);
  });

  it('ignores a zero or negative item cap rather than treating it as "no text allowed"', () => {
    const { complianceSpec } = buildArtifactSpecs({
      artifactType: 'narrative', items: [{ characterLimit: 0 }, { characterLimit: -5 }], compliance,
    });
    expect(complianceSpec.max_characters).toBeNull();
  });
});

describe('the extractor READS the cap off the solicitation', () => {
  // Verbatim from DoW_2026_SBIR_BAA_Preface_07152026.pdf, the sentence that governs Volume 1.
  const BAA = `The proposal cover sheet is prepared on DSIP. The cover sheet must include a brief
technical abstract that describes the proposed R&D project and an anticipated benefits and
potential commercial applications discussion. Each section should be no more than 3,000
characters. Do not include proprietary or classified information in the proposal cover sheet.`;

  it('reads "no more than 3,000 characters" with a citable excerpt', () => {
    const out = extractByPattern(BAA);
    expect(out.compliance.characterLimitNarrative).toBe(3000);
    const ev = out.evidence.character_limit_narrative;
    expect(ev).toBeTruthy();
    expect(ev.anchor.excerpt).toMatch(/3,000\s*\n?characters/);
  });

  // extractByPattern refuses text below MIN_USABLE_TEXT_CHARS (200) — an unshredded document
  // must not look like a document that states no rules. Test sentences are therefore padded to
  // realistic solicitation length; without this the assertions below (both the positive AND the
  // negative ones) pass vacuously against the guard rather than against the rules.
  const inSolicitation = (sentence: string) =>
    `Section 5.0 Proposal Preparation Instructions. Offerors are responsible for reading the ` +
    `instructions in their entirety before preparing a submission under this announcement. ` +
    `${sentence} Questions regarding these instructions may be submitted through the portal ` +
    `during the pre-release period only.`;

  it('handles the other wordings agencies use', () => {
    const read = (s: string) => extractByPattern(inSolicitation(s)).compliance.characterLimitNarrative;
    expect(read('The abstract is limited to 4000 characters.')).toBe(4000);
    expect(read('The summary shall not exceed 2,500 characters.')).toBe(2500);
    expect(read('Provide a Project Summary of a maximum of 1,200 characters.')).toBe(1200);
    expect(read('Enter the abstract, subject to a 3000-character limit.')).toBe(3000);
  });

  it('does not invent a cap from prose that merely mentions characters', () => {
    // Absence is a finding. A stray count in unrelated prose must not become a submission rule.
    for (const prose of [
      'Do not use special characters in the file name.',
      'The topic number consists of 14 characters.',
      'Proposals must be submitted in the format specified above.',
    ]) {
      expect(extractByPattern(inSolicitation(prose)).compliance.characterLimitNarrative).toBeUndefined();
    }
  });

  it('refuses to read anything from an unshredded document rather than reporting "no cap"', () => {
    expect(extractByPattern('').compliance.characterLimitNarrative).toBeUndefined();
    expect(extractByPattern('no more than 3,000 characters').hasAny).toBe(false);
  });
});
