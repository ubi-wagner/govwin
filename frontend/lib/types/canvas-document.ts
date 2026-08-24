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
/**
 * A PARTIAL canvas spec is a real shape in the database, and the ruler used to die on it.
 *
 * `paginate` guards a MISSING canvas (`doc.canvas ?? CANVAS_PRESETS.letter_standard`) and nothing
 * guarded a partial one. Three stored TVSF volumes carry `{width, height, margins}` and no
 * `font_default`, so `c.font_default.size` threw `Cannot read properties of undefined (reading
 * 'size')` — on real customer rows, today. The EXPORTERS never noticed: `canvasBaseCss` defaults
 * every field it reads (`font_default ?? { family: 'Times New Roman', size: 12 }`), so the same
 * volume downloads as a correct PDF while the page gauge, the layout route, the readiness verdict
 * and the compliance floor all throw on it.
 *
 * That asymmetry is the defect — one half of the system tolerant, the other half brittle, over the
 * same data. These defaults are canvas-html's, deliberately, so the ruler measures the document the
 * exporter will actually draw rather than refusing to measure at all.
 */
const FRAME_DEFAULTS = {
  width: 612, height: 792,
  margins: { top: 72, right: 72, bottom: 72, left: 72 },
  font_default: { family: 'Times New Roman', size: 12 },
  line_spacing: 1.15,
} as const;

/**
 * Fill a partial canvas with the defaults the EXPORTER draws — the one place that decision lives.
 *
 * B73 fixed this for the ruler by defaulting inside `flowMetrics`. That left the same shape
 * unguarded in every other reader, and B78 is what that cost: `CanvasRenderer` reads
 * `canvas.font_default.family` directly, four stored TVSF sections carry a canvas with no
 * `font_default`, and the whole proposal workspace route rendered "Something went wrong" for the
 * tenant that owns them — `TypeError: Cannot read properties of undefined (reading 'family')`,
 * thrown in a client component, so nothing reached the server log and the page still returned 200.
 *
 * A private default inside one function is a fix for one caller. This is exported so the ruler, the
 * editor, the sidebar and the previewers all resolve a partial canvas the SAME way the stylesheet
 * does, and a new reader gets the tolerance by construction instead of by remembering.
 *
 * `header`/`footer` are normalized only when present: a null header means "no header", which is a
 * real and different thing from "a header with unstated fonts".
 */
export function normalizeCanvas(raw: Partial<CanvasRules> | null | undefined): CanvasRules {
  const font = { ...FRAME_DEFAULTS.font_default, ...(raw?.font_default ?? {}) };
  const furniture = (f: CanvasRules['header']): CanvasRules['header'] =>
    // Field by field, not by spread: `f.font` is TYPED as present, so a spread would be compiled
    // as "always overwrites" — and the whole point is that the stored row may not have it. Furniture
    // inherits the body FAMILY but not its size; every preset carrying a header/footer sets 10pt.
    (f ? {
      template: f.template ?? '',
      height: f.height ?? 36,
      font: { family: f.font?.family ?? font.family, size: f.font?.size ?? 10 },
    } : null);
  return {
    ...(raw ?? {}),
    // `||`, not `??`: an empty-string format is a real persisted shape (an agent's
    // markdown_to_canvas output), and it is just as unusable as a missing one.
    format: raw?.format || 'letter',
    width: raw?.width ?? FRAME_DEFAULTS.width,
    height: raw?.height ?? FRAME_DEFAULTS.height,
    margins: { ...FRAME_DEFAULTS.margins, ...(raw?.margins ?? {}) },
    header: furniture(raw?.header ?? null),
    footer: furniture(raw?.footer ?? null),
    font_default: font,
    line_spacing: raw?.line_spacing ?? FRAME_DEFAULTS.line_spacing,
    max_pages: raw?.max_pages ?? null,
    max_slides: raw?.max_slides ?? null,
  };
}

