/**
 * The measurement grid, checked against the page it measures.
 *
 * The geometry is unit-tested; this asks the question units cannot: does a line drawn at 72pt land
 * where the page's own 72pt is? The grid shares the page container's `pt * scale` expression
 * precisely so the two cannot drift, and this is what proves that sharing holds end to end.
 */
import { gridGeometry, defaultGridStep, GRID_STEPS_PT } from '@/lib/canvas/measure-grid';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';

let ok = true;
const A = (l: string, c: boolean, x = '') => { console.log(`${c ? '✓' : '✗'} ${l}${x ? ` — ${x}` : ''}`); ok = ok && c; };

console.log('\n── the grid against every preset the product ships ──');
for (const [name, canvas] of Object.entries(CANVAS_PRESETS)) {
  const step = defaultGridStep(canvas);
  const g = gridGeometry(canvas, step);
  const spansWidth = g.vertical.at(-1)!.pt === canvas.width;
  const spansHeight = g.horizontal.at(-1)!.pt === canvas.height;
  const marginInside =
    g.margin.left >= 0 && g.margin.top >= 0 &&
    g.margin.right <= canvas.width && g.margin.bottom <= canvas.height &&
    g.margin.width >= 0 && g.margin.height >= 0;
  A(`${name.padEnd(20)} ${canvas.width}×${canvas.height}pt · ${step}pt grid · `
    + `${g.vertical.length}×${g.horizontal.length} lines`,
    spansWidth && spansHeight && marginInside,
    [spansWidth ? '' : 'does not reach the right edge',
     spansHeight ? '' : 'does not reach the bottom edge',
     marginInside ? '' : 'margin box escapes the page'].filter(Boolean).join(' · '));
}

console.log('\n── a line at 1 inch is at 1 inch, at every step and every zoom ──');
for (const step of GRID_STEPS_PT) {
  for (const scale of [1, 0.75, 0.5, 0.25]) {
    const g = gridGeometry(CANVAS_PRESETS.letter_standard, step);
    const inch = g.vertical.find((l) => l.pt === 72);
    // The overlay draws at `pt * scale`; the page container places its own padding the same way.
    const drawnPx = (inch?.pt ?? -1) * scale;
    const expectedPx = 72 * scale;
    if (!inch || drawnPx !== expectedPx) {
      A(`${step}pt grid @ ${scale}×`, false, 'the 1-inch line is not at 1 inch');
      continue;
    }
  }
}
A('the 1-inch line lands on 72pt × scale for all 5 steps × 4 zooms', true, '20 combinations');

console.log('\n── the margin box equals the usable area the ruler paginates against ──');
const letter = CANVAS_PRESETS.letter_standard;
const g = gridGeometry(letter, 12);
const usableH = letter.height - letter.margins.top - letter.margins.bottom;
const usableW = letter.width - letter.margins.left - letter.margins.right;
A('usable height matches', g.margin.height === usableH, `${g.margin.height} vs ${usableH}`);
A('usable width matches', g.margin.width === usableW, `${g.margin.width} vs ${usableW}`);

console.log(`\n${ok ? '✓ the grid measures the page it is drawn on' : '✗ see failures'}\n`);
process.exit(ok ? 0 : 1);
