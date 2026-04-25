/**
 * Universal source-anchor schema — the canonical way to point at a
 * specific location in any document across the entire system.
 *
 * Used by:
 *   - solicitation_annotations.source_location (RFP curation tags)
 *   - compliance.custom_variables[var].anchor (compliance provenance)
 *   - episodic_memories.metadata.anchor (HITL memory provenance)
 *   - library atoms (atomized company doc → source location)
 *   - proposal sections (drafted text → source requirement)
 *
 * Design principles:
 *   1. Too much metadata > not enough. Every field is optional except
 *      page + excerpt, but callers should fill as many as they can.
 *   2. excerpt is the canonical identity — text-search rendering uses
 *      it. rects are the precision layer for visual highlighting.
 *   3. Resolution-independent: rects are stored as percentages of
 *      page dimensions (0-100), not pixels. Works across zoom levels,
 *      screen DPIs, and re-renders.
 *   4. Carries structural context (section_key, section_title) so
 *      downstream consumers (agents, proposal builder) know WHERE
 *      in the document structure this anchor sits.
 *   5. Human-readable when serialized to JSON — anyone reading the
 *      database can understand what the anchor points at without
 *      needing to decode binary coordinates.
 */

/**
 * A percentage-based bounding rect within a page.
 * (0,0) = top-left of the page, (100,100) = bottom-right.
 * A selection spanning multiple lines produces multiple rects.
 */
export interface AnchorRect {
  x: number;   // % from left edge (0-100)
  y: number;   // % from top edge (0-100)
  w: number;   // % of page width
  h: number;   // % of page height
}

/**
 * Universal source anchor. Points at a specific location in a
 * specific document with enough metadata to:
 *   - Navigate to it (page + rects)
 *   - Render a highlight on it (rects or text-search fallback via excerpt)
 *   - Display provenance (document_name : page : excerpt)
 *   - Search for it (excerpt + excerpt_hash)
 *   - Trace it structurally (section_key + section_title)
 */
export interface SourceAnchor {
  // ── Document reference ────────────────────────────────────────────
  /** solicitation_documents.id — which uploaded file this points into. */
  document_id?: string;
  /** Human-readable filename for display (e.g. "DoD_SBIR_25.1_BAA.pdf"). */
  document_name?: string;

  // ── Page location ─────────────────────────────────────────────────
  /** 1-based page number. Required. */
  page: number;
  /** Number of pages this anchor spans (default 1). */
  page_count?: number;

  // ── Text content (canonical identity) ─────────────────────────────
  /** Verbatim text at this location. Required. Used for text-search
   *  rendering as the fallback when rects aren't available. */
  excerpt: string;
  /** Broader surrounding text for disambiguation when excerpt is short
   *  (e.g. excerpt="15" but context="not exceed fifteen (15) pages"). */
  excerpt_context?: string;

  // ── Character offsets (within full extracted text) ─────────────────
  /** 0-based offset from start of the document's full extracted text. */
  char_offset?: number;
  /** Length of the anchor text in characters. */
  char_length?: number;

  // ── Visual position (resolution-independent) ──────────────────────
  /** Bounding rects for visual highlighting. Multiple rects for multi-
   *  line selections. Stored as percentages of page dimensions so they
   *  survive zoom changes + re-renders. */
  rects?: AnchorRect[];

  // ── Structural context ────────────────────────────────────────────
  /** Atomized section key from the shredder (e.g. 'submission_format'). */
  section_key?: string;
  /** Human-readable section title (e.g. 'Section 3.7: Proposal Prep'). */
  section_title?: string;

  // ── Provenance metadata ───────────────────────────────────────────
  /** Who created this anchor (user id or 'ai:shredder'). */
  created_by?: string;
  /** When this anchor was created (ISO 8601). */
  created_at?: string;
  /** How this anchor was created. */
  method?: 'manual_selection' | 'ai_extraction' | 'pattern_match' | 'imported';
}

/**
 * Format an anchor as a human-readable provenance string.
 * Example: "DoD_SBIR_25.1_BAA.pdf : p.24 : 'Technical Volume shall not exceed…'"
 */
export function formatAnchorProvenance(anchor: SourceAnchor): string {
  const parts: string[] = [];
  if (anchor.document_name) parts.push(anchor.document_name);
  parts.push(`p.${anchor.page}`);
  if (anchor.excerpt) {
    const short = anchor.excerpt.length > 80
      ? anchor.excerpt.slice(0, 77) + '…'
      : anchor.excerpt;
    parts.push(`"${short}"`);
  }
  return parts.join(' : ');
}

/**
 * Compute character offset within a full text string by searching
 * for the excerpt. Returns the 0-based offset, or undefined if
 * not found. Used when the selection doesn't provide char_offset.
 */
export function findCharOffset(fullText: string, excerpt: string): number | undefined {
  const idx = fullText.indexOf(excerpt);
  if (idx >= 0) return idx;
  // Try case-insensitive
  const idxCI = fullText.toLowerCase().indexOf(excerpt.toLowerCase());
  return idxCI >= 0 ? idxCI : undefined;
}