function flowMetrics(raw: CanvasDocument['canvas']) {
  const c = normalizeCanvas(raw);
  const usableW = Math.max(1, c.width - c.margins.left - c.margins.right);
  // A RUNNING HEADER TAKES NOTHING FROM THE CONTENT BOX — it lives IN the margin (B69).
  //
  // This used to subtract `header.height + footer.height` on top of the margins, which took 72pt
  // off every page of any document carrying both — 11% of a letter page, on a product where every
  // agency mold has a running header and a page-numbered footer. `exportToPdf` passes the canvas
  // margins straight to `page.pdf({ margin })` and sets `displayHeaderFooter`, and Chromium draws
  // those templates INSIDE the margin box; the content box is height − top − bottom, full stop.
  // The editor's page frame agrees (canvas-renderer positions header/footer absolutely in the
  // margin bands). Measured: four pages of prose print as 3 with furniture and 3 without, and the
  // ruler read 4 with and 3 without.
  //
  // Nothing caught it because every case in scripts/calibrate-page-ruler.mts used the one preset
  // that declares `header: null, footer: null`, so the furniture path had no measurement at all —
  // the same shape as the harness bug in B66 and the two frame cases whose override key was not a
  // field of CanvasRules. There are now cases with furniture.
  const usableH = Math.max(1, c.height - c.margins.top - c.margins.bottom);
  const fs = c.font_default.size;
  // THE SAME LEADING FLOOR THE STYLESHEET APPLIES. canvas-html sets
  // `line-height: Math.max(lineSpacing, 1.28)` — deliberately, so a solicitation that mandates
  // "single spaced" does not render as a grey slab — and this read the raw `line_spacing`. On
  // `letter_standard` (1.15) that measured every line of prose at 13.8pt where the page draws
  // 15.36pt: 11% short, on the most common node in a proposal.
  //
  // Four node cases had already worked around it locally with `Math.max(bodyLineH / fs, 1.28)`
  // (lists, code_block, toc, the figure placeholder) — the flow-text default, which is most of a
  // volume, had not. A local workaround repeated four times is the shape of a fact that belongs
  // one level up; those four are now no-ops and left in place as documentation.
  const bodyLineH = fs * Math.max(c.line_spacing, 1.28);
  // ONE CONSTANT CANNOT STAND IN FOR A FONT WHOSE ADVANCE DEPENDS ON THE WORDS.
  //
  // `CHAR_W` was 0.45 for every text in the product. Measured against Chromium on 40-line
  // paragraphs at two font sizes (scripts/measure-char-width.mts and the uppercase sweep behind
  // B76), Times New Roman's average advance is very nearly linear in the UPPERCASE FRACTION of the
  // text and independent of size:
  //
  //     upper   0.00   0.08   0.24   0.44   0.64   0.79   1.00
  //     CHAR_W  0.414  0.427  0.455  0.488  0.526  0.552  0.588
  //
  // So a single 0.45 ran ~8% CONSERVATIVE on lowercase narrative — the mold over-counts — and
  // ~20% OPTIMISTIC on acronym-dense text, which is an UNDER-count, the direction that clears a
  // volume the printer rejects. A cover sheet or compliance matrix full of agency acronyms is
  // exactly that text, and nothing had ever measured it.
  //
  // `glyphAdvance` is that line with a uniform ~3% safety margin on top, so every register is
  // slightly conservative instead of one being conservative and another optimistic.
  const cpl = cplFor(getUpperFraction(''), usableW, fs);   // the all-lowercase default, for callers with no text
  // tocRows is filled in by paginate(), which can see the whole document; a per-node ruler cannot.
  // See the 'toc' case in nodeStackHeightPt.
  return { usableW, usableH, fs, bodyLineH, cpl, tocRows: undefined as TocRow[] | undefined };
}

/** Fraction of the letters in `s` that are uppercase — the one feature the advance depends on. */
function getUpperFraction(s: string): number {
  let letters = 0, upper = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 65 && c <= 90) { letters++; upper++; }
    else if (c >= 97 && c <= 122) letters++;
  }
  return letters ? upper / letters : 0;
}

/**
 * Average glyph advance for a text, as a fraction of the font size (B76).
 *
 * Fitted to the measured sweep above — 0.414 at all-lowercase, 0.588 at all-caps — times a margin.
 *
 * THE MARGIN IS 8% AND THAT NUMBER IS THE FINDING. A paragraph's realised advance sits above the
 * 40-line average often enough to matter: at 3% the authored NILOC corpus produced an UNDER-count
 * (cadence-technical, 5 modelled against 6 printed) and the gate refused the change. 6% cleared all
 * eight, 8% clears them with room that is not tuned to those eight documents.
 *
 * What that means is worth stating plainly, because it refutes the reason this model was written:
 * at 8%, all-lowercase lands on 0.451 — the SAME value as the single constant it replaces. The mold
 * over-counts therefore CANNOT be closed this way; the headroom that keeps real prose safe is
 * exactly what makes a bracket-heavy template read long. What the model does close is the other
 * end: acronym-dense text is now ~33% more conservative than the constant, which was UNDER-counting
 * it — a cover sheet or compliance matrix full of agency identifiers is precisely that text, and
 * nothing had ever measured it.
 *
 * Never lower the intercept or the margin without re-running the sweep AND both under-count gates.
 * Below the measured value the ruler under-counts, and an under-count at the export gate clears a
 * volume that is over its agency page limit.
 */
function glyphAdvance(text: string): number {
  const SAFETY = 1.08;
  return (0.414 + 0.174 * getUpperFraction(text)) * SAFETY;
}

/** Characters that fit on one line of `text` at `fs`, across `widthPt`. */
function cplFor(textOrUpper: string | number, widthPt: number, fs: number): number {
  const adv = typeof textOrUpper === 'number'
    ? (0.414 + 0.174 * textOrUpper) * 1.03
    : glyphAdvance(textOrUpper);
  return Math.max(1, Math.floor(widthPt / (fs * adv)));
}

/** One rendered contents-list entry: its indent level and the length of its label. */
interface TocRow { level: number; len: number; upper: number }

/** The headings a `toc` node will render, in document order (mirrors canvas-html::buildTocHtml). */
function collectTocRows(doc: CanvasDocument): TocRow[] {
  const rows: TocRow[] = [];
  const visit = (nodes: CanvasNode[] | undefined) => {
    for (const n of nodes ?? []) {
      if (n.type !== 'heading') continue;
      const c = n.content as HeadingContent | undefined;
      const num = c?.numbering ? `${c.numbering} ` : '';
      const label = num + (c?.text ?? '');
      rows.push({ level: c?.level ?? 1, len: label.length, upper: getUpperFraction(label) });
    }
  };
  if (doc.sections?.length) {
    for (const s of doc.sections) for (const g of s.groups ?? []) visit(g.nodes);
  } else visit(doc.nodes);
  return rows;
}

