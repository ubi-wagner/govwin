/**
 * paginate() — the measure engine (docs/CANVAS_GEOMETRY_REDESIGN.md §6).
 *
 * A pure, fast text-metrics estimate that lays the section layer into the frame
 * and REPORTS page usage — replacing the old forced-`page_break` hack. It is the
 * "live" fidelity that drives the in-editor page-fill gauge and per-section
 * budget bars; the authoritative count still comes from the real renderer
 * (Chromium + pdfjs) at export. Both read the same section model, so the gauge
 * and the download agree in shape.
 *
 * Documents only (letter/custom). Slides are one-section-per-slide by
 * construction and don't need flow measurement.
 */
import type {
  CanvasDocument,
  CanvasNode,
  CanvasSection,
  CanvasGroup,
  HeadingContent,
  TextBlockContent,
  ListContent,
  TableContent,
  ImageContent,
} from '@/lib/types/canvas-document';
import { toSections } from '@/lib/types/canvas-document';

export interface SectionPageInfo {
  id: string;
  title?: string;
  startPage: number;
  endPage: number;
  pagesUsed: number;
  /** budget set on the section, if any (soft target pages). */
  budget?: number;
  /** pagesUsed exceeds the section's own page_budget. */
  overBudget: boolean;
}

export interface LayoutResult {
  totalPages: number;
  perSection: SectionPageInfo[];
  /** the frame's max_pages cap and whether the layout exceeds it. */
  vsMaxPages: { max: number | null; over: boolean };
}

interface Metrics {
  usableHeight: number; // points of body height per page
  lineHeight: number;   // points per text line
  charsPerLine: number; // approx characters per body line
  fontSize: number;
}

function metricsOf(doc: CanvasDocument): Metrics {
  const c = doc.canvas;
  const width = c?.width ?? 612;
  const height = c?.height ?? 792;
  const m = c?.margins ?? { top: 72, right: 72, bottom: 72, left: 72 };
  const headerH = c?.header?.height ?? 0;
  const footerH = c?.footer?.height ?? 0;
  const fontSize = c?.font_default?.size ?? 12;
  const lineSpacing = c?.line_spacing ?? 1.15;
  const usableHeight = Math.max(1, height - m.top - m.bottom - headerH - footerH);
  const colWidth = Math.max(1, width - m.left - m.right);
  const lineHeight = fontSize * lineSpacing;
  // ~0.5em average glyph advance for proportional body faces.
  const charsPerLine = Math.max(1, Math.floor(colWidth / (fontSize * 0.5)));
  return { usableHeight, lineHeight, charsPerLine, fontSize };
}

/** Estimated rendered height (points) of one node. */
function nodeHeight(node: CanvasNode, mt: Metrics): number {
  const lh = mt.lineHeight;
  const wrap = (text: string) => Math.max(1, Math.ceil((text?.length ?? 0) / mt.charsPerLine));
  switch (node.type) {
    case 'heading': {
      const h = node.content as HeadingContent;
      const scale = h.level === 1 ? 1.6 : h.level === 2 ? 1.3 : 1.1;
      return wrap(h.text) * lh * scale + lh * 0.6; // line(s) + heading spacing
    }
    case 'text_block': {
      const t = node.content as TextBlockContent;
      return wrap(t.text) * lh + lh * 0.4;
    }
    case 'bulleted_list':
    case 'numbered_list': {
      const l = node.content as ListContent;
      const rows = (l.items ?? []).reduce((n, it) => n + wrap(it.text) + (it.children?.length ?? 0), 0);
      return Math.max(1, rows) * lh + lh * 0.4;
    }
    case 'table': {
      const t = node.content as TableContent;
      const rows = 1 + (t.rows?.length ?? 0);
      return rows * lh * 1.5 + lh * 0.6; // header + body rows, padded
    }
    case 'image': {
      const im = node.content as ImageContent;
      const h = im.height && im.height > 0 ? im.height : 180;
      return Math.min(h, mt.usableHeight) + (im.caption ? lh : 0) + lh * 0.6;
    }
    case 'caption':
    case 'footnote':
      return lh + lh * 0.3;
    case 'spacer':
      return node.style?.space_after ?? 12;
    case 'page_break':
      return 0; // handled at the flow level
    case 'toc':
    case 'url':
      return lh;
    default:
      return lh;
  }
}

function groupHeight(group: CanvasGroup, mt: Metrics): number {
  return (group.nodes ?? []).reduce((sum, n) => sum + nodeHeight(n, mt), 0);
}

/**
 * Lay sections into pages and report usage. `y` is points consumed on the
 * current page; a keep_together group/section that would straddle the page edge
 * moves wholesale to the next page (matching the exporters' break-inside:avoid).
 */
export function paginate(doc: CanvasDocument): LayoutResult {
  const mt = metricsOf(doc);
  const sections = toSections(doc);
  const perSection: SectionPageInfo[] = [];

  let page = 1;
  let y = 0; // points used on the current page

  const newPage = () => { page += 1; y = 0; };
  const advance = (h: number) => {
    // consume h points, spilling onto as many pages as needed.
    let remaining = h;
    if (y > 0 && y + remaining > mt.usableHeight) newPage();
    while (remaining > mt.usableHeight) { remaining -= mt.usableHeight; newPage(); }
    y += remaining;
  };
  const fitKeep = (h: number) => {
    // a keep-together block: if it doesn't fit the remaining space, move it whole.
    if (y > 0 && y + h > mt.usableHeight && h <= mt.usableHeight) newPage();
    advance(Math.min(h, mt.usableHeight));
    if (h > mt.usableHeight) y = Math.min(mt.usableHeight, y); // oversized keep: clamp
  };

  sections.forEach((section: CanvasSection, i) => {
    if (section.layout?.break_before && i > 0 && y > 0) newPage();
    const startPage = page;
    const sectionKeep = section.layout?.mode === 'keep_together';

    if (sectionKeep) {
      const total = (section.groups ?? []).reduce((s, g) => s + groupHeight(g, mt), 0);
      fitKeep(total);
    } else {
      for (const group of section.groups ?? []) {
        const gh = groupHeight(group, mt);
        if (group.keep_together) {
          fitKeep(gh);
        } else {
          for (const node of group.nodes ?? []) {
            if (node.type === 'page_break') { if (y > 0) newPage(); continue; }
            advance(nodeHeight(node, mt));
          }
        }
      }
    }

    const endPage = page;
    const budget = section.layout?.page_budget;
    const pagesUsed = endPage - startPage + 1;
    perSection.push({
      id: section.id,
      title: section.title,
      startPage,
      endPage,
      pagesUsed,
      budget,
      overBudget: typeof budget === 'number' && pagesUsed > budget,
    });
  });

  const totalPages = page;
  const max = doc.canvas?.max_pages ?? null;
  return { totalPages, perSection, vsMaxPages: { max, over: max != null && totalPages > max } };
}
