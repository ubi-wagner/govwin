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
  // The rest of the run-formatting common to Word / PowerPoint / Excel / PDF, so
  // every primitive can carry the full set (NodeStyle extends FontSpec).
  underline?: boolean;
  strikethrough?: boolean;
  highlight?: string;   // hex background/highlight color, e.g. '#FFFF00'
}

// ─── Canvas rules (from volume_required_items) ──────────────────────

export type CanvasFormat = 'letter' | 'slide_16_9' | 'slide_4_3' | 'custom' | 'spreadsheet';

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
  /** Minimum allowed body font size (pt) — the RFP compliance floor (E2/E4). */
  min_font_size?: number;
  /** Whether images/figures are permitted in this artifact (E2/E4). */
  images_allowed?: boolean;
  /** Image dimension ceilings, in canvas units (E2/E4). */
  image_max_width?: number;
  image_max_height?: number;
  watermark?: { text: string; color?: string; opacity?: number };
}

/**
 * ComplianceSpec — the typed, enforceable compliance contract for one artifact,
 * frozen onto `proposal_artifacts.compliance_spec` at purchase (E2) and checked
 * by `validateCanvasAgainstSpec` at save/export (E4). Distinct from CanvasRules
 * (the format/layout spec): this is the set of *limits the content must satisfy*.
 * A null limit means "unconstrained / not specified by the RFP".
 */