/** Vertical height (pt) a single node occupies in normal flow. page_break / toc contribute nothing. */
/**
 * The vertical MARGINS canvas-html gives a node's outermost element, in points.
 *
 * Kept separate from the node's box height for one reason: CSS collapses adjacent vertical margins
 * to the LARGER of the two, and a model that bakes margins into each node's height cannot. The
 * ruler used to do exactly that, inconsistently — a heading carried its 20pt and 5pt, a paragraph
 * carried nothing at all (`p { margin: 0 0 7pt }` was simply absent), a figure carried both of its
 * own — so consecutive paragraphs lost 7pt each while a paragraph followed by a heading came out
 * right by accident. On real prose-heavy proposals the missing paragraph margins won: four of the
 * eight authored NILOC volumes UNDER-counted by a page, which is the one direction that matters —
 * the export gate clearing a volume that is over its limit.
 *
 * Read straight off canvas-html (canvasBaseCss + the inline styles in renderNode); a type not
 * listed here has no vertical margin.
 */
function nodeMarginsPt(node: CanvasNode): { top: number; bottom: number } {
  switch (node.type) {
    case 'heading': {
      const level = (node.content as HeadingContent | undefined)?.level ?? 1;
      return level <= 1 ? { top: 20, bottom: 5 } : level === 2 ? { top: 14, bottom: 4 } : { top: 11, bottom: 3 };
    }
    // `p { margin: 0 0 7pt }` — text_block, and the three node types that also render as a <p>.
    case 'text_block':
    case 'caption':
    case 'footnote':
    case 'url':
      return { top: 0, bottom: 7 };
    case 'bulleted_list':                       // ul, ol { margin: 0 0 8pt 20pt }
    case 'numbered_list':
      return { top: 0, bottom: 8 };
    case 'image':                               // <figure style="margin:12px 0">
      return { top: 9, bottom: 9 };
    case 'chart':                               // a bare <svg style="margin:10pt 0">, not a figure
      return { top: 10, bottom: 10 };
    case 'table':                               // <table style="margin:10px 0">
      return { top: 7.5, bottom: 7.5 };
    case 'callout':                             // margin:10pt 0
    case 'blockquote':
      return { top: 10, bottom: 10 };
    case 'code_block':                          // <pre>'s UA default margin, 1em at 9pt
      return { top: 9, bottom: 9 };
    case 'equation':                            // margin:8pt 0
      return { top: 8, bottom: 8 };
    case 'divider':                             // <hr style="margin:12pt 0">
      return { top: 12, bottom: 12 };
    case 'signature':                           // margin:16pt 0
      return { top: 16, bottom: 16 };
    case 'toc':                                 // <nav style="margin:4pt 0 14pt">
      return { top: 4, bottom: 14 };
    default:
      return { top: 0, bottom: 0 };
  }
}

