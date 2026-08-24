/**
 * Z-order reaches the exported deck.
 *
 * In PowerPoint there is no z attribute on a shape — whatever is added last sits on top — so
 * honouring `position.z` means SORTING before emission. The pptx writer did not, and emitted in
 * document order, which silently dropped the arrangement an author made. The editor and the
 * HTML/PDF path both already honoured it (canvas-renderer, canvas-html), so the .pptx was the one
 * artifact where layering came back rearranged.
 *
 * THE CASES ARE CHOSEN SO THEY CAN FAIL. A first draft of this asserted "bring CHARLIE to front"
 * on a document where CHARLIE was already last, and "send ALPHA to back" where ALPHA was already
 * first — both passed against the UNFIXED writer, because the expected order was the order it
 * already emitted. Moving the FIRST node to the front and the LAST node to the back is the only
 * shape of test that distinguishes a writer which sorts from one which does not.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '@/lib/types/canvas-document';
import { exportToPptx } from '@/lib/export/pptx-exporter';

const node = (id: string, text: string, position?: unknown): CanvasNode => ({
  id, type: 'shape', content: { shape: 'rectangle', text }, style: { fill: { color: '#3366CC' } },
  position, provenance: { source: 'manual' }, history: [], library_eligible: false,
} as unknown as CanvasNode);

const deck = (nodes: CanvasNode[]): CanvasDocument => ({
  version: 1, canvas: { ...CANVAS_PRESETS.slide_deck }, metadata: { title: 'z' }, nodes,
} as unknown as CanvasDocument);

/** Emission order == the order the shape texts appear in the slide XML. */
async function emissionOrder(doc: CanvasDocument): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(await exportToPptx(doc, {})));
  const xml = await zip.files['ppt/slides/slide1.xml'].async('string');
  return ['ALPHA', 'BRAVO', 'CHARLIE']
    .filter((t) => xml.includes(t))
    .sort((a, b) => xml.indexOf(a) - xml.indexOf(b));
}

describe('pptx honours position.z as emission order', () => {
  it('keeps document order when no node declares a z', async () => {
    const order = await emissionOrder(deck([node('a', 'ALPHA'), node('b', 'BRAVO'), node('c', 'CHARLIE')]));
    expect(order).toEqual(['ALPHA', 'BRAVO', 'CHARLIE']);
  });

  it('moves the FIRST node last when it is brought to front', async () => {
    const order = await emissionOrder(deck([
      node('a', 'ALPHA', { z: 900 }), node('b', 'BRAVO'), node('c', 'CHARLIE'),
    ]));
    expect(order).toEqual(['BRAVO', 'CHARLIE', 'ALPHA']);
  });

  it('moves the LAST node first when it is sent to back', async () => {
    const order = await emissionOrder(deck([
      node('a', 'ALPHA'), node('b', 'BRAVO'), node('c', 'CHARLIE', { z: 1 }),
    ]));
    expect(order).toEqual(['CHARLIE', 'ALPHA', 'BRAVO']);
  });

  it('treats wrap:behind as the floor, below every un-layered node', async () => {
    const order = await emissionOrder(deck([
      node('a', 'ALPHA'), node('b', 'BRAVO'), node('c', 'CHARLIE', { wrap: 'behind' }),
    ]));
    expect(order).toEqual(['CHARLIE', 'ALPHA', 'BRAVO']);
  });

  it('is STABLE — equal z keeps document order, so an unlayered deck is never reshuffled', async () => {
    const order = await emissionOrder(deck([
      node('a', 'ALPHA', { z: 5 }), node('b', 'BRAVO', { z: 5 }), node('c', 'CHARLIE', { z: 5 }),
    ]));
    expect(order).toEqual(['ALPHA', 'BRAVO', 'CHARLIE']);
  });
});
