/**
 * Canvas selection model — the "selection is the verb" spine (fluid-canvas F0).
 *
 * A live text selection in the canvas is read from the DOM as a start/end node id
 * (each rendered node carries `data-node-id`). This PURE function maps that to the
 * document model: the contiguous run of nodes the selection spans, their aggregated
 * text, and the content groups they fall in — so a floating action (atomize /
 * regenerate / annotate) can target the right nodes without touching the DOM again.
 *
 * Pure + framework-free so it is unit-testable and shared by the renderer + toolbar.
 */
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { docNodes, getNodeText, toSections } from '@/lib/types/canvas-document';

export interface CanvasSelection {
  /** The node ids the selection spans, in document order. */
  nodeIds: string[];
  /** Aggregated plain text of the spanned nodes (blank lines between nodes). */
  text: string;
  /** Distinct content-group titles the spanned nodes belong to (page-break groups for a
   *  flat doc; section titles for a v2 doc). Drives multi-section actions later (F4). */
  groupTitles: string[];
  /** True when the selection is within a single node. */
  singleNode: boolean;
}

/**
 * Map a DOM-read start/end node id to the model. Order-independent (a user can drag
 * upward, so start may come after end). Returns null if either anchor is not a real
 * node in the doc (e.g. the selection started outside the canvas).
 */
export function selectionToModel(
  doc: CanvasDocument,
  startNodeId: string,
  endNodeId: string,
): CanvasSelection | null {
  const nodes = docNodes(doc);
  let a = nodes.findIndex((n) => n.id === startNodeId);
  let b = nodes.findIndex((n) => n.id === endNodeId);
  if (a < 0 || b < 0) return null;
  if (a > b) [a, b] = [b, a];

  const span = nodes.slice(a, b + 1);
  const nodeIds = span.map((n) => n.id);
  const text = span.map(getNodeText).filter((t) => t && t.trim()).join('\n\n');

  // Best-effort group titles — a v2 doc's sections, or the page-break groups a flat doc
  // lifts into. Used to say "this selection spans N sections" for multi-target actions.
  const nodeIdToGroup = new Map<string, string>();
  for (const s of toSections(doc)) {
    const title = s.title ?? '';
    for (const g of s.groups ?? []) for (const n of g.nodes ?? []) nodeIdToGroup.set(n.id, title);
  }
  const groupTitles = [...new Set(nodeIds.map((id) => nodeIdToGroup.get(id)).filter((t): t is string => !!t && !!t.trim()))];

  return { nodeIds, text, groupTitles, singleNode: nodeIds.length === 1 };
}

/** A short, human label for a selection (for the atomize dialog title default + toasts). */
export function selectionLabel(sel: CanvasSelection): string {
  const first = sel.text.split('\n')[0]?.trim() ?? '';
  return first.length > 60 ? `${first.slice(0, 57)}…` : first || `${sel.nodeIds.length} block(s)`;
}