/** nodeStackHeightPt returns the node's BOX — margins are `nodeMarginsPt`, collapsed by the caller. */
function nodeStackHeightPt(node: CanvasNode, m: ReturnType<typeof flowMetrics>): number {
  const { usableW, fs, bodyLineH, cpl } = m;
  const linesFor = (chars: number, per: number) => Math.max(1, Math.ceil(chars / per));
  switch (node.type) {
    case 'page_break':
      return 0;
    case 'toc': {
      // A CONTENTS LIST IS NOT FREE. `buildTocHtml` emits one indented block per heading in the
      // document — `<div style="margin-left:…;padding:2pt 0">` — under a small uppercase label,
      // inside `<nav style="margin:4pt 0 14pt">`. Modelling it as 0 meant a 40-entry contents page
      // cost nothing in the estimate and two pages in the print.
      //
      // The height depends on the WHOLE document, which a per-node function cannot see, so
      // paginate() counts the headings once and threads them in. Without that (sectionPageSpan,
      // overflowingSlides — neither of which meets a toc in practice, since decks have none) this
      // falls back to zero rather than inventing a number.
      //
      // MEASURED, not read off the stylesheet: binary-searching the largest contents list that
      // still fits one 648pt page gives 31 entries, which brackets the per-entry height at
      // (19.14, 19.76]pt once the fixed label + nav margin is subtracted. The 19.36 below is inside
      // that bracket. KNOWN RESIDUAL, stated rather than tuned away: on a document that is a
      // contents list followed by nothing but headings, the total can still be ±1 page, because
      // the ruler does not implement `h1,h2,h3 { break-after: avoid }` — a heading at the foot of
      // a page moves to the next one WITH its first paragraph, leaving whitespace the model spends.
      // That is a separate gap (it shows only when a toc pushes headings to a page boundary); both
      // documents above are exact without a toc. See docs/BUG_LOG B66.
      const rows = m.tocRows;
      if (!rows || rows.length === 0) return 0;
      const TOC_ENTRY_PAD_PT = 4;    // 2pt top + 2pt bottom
      const TOC_LABEL_PT = 9 * 1.28 + 6;
      const line = fs * Math.max(bodyLineH / fs, 1.28);
      let h = TOC_LABEL_PT;          // the <nav>'s 4pt/14pt margins are nodeMarginsPt's
      for (const r of rows) {
        const w = Math.max(1, usableW - (r.level - 1) * 20);
        h += linesFor(r.len, cplFor(r.upper, w, fs)) * line + TOC_ENTRY_PAD_PT;
      }
      return h;
    }
    case 'spacer':
      return spacerHeightPt(node, bodyLineH);
    case 'heading': {
      // THE SCALE HERE MUST BE THE STYLESHEET'S SCALE. canvas-html tightened headings — its own
      // comment says "a tighter scale than 1.6/1.3/1.1" — and this ruler was never moved with it,
      // so it kept modelling h1 at 2.5× the body where the page renders 1.34×, nearly double. On a
      // mold with 22 headings that is +29% of every heading's height; amplified across 264 of them
      // the ruler read 18 pages against 14 printed.
      //
      // Read straight off canvas-html::canvasBaseCss so the two cannot drift again:
      //   h1  font-size fs×1.34   margin 20pt 0 5pt
      //   h2  font-size fs×1.14   margin 14pt 0 4pt
      //   h3  font-size fs×1.02   margin 11pt 0 3pt
      //   all line-height 1.22
      const level = (node.content as HeadingContent).level ?? 1;
      const scale = level <= 1 ? 1.34 : level === 2 ? 1.14 : 1.02;
      const hfs = fs * scale;
      const htext = getNodeText(node);
      const hcpl = cplFor(htext, usableW, hfs);
      // The 20/5 · 14/4 · 11/3 margins live in nodeMarginsPt so they can COLLAPSE against the
      // paragraph above. Charged here they were added to that paragraph's own bottom margin, which
      // is not what the page does.
      return linesFor(htext.length, hcpl) * hfs * 1.22;
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
      // A CHART IS A GENERATED SVG OF KNOWN SIZE — not an unknown picture to guess at.
      //
      // It fell through to a flat `fs * 15.5` fallback because a chart node carries no width or
      // height: 201pt modelled against 256pt printed, a 21% UNDER-count, which is the direction
      // that matters. `renderChartSvg` fixes the viewBox itself — 480×300 for every plot type,
      // and 500 × (12 or 30 + 24 per category + 26) for a gantt — so the height is computable.
      // Measured in a run (scripts/probe-chart.mts): a 300px chart advances 249.09pt, which is the
      // 225pt box, the 10pt margin (nodeMarginsPt's, so it collapses), and ~14pt of baseline gap
      // below an INLINE svg. `bodyLineH` covers that last part with a point to spare.
      if (node.type === 'chart') {
        const cc = node.content as ChartContent | undefined;
        const gantt = cc?.chart_type === 'gantt';
        const svgW = gantt ? 500 : 480;
        const svgH = gantt ? (cc?.title ? 30 : 12) + (cc?.categories?.length ?? 0) * 24 + 26 : 300;
        const PX_TO_PT = 0.75;
        const chartScale = Math.min(1, usableW / (svgW * PX_TO_PT));
        return svgH * PX_TO_PT * chartScale + bodyLineH;
      }

      const c = node.content as { width?: number; height?: number; storage_key?: unknown } | undefined;

      // AN IMAGE WITH NOWHERE TO LOAD FROM IS NOT A FIGURE — it is a placeholder box.
      // canvas-html::renderImage draws `<img>` only when the key is a data: URI (the export path
      // inlines real storage keys first); with nothing to inline it emits a small dashed
      // `<div style="border:1px dashed;padding:24px">alt text</div>` instead, where the declared
      // height acts as a `max-height` CAP rather than a height. Measuring the declared size anyway
      // made every template mold read far longer than it prints: the DOE STTR Phase I mold carries
      // five images with an EMPTY storage_key declared at up to 900×520, and the ruler spent ~3
      // pages on figures Chromium drew as five one-line boxes — 10 pages estimated against 7
      // printed, before any of this session's other fixes.
      //
      // Scoped to an EMPTY key on purpose. A real storage key resolves through
      // `inlineImageDataUris` at export and does take its declared size — which is why real
      // authored proposals measured exactly right. Only the provably-unresolvable case changes.
      //
      // The box below is MEASURED, not read off the stylesheet by hand — the first correction did
      // that and still came out at roughly double (86pt modelled against 63.6pt printed), because a
      // by-hand reading double-counts the <figure>'s margins (they COLLAPSE with the neighbouring
      // paragraph's) and charges a caption line to a box that has no caption. Chromium reports the
      // laid-out geometry directly; scripts/measure-image-placeholder.mts is that measurement, and
      // the calibration harness carries the placeholder cases so it cannot drift back.
      const key = typeof c?.storage_key === 'string' ? c.storage_key.trim() : '';
      if (node.type === 'image' && key === '') {
        const PAD_PT = 36;          // padding:24px, top + bottom
        const BORDER_PT = 1.5;      // 1px dashed, top + bottom
        const CAPTION_PT = 14.5;    // <figcaption> 9pt at the body's leading + its 4px margin-top
        // The alt text wraps inside the box, at the box's own width — which is the DECLARED width
        // when there is one (the div carries `width:Npx` with no max-width, so a 900px figure lays
        // out 900px wide and overflows the column rather than wrapping into it).
        const declaredWpt = typeof c?.width === 'number' && c.width > 0 ? c.width * 0.75 : usableW;
        const textW = Math.max(1, declaredWpt - PAD_PT);
        const alt = typeof (c as { alt_text?: unknown })?.alt_text === 'string' ? (c as { alt_text: string }).alt_text : '';
        const altText = alt || 'Image';
        const lines = linesFor(altText.length, cplFor(altText, textW, fs));
        const natural = PAD_PT + BORDER_PT + lines * bodyLineH;
        // A declared height is a `max-height` on this box, so it can only make it SHORTER.
        const capped = typeof c?.height === 'number' && c.height > 0 ? Math.min(natural, c.height * 0.75) : natural;
        const caption = typeof (c as { caption?: unknown })?.caption === 'string' && (c as { caption: string }).caption ? CAPTION_PT : 0;
        return capped + caption;   // the <figure>'s 12px margins are nodeMarginsPt's, so they collapse
      }

      const w = typeof c?.width === 'number' && c.width > 0 ? c.width : 0;
      const h = typeof c?.height === 'number' && c.height > 0 ? c.height : 0;
      if (w > 0 && h > 0) {
        const PX_TO_PT = 0.75;                       // 96 CSS px per inch, 72 pt per inch
        const scale = Math.min(1, usableW / (w * PX_TO_PT));
        // The <figure>'s own 12px margins are nodeMarginsPt's (they collapse); the trailing
        // bodyLineH is the caption line, which does not.
        return h * PX_TO_PT * scale + bodyLineH;
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
      //
      // PROPORTIONAL WAS NOT ENOUGH: A COLUMN NEVER GETS LESS THAN ITS LONGEST WORD.
      //
      // Weighting purely by longest-cell starves a narrow column below the width of the text it
      // holds. Measured on the NSF Project Description mold, a four-column milestone table whose
      // first column holds "Task 1": the proportional share gave that column 5.8 characters, so
      // the model wrapped a six-character cell onto a second line — and did it on every row.
      // 148pt estimated against 105.9pt printed, a 40% over-count on one node, which was enough on
      // its own to push a segment onto a second page and the mold from 6 pages to 8.
      //
      // CSS auto table layout does not work that way. Every column is first given its MIN-CONTENT
      // width — the longest unbreakable word, which is the narrowest it can be without splitting a
      // word — and only the space left over is shared out, in proportion to how much more each
      // column would like (max-content − min-content). When every column's max-content fits, no
      // cell wraps at all. That is CSS 2.1 §17.5.2, and it is what the renderer is doing.
      const longestWord = (s: string) => Math.max(1, ...s.split(/\s+/).map((w) => w.length));
      const minChars = Array.from({ length: cols }, (_, i) =>
        Math.max(1, ...allRows.map((r) => longestWord(cellText(r?.[i])))));
      const maxChars = Array.from({ length: cols }, (_, i) =>
        Math.max(1, ...allRows.map((r) => cellText(r?.[i]).length)));
      const textWidth = Math.max(1, usableW - cols * CELL_SIDE_PAD_PT);
      // The table's own register: a milestone table of prose wraps differently from one of acronyms.
      const tableText = allRows.map((r) => (r ?? []).map(cellText).join(' ')).join(' ');
      const capacity = textWidth / (TABLE_FS * glyphAdvance(tableText));   // the whole row, in characters
      const sumMin = minChars.reduce((a, b) => a + b, 0);
      const sumMax = maxChars.reduce((a, b) => a + b, 0);
      const cplPerCol = sumMax <= capacity
        // Everything fits: each column takes its content and nothing wraps.
        ? maxChars.slice()
        : minChars.map((mn, i) => {
          // Share out what is left of the row after every column's minimum, by how much more each
          // column wants. When even the minimums do not fit, the columns keep them and the table
          // overflows — which is what the renderer does too.
          const slack = Math.max(0, capacity - sumMin);
          const want = maxChars[i] - mn;
          const totalWant = maxChars.reduce((s, mx, j) => s + (mx - minChars[j]), 0) || 1;
          // ROUND, not floor. A column's share is a real-valued width; truncating it down stacks a
          // second conservatism on top of CHAR_W's (0.45 against a measured ~0.42), and it stacks
          // once PER COLUMN. On the table above that turned a 5.9-character allocation into 5 and
          // wrapped "Task 1" — six characters — onto a second line in every row.
          return Math.max(1, Math.round(mn + (slack * want) / totalWant));
        });

      let h = 0;
      for (const row of allRows) {
        const lines = Math.max(1, ...(row ?? []).map((c, i) =>
          Math.ceil(cellText(c).length / cplPerCol[i]) || 1));
        h += ROW_BASE + lines * ROW_LINE;
      }
      return h;
    }
    case 'caption': {
      // A caption is USUALLY one line, and used to be modelled as exactly one — but it is prose,
      // and a long one wraps like any other. A constant under-counts it, and under-count is the
      // direction the size gates forbid. Measured with the body advance (a caption renders
      // smaller, so body metrics fit FEWER characters per line and therefore over-estimate — the
      // safe side), floored at one line so the common short caption is unchanged.
      const t = getNodeText(node);
      return Math.max(1, linesFor(t.length, t ? cplFor(t, usableW, fs) : cpl)) * bodyLineH;
    }
    case 'code_block': {
      // A CODE BLOCK PRESERVES ITS NEWLINES. It renders inside
      // `<pre style="white-space:pre-wrap; padding:12pt; font-size:9pt; font-family:Courier New">`,
      // so every `\n` is a hard line and a long line wraps rather than being clipped. Reflowing it
      // as prose (the old default) collapsed 60 lines of code into one paragraph's worth: measured
      // 1 page against a printed 2. Same class as the table and list defects — structure the
      // renderer keeps and the model threw away.
      //
      // Monospace advances wider than the proportional CHAR_W: Courier New is 0.6em per glyph, so
      // using the body's 0.45 would over-estimate how much code fits on a line.
      const code = String((node.content as { code?: unknown } | undefined)?.code ?? '');
      const CODE_FS = 9;
      const MONO_CHAR_W = 0.6;
      const PRE_PAD_PT = 24;                       // 12pt top + 12pt bottom
      const codeLine = CODE_FS * Math.max(bodyLineH / fs, 1.28);
      const per = Math.max(1, Math.floor((usableW - PRE_PAD_PT) / (CODE_FS * MONO_CHAR_W)));
      const lines = code.split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / per)), 0);
      return Math.max(1, lines) * codeLine + PRE_PAD_PT;
    }
    case 'bulleted_list':
    case 'numbered_list': {
      // A LIST IS NOT A PARAGRAPH. Falling through to the flow-text default concatenated every
      // bullet into one string and reflowed it at full column width, so twenty short bullets
      // measured as three lines instead of twenty. Consequences in both rulers:
      //   • a 120-bullet document read 3 pages and printed 4
      //   • a slide holding 30 bullets — needing 648pt of a 452pt frame — reported NO overflow,
      //     so `overflowingSlides` (the only thing standing between a customer and a deck with
      //     content cut off the bottom) stayed silent until 60.
      // Same defect as the table-wrap bug: the model flattened structure the renderer preserves.
      //
      // Geometry from canvas-html: `ul, ol { margin: 0 0 8pt 20pt }`, `li { margin: 0 0 3pt }`,
      // and each item is its own block that wraps inside the indented column. Nested children
      // indent another 20pt each level.
      const items = (node.content as ListContent | undefined)?.items ?? [];
      const LIST_INDENT_PT = 20;
      const ITEM_GAP_PT = 3;   // li { margin: 0 0 3pt } — between items, so it never collapses out
      // The stylesheet floors line-height at 1.28 (`Math.max(lineSpacing, 1.28)`), and for a list
      // that floor matters: an error of a fraction of a line repeats per ITEM instead of averaging
      // out across a reflowed paragraph.
      const lineH = fs * Math.max(m.bodyLineH / fs, 1.28);
      const walk = (list: ListContent['items'], depth: number): number => {
        const w = Math.max(1, usableW - LIST_INDENT_PT * (depth + 1));
        let h = 0;
        for (const it of list ?? []) {
          const itText = it?.text ?? '';
          h += linesFor(itText.length, cplFor(itText, w, fs)) * lineH + ITEM_GAP_PT;
          if (it?.children?.length) h += walk(it.children, depth + 1);
        }
        return h;
      };
      return items.length ? walk(items, 0) : bodyLineH;   // the ul/ol 8pt bottom is nodeMarginsPt's
    }
    default: {
      // Flow text measured at ITS OWN advance, not one constant for the whole product (B76).
      const t = getNodeText(node);
      return linesFor(t.length, t ? cplFor(t, usableW, fs) : cpl) * bodyLineH;
    }
  }
}

