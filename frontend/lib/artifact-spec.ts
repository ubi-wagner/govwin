/**
 * Artifact spec builder (E2).
 *
 * Freezes a per-artifact format spec (CanvasRules) + compliance spec
 * (ComplianceSpec) at purchase, derived from the curated compliance matrix
 * (solicitation_compliance, merged) + the volume's required-items. The upstream
 * specs are human-authored TEXT ("12pt", "1 inch all sides", "single") plus a
 * structured JSONB home (canvas_preset / compliance_preset, mig 084); this module
 * parses the TEXT and overlays it on a base CanvasRules preset so exporters (E4)
 * and the validator can work against typed numbers, not unparseable strings.
 *
 * Pure + dependency-free (no DB) so it is unit-testable and runs inside the
 * create-route transaction.
 */
import { CANVAS_PRESETS, type CanvasRules, type ComplianceSpec } from '@/lib/types/canvas-document';

/** Parse a font size like "12pt", "12 pt", "12" → 12. Returns null if unparseable. */
export function parseFontPt(text: unknown): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  if (typeof text !== 'string') return null;
  const m = text.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Parse margins like "1 inch all sides", "1\"", "0.5 in", "2.54cm" → points
 * (72pt = 1in). Defaults to 72 (1in) when unparseable.
 */
export function parseMarginsToPt(text: unknown): number {
  if (typeof text === 'number' && Number.isFinite(text)) return text;
  if (typeof text !== 'string') return 72;
  const m = text.match(/(\d+(?:\.\d+)?)\s*(cm|mm|in|inch|")?/i);
  if (!m) return 72;
  const val = parseFloat(m[1]);
  const unit = (m[2] || 'in').toLowerCase();
  if (unit === 'cm') return Math.round(val * 28.3465);
  if (unit === 'mm') return Math.round(val * 2.83465);
  return Math.round(val * 72); // inch / " / default
}

/** Parse line spacing: "single"/"1.0"→1.0, "double"/"2"→2.0, "1.5"→1.5. Default 1.0. */
export function parseLineSpacing(text: unknown): number {
  if (typeof text === 'number' && Number.isFinite(text)) return text;
  if (typeof text !== 'string') return 1.0;
  const t = text.trim().toLowerCase();
  if (t.includes('double')) return 2.0;
  if (t.includes('single')) return 1.0;
  const m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 1.0;
}

export interface ArtifactSpecInput {
  /** 'narrative' | 'cost' | 'form' | 'matrix' | 'other' */
  artifactType: string;
  /** Resolved volume required-items (resolveTopicCompliance volumes[].items). */
  items: Array<Record<string, unknown>>;
  /** Merged compliance matrix (camelCase keys, from resolveTopicCompliance). */
  compliance: Record<string, unknown>;
  /**
   * THIS solicitation's own identifiers — topic number, solicitation number. Frozen onto the
   * artifact so the compliance floor can tell "our topic number" from a past proposal's, which is
   * what a draft grounded on the company's library will otherwise carry across. Omit to leave the
   * check off (a build with no identifiers recorded behaves exactly as before).
   */
  ownIdentifiers?: Array<string | null | undefined>;
}

export interface FrozenSpecs {
  formatSpec: CanvasRules;
  complianceSpec: ComplianceSpec;
}

function firstNum(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Coerce a required_sections value (array of strings or {name}/{label} objects) to string[]. */
function toSectionList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object') {
        const o = x as Record<string, unknown>;
        return String(o.name ?? o.label ?? o.title ?? '');
      }
      return '';
    })
    .filter(Boolean);
}

/**
 * Build the frozen { formatSpec, complianceSpec } for one artifact (= one volume),
 * from the volume's required-items + the merged compliance matrix. Item-level
 * specs win over the matrix; the matrix is the fallback.
 */
