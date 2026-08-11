import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readPptx } from '@/lib/import/pptx-reader';

/**
 * BOX-3 — the text parsers can't read visual content (a slide `<p:pic>` image, or a scanned
 * PDF page). Instead of silently dropping it, the reader emits an `unextractable` signal so the
 * UI can route the user to the box tool (Capture tab). Here: prove readPptx counts slide images
 * even when text still extracts, and stays quiet for a text-only deck.
 */

async function makePptx(slides: string[]): Promise<Buffer> {
  const zip = new JSZip();
  slides.forEach((xml, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, xml));
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

const slideText = `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Our technical approach to the program.</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
const slideTextPlusPic = `<p:sld><p:cSld><p:spTree>
  <p:sp><p:txBody><a:p><a:r><a:t>Figure 1 shows the print head.</a:t></a:r></a:p></p:txBody></p:sp>
  <p:pic><p:nvPicPr/><p:blipFill><a:blip r:embed="rId2"/></p:blipFill></p:pic>
</p:spTree></p:cSld></p:sld>`;

describe('BOX-3: readPptx flags <p:pic> images the text pass cannot read', () => {
  it('reports unextractable when a slide carries a picture — text still atomizes', async () => {
    const r = await readPptx(await makePptx([slideTextPlusPic]), 'deck.pptx');
    expect(r.atoms.length).toBeGreaterThan(0);            // the slide's text is still extracted
    expect(r.unextractable?.kind).toBe('slide_image');
    expect(r.unextractable?.count).toBe(1);
    expect(r.unextractable?.hint).toMatch(/Box an uploaded image|Capture/i);
  });

  it('counts pictures across multiple slides', async () => {
    const r = await readPptx(await makePptx([slideTextPlusPic, slideTextPlusPic, slideText]), 'deck.pptx');
    expect(r.unextractable?.count).toBe(2);
  });

  it('emits no signal for a text-only deck', async () => {
    const r = await readPptx(await makePptx([slideText]), 'deck.pptx');
    expect(r.unextractable).toBeUndefined();
  });
});