/** Total stacked height (pt) of a node run (a section's footprint), ignoring page breaks.
 *  Adjacent vertical margins COLLAPSE to the larger of the two, as the renderer does. */
function stackHeightPt(nodes: CanvasNode[], m: ReturnType<typeof flowMetrics>): number {
  let h = 0;
  let prevBottom = 0;
  let first = true;
  for (const n of nodes) {
    if (n.type === 'page_break') { prevBottom = 0; continue; }
    const mg = nodeMarginsPt(n);
    // The block's OWN outer margins collapse through it (no border, no padding), so the leading
    // top margin and the trailing bottom margin are not part of the height that has to fit.
    if (!first) h += Math.max(prevBottom, mg.top);
    h += nodeStackHeightPt(n, m);
    prevBottom = mg.bottom;
    first = false;
  }
  return h;
}

/**
 * estimatePageCount — the rendered PAGE count of a document canvas. Delegates to
 * paginate(), the ONE flow engine, so the compliance floor, submission-readiness,
 * the in-editor page readout, AND the live layout gauge all read a single
 * calibrated number — a document can never say "6 pages" in the editor and "7
 * pages" at the export gate. A spreadsheet is measured in tabs, not flow pages.
 */
/**
 * How tall a `spacer` is, in points — the ONE answer, for every reader.
 *
 * A spacer had five readers and four different heights, none of which was the author's:
 *
 *   ruler   `content.height`            · the only one that read the node at all
 *   html/pdf `style.space_after` ?? 12pt · so `content.height = 600` emitted `height:12pt`
 *   docx    hardcoded `after: 200` twips (10pt)
 *   pptx    hardcoded `0.3` in (21.6pt)
 *   editor  hardcoded `h-8` (≈24pt)
 *   xlsx    filtered out — correct; a grid has no vertical whitespace to place
 *
 * So an author who set a spacer's height saw four different numbers in four artifacts and the one
 * they typed in none of them, while the ruler measured a height no writer would produce. Nothing is
 * lost — it is whitespace — but it is the same defect class as B64/B65/B73: several readers of one
 * node model, disagreeing silently, with the ruler modelling something the renderers do not.
 *
 * `content.height` is canonical because it is spacer-specific; `style.space_after` is honoured as a
 * fallback because canvas-html already read it and stored documents may carry it.
 */