export interface ComplianceSpec {
  max_pages: number | null;
  max_slides: number | null;
  min_font_size: number | null;
  images_allowed: boolean;
  required_sections: string[];
  header_required: boolean;
  footer_required: boolean;
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
  spreadsheet: {
    format: 'spreadsheet' as CanvasFormat,
    width: 1200, height: 800,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    header: null, footer: null,
    font_default: { family: 'Calibri', size: 11 },
    line_spacing: 1.0,
    max_pages: null, max_slides: null,
  },
  custom: {
    format: 'custom' as CanvasFormat,
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: null, footer: null,
    font_default: { family: 'Times New Roman', size: 12 },
    line_spacing: 1.15,
    max_pages: null, max_slides: null,
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
  | 'spacer'
  // Extended element types (Word/PPT/Excel/PDF common set):
  | 'shape'          // rectangle/ellipse/line/arrow/… with fill+border+opacity
  | 'text_box'       // a free-positioned content box (does NOT snap to margins)
  | 'callout'        // info/warning/tip/note box
  | 'code_block'     // monospace code
  | 'blockquote'     // quote / pull-quote
  | 'chart'          // bar/line/pie/…
  | 'equation'       // math (LaTeX/MathML)
  | 'divider'        // horizontal rule
  | 'video'          // embedded media
  | 'signature';     // signature block (→ vault/contract future)

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

export interface TableCellStyle {
  bg?: string;           // hex color for cell background
  bold?: boolean;
  alignment?: 'left' | 'center' | 'right';
  border?: 'none' | 'thin' | 'thick';
}

export interface TableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
  style?: TableCellStyle;
  formula?: string;
  number_format?: string;
  cell_type?: 'text' | 'number' | 'currency' | 'percent' | 'formula';
  value?: number | null;
}

export interface TableContent {
  headers: (string | TableCell)[];
  rows: (string | TableCell)[][];
  column_widths?: number[];
  header_style?: TableCellStyle;
  border_style?: 'none' | 'single' | 'double';
  sheet_name?: string;
  is_spreadsheet?: boolean;
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

// ─── Extended element content ───────────────────────────────────────

export type ShapeKind =
  | 'rectangle' | 'rounded_rectangle' | 'ellipse' | 'triangle'
  | 'line' | 'arrow' | 'star' | 'diamond' | 'callout_bubble';

export interface ShapeContent {
  shape: ShapeKind;
  text?: string;                 // optional text inside the shape
}

/** A free-positioned content box (rectangle that does NOT snap to margins). Positioning
 *  lives on node.position; look (fill/border/opacity/radius) lives on node.style. */
export interface TextBoxContent {
  text: string;
  inline_formats?: TextBlockContent['inline_formats'];
}

export interface CalloutContent {
  variant: 'info' | 'warning' | 'tip' | 'success' | 'note';
  title?: string;
  text: string;
  icon?: string;
}

export interface CodeBlockContent {
  code: string;
  language?: string;
}

export interface BlockquoteContent {
  text: string;
  cite?: string;
}

export interface ChartContent {
  chart_type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'doughnut';
  categories: string[];
  series: Array<{ name: string; data: number[]; color?: string }>;
  title?: string;
}

export interface EquationContent {
  latex?: string;
  mathml?: string;
  display?: boolean;             // block (true) vs inline (false)
}

export interface DividerContent {
  thickness?: number;
  color?: string;
  line_style?: 'solid' | 'dashed' | 'dotted';
}

export interface VideoContent {
  storage_key?: string;
  url?: string;
  poster?: string;               // poster image storage key
  caption?: string;
}

export interface SignatureContent {
  label?: string;                // e.g. "Authorized Representative"
  signer_name?: string;
  signer_email?: string;
  signed?: boolean;
  signed_at?: string;
  document_ref?: string;         // the agreement being signed (vault/contract future)
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
  | ShapeContent
  | TextBoxContent
  | CalloutContent
  | CodeBlockContent
  | BlockquoteContent
  | ChartContent
  | EquationContent
  | DividerContent
  | VideoContent
  | SignatureContent
  | null;

// ─── Node comments (collaborative annotations) ─────────────────────

export interface NodeComment {
  id: string;
  actor_id: string;
  actor_name: string;
  text: string;
  timestamp: string;
  resolved?: boolean;
  resolved_by?: string;
}

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

/** Box fill (shapes, content boxes, callouts) with transparency. */
export interface BoxFill {
  color?: string;
  opacity?: number;    // 0..1 (transparency — "easy peasy")
}

/** Box outline/border (shapes, content boxes, images) with radius + transparency. */
export interface BoxBorder {
  color?: string;
  width?: number;      // pt
  style?: 'solid' | 'dashed' | 'dotted' | 'none';
  radius?: number;     // rounded corners, pt
  opacity?: number;    // 0..1
}

/** Free positioning for a content box / shape / image that does NOT snap to the
 *  text margins — like Word's "in front of / behind / with text wrap" options. */
export interface NodePosition {
  x?: number;          // inches from the page/content-left
  y?: number;          // inches from the top
  w?: number;
  h?: number;
  z?: number;          // stacking order (bring to front/back)
  wrap?: 'inline' | 'float' | 'behind' | 'front';
}

export interface NodeStyle extends Partial<FontSpec> {
  alignment?: 'left' | 'center' | 'right' | 'justify';
  indent?: number;
  space_before?: number;
  space_after?: number;
  // ── box / shape / image look (the ribbon's Shape Format tab) ──
  fill?: BoxFill;
  border?: BoxBorder;
  opacity?: number;    // whole-node transparency 0..1 (shapes + images)
  shadow?: boolean;
  rotation?: number;   // degrees
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
  comments?: NodeComment[];
  library_eligible: boolean;
  library_tags?: string[];
  // Free placement (content boxes / shapes / floating images that don't snap to
  // the text margins). Absent ⇒ normal in-flow layout.
  position?: NodePosition;
}

// ─── Section layer (v2) — Section → Group → Node ────────────────────
//
// The section layer sits between the frame (CanvasRules) and the atoms
// (CanvasNode). It carries LAYOUT INTENT — a section flows across pages,
// stays on one page (keep_together), or is pinned to slide coordinates —
// so pagination is measured, not hacked with forced `page_break` nodes.
// See docs/CANVAS_GEOMETRY_REDESIGN.md §5. Fully backward-compatible: a v1
// flat `nodes[]` lifts into one flow section (toSections), and the exporters
// keep the flat-node path untouched for docs with no `sections`.

/** How a section (or pinned group) occupies the frame. */
export interface SectionLayout {
  /** flow: reflow across pages · keep_together: never split · pinned: placed by box (slides). */
  mode: 'flow' | 'keep_together' | 'pinned';
  /** Force a new page/slide at the section start (replaces the page_break-as-content hack). */
  break_before?: boolean;
  /** Soft page target (documents) — drives the page-fill gauge + reflow, never a hard cut. */
  page_budget?: number;
  /** Absolute placement (slides / pinned blocks only); ignored for flow document sections. */
  box?: { page: number; x: number; y: number; w: number; h: number };
}

/**
 * A group of nodes inside a section. Optionally instantiates a library atom
 * (`atom_ref`) — e.g. a "Team Bios" group whose members are individual bio
 * atoms — and can be marked `keep_together` (don't split across a page/slide).
 */
export interface CanvasGroup {
  id: string;
  label?: string;
  keep_together?: boolean;
  atom_ref?: string;
  nodes: CanvasNode[];
}

/**
 * A first-class section: an ordered set of groups with a layout intent. Maps
 * to a mold / compliance-matrix element via `section_type` (the `vol`), and
 * remembers the library atoms it was assembled from (`source_atom_ids`) for
 * the harvest-with-lineage loop.
 */
export interface CanvasSection {
  id: string;
  title?: string;
  section_type?: string;
  layout: SectionLayout;
  groups: CanvasGroup[];
  source_atom_ids?: string[];
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
  /** 1 = flat `nodes[]` (legacy) · 2 = section layer present. Both render. */
  version: 1 | 2;
  document_id: string;
  canvas: CanvasRules;
  /**
   * Flat node list. The canonical content for v1 docs; for a v2 doc it may be
   * empty ([]) with content living under `sections`. Readers wanting a flat
   * view of either shape should use `docNodes(doc)`.
   */
  nodes: CanvasNode[];
  /** Section layer (v2). Present ⇒ exporters walk sections→groups→nodes. */
  sections?: CanvasSection[];
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
  for (const node of docNodes(doc)) {
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
      const cellText = (c: string | TableCell): string => typeof c === 'string' ? c : c.text;
      return [...t.headers.map(cellText), ...t.rows.flat().map(cellText)].join(' ');
    }
    default: return '';
  }
}

function flattenListItems(items: ListContent['items']): string {
  return items.map((i) => i.text + (i.children ? ' ' + flattenListItems(i.children) : '')).join(' ');
}

// ─── Section-layer helpers (v1 ⇄ v2 bridge) ─────────────────────────

/** First heading's text in a node run (for a lifted section title). */
function firstHeadingText(nodes: CanvasNode[]): string | undefined {
  const h = nodes.find((n) => n.type === 'heading');
  return h ? (h.content as HeadingContent).text : undefined;
}

/**
 * Normalize any CanvasDocument to a section list. A v2 doc returns its
 * `sections` as-is; a v1 doc lifts its flat `nodes[]` into flow sections,
 * splitting on `page_break` (each break ⇒ the next section carries
 * `break_before`), so a legacy doc renders identically through the
 * section-aware path. A doc with neither yields one empty flow section.
 */
export function toSections(doc: CanvasDocument): CanvasSection[] {
  if (doc.sections && doc.sections.length) return doc.sections;
  const sections: CanvasSection[] = [];
  let current: CanvasNode[] = [];
  let breakBefore = false;
  const flush = () => {
    if (current.length === 0) return;
    sections.push({
      id: crypto.randomUUID(),
      title: firstHeadingText(current),
      layout: { mode: 'flow', ...(breakBefore ? { break_before: true } : {}) },
      groups: [{ id: crypto.randomUUID(), nodes: current }],
    });
    current = [];
  };
  for (const n of doc.nodes ?? []) {
    if (n.type === 'page_break') { flush(); breakBefore = true; continue; }
    current.push(n);
  }
  flush();
  if (sections.length === 0) {
    sections.push({ id: crypto.randomUUID(), layout: { mode: 'flow' }, groups: [{ id: crypto.randomUUID(), nodes: [] }] });
  }
  return sections;
}

/** Flatten a section list to its content nodes (no synthetic breaks). */
export function sectionsToNodes(sections: CanvasSection[]): CanvasNode[] {
  return sections.flatMap((s) => s.groups.flatMap((g) => g.nodes));
}

/** A flat node view of either doc shape (v2 sections flattened, else `nodes`). */
export function docNodes(doc: CanvasDocument): CanvasNode[] {
  return doc.sections && doc.sections.length ? sectionsToNodes(doc.sections) : (doc.nodes ?? []);
}

/**
 * Normalize any doc into a FLAT, editable v1 doc for the canvas editor (which
 * edits `nodes`). A v1 doc passes through untouched. A v2 doc flattens its
 * sections→groups→nodes so its content is visible + editable — documents flow
 * (no synthetic breaks; the flat exporter paginates naturally), slides keep
 * their boundaries (a `page_break` is inserted between section-slides so the
 * slide editor still splits correctly). Re-sectioning happens at export
 * (`assembleArtifactCanvas` / `coalesceGroups`), so edit-flat → export-flowed
 * round-trips.
 */
export function toEditableFlat(doc: CanvasDocument): CanvasDocument {
  if (!doc.sections || doc.sections.length === 0) return doc;
  const isSlide = doc.canvas?.format === 'slide_16_9' || doc.canvas?.format === 'slide_4_3';
  let nodes: CanvasNode[];
  if (isSlide) {
    nodes = [];
    doc.sections.forEach((s, i) => {
      if (i > 0) nodes.push({ id: crypto.randomUUID(), type: 'page_break', content: null, style: {}, provenance: { source: 'template' }, history: [], library_eligible: false });
      nodes.push(...s.groups.flatMap((g) => g.nodes));
    });
  } else {
    nodes = sectionsToNodes(doc.sections);
  }
  return { ...doc, version: 1, nodes, sections: undefined };
}

/** Build a group from nodes (optionally a labeled, keep-together, atom-backed group). */
export function createGroup(
  nodes: CanvasNode[],
  opts: { label?: string; keepTogether?: boolean; atomRef?: string } = {},
): CanvasGroup {
  return {
    id: crypto.randomUUID(),
    ...(opts.label ? { label: opts.label } : {}),
    ...(opts.keepTogether ? { keep_together: true } : {}),
    ...(opts.atomRef ? { atom_ref: opts.atomRef } : {}),
    nodes,
  };
}

/**
 * Lift a v1 flat-node document into a v2 FLOW document: split on `page_break`
 * into sections but DROP the forced breaks (mode `flow`, no `break_before`) so
 * content runs continuously, and auto-coalesce each figure/table (with its
 * following caption) into a `keep_together` group so it never splits. This is
 * the mechanical "retire the page-break hack" upgrade — the same operation the
 * annotation atomizer and any v1→v2 content migration reuse. A doc already
 * carrying `sections` is returned unchanged.
 */
export function liftToFlowSections(doc: CanvasDocument): CanvasDocument {
  if (doc.sections && doc.sections.length) return doc;
  const chunks: CanvasNode[][] = [];
  let cur: CanvasNode[] = [];
  for (const n of doc.nodes ?? []) {
    if (n.type === 'page_break') { if (cur.length) chunks.push(cur); cur = []; continue; }
    cur.push(n);
  }
  if (cur.length) chunks.push(cur);
  if (chunks.length === 0) chunks.push([]);

  const sections: CanvasSection[] = chunks.map((chunk) => {
    const groups = coalesceGroups(chunk);
    if (groups.length === 0) groups.push({ id: crypto.randomUUID(), nodes: [] });
    return { id: crypto.randomUUID(), title: firstHeadingText(chunk), layout: { mode: 'flow' }, groups };
  });
  return { ...doc, version: 2, nodes: [], sections };
}

/**
 * Coalesce a flat node run into groups: each image/table (plus its following
 * caption) becomes its own `keep_together` group so a figure never splits from
 * its caption; runs of other nodes flow together in a plain group. Shared by
 * `liftToFlowSections` and the export assembly (each mold → one flow section).
 */
export function coalesceGroups(nodes: CanvasNode[]): CanvasGroup[] {
  const groups: CanvasGroup[] = [];
  let buf: CanvasNode[] = [];
  const flush = () => { if (buf.length) { groups.push({ id: crypto.randomUUID(), nodes: buf }); buf = []; } };
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.type === 'image' || n.type === 'table') {
      flush();
      const grp = [n];
      if (nodes[i + 1]?.type === 'caption') { grp.push(nodes[i + 1]); i++; }
      groups.push({ id: crypto.randomUUID(), keep_together: true, nodes: grp });
    } else {
      buf.push(n);
    }
  }
  flush();
  return groups;
}

/** Build a section from groups (or a flat node run wrapped in one group). */
export function createSection(opts: {
  title?: string;
  sectionType?: string;
  layout?: Partial<SectionLayout>;
  groups?: CanvasGroup[];
  nodes?: CanvasNode[];
  sourceAtomIds?: string[];
}): CanvasSection {
  const groups = opts.groups ?? [createGroup(opts.nodes ?? [])];
  return {
    id: crypto.randomUUID(),
    ...(opts.title ? { title: opts.title } : {}),
    ...(opts.sectionType ? { section_type: opts.sectionType } : {}),
    layout: { mode: 'flow', ...opts.layout },
    groups,
    ...(opts.sourceAtomIds ? { source_atom_ids: opts.sourceAtomIds } : {}),
  };
}
