/**
 * measure-image-placeholder — read the real laid-out height of an image node from Chromium.
 *
 * The page ruler models an image by its DECLARED width/height. That is right when the image
 * resolves; it is wrong when `storage_key` is empty, because canvas-html then draws a dashed
 * box whose declared size acts as a `max-height` cap on one line of alt text (B68). The first
 * correction guessed the box from the CSS by hand and still over-counted by roughly double.
 *
 * Guessing twice is enough. This asks the renderer: lay the figures out, then report where each
 * one actually starts. The gap between consecutive figure tops IS the height the ruler must
 * advance — it already includes the border, the padding, the caption and any margin collapsing
 * between neighbours, none of which a by-hand reading of the stylesheet gets reliably right.
 *
 * Run: npx tsx scripts/measure-image-placeholder.mts
 */
import { renderCanvasToHtml } from '../lib/export/canvas-html';
import { resolveChromiumExecutable } from '../lib/export/chromium';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '../lib/types/canvas-document';

let seq = 0;
function node(type: CanvasNode['type'], content: unknown): CanvasNode {
  seq += 1;
  return { id: `n${seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [] } as unknown as CanvasNode;
}

type ImgSpec = { label: string; content: Record<string, unknown> };

const SPECS: ImgSpec[] = [
  { label: 'empty key, no declared size', content: { storage_key: '', alt_text: 'Figure 1. System architecture' } },
  { label: 'empty key, declared 900x520', content: { storage_key: '', alt_text: 'Figure 2. Build cell layout', width: 900, height: 520 } },
  { label: 'empty key, declared 640x180', content: { storage_key: '', alt_text: 'Figure 3. Thermal profile', width: 640, height: 180 } },
  { label: 'empty key, declared 320x60', content: { storage_key: '', alt_text: 'Figure 4. Legend', width: 320, height: 60 } },
  { label: 'empty key, no alt text', content: { storage_key: '', alt_text: '' } },
  { label: 'empty key + caption', content: { storage_key: '', alt_text: 'Figure 5. Coupon results', caption: 'Interlaminar shear strength by build orientation' } },
  { label: 'empty key, long alt (wraps)', content: { storage_key: '', alt_text: 'Figure 6. Interlaminar shear strength measured across all three build orientations for the qualification coupon set, sectioned and tested to ASTM D2344 with witness coupons retained for the full print campaign' } },
  { label: 's3 key (unresolvable, also a box)', content: { storage_key: 'tenants/x/uploads/diagram.png', alt_text: 'Figure 7. Flow diagram', width: 900, height: 520 } },
];

/** One document per spec: 12 identical figures, so per-figure advance is the top-to-top delta. */
function docOf(spec: ImgSpec): CanvasDocument {
  const preset = CANVAS_PRESETS.letter_standard;
  return {
    canvas: { ...preset },
    sections: [{
      id: 's1', title: 'Measurement',
      groups: [{ id: 'g1', nodes: Array.from({ length: 12 }, () => node('image', { ...spec.content })) }],
    }],
  } as unknown as CanvasDocument;
}

/**
 * The MARGINAL cost of a figure in a real document.
 *
 * A run of figures measures the collapsed gap between two figures; a mold interleaves them with
 * prose, and `p { margin: 0 0 7pt }` collapses against `figure`'s 12px differently than a figure
 * does against a figure. The ruler charges per node, so what it needs is the difference a figure
 * makes to the total — measured by rendering the same paragraphs with and without them.
 */
function mixedDoc(withFigures: boolean, content: Record<string, unknown>): CanvasDocument {
  const preset = CANVAS_PRESETS.letter_standard;
  const para = 'The additive manufacturing cell maintains a controlled thermal profile across the build volume, which keeps interlaminar shear strength within the qualification band.';
  const nodes: CanvasNode[] = [];
  for (let i = 0; i < 8; i++) {
    nodes.push(node('text_block', { text: para }));
    if (withFigures) nodes.push(node('image', { ...content }));
  }
  return {
    canvas: { ...preset },
    sections: [{ id: 's1', title: 'Mixed', groups: [{ id: 'g1', nodes }] }],
  } as unknown as CanvasDocument;
}

async function main() {
  const { chromium } = await import('playwright');
  const executablePath = await resolveChromiumExecutable();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(executablePath ? { executablePath } : {}) });
  const preset = CANVAS_PRESETS.letter_standard as unknown as { width: number; margins: { left: number; right: number } };
  const usableWpt = preset.width - preset.margins.left - preset.margins.right;
  console.log(`usable width ${usableWpt}pt (${(usableWpt / 0.75).toFixed(0)}px)\n`);
  try {
    const page = await browser.newPage({ viewport: { width: Math.round(usableWpt / 0.75), height: 900 } });
    for (const spec of SPECS) {
      const html = renderCanvasToHtml(docOf(spec), {});
      await page.setContent(html, { waitUntil: 'networkidle' });
      const geom = await page.evaluate(() => {
        const figs = Array.from(document.querySelectorAll('figure'));
        const tops = figs.map((f) => f.getBoundingClientRect().top);
        const boxes = figs.map((f) => f.getBoundingClientRect().height);
        const inner = figs.map((f) => {
          const el = f.firstElementChild as HTMLElement | null;
          return el ? el.getBoundingClientRect().height : 0;
        });
        return { tops, boxes, inner };
      });
      // Top-to-top deltas, skipping the first (which carries no collapsed neighbour above it).
      const deltas = geom.tops.slice(1).map((t, i) => t - geom.tops[i]);
      const uniq = Array.from(new Set(deltas.map((d) => d.toFixed(2))));
      const advancePx = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : geom.boxes[0];
      console.log(
        `${spec.label.padEnd(34)} inner ${geom.inner[0].toFixed(1).padStart(6)}px  figure ${geom.boxes[0].toFixed(1).padStart(6)}px`
        + `  advance ${advancePx.toFixed(2).padStart(7)}px = ${(advancePx * 0.75).toFixed(2).padStart(6)}pt`
        + (uniq.length > 1 ? `   (deltas vary: ${uniq.join(', ')})` : ''),
      );
    }

    console.log('\nmarginal cost of one figure interleaved with prose (8 paragraphs ± 8 figures):');
    const bodyHeight = async (doc: CanvasDocument) => {
      await page.setContent(renderCanvasToHtml(doc, {}), { waitUntil: 'networkidle' });
      return page.evaluate(() => document.body.getBoundingClientRect().height);
    };
    for (const spec of SPECS.slice(0, 3)) {
      const withF = await bodyHeight(mixedDoc(true, spec.content));
      const without = await bodyHeight(mixedDoc(false, spec.content));
      const perFig = (withF - without) / 8;
      console.log(`${spec.label.padEnd(34)} ${(perFig * 0.75).toFixed(2).padStart(6)}pt per figure`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