export function spacerHeightPt(node: CanvasNode, fallbackPt = 12): number {
  const h = (node.content as { height?: number } | undefined)?.height;
  if (typeof h === 'number' && h > 0) return h;
  const s = node.style?.space_after;
  if (typeof s === 'number' && s > 0) return s;
  return fallbackPt;
}

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

/**
 * Which page a single node landed on — the ruler's answer to the question it always knew and never
 * wrote down.
 *
 * `perSection` cannot answer it for the documents the product actually STORES. Every stored section
 * canvas and every assembled proposal document is FLAT (`nodes`, no `sections` — verified against
 * the live schema), so `toSections()` synthesises sections whose ids are `crypto.randomUUID()`:
 * freshly minted on every call, matching nothing in the document. Anything trying to resolve "what
 * is on pages 3–5" through `perSection` therefore matched nothing at all, silently.
 *
 * A node that outgrows a page reports a RANGE, and every node inside a `keep_together` group or
 * section reports the whole block's range — because that is what happens to them on the page.
 */
export interface NodePageInfo {
  id: string;
  startPage: number;
  endPage: number;
}

export interface LayoutResult {
  totalPages: number;
  perSection: SectionPageInfo[];
  /** Page span of every node, in document order. Additive — no measurement depends on it. */
  perNode: NodePageInfo[];
  /** the frame's max_pages cap and whether the layout exceeds it. */
  vsMaxPages: { max: number | null; over: boolean };
}

