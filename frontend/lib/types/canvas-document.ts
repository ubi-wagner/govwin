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
  /** Character cap for a document the agency measures in characters, not pages (E2/E4). */
  max_characters?: number | null;
  /** Minimum allowed body font size (pt) — the RFP compliance floor (E2/E4). */
  min_font_size?: number;
  /** Whether images/figures are permitted in this artifact (E2/E4). */
  images_allowed?: boolean;
  /** Image dimension ceilings, in canvas units (E2/E4). */
  image_max_width?: number;
  image_max_height?: number;
  watermark?: { text: string; color?: string; opacity?: number };
  /** Deck/page background fill (hex, e.g. '#0F172A'). Painted behind content in the
   *  editor AND honored on export (pptx slide.background, html/pdf page). Slides mainly. */
  background?: string;
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
  /**
   * Character cap for the whole artifact. A large family of required documents is measured in
   * CHARACTERS rather than pages — SBIR cover-sheet abstracts, NSF project summaries, grants.gov
   * narrative fields — because the agency portal pastes them into a fixed-size form field and
   * truncates or refuses at the cap. `null` = unconstrained (the normal case for a paginated
   * volume). Per-section caps ride `SectionLayout.character_budget`.
   */
  max_characters?: number | null;
  /**
   * This proposal's OWN solicitation identifiers — its topic number, solicitation number, and
   * (once assigned) proposal number. Any labelled identifier in the document that is not one of
   * these is a different agency's, and the document is citing the wrong solicitation.
   *
   * The check exists because the leak is structural, not careless. A company's library is built
   * from its past proposals, and a past proposal's cover sheet and cost form legitimately carry
   * that solicitation's numbers — that IS the content of those pages, so it cannot be stripped at
   * ingest. Drafting grounds on those pages and carries the numbers across. Observed on the T3CP
   * build: a cost section for OSW26BZ04-DP013 opened "STTR Phase II Proposal Proposal Number
   * F2-17528 Topic Number AFX23D-TCSO1".
   *
   * Empty/absent = unchecked, so a build with no identifiers recorded behaves exactly as before.
   */
  own_identifiers?: string[];
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
  // ── Pristine collateral/agency presets — running header + page-numbered footer + figures enabled,
  //    so NSF/DOE narratives and marketing/commercialization/investment pieces carry proper page
  //    furniture (headers-footers, page numbers) and can hold banners/figure placeholders. ──
  letter_agency: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 72, right: 72, bottom: 72, left: 72 },
    header: { template: '{company_name} — {project_title}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    footer: { template: '{company_name}  |  Page {n} of {N}', height: 36, font: { family: 'Times New Roman', size: 10 } },
    font_default: { family: 'Times New Roman', size: 11 }, // NSF PAPPG 11pt floor
    line_spacing: 1.15,
    max_pages: null, max_slides: null,
    min_font_size: 11, images_allowed: true,
  },
  letter_collateral: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 64, right: 64, bottom: 64, left: 64 },
    header: { template: '{company_name}', height: 30, font: { family: 'Calibri', size: 9 } },
    footer: { template: '{company_name}  ·  {website}  |  Page {n} of {N}', height: 30, font: { family: 'Calibri', size: 9 } },
    font_default: { family: 'Calibri', size: 11 },
    line_spacing: 1.2,
    max_pages: null, max_slides: null,
    images_allowed: true,
  },
  letter_onepager: {
    format: 'letter',
    width: 612, height: 792,
    margins: { top: 54, right: 54, bottom: 48, left: 54 },
    header: null,
    footer: { template: '{company_name}  ·  {contact_email}  ·  {website}', height: 28, font: { family: 'Calibri', size: 9 } },
    font_default: { family: 'Calibri', size: 10.5 },
    line_spacing: 1.12,
    max_pages: 1, max_slides: null,
    images_allowed: true,
  },
  slide_deck: {
    format: 'slide_16_9',
    width: 960, height: 540,
    margins: { top: 40, right: 40, bottom: 48, left: 40 },
    header: null,
    footer: { template: '{company_name}  ·  {n} / {N}', height: 28, font: { family: 'Arial', size: 10 } },
    font_default: { family: 'Arial', size: 18 },
    line_spacing: 1.2,
    max_pages: null, max_slides: 25,
    images_allowed: true,
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

/** Slide frame dimensions (pt) by aspect: 16:9 widescreen (960×540) vs 4:3 standard
 *  (720×540). Same 540pt height, so switching aspect only reflows width — the canonical
 *  PowerPoint frames (13.333″×7.5″ / 10″×7.5″ at 72dpi). Used by the slide-frame control. */
export function slideFrame(format: 'slide_16_9' | 'slide_4_3'): { width: number; height: number } {
  return format === 'slide_4_3' ? { width: 720, height: 540 } : { width: 960, height: 540 };
}

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
  fg?: string;           // hex color for the cell TEXT (e.g. white on a dark branded header)
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
  /** gantt = horizontal timeline (series[0]=start month, series[1]=end month per category). */
  chart_type: 'bar' | 'line' | 'pie' | 'scatter' | 'area' | 'doughnut' | 'gantt';
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
  reuse_marker?: boolean; // imported from a prior proposal — rendered red italic
  background?: string;    // hex highlight (section-ribbon alias for `highlight`)
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
  /**
   * Hard character cap for this section, when the solicitation measures it in characters rather
   * than pages (a cover-sheet abstract, a project summary). Unlike `page_budget` this is not a
   * soft target: the agency's form field truncates at the cap, so exceeding it loses text.
   */
  character_budget?: number;
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

/**
 * Estimate the rendered page count of a paginated (page-flow) canvas document.
 *
 * This is the SINGLE page ruler the whole portal trusts — both the submission-readiness
 * page gate and the export compliance floor (validateCanvasAgainstSpec) call it — so it
 * MUST track the actual exported .docx/.pdf, which are laid out with these same page
 * metrics (page size, margins, header/footer, 11pt body, line spacing). It models real
 * VERTICAL HEIGHT per node type rather than a flat char total, because the old char-based
 * heuristic (text.length + 2 lines/node) was dominated by its per-node fudge and barely
 * moved as prose was added — so a genuinely 7.4-page narrative read as "6", and a
 * builder could sail past a hard page limit. Height model, calibrated so a real 11pt /
 * 0.75in-margin narrative matches Word to within a fraction of a page:
 *   - flow text (text_block, lists, caption, footnote, url): ceil(chars / charsPerLine) lines
 *   - heading: larger font (h1 ≈ 2.5×, h2 ≈ 1.45× body) + space before/after
 *   - table: (header + data rows) × 1.35 line-heights
 *   - image / chart: its declared height, else ~15.5 line-heights (a typical figure)
 *   - page_break: advance to a fresh page
 * Proportional-font average glyph width ≈ 0.45 × font size (Times New Roman body).
 */
/** Per-format usable geometry + flow metrics (points) — shared by the page, slide, and section rulers. */
function flowMetrics(c: CanvasDocument['canvas']) {
  const usableW = Math.max(1, c.width - c.margins.left - c.margins.right);
  const usableH = Math.max(1, c.height - c.margins.top - c.margins.bottom - (c.header?.height ?? 0) - (c.footer?.height ?? 0));
  const fs = c.font_default.size;
  const bodyLineH = fs * c.line_spacing;
  const CHAR_W = 0.45; // avg proportional glyph width as a fraction of font size (calibrated to the exporter)
  const cpl = Math.max(1, Math.floor(usableW / (fs * CHAR_W)));
  return { usableW, usableH, fs, bodyLineH, CHAR_W, cpl };
}

/** Vertical height (pt) a single node occupies in normal flow. page_break / toc contribute nothing. */
function nodeStackHeightPt(node: CanvasNode, m: ReturnType<typeof flowMetrics>): number {
  const { usableW, fs, bodyLineH, CHAR_W, cpl } = m;
  const linesFor = (chars: number, per: number) => Math.max(1, Math.ceil(chars / per));
  switch (node.type) {
    case 'page_break':
    case 'toc':
      return 0;
    case 'spacer': {
      const h = (node.content as { height?: number } | undefined)?.height;
      return typeof h === 'number' && h > 0 ? h : bodyLineH;
    }
    case 'heading': {
      const level = (node.content as HeadingContent).level ?? 1;
      const hfs = fs * (level <= 1 ? 2.5 : level === 2 ? 1.45 : 1.2);
      const hcpl = Math.max(1, Math.floor(usableW / (hfs * CHAR_W)));
      return linesFor(getNodeText(node).length, hcpl) * hfs * 1.15 + fs * 0.7 + fs * 0.25;
    }
    case 'image':
    case 'chart': {
      const styleH = (node.style as { height?: number } | undefined)?.height;
      if (typeof styleH === 'number' && styleH > 0) return styleH + bodyLineH;

      // The image's OWN declared size, when it has one. The exporters size an image by
      // `content.width`/`content.height` in CSS pixels and constrain it to the text column
      // (`max-width:100%`), so the height that lands on the page is the declared height scaled
      // down by however much the width had to shrink.
      //
      // Estimating every image at a fixed 15.5 lines instead was a full page of error on a real
      // volume: a 375×378 px harvested photograph occupies ~283pt, the flat estimate said ~155pt,
      // and a Technical Volume the ruler cleared at 10 of 10 pages rendered as 11. A ruler that
      // reads a different document from the one Chromium lays out is not a ruler — this is the
      // same defect class as the three the ruler already documents.
      const c = node.content as { width?: number; height?: number } | undefined;
      const w = typeof c?.width === 'number' && c.width > 0 ? c.width : 0;
      const h = typeof c?.height === 'number' && c.height > 0 ? c.height : 0;
      if (w > 0 && h > 0) {
        const PX_TO_PT = 0.75;                       // 96 CSS px per inch, 72 pt per inch
        const scale = Math.min(1, usableW / (w * PX_TO_PT));
        // + the <figure> element's own 12px top and bottom margins (canvas-html::imageHtml). Small
        // per figure, and exactly the sort of omission that accumulates into the one-page error
        // that turns a "10 of 10" claim into an eleven-page submission.
        const FIGURE_MARGIN_PT = 18;
        return h * PX_TO_PT * scale + FIGURE_MARGIN_PT + bodyLineH;
      }
      return fs * 15.5 + bodyLineH;
    }
    case 'table': {
      // A TABLE ROW IS NOT A LINE OF BODY TEXT, and treating it as 1.35 of one under-counted
      // every table in the product — in the dangerous direction, where the ruler clears a volume
      // the printer does not. Measured against Chromium (scripts/measure-table-row-height.mts):
      //
      //   40 single-line rows   ruler 2 pages   printed 3     (row height 9% short)
      //   40 wrapping rows      ruler 2 pages   printed 4     (row height 74% short)
      //
      // The second number is the real defect: the old model counted ROWS, so a cell whose text
      // wraps to two lines moved the printed table by a whole page and moved the estimate by
      // nothing at all. A milestone table with real deliverable descriptions in it — the single
      // most common table in a proposal — is exactly that shape.
      //
      // A row is `ROW_BASE + lines × ROW_LINE`, and a row is as tall as its TALLEST cell, so the
      // line count is a max across the row. Both constants are measured, not derived from reading
      // the CSS: binary-searching the largest table that still fits one 648pt page brackets the
      // true row height at three different cell lengths —
      //
      //   1-line cells   31 data rows + header = 32 boxes   → 19.64pt < row ≤ 20.25pt
      //   2-line cells   19 data rows + header = 20 boxes   → 30.86pt < row ≤ 32.40pt
      //   3-line cells   13 data rows + header = 14 boxes   → 43.20pt < row ≤ 46.29pt
      //
      // Those three brackets solved together admit ROW_LINE ∈ (10.8, 12.76); 12.0 with a base of
      // 8.0 satisfies all three (20.0 / 32.0 / 44.0), leaving under a third of a point of residual
      // per row. Reading the stylesheet instead would have given 10 × 1.28 = 12.8 from the body's
      // unitless line-height, which is outside the measured bracket — the table text resolves at
      // `normal` leading, not the body's. That is exactly why these are measured.
      // (scripts/measure-table-row-height.mts + scripts/calibrate-page-ruler.mts.)
      const t = node.content as TableContent;
      const header = Array.isArray(t.headers) && t.headers.length ? [t.headers] : [];
      const allRows = [...header, ...(t.rows ?? [])];
      if (allRows.length === 0) return bodyLineH;

      const TABLE_FS = 10;            // canvas-html::renderTable hardcodes font-size:10pt
      const ROW_LINE = 12.0;          // measured leading of one line of table text
      const ROW_BASE = 8.0;           // measured: 4px+4px padding + the collapsed 1px rule
      const CELL_SIDE_PAD_PT = 12;    // 8px left + 8px right, taken out of the text column

      const cellText = (v: unknown): string =>
        typeof v === 'string' ? v : String((v as { text?: unknown } | null)?.text ?? '');
      const cols = Math.max(1, ...allRows.map((r) => (r?.length ?? 0)));

      // COLUMNS ARE NOT EQUAL WIDTH. The table renders `width:100%` with no fixed layout, so
      // Chromium auto-sizes each column to its content: a "Month" column holding "1".."40" takes a
      // sliver, and the "Deliverable" column holding a sentence takes most of the table. Dividing
      // the width evenly instead made every wide column look far narrower than it renders, so its
      // text appeared to wrap to twice as many lines as it does — a 40-row table read as 5 pages
      // and printed as 4. Weighting by each column's longest cell is the same rule auto-layout
      // uses, and it lands the estimate on the printed number.
      const colChars = Array.from({ length: cols }, (_, i) =>
        Math.max(1, ...allRows.map((r) => cellText(r?.[i]).length)));
      const totalChars = colChars.reduce((a, b) => a + b, 0) || 1;
      const textWidth = Math.max(1, usableW - cols * CELL_SIDE_PAD_PT);
      const cplPerCol = colChars.map((ch) =>
        Math.max(1, Math.floor((textWidth * (ch / totalChars)) / (TABLE_FS * CHAR_W))));

      let h = 0;
      for (const row of allRows) {
        const lines = Math.max(1, ...(row ?? []).map((c, i) =>
          Math.ceil(cellText(c).length / cplPerCol[i]) || 1));
        h += ROW_BASE + lines * ROW_LINE;
      }
      return h;
    }
    case 'caption':
      return bodyLineH;
    default:
      return linesFor(getNodeText(node).length, cpl) * bodyLineH; // flow text
  }
}

/** Total stacked height (pt) of a node run (a section's footprint), ignoring page breaks. */
function stackHeightPt(nodes: CanvasNode[], m: ReturnType<typeof flowMetrics>): number {
  let h = 0;
  for (const n of nodes) h += nodeStackHeightPt(n, m);
  return h;
}

/**
 * estimatePageCount — the rendered PAGE count of a document canvas. Delegates to
 * paginate(), the ONE flow engine, so the compliance floor, submission-readiness,
 * the in-editor page readout, AND the live layout gauge all read a single
 * calibrated number — a document can never say "6 pages" in the editor and "7
 * pages" at the export gate. A spreadsheet is measured in tabs, not flow pages.
 */
export function estimatePageCount(doc: CanvasDocument): number {
  const c = doc.canvas;
  if (!c) return 1;
  if (c.format === 'spreadsheet') return 1;
  return paginate(doc).totalPages;
}

/** The slide groups of a deck: one per v2 section, else the flat nodes split on page_break. */
function slideGroups(doc: CanvasDocument): CanvasNode[][] {
  if (doc.sections && doc.sections.length) return doc.sections.map((s) => sectionsToNodes([s]));
  const groups: CanvasNode[][] = [[]];
  for (const n of doc.nodes ?? []) {
    if (n.type === 'page_break') { groups.push([]); continue; }
    groups[groups.length - 1].push(n);
  }
  return groups.filter((g, i) => g.length > 0 || i === 0);
}

/**
 * Estimate the SLIDE count of a slide-format canvas — the deck ruler, the analog of
 * estimatePageCount for documents. The pptx exporter renders exactly one slide per v2
 * section (or per page_break group for a flat v1 deck), so the count is the number of
 * groups. Overflow (a group too tall for the frame) is a SEPARATE concern — see
 * overflowingSlides — since the exporter does not reflow a slide.
 */
export function estimateSlideCount(doc: CanvasDocument): number {
  return Math.max(1, slideGroups(doc).length);
}

/** 0-based indices of slides whose content overflows the slide frame (content will be cut off). */
export function overflowingSlides(doc: CanvasDocument): number[] {
  const c = doc.canvas;
  if (!c) return [];
  const m = flowMetrics(c);
  const out: number[] = [];
  slideGroups(doc).forEach((g, i) => { if (stackHeightPt(g, m) > m.usableH * 1.02) out.push(i); });
  return out;
}

/** The page footprint of a single section's nodes (for per-section size budgets + the fill gauge). */
export function sectionPageSpan(nodes: CanvasNode[], canvas: CanvasDocument['canvas']): number {
  if (!canvas) return 1;
  const m = flowMetrics(canvas);
  return Math.max(1, Math.ceil(stackHeightPt(nodes, m) / m.usableH));
}

// ─── The single flow-pagination engine ──────────────────────────────
// paginate() lays the section layer into the frame and reports page usage with the
// SAME calibrated per-node ruler (flowMetrics + nodeStackHeightPt) estimatePageCount
// uses — so the live editor gauge and the compliance floor can never disagree.
// Regular flow content splits across the page edge (like the real renderer); a
// keep_together group/section moves wholesale when it would straddle the edge
// (break-inside:avoid). Documents only — slides are one-section-per-slide.

export interface SectionPageInfo {
  id: string;
  title?: string;
  startPage: number;
  endPage: number;
  pagesUsed: number;
  /** the section's own soft page budget, if set. */
  budget?: number;
  /** pagesUsed exceeds that budget. */
  overBudget: boolean;
}

export interface LayoutResult {
  totalPages: number;
  perSection: SectionPageInfo[];
  /** the frame's max_pages cap and whether the layout exceeds it. */
  vsMaxPages: { max: number | null; over: boolean };
}

/** Node types the exporters refuse to break across a page (canvas-html: page-break-inside: avoid). */
const ATOMIC_NODES: ReadonlySet<CanvasNode['type']> = new Set<CanvasNode['type']>(['image', 'chart', 'table']);

export function paginate(doc: CanvasDocument): LayoutResult {
  const m = flowMetrics(doc.canvas ?? CANVAS_PRESETS.letter_standard);
  const usableH = m.usableH;
  const sections = toSections(doc);
  const perSection: SectionPageInfo[] = [];

  let page = 1;
  let y = 0; // points consumed on the current page
  const newPage = () => { page += 1; y = 0; };
  // Fill the current page, then spill onto as many pages as needed — flow content
  // splits at the page edge, so pages = ceil(totalHeight / pageHeight) with no
  // phantom whitespace (matches estimatePageCount exactly for un-broken content).
  const advance = (h: number) => {
    let remaining = h;
    while (remaining > 0) {
      const room = usableH - y;
      if (remaining <= room) { y += remaining; return; }
      remaining -= room;
      newPage();
    }
  };
  // A keep-together block moves whole to the next page when it does not fit in what is left.
  //
  // THE OVERSIZED CASE TOO — this used to carry an `h <= usableH` guard, so a block taller than a
  // page kept flowing from wherever it landed. Chromium does not do that. `break-inside: avoid`
  // (canvas-html: `table`, `figure`, and any keep_together group/section) pushes the element to a
  // fresh page even when it cannot possibly fit there, and only then lets it overflow. Measured:
  //
  //   table(40 rows) alone                  → 2 pages
  //   ONE sentence of prose + the same table → 3 pages
  //
  // A single line of text moved the document by a whole page, because the table was relocated
  // rather than filled in behind the prose. Under the old guard the ruler read 2 for both — so any
  // volume with a long table under a paragraph, which is most of them, was under-counted at the
  // exact gate meant to catch it.
  const fitKeep = (h: number) => {
    if (y > 0 && y + h > usableH) newPage();
    advance(h);
  };

  sections.forEach((section, i) => {
    if (section.layout?.break_before && i > 0 && y > 0) newPage();
    const startPage = page;
    if (section.layout?.mode === 'keep_together') {
      fitKeep((section.groups ?? []).reduce((s, g) => s + stackHeightPt(g.nodes ?? [], m), 0));
    } else {
      for (const group of section.groups ?? []) {
        if (group.keep_together) { fitKeep(stackHeightPt(group.nodes ?? [], m)); continue; }
        for (const node of group.nodes ?? []) {
          if (node.type === 'page_break') { if (y > 0) newPage(); continue; }
          // A figure or a table is ATOMIC. The exporters' own stylesheet says so —
          // `figure, table { page-break-inside: avoid }` in canvas-html::canvasBaseCss — so when
          // one does not fit in what is left of a page the renderer moves it whole to the next and
          // leaves the gap. Letting it split here made the ruler read a document Chromium never
          // produces: a Technical Volume with two photographs measured 9 pages and laid out as 10,
          // because the estimator spent the white space the renderer left empty.
          //
          // This is the third time the same class of defect has surfaced (a flat height for every
          // image; a footer token nothing substituted; captions borrowed from alt text) and the
          // shape is always the same — a model of the page that quietly disagrees with the page.
          if (ATOMIC_NODES.has(node.type)) { fitKeep(nodeStackHeightPt(node, m)); continue; }
          advance(nodeStackHeightPt(node, m));
        }
      }
    }
    const endPage = page;
    const budget = section.layout?.page_budget;
    const pagesUsed = endPage - startPage + 1;
    perSection.push({
      id: section.id, title: section.title, startPage, endPage, pagesUsed, budget,
      overBudget: typeof budget === 'number' && pagesUsed > budget,
    });
  });

  const max = doc.canvas?.max_pages ?? null;
  return { totalPages: page, perSection, vsMaxPages: { max, over: max != null && page > max } };
}

/** Extract plain text from any node type (for search + page estimation). */
/**
 * countCharacters — the character ruler, the third size dimension beside pages and slides.
 *
 * An agency character cap is counted against the NARRATIVE the offeror types into the form
 * field, so this counts the same thing a person pasting into DSIP would: the visible text of
 * every text-bearing node, joined by a single space (the paragraph break the reader sees).
 * Whitespace runs collapse to one character because the form field does the same — counting a
 * canvas's internal indentation against the offeror's budget would report a document as over
 * the cap that the portal accepts. Images and page furniture contribute nothing: they are not
 * text and never reach the field.
 *
 * Deliberately shared by the editor gauge and the export gate so the two can never disagree —
 * the same rule the page ruler follows (`estimatePageCount` delegating to `paginate`).
 */
export function countCharacters(nodes: CanvasNode[]): number {
  let total = 0;
  for (const n of nodes) {
    const text = getNodeText(n).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (total > 0) total += 1; // the separator between blocks
    total += text.length;
  }
  return total;
}

/** The character count of a whole document, across either doc shape. */
export function countDocCharacters(doc: CanvasDocument): number {
  return countCharacters(docNodes(doc));
}

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

/** One failed compliance limit — surfaced at save/export so a non-compliant volume
 *  is caught before submission (not silently shipped). */
export interface ComplianceViolation {
  code:
    | 'font_too_small'
    | 'over_page_limit'
    | 'over_slide_limit'
    | 'over_character_limit'
    | 'section_over_characters'
    | 'slide_overflow'
    | 'section_over_budget'
    | 'image_not_allowed'
    | 'missing_header'
    | 'missing_footer'
    | 'foreign_solicitation';
  message: string;
  limit?: number | null;
  actual?: number;
  /** foreign_solicitation: the identifiers found that belong to another solicitation. */
  found?: string[];
}

/**
 * Labelled solicitation identifiers in a block of text — "Topic Number: AFX23D-TCSO1",
 * "Proposal Number F2-17528", "Topic: X23.5_CSO", "Solicitation No. N254-P01".
 *
 * Deliberately keyed on the LABEL rather than the shape of the token. Agency identifiers have no
 * common format (OSW26BZ04-DP013, X23.5_CSO, F2-17528, N26BX-NP002-0450), so shape-matching either
 * misses them or swallows part numbers and model numbers out of the company's own technical prose.
 * They leak WITH their label attached, because they leak out of cover sheets and running headers.
 */
export function findLabelledIdentifiers(text: string): string[] {
  // The lookahead requires a DIGIT inside the token. That is not just a filter — it makes the
  // engine reject a label word as the identifier and keep looking, which is what a real cover
  // sheet needs: in "STTR Phase II Proposal Proposal Number F2-17528", a filter applied after the
  // match would have already consumed the first "Proposal" as both label and token, and F2-17528
  // would never be reached.
  // Only labels that identify WHICH SOLICITATION this document answers. `contract` and `award`
  // are deliberately excluded: a prior contract number is past performance — "under Contract
  // FA864923P0971 we delivered the disrupter prototype" — which every cover sheet and capability
  // narrative legitimately carries. Including them flagged a real Air Force contract in the
  // company's own past-performance text as though the proposal were for the wrong program.
  const re = /\b(?:topic|proposal|solicitation)\s*(?:number|no\.?|#)?\s*[:.\-]?\s*([A-Z0-9](?=[A-Z0-9._\-/]*\d)[A-Z0-9._\-/]{3,29})\b/gi;
  return [...text.matchAll(re)].map((m) => m[1]);
}

/** Compare identifiers ignoring case, spacing and separators — "F 2 - 1 7 5 2 8" is "F2-17528". */
const idKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

/**
 * validateCanvasAgainstSpec — the deterministic compliance floor (E4): check a
 * CanvasDocument against the ComplianceSpec frozen onto its artifact at purchase.
 * Complements the AI compliance review with hard, cheap limits (font floor, page
 * cap, header/footer, images). A `null` limit means "unconstrained". Pure — safe
 * to call on save AND at the export gate. Returns [] when fully compliant.
 */
export function validateCanvasAgainstSpec(doc: CanvasDocument, spec: ComplianceSpec): ComplianceViolation[] {
  const out: ComplianceViolation[] = [];
  const defaultSize = doc.canvas?.font_default?.size ?? 12;

  // Font floor — the smallest font on any text-bearing node (else the doc default).
  if (spec.min_font_size != null) {
    let smallest = defaultSize;
    for (const n of docNodes(doc)) {
      if (!getNodeText(n)) continue;
      const size = (n.style as { size?: number } | undefined)?.size ?? defaultSize;
      if (size < smallest) smallest = size;
    }
    if (smallest < spec.min_font_size) {
      out.push({
        code: 'font_too_small',
        message: `Body font ${smallest}pt is below the ${spec.min_font_size}pt RFP minimum.`,
        limit: spec.min_font_size,
        actual: smallest,
      });
    }
  }

  // Page cap — the same estimator the editor gauge uses.
  if (spec.max_pages != null) {
    const pages = estimatePageCount(doc);
    if (pages > spec.max_pages) {
      out.push({
        code: 'over_page_limit',
        message: `Estimated ${pages} pages exceeds the ${spec.max_pages}-page limit.`,
        limit: spec.max_pages,
        actual: pages,
      });
    }
  }

  // Slide cap — a deck is measured in SLIDES, not pages (the analog of the page cap).
  if (spec.max_slides != null) {
    const slides = estimateSlideCount(doc);
    if (slides > spec.max_slides) {
      out.push({
        code: 'over_slide_limit',
        message: `Estimated ${slides} slides exceeds the ${spec.max_slides}-slide limit.`,
        limit: spec.max_slides,
        actual: slides,
      });
    }
  }

  // Character cap — the third size ruler. A character-capped document (an SBIR cover-sheet
  // abstract, an NSF project summary) is pasted into a fixed-size agency form field that
  // truncates at the cap, so going over does not merely risk a deduction: it silently loses the
  // end of the narrative. Measured whole-artifact here; per-section caps are checked below.
  if (spec.max_characters != null) {
    const chars = countDocCharacters(doc);
    if (chars > spec.max_characters) {
      out.push({
        code: 'over_character_limit',
        message: `${chars.toLocaleString()} characters exceeds the ${spec.max_characters.toLocaleString()}-character limit.`,
        limit: spec.max_characters,
        actual: chars,
      });
    }
  }

  // Slide overflow — a slide too tall for its frame is cut off on export, regardless of any cap.
  if (doc.canvas?.format === 'slide_16_9' || doc.canvas?.format === 'slide_4_3') {
    const over = overflowingSlides(doc);
    if (over.length) {
      out.push({
        code: 'slide_overflow',
        message: `${over.length} slide(s) overflow the frame (slide ${over.map((i) => i + 1).join(', ')}) — content will be cut off; split them.`,
        actual: over.length,
      });
    }
  }

  // Per-SECTION size budgets — a section that declares a page_budget must fit within it
  // (e.g. a "Technical Approach ≤ 5 pages" section inside a longer document). Measured with
  // the same height ruler, so a section limit is enforced as strictly as the whole-doc cap.
  //
  // …but ONLY when the document as a whole does not fit. A per-section budget is the OFFEROR's
  // internal allocation of the agency's cap (ten required items sharing a ten-page Technical
  // Volume get one page each); the agency caps the volume, not the item. Once the assembled volume
  // is inside its cap, a section that ran to two pages while its neighbour ran to half a page is a
  // plan that reality adjusted, not a compliance defect — and reporting it as one told a customer
  // their compliant, submittable volume had a violation. Kept live when the volume IS over, which
  // is when the number does its real job: saying WHICH section to cut.
  const volumeFits = doc.canvas?.max_pages != null && doc.canvas.max_pages > 0
    && estimatePageCount(doc) <= doc.canvas.max_pages;
  if (doc.sections?.length && doc.canvas && !volumeFits) {
    for (const s of doc.sections) {
      const budget = s.layout?.page_budget;
      if (budget == null || budget <= 0) continue;
      const nodes = sectionsToNodes([s]);
      const span = sectionPageSpan(nodes, doc.canvas);
      if (span > budget) {
        out.push({
          code: 'section_over_budget',
          message: `"${firstHeadingText(nodes) ?? 'Section'}" is estimated at ${span} pages against its ${budget}-page budget.`,
          limit: budget,
          actual: span,
        });
      }
    }
  }

  // Per-SECTION character caps. A volume can mix the two rulers — the DoW cover sheet holds two
  // separate 3,000-character narratives in one artifact — so each capped section is measured on
  // its own. Unlike a page budget this is an exact count, not an estimate: it is checked even
  // when the document declares no canvas.
  if (doc.sections?.length) {
    for (const s of doc.sections) {
      const budget = s.layout?.character_budget;
      if (budget == null || budget <= 0) continue;
      const nodes = sectionsToNodes([s]);
      const chars = countCharacters(nodes);
      if (chars > budget) {
        out.push({
          code: 'section_over_characters',
          message: `"${firstHeadingText(nodes) ?? 'Section'}" is ${chars.toLocaleString()} characters against its ${budget.toLocaleString()}-character limit — the agency form truncates the overflow.`,
          limit: budget,
          actual: chars,
        });
      }
    }
  }

  // Images/figures not permitted by the RFP.
  if (spec.images_allowed === false && docNodes(doc).some((n) => n.type === 'image')) {
    out.push({ code: 'image_not_allowed', message: 'This artifact does not permit images/figures.' });
  }

  // Required page furniture.
  if (spec.header_required && !doc.canvas?.header) {
    out.push({ code: 'missing_header', message: 'A page header is required but not configured.' });
  }
  if (spec.footer_required && !doc.canvas?.footer) {
    out.push({ code: 'missing_footer', message: 'A page footer is required but not configured.' });
  }

  // The document must cite ITS OWN solicitation and no other. See ComplianceSpec.own_identifiers
  // for why this leak is structural: a past proposal's cover sheet and cost form legitimately
  // carry that solicitation's numbers, so they survive ingest as content and drafting grounds on
  // them. An identifier from the wrong solicitation is not a style problem — a reviewer reading it
  // is reading a proposal that appears to be for a different program.
  // Normalize FIRST, then drop blanks: a whitespace-only entry keys to "" and would otherwise sit
  // in the allow-list as an identifier that matches nothing while still switching the check on.
  const own = (spec.own_identifiers ?? []).map(idKey).filter(Boolean);
  if (own.length) {
    const foreign = new Set<string>();
    for (const n of docNodes(doc)) {
      const text = getNodeText(n);
      if (!text) continue;
      for (const id of findLabelledIdentifiers(text)) {
        if (!own.includes(idKey(id))) foreign.add(id.trim());
      }
    }
    if (foreign.size) {
      const list = [...foreign];
      out.push({
        code: 'foreign_solicitation',
        message: list.length === 1
          ? `Cites an identifier from another solicitation: "${list[0]}". This proposal is ${spec.own_identifiers![0]}.`
          : `Cites ${list.length} identifiers from other solicitations: ${list.map((s) => `"${s}"`).join(', ')}. This proposal is ${spec.own_identifiers![0]}.`,
        actual: list.length,
        found: list,
      });
    }
  }

  return out;
}

/**
 * Derive a ComplianceSpec from a canvas's OWN inline rules — the self-declared
 * size/format floor for a STANDALONE document (a marketing flier, a slide deck, a
 * library artifact) that carries no RFP-frozen ComplianceSpec. Only the limits the
 * canvas actually declares are enforced; header/footer/required-sections are RFP
 * concepts and stay off, so a flier is never failed for lacking a page header.
 */
export function specFromCanvasRules(canvas: CanvasRules): ComplianceSpec {
  return {
    max_pages: canvas.max_pages ?? null,
    max_slides: canvas.max_slides ?? null,
    min_font_size: canvas.min_font_size ?? null,
    images_allowed: canvas.images_allowed ?? true,
    required_sections: [],
    header_required: false,
    footer_required: false,
  };
}

/**
 * The compliance floor for a STANDALONE document — the SAME size ruler the proposal
 * export gate uses (page/slide caps, per-section budgets, font floor, images), but
 * measured against the document's own declared limits. This is the one entry point
 * every non-proposal create/save/export path calls so "doc, pdf, ppt, xls" — and a
 * 2-page flier or a 10-slide deck built outside a proposal — is size-checked too.
 * Advisory: it reports; the caller decides whether to warn or block.
 */
export function validateStandaloneCanvas(doc: CanvasDocument): ComplianceViolation[] {
  if (!doc.canvas) return [];
  return validateCanvasAgainstSpec(doc, specFromCanvasRules(doc.canvas));
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

/**
 * Fill missing `canvas` rules with the letter_standard defaults so the editor never crashes on a
 * partial/legacy/agent-produced document. Several editor surfaces call `doc.canvas.format.startsWith(…)`
 * unguarded, so a document persisted without `canvas.format` (e.g. an agent's markdown_to_canvas output
 * or an older import) would otherwise white-screen the whole section. A document that already carries a
 * truthy `canvas.format` is returned unchanged (stable identity — no needless re-render for valid docs).
 */
export function withCanvasDefaults(doc: CanvasDocument): CanvasDocument {
  const c = doc.canvas as Partial<CanvasRules> | undefined;
  // Fast path: a fully-formed canvas is returned UNCHANGED (stable identity, no re-render for valid docs).
  if (c && c.format && c.width && c.height && c.margins && c.font_default && typeof c.line_spacing === 'number') {
    return doc;
  }
  // Otherwise merge the letter_standard defaults under whatever the doc supplies, so EVERY field the
  // renderer reads (format, font_default, line_spacing, margins, header/footer, page limits) is present.
  // Any single missing field (e.g. an agent doc with format but no font_default) would otherwise crash a
  // downstream `doc.canvas.<field>.<prop>` access and white-screen the section.
  const canvas = { ...CANVAS_PRESETS.letter_standard, ...(c ?? {}) } as CanvasRules;
  if (!canvas.format) canvas.format = 'letter';
  return { ...doc, canvas };
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