export function buildArtifactSpecs(input: ArtifactSpecInput): FrozenSpecs {
  const { artifactType, items, compliance } = input;
  // Deduplicated, trimmed, case-insensitive — the same number can arrive as both the topic and the
  // solicitation number, and an empty string must never become an "own identifier" that silently
  // matches everything.
  const ownIdentifiers = [...new Set(
    (input.ownIdentifiers ?? [])
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter(Boolean),
  )];

  // Pick the canvas format from the volume's item types / artifact type.
  const types = items.map((i) => String(i.itemType ?? ''));
  let presetKey: keyof typeof CANVAS_PRESETS = 'letter_standard';
  if (types.some((t) => t === 'slide_deck')) presetKey = 'slide_cso';
  else if (types.some((t) => t === 'spreadsheet') || artifactType === 'cost') presetKey = 'spreadsheet';
  const base: CanvasRules = JSON.parse(JSON.stringify(CANVAS_PRESETS[presetKey]));

  // Page / slide limits: prefer the (max) volume-item limit, fall back to the
  // matrix. Cost artifacts take the COST page limit (not the technical one), and
  // each limit is gated by format so a slide deck carries no page cap and a
  // page-based doc carries no slide cap.
  const isSlide = presetKey === 'slide_cso';
  const itemPages = items.map((i) => i.pageLimit).filter((v): v is number => typeof v === 'number');
  const itemSlides = items.map((i) => i.slideLimit).filter((v): v is number => typeof v === 'number');
  const matrixPages = artifactType === 'cost'
    ? firstNum(compliance.pageLimitCost, compliance.pageLimitTechnical)
    : firstNum(compliance.pageLimitTechnical);
  // Whole-volume page cap. When the volume's required-items declare page budgets, the volume cap is
  // their SUM (each item is a section of the volume, so the budgets add up) — NOT Math.max, which
  // took the single largest section (e.g. a 3-page SOW) as the whole-volume cap and falsely
  // throttled a 10-page Technical Volume to 3. Per-section budgets are still enforced individually by
  // sectionPageSpan; this is the volume total. A single-item volume is unchanged (sum == that item).
  // Falls back to the matrix volume limit (page_limit_technical) when no item declares a budget.
  const summedItemPages = itemPages.reduce((a, b) => a + b, 0);
  const maxPages = isSlide ? null : (itemPages.length ? summedItemPages : matrixPages);

  // Whole-volume CHARACTER cap — the third ruler, for volumes the agency measures in characters
  // rather than pages (the DoW cover sheet's two 3,000-character narratives). Like pages, the
  // items' caps SUM to the volume total; each item is still capped individually by its section's
  // character_budget, and this is the total across them.
  //
  // Deliberately NO matrix fallback. `character_limit_narrative` states the cap on the
  // solicitation's NARRATIVE SUMMARY documents — it is not a document-wide rule the way
  // page_limit_technical is, and applying it as a whole-volume default would cap the 10-page
  // Technical Volume at 3,000 characters: a limit the solicitation never states about it. A
  // volume whose items declare no character cap is unconstrained on this ruler, which is the
  // normal case for every paginated volume. Curation decides WHICH items the matrix cap governs.
  const itemChars = items.map((i) => i.characterLimit).filter((v): v is number => typeof v === 'number' && v > 0);
  const maxCharacters = itemChars.length ? itemChars.reduce((a, b) => a + b, 0) : null;
  const maxSlides = isSlide
    ? (itemSlides.length ? Math.max(...itemSlides) : firstNum(compliance.slideLimit))
    : null;

  // Fonts / margins / spacing: first item that specifies, else the matrix.
  const fontItem = items.find((i) => i.fontSize != null);
  const fontPt = parseFontPt(fontItem?.fontSize ?? compliance.fontSize) ?? base.font_default.size;
  const fontFamily = String((fontItem?.fontFamily ?? compliance.fontFamily) ?? base.font_default.family);
  const marginItem = items.find((i) => i.margins != null);
  const marginPt = parseMarginsToPt(marginItem?.margins ?? compliance.margins);
  const spacingItem = items.find((i) => i.lineSpacing != null);
  const lineSpacing = parseLineSpacing(spacingItem?.lineSpacing ?? compliance.lineSpacing);

  // Min-font enforcement floor. NUMERIC columns arrive from postgres.js as
  // STRINGS, so parse them (a typeof-number check silently drops the floor).
  const minFontItem = items.find((i) => i.minFontSize != null);
  const minFontSize = parseFontPt(minFontItem?.minFontSize ?? compliance.minFontSize);

  const imagesAllowed = compliance.imagesTablesAllowed !== false;

  // Required sections: UNION of item-level + matrix-level (a single item-level
  // hint must not drop the matrix's document-level mandatory sections).
  const requiredSections = Array.from(new Set([
    ...items.flatMap((i) => toSectionList(i.requiredSections)),
    ...toSectionList(compliance.requiredSections),
  ]));

  const headerRequired = items.some((i) => i.headerFormat != null) || compliance.headerRequired === true || !!base.header;
  const footerRequired = items.some((i) => i.footerFormat != null) || compliance.footerRequired === true || !!base.footer;

  const formatSpec: CanvasRules = {
    ...base,
    margins: { top: marginPt, right: marginPt, bottom: marginPt, left: marginPt },
    font_default: { ...base.font_default, family: fontFamily, size: fontPt },
    line_spacing: lineSpacing,
    max_pages: maxPages,
    max_slides: maxSlides,
    images_allowed: imagesAllowed,
    ...(minFontSize != null ? { min_font_size: minFontSize } : {}),
  };

  const complianceSpec: ComplianceSpec = {
    max_pages: maxPages,
    max_slides: maxSlides,
    max_characters: maxCharacters,
    min_font_size: minFontSize,
    images_allowed: imagesAllowed,
    required_sections: requiredSections,
    header_required: headerRequired,
    footer_required: footerRequired,
    ...(ownIdentifiers.length ? { own_identifiers: ownIdentifiers } : {}),
  };

  return { formatSpec, complianceSpec };
}