/**
 * Node types the exporters refuse to break across a page (canvas-html: page-break-inside: avoid).
 *
 * EXHAUSTIVE BY CONSTRUCTION. This was a hand-written `new Set(['image','chart','table'])`, which
 * means a node type added to the union silently defaulted to "splittable" — and break-affinity is
 * not cosmetic: the paginator moves an atomic node wholesale when it would straddle the page edge,
 * so getting it wrong changes the page COUNT, and the page count is the compliance gate. A ruler
 * that under-counts clears a volume that is over its agency page limit.
 *
 * `Record<NodeType, boolean>` makes the decision mandatory: add a member to the union without a
 * line here and it is a compile error, not a silent default. This mirrors the discipline
 * `__tests__/node-vocabulary-coverage.test.ts` already enforces across the four writers — the
 * ruler was the lane that guard did not cover.
 *
 * Values below preserve the previous behaviour exactly: only image, chart and table are atomic.
 */
const ATOMIC_BY_TYPE: Record<NodeType, boolean> = {
  heading: false,
  text_block: false,
  bulleted_list: false,
  numbered_list: false,
  image: true,
  table: true,
  caption: false,
  footnote: false,
  toc: false,
  page_break: false,
  url: false,
  spacer: false,
  shape: false,
  text_box: false,
  callout: false,
  code_block: false,
  blockquote: false,
  chart: true,
  equation: false,
  divider: false,
  video: false,
  signature: false,
};
const ATOMIC_NODES: ReadonlySet<CanvasNode['type']> = new Set(
  (Object.keys(ATOMIC_BY_TYPE) as NodeType[]).filter((t) => ATOMIC_BY_TYPE[t]),
);

