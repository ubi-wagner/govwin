/**
 * CHAR_W — the ruler's average glyph advance, as a fraction of the font size.
 *
 * It has sat at 0.45 with the comment "calibrated to the exporter" and no measurement behind it.
 * That number decides how many characters fit on a line, so it multiplies into every prose height
 * in the product; and once the leading floor was corrected (B71) its slack stopped being invisible
 * and started showing as whole pages of over-count on prose-heavy documents.
 *
 * Method: lay real paragraphs out at a known column width, read the height back, divide by the
 * line height to get the line COUNT Chromium actually produced, and solve for the advance that
 * would predict it. Several texts, because the answer depends on the words: digits and capitals
 * are wider than lowercase, and a safe constant has to cover the widest of them, not the average.
 *
 *   npx tsx scripts/measure-char-width.mts
 */
import { renderCanvasToHtml } from '../lib/export/canvas-html';
import { resolveChromiumExecutable } from '../lib/export/chromium';
import { CANVAS_PRESETS, type CanvasDocument, type CanvasNode } from '../lib/types/canvas-document';

let seq = 0;
const node = (type: string, content: unknown): CanvasNode => ({
  id: `n${++seq}`, type, content, style: {}, provenance: { source: 'human' }, history: [],
} as unknown as CanvasNode);

const TEXTS: Array<{ label: string; text: string }> = [
  {
    label: 'technical prose (lowercase-heavy)',
    text: 'The additive manufacturing cell maintains a controlled thermal profile across the build volume, '
      + 'which keeps interlaminar shear strength within the qualification band for the full print. '.repeat(3),
  },
  {
    label: 'proposal boilerplate',
    text: 'The offeror certifies that the proposed effort does not duplicate work previously funded under any '
      + 'other Federal award, and that all key personnel identified in this volume are available to perform '
      + 'at the levels of effort stated in the cost volume for the full period of performance. '.repeat(2),
  },
  {
    label: 'ACRONYMS AND CAPITALS',
    text: 'SBIR STTR BAA OTA CSO NOFO DoD DoE NSF NASA NIH DARPA AFWERX SOCOM DIU TACFI STRATFI '
      + 'UEI CAGE SAM DUNS PIID FAR DFARS CDRL SOW WBS IMS EVMS TRL MRL IRAD CRADA. '.repeat(3),
  },
  {
    label: 'numbers and identifiers',
    text: 'Topic AF254-D001 requests 1,250 units at $18,400 each across 36 months (FY2026-FY2029), '
      + 'with 4,800 test coupons at 99.7% yield and 0.015 in. layer height at 210 C. '.repeat(3),
  },
  {
    label: 'long compound words',
    text: 'Interlaminar characterization thermomechanical qualification microstructural reproducibility '
      + 'photopolymerization multifunctionality electromechanical instrumentation standardization. '.repeat(3),
  },
];

async function main() {
  const { chromium } = await import('playwright');
  const executablePath = await resolveChromiumExecutable();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'], ...(executablePath ? { executablePath } : {}) });
  try {
    const implied: number[] = [];
    console.log('TEXT                                 FS   CHARS  LINES   chars/line   implied CHAR_W');
    console.log('─'.repeat(88));
    for (const fs of [10, 11, 12]) {
      const preset = { ...CANVAS_PRESETS.letter_standard, font_default: { family: 'Times New Roman', size: fs } };
      const usableW = preset.width - preset.margins.left - preset.margins.right;
      const lineH = fs * Math.max(preset.line_spacing, 1.28);
      const page = await browser.newPage({ viewport: { width: Math.round(usableW / 0.75), height: 900 } });
      for (const t of TEXTS) {
        // Repeat until the paragraph is ~40 lines. A 4-line sample quantises: 365 characters came
        // back as "4 lines" at 10pt AND at 12pt, which cannot both be true, and the implied advance
        // it produced was the rounding, not the font. Long paragraphs push that error under 3%.
        const text = t.text.trim().repeat(10);
        const doc = { version: 1, canvas: preset, nodes: [node('text_block', { text })] } as unknown as CanvasDocument;
        await page.setContent(renderCanvasToHtml(doc, {}), { waitUntil: 'domcontentloaded' });
        const px = await page.evaluate(() => (document.querySelector('p') as HTMLElement).getBoundingClientRect().height);
        const lines = Math.round((px * 0.75) / lineH);
        const chars = text.length;
        const perLine = chars / lines;
        const cw = usableW / (fs * perLine);
        implied.push(cw);
        console.log(`${t.label.padEnd(36)} ${String(fs).padStart(2)}  ${String(chars).padStart(6)}  ${String(lines).padStart(5)}   ${perLine.toFixed(1).padStart(10)}   ${cw.toFixed(3).padStart(14)}`);
      }
      await page.close();
    }
    const max = Math.max(...implied);
    const avg = implied.reduce((a, b) => a + b, 0) / implied.length;
    console.log(`\nwidest text needs CHAR_W ${max.toFixed(3)}; average ${avg.toFixed(3)}`);
    console.log('A safe constant covers the WIDEST — under it the ruler under-counts that text.');
  } finally {
    await browser.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
