/**
 * A slide that says "Core Technology & IP" must not enter the library as "Core Technology &amp; IP".
 *
 * PPTX text is XML, so an ampersand is stored escaped. The reader decoded entities in TABLE cells
 * only, which left every slide TITLE and BODY paragraph raw. That is not cosmetic: slide text
 * becomes library atoms, atoms get ranked into a section, and the section is exported into a
 * customer's proposal — so the escape travels all the way to a government submission. Measured on
 * a real deck before the fix: atoms titled "Slide 4 Core Technology &amp; IP Quantization-aware
 * training", "Slide 7 Facilities &amp; Capabilities", "Slide 9 Transition &amp; Commercialization".
 *
 * Round-trips through the REAL exporter so the bytes are a genuine OpenXML package, and the entity
 * is one pptxgenjs actually writes — not a hand-built XML string that could encode the bug into
 * the fixture and then "prove" itself.
 */
import { describe, it, expect } from 'vitest';
import { exportToPptx } from '@/lib/export/pptx-exporter';
import { readPptx } from '@/lib/import/pptx-reader';
import { CANVAS_PRESETS, type CanvasNode, type CanvasDocument } from '@/lib/types/canvas-document';

function node(type: CanvasNode['type'], content: unknown): CanvasNode {
  return {
    id: crypto.randomUUID(), type, content: content as CanvasNode['content'],
    style: {} as CanvasNode['style'], provenance: { source: 'template' }, history: [],
    library_eligible: true,
  };
}

/** Every character XML escapes, in the places a proposer actually types them. */
const TITLE = 'Core Technology & IP';
const BODY = 'Margins < 5% and cost > $1M; "quoted" text with O\'Brien and R&D';

function deckOf(nodes: CanvasNode[]): CanvasDocument {
  return {
    version: 2, document_id: 'd', canvas: CANVAS_PRESETS.slide_cso, nodes: [],
    sections: [{ id: 's', title: 'S', layout: { mode: 'flow' }, groups: [{ id: 'g', nodes }] }],
    metadata: {
      title: 'Entity Deck', volume_id: '', required_item_id: '', proposal_id: '', solicitation_id: '',
      created_at: '', last_modified_at: '', last_modified_by: '', version_number: 1, status: 'accepted',
    },
  } as CanvasDocument;
}

async function roundTrip(nodes: CanvasNode[]): Promise<string> {
  const bytes = await exportToPptx(deckOf(nodes));
  const result = await readPptx(Buffer.from(bytes), 'entities.pptx');
  // Read the text back off the canvas nodes the reader produced — that IS what becomes an atom.
  const texts: string[] = [];
  const walk = (c: unknown) => {
    if (!c || typeof c !== 'object') return;
    for (const v of Object.values(c as Record<string, unknown>)) {
      if (typeof v === 'string') texts.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') walk(v);
    }
  };
  for (const atom of result.atoms) {
    if (atom.headingText) texts.push(atom.headingText);
    atom.nodes.forEach((n) => walk(n.content));
  }
  return texts.join('\n');
}

describe('pptx reader — XML entities in slide text', () => {
  it('decodes an ampersand in a slide TITLE', async () => {
    const text = await roundTrip([node('heading', { level: 1, text: TITLE })]);
    expect(text).toContain('Core Technology & IP');
    expect(text).not.toContain('&amp;');
  }, 30000);

  it('decodes every predefined entity in slide BODY text', async () => {
    const text = await roundTrip([
      node('heading', { level: 1, text: 'Constraints' }),
      node('text_block', { text: BODY }),
    ]);
    expect(text).not.toMatch(/&(amp|lt|gt|quot|apos);/);
    // And the characters themselves survived rather than being stripped along with the escape.
    for (const ch of ['&', '<', '>']) expect(text).toContain(ch);
  }, 30000);

  it('leaves text with no entities untouched', async () => {
    const plain = 'Phase I Statement of Work';
    const text = await roundTrip([node('heading', { level: 1, text: plain })]);
    expect(text).toContain(plain);
  }, 30000);
});
