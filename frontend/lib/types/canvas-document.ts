/**
 * Canvas Document types — the unified content model for all proposal
 * artifacts. Every document (Word, slides, PDF) is a JSON canvas
 * populated with typed atoms.
 *
 * See docs/CANVAS_DOCUMENT_ARCHITECTURE.md for the full design.
 */

import type { SourceAnchor } from './source-anchor';

// ─── Font specification ─────────────────────────────────────────────

export interface FontSpec {
  family: string;
  size: number;
  weight?: 'normal' | 'bold';
  style?: 'normal' | 'italic';
  color?: string;
}

// ─── Canvas rules (from volume_required_items) ──────────────────────

export type CanvasFormat = 'letter' | 'slide_16_9' | 'slide_4_3' | 'custom';

export interface CanvasRules {
  format: CanvasFormat;
  width: number;
  height: number;
  margins: { top: number; right: number; bottom: number; left: number };
  header: { template: string; height: number; font: FontSpec } | null;
  footer: { template: string; height: number; font: FontSpec } | null;
  font_default: FontSpec;
  line_spacing: number;
  max_pages: number | null;
  max_slides: number | null;
}

/** Standard presets derived from common RFP requirements. */
export const CANVAS_PRESETS: Record<string, CanvasRules> = {
  letter_standard: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: null, footer: null,
    font_default: { family: 'Times New Roman', size: 12 },
    line_spacing: 1.15,
    max_pages: null, max_slides: null,
  },
  letter_sbir_phase1: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: { template: '{topic_number} — {company_name}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    footer: { template: '{company_name} | Page {n} of {N}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    font_default: { family: 'Times New Roman', size: 10 },
    line_spacing: 1.0,
    max_pages: 15, max_slides: null,
  },
  letter_sbir_phase2: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: { template: '{topic_number} — {company_name}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    footer: { template: '{company_name} | Page {n} of {N}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    font_default: { family: 'Times New Roman', size: 12 },
    line_spacing: 1.0,
    max_pages: 30, max_slides: null,
  },
  slide_cso: {
    format: 'slide_16_9',
    width: 960, height: 540,
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    header: null, footer: null,
    font_default: { family: 'Arial', size: 18 },
    line_spacing: 1.2,
    max_pages: null, max_slides: 25,
  },
};

// ─── Node types ─────────────────────────────────────────────────────

export type NodeType =
  | 'heading'
  | 'text_block'
  | 'bulleted_list'
  | 'numbered_list'
  | 'image'
  | 'table'
  | 'caption'
  | 'footnote'
  | 'toc'
  | 'page_break'
  | 'url'
  | 'spacer';

export type NodeSource = 'ai_draft' | 'library' | 'manual' | 'imported' | 'template';

// ─── Node content (type-specific payloads) ──────────────────────────

export interface HeadingContent {
  level: 1 | 2 | 3;
  text: string;
  numbering?: string;
}

export interface TextBlockContent {
  text: string;
  inline_formats?: Array<{
    start: number;
    length: number;
    format: 'bold' | 'italic' | 'underline' | 'superscript' | 'subscript';
  }>;
}

export interface ListContent {
  items: Array<{
    text: string;
    indent_level?: number;
    children?: ListContent['items'];
  }>;
}

export interface ImageContent {
  storage_key: string;
  alt_text: string;
  width: number;
  height: number;
  caption?: string;
}

export interface TableContent {
  headers: string[];
  rows: string[][];
  column_widths?: number[];
}

export interface CaptionContent {
  prefix: 'Figure' | 'Table' | 'Chart';
  number: number;
  text: string;
}

export interface FootnoteContent {
  marker: string;
  text: string;
}

export interface TocContent {
  max_depth: 1 | 2 | 3;
}

export interface UrlContent {
  href: string;
  display_text: string;
}

export type NodeContent =
  | HeadingContent
  | TextBlockContent
  | ListContent
  | ImageContent
  | TableContent
  | CaptionContent
  | FootnoteContent
  | TocContent
  | UrlContent
  | null;

// ─── Node edit history ──────────────────────────────────────────────

export interface NodeEdit {
  actor_id: string;
  actor_name: string;
  action: 'created' | 'edited' | 'replaced' | 'moved' | 'accepted' | 'reverted';
  timestamp: string;
  previous_content?: string;
  comment?: string;
}

// ─── Node style overrides ───────────────────────────────────────────

export interface NodeStyle extends Partial<FontSpec> {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: number;
  space_before?: number;
  space_after?: number;
}

// ─── Canvas Node (the atom) ─────────────────────────────────────────

