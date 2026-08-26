import { describe, it, expect } from 'vitest';
import { estimatePageCount } from '@/lib/types/canvas-document';

// The real narrative page metrics: US-Letter, 0.75in margins, a 26pt running header and footer,
// 11pt Times New Roman body, 1.06 declared line spacing — the SAME layout the .docx/.pdf exporter
// uses, so estimatePageCount must track the exported page count. Two things about this frame are
// easy to get wrong and were: the header and footer are drawn INSIDE the margins and take nothing
// from the content box, and the stylesheet floors leading at 1.28, so the declared 1.06 renders as
// 1.28 (B69 · B71).
const canvas = {
  format: 'letter', width: 612, height: 792,
  margins: { top: 54, right: 54, bottom: 54, left: 54 },
  header: { template: '', height: 26, font: { family: 'Times New Roman', size: 9 } },
  footer: { template: '', height: 26, font: { family: 'Times New Roman', size: 9 } },
  font_default: { family: 'Times New Roman', size: 11 },
  line_spacing: 1.06, max_pages: 7, max_slides: null,
};
let seq = 0;
const doc = (nodes: unknown[]) => ({ version: 1, document_id: 'd', canvas, metadata: {}, nodes }) as never;
const base = () => ({ id: `n${seq++}`, style: {}, provenance: { source: 'test' }, history: [], library_eligible: false });
const text = (chars: number) => ({ ...base(), type: 'text_block', content: { text: 'word '.repeat(Math.ceil(chars / 5)).slice(0, chars) } });
const heading = (t: string, level = 1) => ({ ...base(), type: 'heading', content: { text: t, level } });
const table = (rows: number) => ({ ...base(), type: 'table', content: { headers: [{ text: 'a' }, { text: 'b' }], rows: Array.from({ length: rows }, () => [{ text: 'x' }, { text: 'y' }]) } });
const chart = () => ({ ...base(), type: 'chart', content: { chart_type: 'bar', categories: [], series: [] } });
const pageBreak = () => ({ ...base(), type: 'page_break', content: {} });

describe('estimatePageCount — height model tracks the exported docx', () => {
  it('an empty document is one page', () => {
    expect(estimatePageCount(doc([]))).toBe(1);
  });

  it('is MONOTONIC in prose (the old char-heuristic barely moved as content grew)', () => {
    const p1 = estimatePageCount(doc([text(3000)]));
    const p2 = estimatePageCount(doc([text(3000), text(3000), text(3000)]));
    const p3 = estimatePageCount(doc([text(3000), text(3000), text(3000), text(3000), text(3000), text(3000)]));
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });

  it('~4700 chars of body text is one page; ~9000 is two', () => {
    // The old numbers here (632pt of usable height, 1.06 leading) were the two defects this frame
    // was carrying, not the frame: the running header and footer do NOT come out of the content
    // box — Chromium draws them in the margins — and canvas-html floors line-height at 1.28, so
    // 11pt body sets on 14.08pt leading, never 11.66 (bug log B69 · B71).
    // Corrected: usable 504×684pt, 48 lines of ~101 characters ≈ 4,850 characters a page.
    expect(estimatePageCount(doc([text(4700)]))).toBe(1);
    expect(estimatePageCount(doc([text(9000)]))).toBe(2);
  });

  it('headings, tables, and figures consume real vertical space beyond their text', () => {
    const textOnly = estimatePageCount(doc([text(4500)]));
    const withFurniture = estimatePageCount(doc([text(4500), chart(), table(16)]));
    expect(withFurniture).toBeGreaterThan(textOnly);
  });

  it('a page_break advances to a fresh page', () => {
    expect(estimatePageCount(doc([text(200), pageBreak(), text(200)]))).toBe(2);
  });

  it('CALIBRATION: a full 11pt narrative (~25k chars over 15 headed sections + 4 tables + a chart) reads 7–9 pages, NOT ~6', () => {
    const nodes: unknown[] = [];
    for (let i = 1; i <= 15; i++) { nodes.push(heading(`${i}. Section Heading`)); nodes.push(text(1700)); }
    nodes.push(table(8), table(17), table(6), table(6), chart());
    const pages = estimatePageCount(doc(nodes));
    expect(pages).toBeGreaterThanOrEqual(7);
    expect(pages).toBeLessThanOrEqual(9);
  });
});
