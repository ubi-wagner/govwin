/**
 * Atom size — the currency shared between an atom and a section mold. Pure (no DB),
 * so it's safe in client bundles and unit tests. An atom's words/chars are directly
 * comparable to a section mold's word budget (lib/section-budget); the physical
 * estimate (lines/inches/pages) drives fit against slide/free-form molds.
 */

import { wordsPerPage } from '@/lib/section-budget';
import type { CanvasNode } from '@/lib/types/canvas-document';

export interface AtomSize {
  words: number;
  chars: number;
  estLines: number;
  estHeightIn: number;
  estPages: number;
}

function textOfNodes(nodes: CanvasNode[] | null | undefined): string {
  if (!Array.isArray(nodes)) return '';
  const parts: string[] = [];
  for (const n of nodes) {
    const c = n?.content as unknown as Record<string, unknown> | undefined;
    if (!c) continue;
    if (typeof c.text === 'string') parts.push(c.text);
    if (Array.isArray(c.items)) for (const it of c.items) { const t = (it as { text?: unknown })?.text; if (typeof t === 'string') parts.push(t); }
    if (Array.isArray(c.rows)) for (const row of c.rows as unknown[]) if (Array.isArray(row)) for (const cell of row) parts.push(typeof cell === 'string' ? cell : String((cell as { text?: unknown })?.text ?? ''));
  }
  return parts.join(' ');
}

export function wordChar(content?: string | null, nodes?: CanvasNode[] | null): { words: number; chars: number } {
  const text = (content ?? '') || textOfNodes(nodes);
  const trimmed = text.trim();
  return { words: trimmed ? trimmed.split(/\s+/).length : 0, chars: text.length };
}

/** Physical + content size, comparable to a section mold's budget. */
export function atomSize(input: { content?: string | null; canvasNodes?: CanvasNode[] | null; fontSize?: number; lineSpacing?: number; widthIn?: number }): AtomSize {
  const { words, chars } = wordChar(input.content, input.canvasNodes);
  const fs = input.fontSize && input.fontSize >= 6 && input.fontSize <= 24 ? input.fontSize : 12;
  const ls = input.lineSpacing && input.lineSpacing >= 1 && input.lineSpacing <= 3 ? input.lineSpacing : 1;
  const widthIn = input.widthIn && input.widthIn > 0 ? input.widthIn : 6.5; // letter, 1" margins
  const charsPerInch = 120 / fs;                        // ~10/in at 12pt, more when smaller
  const charsPerLine = Math.max(1, Math.round(widthIn * charsPerInch));
  const estLines = Math.ceil(chars / charsPerLine) || 0;
  const lineHeightIn = (fs / 72) * ls;
  const estHeightIn = Math.round(estLines * lineHeightIn * 100) / 100;
  const estPages = Math.max(0, Math.round((words / wordsPerPage({ fontSize: fs, lineSpacing: ls })) * 100) / 100);
  return { words, chars, estLines, estHeightIn, estPages };
}
