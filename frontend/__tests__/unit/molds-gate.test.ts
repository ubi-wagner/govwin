import { describe, it, expect } from 'vitest';
import { parseAgentOutline, inferTemplateType, buildMoldCanvas } from '@/lib/ingest/molds';
import { countCharacters, docNodes, type CanvasDocument } from '@/lib/types/canvas-document';

/**
 * The MOLDS gate. skeleton_architect is advisory — it proposes a skeleton and writes nothing,
 * which is correct. What was missing is the other half: nothing read its proposal, nothing staged
 * it where a curator could see it, and nothing turned it into molds. The gate parked a human in
 * front of an empty panel.
 *
 * These lock the pure parts of the landing: how an agent proposal is recognised (and, more
 * importantly, when it is NOT), and what a built mold actually contains.
 */

describe('parseAgentOutline — recognising a real proposal', () => {
  it('lifts the JSON skeleton out of the prose the model wraps it in', () => {
    const text = `Here is the skeleton I propose.\n\n{"volumes":[{"volume":"Technical Volume",` +
      `"sections":[{"section":"Phase I Statement of Work","template_type":"technical_volume","page_budget":3}]}],` +
      `"notes":"budgets sum within the 10-page limit"}\n\nLet me know if you want it rebalanced.`;
    const out = parseAgentOutline(text);
    expect(out).toBeTruthy();
    expect(out!.volumes).toHaveLength(1);
    expect(out!.notes).toBe('budgets sum within the 10-page limit');
  });

  it('returns null when the run produced no skeleton — the honest answer', () => {
    // This is the ACTUAL text a safe-skipped / emulated run leaves behind. Treating it as a
    // proposal, or quietly substituting an invented one, is how "the agent designed this" gets
    // said about something no agent produced.
    expect(parseAgentOutline('Done — the emulated model completed its tool loop.')).toBeNull();
    expect(parseAgentOutline(null)).toBeNull();
    expect(parseAgentOutline(undefined)).toBeNull();
    expect(parseAgentOutline('')).toBeNull();
    expect(parseAgentOutline('{"volumes":[]}')).toBeNull();       // present but empty
    expect(parseAgentOutline('{"volumes": not json}')).toBeNull(); // malformed
  });

  it('does not mistake a nested mention of volumes for the skeleton', () => {
    expect(parseAgentOutline('The solicitation lists seven volumes in total.')).toBeNull();
  });
});

describe('inferTemplateType — every result must satisfy the CHECK constraint', () => {
  const ALLOWED = new Set([
    'technical_volume', 'cost_volume', 'slide_deck', 'past_performance', 'key_personnel',
    'commercialization', 'abstract', 'cover_sheet', 'supporting_docs', 'collaboration', 'custom',
  ]);

  it('types the real T3CP volume set', () => {
    expect(inferTemplateType('Technical Volume', 'Phase I Statement of Work')).toBe('technical_volume');
    expect(inferTemplateType('Cost Volume', 'DSIP cost volume')).toBe('cost_volume');
    expect(inferTemplateType('Proposal Cover Sheet', 'Project Summary / Technical Abstract')).toBe('abstract');
    expect(inferTemplateType('Proposal Cover Sheet', 'Anticipated Benefits and Potential Commercial Applications')).toBe('abstract');
    expect(inferTemplateType('Supporting Documents', 'TABA Request Form')).toBe('supporting_docs');
  });

  it('falls back to custom rather than to an invalid type', () => {
    for (const [v, i] of [['', ''], ['Volume 9', 'Something Nobody Anticipated'], ['x', 'y']]) {
      expect(ALLOWED.has(inferTemplateType(v, i))).toBe(true);
    }
    expect(inferTemplateType('Volume 9', 'Something Nobody Anticipated')).toBe('custom');
  });
});

describe('the authored set — volume flag and item flag must agree', () => {
  // Found live by the molds drive: proposeOutline filtered DSIP-only ITEMS but not DSIP-only
  // VOLUMES, so Volume 4 (Company Commercialization Report — flagged at the volume level, its
  // single item unflagged) reached the skeleton and would have been molded. That is an authoring
  // artifact for a report SBIR.gov generates: work the customer can never do, blocking readiness
  // forever. The rule below is the one provision applies, and the two must not drift.
  type Item = { dsipOnly?: boolean };
  type Vol = { dsipOnly: boolean; items: Item[] };
  const authoredSections = (v: Vol) => (v.dsipOnly ? [] : v.items).filter((i) => i.dsipOnly !== true);

  it('a DSIP-only VOLUME contributes nothing, even when its items are unflagged', () => {
    expect(authoredSections({ dsipOnly: true, items: [{}] })).toHaveLength(0);
  });

  it('a DSIP-only ITEM is dropped from an otherwise authored volume', () => {
    expect(authoredSections({ dsipOnly: false, items: [{ dsipOnly: true }, {}, {}] })).toHaveLength(2);
  });

  it('an ordinary volume keeps all of its items', () => {
    expect(authoredSections({ dsipOnly: false, items: [{}, {}, {}] })).toHaveLength(3);
  });
});

