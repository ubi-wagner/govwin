import { describe, expect, it } from 'vitest';
import { atomSize } from '@/lib/atom-size';
import type { CanvasNode } from '@/lib/types/canvas-document';

const node = (type: string, content: unknown): CanvasNode => ({ type, content } as unknown as CanvasNode);

describe('atoms: size (the atom↔mold currency)', () => {
  it('counts words + chars from plain content', () => {
    const s = atomSize({ content: 'We deliver a robust autonomous system.' });
    expect(s.words).toBe(6);
    expect(s.chars).toBe('We deliver a robust autonomous system.'.length);
    expect(s.estLines).toBeGreaterThan(0);
    expect(s.estHeightIn).toBeGreaterThan(0);
  });

  it('counts words from canvas nodes when no plain content', () => {
    const nodes = [
      node('heading', { level: 1, text: 'Team' }),
      node('bulleted_list', { items: [{ text: 'Eric Wagner PI' }, { text: 'Two more' }] }),
    ];
    const s = atomSize({ canvasNodes: nodes });
    expect(s.words).toBe(6); // Team + "Eric Wagner PI"(3) + "Two more"(2)
  });

  it('empty content is zero-sized', () => {
    const s = atomSize({ content: '' });
    expect(s.words).toBe(0);
    expect(s.chars).toBe(0);
    expect(s.estPages).toBe(0);
  });

  it('physical size grows with content and shrinks with smaller font', () => {
    const long = 'word '.repeat(500).trim();
    const at12 = atomSize({ content: long, fontSize: 12 });
    const at9 = atomSize({ content: long, fontSize: 9 });
    expect(at12.words).toBe(500);
    // ~500 words ≈ 1 page at 12pt
    expect(at12.estPages).toBeGreaterThan(0.8);
    expect(at12.estPages).toBeLessThan(1.3);
    // smaller font packs more per line/page → fewer lines, fewer pages
    expect(at9.estLines).toBeLessThan(at12.estLines);
    expect(at9.estPages).toBeLessThan(at12.estPages);
  });

  it('double spacing roughly doubles physical height', () => {
    const text = 'word '.repeat(200).trim();
    const single = atomSize({ content: text, lineSpacing: 1 });
    const dbl = atomSize({ content: text, lineSpacing: 2 });
    expect(dbl.estHeightIn).toBeGreaterThan(single.estHeightIn * 1.8);
  });
});