export interface CanvasNode {
  id: string;
  type: NodeType;
  content: NodeContent;
  style: NodeStyle;
  provenance: {
    source: NodeSource;
    library_unit_id?: string;
    source_anchor?: SourceAnchor;
    drafted_by?: string;
    drafted_at?: string;
  };
  history: NodeEdit[];
  library_eligible: boolean;
  library_tags?: string[];
}

// ─── Canvas Document ────────────────────────────────────────────────

export type DocumentStatus = 'empty' | 'ai_drafted' | 'in_progress' | 'review' | 'accepted';

export interface CanvasDocumentMetadata {
  title: string;
  volume_id: string;
  required_item_id: string;
  proposal_id: string;
  solicitation_id: string;
  created_at: string;
  last_modified_at: string;
  last_modified_by: string;
  version_number: number;
  status: DocumentStatus;
}

export interface CanvasDocument {
  version: 1;
  document_id: string;
  canvas: CanvasRules;
  nodes: CanvasNode[];
  metadata: CanvasDocumentMetadata;
}

// ─── Helpers ────────────────────────────────────────────────────────

/** Create a new empty canvas document from a required item's compliance. */
export function createEmptyCanvas(opts: {
  documentId: string;
  canvas: CanvasRules;
  metadata: CanvasDocumentMetadata;
}): CanvasDocument {
  return {
    version: 1,
    document_id: opts.documentId,
    canvas: opts.canvas,
    nodes: [],
    metadata: opts.metadata,
  };
}

/** Create a new node with a stable UUID. */
export function createNode(opts: {
  type: NodeType;
  content: NodeContent;
  source: NodeSource;
  actorId: string;
  actorName: string;
  style?: NodeStyle;
  libraryUnitId?: string;
  sourceAnchor?: SourceAnchor;
  libraryTags?: string[];
}): CanvasNode {
  return {
    id: crypto.randomUUID(),
    type: opts.type,
    content: opts.content,
    style: opts.style ?? {},
    provenance: {
      source: opts.source,
      library_unit_id: opts.libraryUnitId,
      source_anchor: opts.sourceAnchor,
      drafted_by: opts.actorId,
      drafted_at: new Date().toISOString(),
    },
    history: [{
      actor_id: opts.actorId,
      actor_name: opts.actorName,
      action: 'created',
      timestamp: new Date().toISOString(),
    }],
    library_eligible: opts.type !== 'page_break' && opts.type !== 'spacer' && opts.type !== 'toc',
    library_tags: opts.libraryTags,
  };
}

/** Compute approximate page count from nodes (for the progress bar). */
export function estimatePageCount(doc: CanvasDocument): number {
  const contentHeight = doc.canvas.height - doc.canvas.margins.top - doc.canvas.margins.bottom
    - (doc.canvas.header?.height ?? 0) - (doc.canvas.footer?.height ?? 0);
  const lineHeight = doc.canvas.font_default.size * doc.canvas.line_spacing;
  const linesPerPage = Math.floor(contentHeight / lineHeight);
  const charsPerLine = Math.floor(
    (doc.canvas.width - doc.canvas.margins.left - doc.canvas.margins.right)
    / (doc.canvas.font_default.size * 0.5)
  );

  let totalChars = 0;
  for (const node of doc.nodes) {
    if (node.type === 'page_break') { totalChars += linesPerPage * charsPerLine; continue; }
    if (node.type === 'spacer' || node.type === 'toc') continue;
    const text = getNodeText(node);
    totalChars += text.length + (charsPerLine * 2);
  }

  return Math.max(1, Math.ceil(totalChars / (linesPerPage * charsPerLine)));
}

/** Extract plain text from any node type (for search + page estimation). */
export function getNodeText(node: CanvasNode): string {
  if (!node.content) return '';
  switch (node.type) {
    case 'heading': return (node.content as HeadingContent).text;
    case 'text_block': return (node.content as TextBlockContent).text;
    case 'bulleted_list':
    case 'numbered_list':
      return flattenListItems((node.content as ListContent).items);
    case 'caption': return (node.content as CaptionContent).text;
    case 'footnote': return (node.content as FootnoteContent).text;
    case 'url': return (node.content as UrlContent).display_text;
    case 'table': {
      const t = node.content as TableContent;
      return [...t.headers, ...t.rows.flat()].join(' ');
    }
    default: return '';
  }
}

function flattenListItems(items: ListContent['items']): string {
  return items.map((i) => i.text + (i.children ? ' ' + flattenListItems(i.children) : '')).join(' ');
}