describe('buildMoldCanvas — what a buyer actually opens', () => {
  const SPEC = { font_default: { family: 'Times New Roman', size: 10 }, min_font_size: 10 };

  it('stamps the mandated list ONLY when the item is the whole volume', () => {
    // Found live: T3CP's Volume 2 is curated as 12 items, one per mandated section. Stamping the
    // full 12-section list into each of them produced 26-node molds — twelve copies of the
    // outline, burying the one section the offeror actually opened. The list belongs in the mold
    // only when the volume is authored as ONE document.
    const isWholeVolume = (authoredSiblings: number) => authoredSiblings === 1;
    expect(isWholeVolume(1)).toBe(true);   // single-item technical volume → stamp the outline
    expect(isWholeVolume(12)).toBe(false); // already split per section → each gets its own heading

    const split = buildMoldCanvas({
      itemName: 'Phase I Statement of Work', volumeName: 'Technical Volume',
      pageLimit: 3, characterLimit: null, requiredSections: [], formatSpec: SPEC,
    });
    const headings = docNodes(split).filter((n) => n.type === 'heading');
    expect(headings).toHaveLength(1);
    expect((headings[0].content as { text: string }).text).toBe('Phase I Statement of Work');
  });

  it('lays out the mandated sections in the mandated order for a technical volume', () => {
    // Getting the required-section ORDER wrong is one of the most common technical-volume
    // compliance failures, and it is knowable at curation time — so the buyer should never have
    // to reconstruct it from the announcement.
    const sections = [
      'Identification and Significance of the Problem or Opportunity',
      'Phase I Technical Objectives',
      'Phase I Statement of Work',
    ];
    const doc = buildMoldCanvas({
      itemName: 'Technical Volume', volumeName: 'Technical Volume',
      pageLimit: 10, characterLimit: null, requiredSections: sections, formatSpec: SPEC,
    });
    const headings = docNodes(doc)
      .filter((n) => n.type === 'heading')
      .map((n) => (n.content as { text: string }).text);
    expect(headings[0]).toBe('Technical Volume');       // the item itself
    expect(headings.slice(1)).toEqual(sections);         // then the mandated order, unshuffled
  });

  it('states the rules that govern the item in the solicitation’s own terms', () => {
    const doc = buildMoldCanvas({
      itemName: 'Project Summary / Technical Abstract', volumeName: 'Proposal Cover Sheet',
      pageLimit: null, characterLimit: 3000, requiredSections: [], formatSpec: SPEC,
    });
    const callout = docNodes(doc).find((n) => n.type === 'callout');
    expect(callout).toBeTruthy();
    const text = (callout!.content as { text: string }).text;
    expect(text).toContain('3,000 characters maximum');
    expect(text).toContain('truncates');          // says WHY it matters, not just the number
    expect(text).toContain('Times New Roman 10pt');
    expect(text).not.toContain('page');           // a character-capped item is not page-capped
  });

  it('is a skeleton, not content — it adds no words to the author’s budget', () => {
    // A mold that shipped prose would eat the cap it exists to protect. Every text block is
    // empty; only the headings and the rules callout carry characters.
    const doc = buildMoldCanvas({
      itemName: 'Anticipated Benefits', volumeName: 'Proposal Cover Sheet',
      pageLimit: null, characterLimit: 3000, requiredSections: [], formatSpec: SPEC,
    });
    const bodyText = docNodes(doc)
      .filter((n) => n.type === 'text_block')
      .map((n) => (n.content as { text: string }).text);
    expect(bodyText.every((t) => t === '')).toBe(true);
    expect(bodyText.length).toBeGreaterThan(0);   // there IS somewhere to write
  });

  it('carries the volume’s frozen format spec onto the canvas', () => {
    const doc = buildMoldCanvas({
      itemName: 'X', volumeName: 'Y', pageLimit: 3, characterLimit: null,
      requiredSections: [], formatSpec: { ...SPEC, max_pages: 3 },
    }) as CanvasDocument;
    expect(doc.canvas?.font_default?.family).toBe('Times New Roman');
    expect(doc.canvas?.max_pages).toBe(3);
    expect(doc.canvas?.min_font_size).toBe(10);
  });

  it('produces a measurable document — the rulers work on it', () => {
    const doc = buildMoldCanvas({
      itemName: 'Technical Volume', volumeName: 'Technical Volume', pageLimit: 10,
      characterLimit: null, requiredSections: ['A', 'B'], formatSpec: SPEC,
    });
    expect(countCharacters(docNodes(doc))).toBeGreaterThan(0);
  });
});