export function paginate(doc: CanvasDocument): LayoutResult {
  const m = flowMetrics(doc.canvas ?? CANVAS_PRESETS.letter_standard);
  // Give the per-node ruler the document-wide fact it cannot derive on its own: what a `toc` node
  // will actually render. Only computed when the document has one, so the common path is unchanged.
  if ((doc.sections?.length ? doc.sections.some((s) => (s.groups ?? []).some((g) => (g.nodes ?? []).some((n) => n.type === 'toc')))
                            : (doc.nodes ?? []).some((n) => n.type === 'toc'))) {
    m.tocRows = collectTocRows(doc);
  }
  const usableH = m.usableH;
  const sections = toSections(doc);
  const perSection: SectionPageInfo[] = [];
  const perNode: NodePageInfo[] = [];
  /** Record a node's span. Called at every point a node's page is decided; never influences one. */
  const mark = (node: CanvasNode, startPage: number) =>
    perNode.push({ id: node.id, startPage, endPage: page });

  let page = 1;
  let y = 0; // points consumed on the current page
  // The previous node's bottom margin, waiting to collapse against the next node's top one. Reset
  // at every page boundary: a margin at the top of a fresh page is not spent, in paged CSS or here.
  let prevBottom = 0;
  const newPage = () => { page += 1; y = 0; prevBottom = 0; };
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
  // Returns the page the block STARTED on. The return value is new; the behaviour is not — the
  // relocate-then-flow decision below is byte-for-byte what it was, and `perNode` only reads it.
  const fitKeep = (h: number) => {
    if (y > 0 && y + h > usableH) newPage();
    const from = page;
    advance(h);
    return from;
  };

  sections.forEach((section, i) => {
    if (section.layout?.break_before && i > 0 && y > 0) newPage();
    const startPage = page;
    if (section.layout?.mode === 'keep_together') {
      // stackHeightPt collapses within the block; the pending margin from before it is spent here.
      advance(prevBottom); prevBottom = 0;
      const from = fitKeep((section.groups ?? []).reduce((s, g) => s + stackHeightPt(g.nodes ?? [], m), 0));
      // The whole section moved as one block, so every node in it shares the block's span.
      for (const g of section.groups ?? []) for (const nd of g.nodes ?? []) mark(nd, from);
    } else {
      for (const group of section.groups ?? []) {
        if (group.keep_together) {
          advance(prevBottom); prevBottom = 0;
          const from = fitKeep(stackHeightPt(group.nodes ?? [], m));
          for (const nd of group.nodes ?? []) mark(nd, from);
          continue;
        }
        for (const node of group.nodes ?? []) {
          if (node.type === 'page_break') { if (y > 0) newPage(); prevBottom = 0; mark(node, page); continue; }
          // The gap above this node: its own top margin COLLAPSED with the previous node's bottom
          // one, not the sum of the two. Spent before the fit decision, because a figure that no
          // longer fits once the gap is on the page is a figure the renderer relocates.
          // A MARGIN AT THE TOP OF A PAGE IS NOT SPENT. Paged CSS discards it, and charging it
          // anyway put `y` above zero before the first element of a page — which made `fitKeep`
          // treat a table at the very top as one that had to be RELOCATED, sending a 2-page table
          // to pages 2 and 3 of a 3-page document that has nothing on page 1.
          const mg = nodeMarginsPt(node);
          if (y > 0) advance(Math.max(prevBottom, mg.top));
          prevBottom = mg.bottom;
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
          if (ATOMIC_NODES.has(node.type)) { mark(node, fitKeep(nodeStackHeightPt(node, m))); continue; }
          const from = page;
          advance(nodeStackHeightPt(node, m));
          mark(node, from);
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
  return { totalPages: page, perSection, perNode, vsMaxPages: { max, over: max != null && page > max } };
}

/**
 * The ruler's per-node opinion, in points — the calibration read-out.
 *
 * `paginate` reports pages, which is what the product needs and the worst possible signal for
 * finding out WHY it is wrong: a mold that estimates 7 and prints 5 has spread two pages of error
 * across forty-seven nodes, and no node's share of it is visible in the total. Every correction to
 * this ruler so far was found by bisecting page counts or by amplifying one node type ×240 — and
 * amplification lies about anything with a vertical margin, because a run of forty headings
 * collapses margins that a real document does not.
 *
 * This exposes the number the ruler actually charges each node, so a diagnostic can set it beside
 * the height Chromium gives that same node and name the culprit directly. Pure, allocation-only,
 * and used by scripts/diagnose-mold-ruler.mts — not on any product path.
 */
export function nodeHeightsPt(doc: CanvasDocument): Array<{ index: number; type: CanvasNode['type']; heightPt: number; atomic: boolean }> {
  const m = flowMetrics(doc.canvas ?? CANVAS_PRESETS.letter_standard);
  const nodes = docNodes(doc);
  if (nodes.some((n) => n.type === 'toc')) m.tocRows = collectTocRows(doc);
  return nodes.map((n, index) => ({
    index, type: n.type,
    heightPt: n.type === 'page_break' ? 0 : nodeStackHeightPt(n, m),
    atomic: ATOMIC_NODES.has(n.type),
  }));
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
    // TEXT-BEARING TYPES THAT USED TO FALL THROUGH TO ''.
    //
    // The default arm returns '', which is correct for a divider or an image and wrong for
    // anything carrying prose. callout / blockquote / code_block all carry prose and all three
    // landed on the default — so the ruler measured them as ONE EMPTY LINE (a callout holding two
    // lines of text read 15pt against the 31pt the same words cost in a text_block),
    // `countCharacters` omitted them from the agency character cap, and search could not find
    // them. This function's own contract says "any node type"; it covered eight.
    //
    // Under-counting is the one direction the size gates forbid — it clears a volume that is over
    // its page limit. Theoretical until markdown_to_canvas learned to emit callouts; live now
    // that AI drafts contain them.
    case 'callout': {
      const c = node.content as CalloutContent;
      return [c.title, c.text].filter(Boolean).join(' ');
    }
    case 'blockquote': return (node.content as BlockquoteContent).text;
    case 'code_block': return (node.content as CodeBlockContent).code;
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
  // Fast path: a fully-formed canvas is returned UNCHANGED (stable identity, no re-render for valid
  // docs). Page furniture counts as a field: a header present but font-less is exactly the shape
  // that crashes `canvas.header.font.family`, and the old predicate waved it through.
  const furnitureOk = (f: CanvasRules['header']) => !f || !!f.font;
  if (c && c.format && c.width && c.height && c.margins && c.font_default
      && typeof c.line_spacing === 'number' && furnitureOk(c.header ?? null) && furnitureOk(c.footer ?? null)) {
    return doc;
  }
  // Otherwise fill against ONE definition of the defaults (B78). This used to spread
  // `CANVAS_PRESETS.letter_standard` directly, which is a second copy of the same constants
  // `flowMetrics` keeps in `FRAME_DEFAULTS` — two places to keep in step, and only one of them
  // handled page furniture. `normalizeCanvas` is now the single answer to "what does a missing
  // canvas field mean", shared by the ruler, the renderer and every editor.
  return { ...doc, canvas: normalizeCanvas(c) };
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
