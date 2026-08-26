/**
 * The emulated-Claude drafter must keep exercising the CANVAS, not just prose (#148).
 *
 * Context. The canvas vocabulary is 22 node types. The emulator used to emit three — heading,
 * text_block, bulleted_list — so every "AI flows proven end-to-end" run drove the narrowest
 * possible slice: the paginator, the docx/pptx/xlsx writers, the image inliner and
 * `validateCanvasAgainstSpec`'s image and per-section budgets were never reached THROUGH an AI
 * flow. Widening the drafter is what makes those paths testable at all.
 *
 * Why this test is a SOURCE assertion rather than a behavioural one: the emulator is a standalone
 * HTTP harness, not an importable module, and the failure being guarded against is structural —
 * the primitive schedule quietly narrowing until images stop being emitted. That already happened
 * once: the first version keyed the plan off the section title and read its bits as flags, and
 * because `sectionTitleFrom` legitimately falls back to the literal 'Section', the whole corpus
 * collapsed onto one plan whose bits cleared both `figure` and `table`. It still reported eight
 * node types, so it LOOKED like coverage while emitting no images at all.
 *
 * The assertion below is the thing that would have caught it: walking the whole schedule must
 * exercise every primitive. Coverage becomes a property of the table, not a hope about how a hash
 * happens to distribute.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../scripts/test-harness/emulated-claude.mjs');
const src = fs.readFileSync(SRC, 'utf8');

/** Pull the literal schedule out of the harness source and parse it. */
function schedule(): Array<Record<string, boolean>> {
  const block = src.match(/const PRIMITIVE_SCHEDULE = \[([\s\S]*?)\n\];/)?.[1];
  if (!block) throw new Error('PRIMITIVE_SCHEDULE not found — did the exerciser get renamed?');
  return block
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => {
      const row: Record<string, boolean> = {};
      for (const m of l.matchAll(/(\w+):\s*(true|false)/g)) row[m[1]] = m[2] === 'true';
      return row;
    });
}

const FLAGS = ['figure', 'table', 'chart', 'callout', 'quote', 'numbered'] as const;

describe('emulated drafter — canvas primitive coverage', () => {
  const rows = schedule();

  it('the schedule has entries', () => {
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });

  it.each(FLAGS)('some scheduled plan emits %s', (flag) => {
    // The exact regression: a schedule where this is false everywhere emits that primitive never,
    // while still reporting a healthy-looking node-type count from the ones that remain.
    expect(rows.some((r) => r[flag] === true)).toBe(true);
  });

  it('is UNEVEN — not every plan carries every primitive', () => {
    // A corpus where every section has a figure tests the writers no better than one where none
    // does. Real proposals are mixed; the schedule has to be too.
    expect(rows.some((r) => FLAGS.some((f) => r[f] === false))).toBe(true);
  });

  it('keys the plan on the whole prompt, not the section title alone', () => {
    // The original bug in one line. `primitivePlanFor(title)` collapses whenever the title does.
    expect(src).not.toMatch(/primitivePlanFor\(title\)/);
    expect(src).toMatch(/primitivePlanFor\(`\$\{title\}\|/);
  });

  it('is deterministic — no Math.random in the harness', () => {
    // A harness whose output changes run to run cannot be used to decide anything, and the four
    // lenses would report drift that is the instrument rather than the product.
    // Match a CALL, not the words — the first version of this regex matched the harness's own
    // comment saying "never Math.random" and failed on prose.
    expect(src).not.toMatch(/Math\.random\s*\(/);
  });

  it('still emits the image node type at all', () => {
    expect(src).toMatch(/type: 'image'/);
    expect(src).toMatch(/type: 'table'/);
    expect(src).toMatch(/type: 'chart'/);
  });
});
