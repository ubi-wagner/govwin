/**
 * Ingest Assist — the DETERMINISTIC extractor (`pattern_match`).
 *
 * Reads the shredded solicitation text and lifts ONLY the rules whose wording is
 * unambiguous, each carrying a citable `SourceAnchor` back into the document. No API key,
 * no model, no network — same text in, same rules out, every time.
 *
 * WHY THIS EXISTS. Ingest Assist had exactly two outcomes: an AI parse, or
 * DEFAULT_SBIR_CSO_SKELETON. With no key (or a stub emulator) every solicitation got the
 * defaults, and — before migration 187 — they landed in `solicitation_compliance`
 * indistinguishable from rules actually read out of the document. Proven live on the DoW
 * 2026 SBIR BAA, where the matrix came back byte-identical whether the shredder had
 * extracted 0 characters or 165,268, asserting a 10-page limit and Times New Roman that
 * appear NOWHERE in that BAA.
 *
 * THE DISCIPLINE. This module is deliberately narrow, and that narrowness is the feature:
 *
 *   1. It extracts only what it can PROVE. A field with no confident match is simply
 *      absent from the result — never guessed, never defaulted. Absence here means "the
 *      deterministic layer has nothing", and the caller falls back explicitly.
 *   2. ABSENCE IS ITSELF A FINDING. When the text says the page limit lives in the
 *      Component-specific instructions, that is recorded as a DEFERRAL — a positive
 *      statement that this document sets no limit. Silence and deferral are different
 *      facts, and a curator needs to see which one they have.
 *   3. Every value carries evidence: the matching excerpt, its character offset in the
 *      full text, and (when the text has page markers) the page. That is what makes
 *      `pattern_match` a stronger provenance tier than `ai` — the value is not merely
 *      asserted, it is CITED, and a curator can check it in one glance.
 *
 * TRUST ORDER (migration 187): hitl > verified > override > pattern_match > ai > default.
 *
 * PURE + DB-FREE, like skeleton.ts, so it stays unit-testable and can run anywhere in the
 * ingest spine (route, agent tool, or worker).
 */
import type { SourceAnchor } from '@/lib/types/source-anchor';
import type { ParsedCompliance, ParsedVolume } from './skeleton';

// ── Result shape ────────────────────────────────────────────────────────────

export interface PatternEvidence {
  /** Which rule fired (stable id — safe to show, log, and assert on in tests). */
  rule: string;
  /** Citable pointer back into the source document. */
  anchor: SourceAnchor;
  /**
   * False when the text carried no page markers — `anchor.page` is then a placeholder and
   * the excerpt (text search) is the only reliable locator. Never claim a page we did not
   * actually resolve.
   */
  pageResolved: boolean;
  /**
   * 1-based index of the DOCUMENT the anchor sits in. A solicitation's `full_text` is the
   * concatenation of every shredded `solicitation_documents` row, so page numbering restarts
   * at each boundary — "p.13" is meaningless without saying p.13 of WHICH file. null when the
   * text holds a single document.
   */
  docSegment: number | null;
  /** Page count of that document, read off its own "N of M" markers. */
  docSegmentPages: number | null;
}

/** A rule the document explicitly declines to set — an ANSWER, not a gap. */
export interface PatternDeferral {
  /** Compliance column the deferral applies to. */
  field: string;
  /** Where the rule actually lives, in the document's own words. */
  reason: string;
  anchor: SourceAnchor;
  pageResolved: boolean;
  docSegment: number | null;
  docSegmentPages: number | null;
}

export interface PatternExtraction {
  /** Only PROVEN fields are present. An absent key means "nothing found", never "no rule". */
  compliance: ParsedCompliance;
  /** Volume list, only when the document names a contiguous set (Volume 1..N). Else []. */
  volumes: ParsedVolume[];
  /** Evidence keyed by compliance COLUMN name (page_limit_technical, min_font_size, …). */
  evidence: Record<string, PatternEvidence>;
  /** Fields the document explicitly defers elsewhere (e.g. Component-specific instructions). */
  deferrals: PatternDeferral[];
  /** Human-readable findings with no column of their own (deadline time, media bans, …). */
  notes: string[];
  /** True when at least one compliance field or the volume list was proven. */
  hasAny: boolean;
}

/** Guard for the callers: is there enough source text to attempt an extraction at all? */
export const MIN_USABLE_TEXT_CHARS = 200;
export function hasUsableSourceText(text: string | null | undefined): boolean {
  return !!text && text.trim().length >= MIN_USABLE_TEXT_CHARS;
}

// ── Whitespace-normalized view (with an offset map back to the original) ────
//
// The shredder wraps mid-sentence, so the rules must match across newlines:
//   "…(no type smaller than 10-point on standard 8-1/2\" x\n11\" paper with one-inch margins…"
// Matching on a normalized copy makes every rule a plain single-line regex, and the offset
// map keeps each anchor pointing at the REAL character position in `full_text`.

interface NormalizedText { norm: string; map: number[] }

function normalize(text: string): NormalizedText {
  const norm: string[] = [];
  const map: number[] = [];
  let pendingSpace = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === ' ') {
      pendingSpace = norm.length > 0;
      continue;
    }
    if (pendingSpace) { norm.push(' '); map.push(i); pendingSpace = false; }
    norm.push(c); map.push(i);
  }
  return { norm: norm.join(''), map };
}

/** Curly quotes/dashes vary by extractor — fold them so one rule covers every variant. */
function fold(s: string): string {
  return s
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/½/g, '1/2');
}

// ── Page index ──────────────────────────────────────────────────────────────
//
// Page numbers come from whatever markers the source actually carries — a printed
// "-- 12 of 50 --" footer, a "Page 12" line, or a form feed. We NEVER synthesize one: with
// no markers `pageResolved` is false and the excerpt is the locator.
//
// A solicitation's `full_text` is every shredded document concatenated, so the numbering
// RESTARTS at each file boundary — the live DoW BAA ingest runs 1…50 (the BAA) then 1…4
// (the topic). A naive "must ascend" check reads that restart as a broken scheme and throws
// away every page number in the document. Instead we SEGMENT on the restart and keep the
// per-document page, which is the number a curator can actually act on.

interface PageMark { offset: number; page: number; total: number; segment: number }
interface PageIndex { marks: PageMark[]; resolved: boolean; segments: number }

const PAGE_MARKER_RES: RegExp[] = [
  /^[ \t]*-{2,}[ \t]*(?:page[ \t]*)?(\d{1,4})[ \t]+of[ \t]+(\d{1,4})[ \t]*-{2,}[ \t]*$/gim,
  /^[ \t]*\[?[ \t]*page[ \t]+(\d{1,4})(?:[ \t]+of[ \t]+(\d{1,4}))?[ \t]*\]?[ \t]*$/gim,
];

function buildPageIndex(text: string): PageIndex {
  for (const re of PAGE_MARKER_RES) {
    const marks: PageMark[] = [];
    let segment = 0;
    let prev: PageMark | null = null;
    let ok = true;
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const page = parseInt(m[1], 10);
      const total = m[2] ? parseInt(m[2], 10) : 0;
      if (!Number.isFinite(page) || page < 1) { ok = false; break; }
      if (prev && (page <= prev.page || total !== prev.total)) {
        // A restart is a document boundary — but only a restart AT PAGE 1 of a new total.
        // Anything else (7, 3, 9) is not a paging scheme at all and must not be trusted.
        if (page !== 1) { ok = false; break; }
        segment++;
      }
      const mk: PageMark = { offset: m.index, page, total, segment };
      marks.push(mk);
      prev = mk;
    }
    // Three markers is enough to trust the scheme; fewer is likely a false positive
    // (a table row, a cross-reference) and would mis-cite every anchor.
    if (ok && marks.length >= 3) return { marks, resolved: true, segments: segment + 1 };
  }
  // Form-feed paging: each \f ENDS a page, same as a printed footer.
  const ff: PageMark[] = [];
  for (let i = text.indexOf('\f'); i >= 0; i = text.indexOf('\f', i + 1)) {
    ff.push({ offset: i, page: ff.length + 1, total: 0, segment: 0 });
  }
  if (ff.length >= 3) return { marks: ff, resolved: true, segments: 1 };
  return { marks: [], resolved: false, segments: 0 };
}

interface PageHit { page: number; segment: number | null; segmentPages: number | null }

/** The page an offset sits on: the first marker AT OR AFTER it (a marker ends its page). */
function pageAt(idx: PageIndex, offset: number): PageHit {
  if (!idx.resolved) return { page: 1, segment: null, segmentPages: null };
  const mk = idx.marks.find((k) => k.offset >= offset) ?? idx.marks[idx.marks.length - 1];
  return {
    page: mk.page,
    segment: idx.segments > 1 ? mk.segment + 1 : null,
    segmentPages: mk.total > 0 ? mk.total : null,
  };
}

// ── Rule engine ─────────────────────────────────────────────────────────────

type RuleValue = string | number | boolean;

interface Rule {
  id: string;
  /** Compliance column, or a `~pseudo` key that only feeds composition/notes. */
  field: string;
  re: RegExp;
  /** Return undefined to REJECT a syntactic match that fails its semantic bounds. */
  value: (m: RegExpExecArray) => RuleValue | undefined;
}

const int = (s: string | undefined, min: number, max: number): number | undefined => {
  const n = s == null ? NaN : parseInt(s, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, half: 0.5 };
const inches = (w: string): string | undefined => {
  const n = WORD_NUM[w.toLowerCase()] ?? parseInt(w, 10);
  return Number.isFinite(n) && n > 0 && n <= 3 ? `${n} inch (all sides)` : undefined;
};

/**
 * Typefaces we will name. A bare capitalized word near "font" is not enough — the token has
 * to be a real typeface, or "…font of the Government's choosing" becomes a mandate.
 */
const TYPEFACES = 'Times New Roman|Times Roman|Arial|Calibri|Helvetica|Georgia|Cambria|Garamond|Verdana|Tahoma|Book Antiqua';

const RULES: Rule[] = [
  // ── minimum font size ──
  { id: 'min_font.no_smaller_than', field: 'min_font_size',
    re: /\bno\s+(?:type|font)(?:\s+size)?\s+smaller\s+than\s+(\d{1,2})[-\s]?(?:point|pt)\b/i,
    value: (m) => int(m[1], 6, 24) },
  { id: 'min_font.minimum_of', field: 'min_font_size',
    re: /\b(?:minimum|min\.?)\s+(?:font|type)\s*(?:size)?\s*(?:of|:|is)?\s*(\d{1,2})[-\s]?(?:point|pt)\b/i,
    value: (m) => int(m[1], 6, 24) },
  { id: 'min_font.at_least', field: 'min_font_size',
    re: /\b(?:font|type)\s*(?:size)?\s*(?:must|shall|should)\s+be\s+(?:at\s+least\s+)?(\d{1,2})[-\s]?(?:point|pt)\b/i,
    value: (m) => int(m[1], 6, 24) },

  // ── margins ──
  { id: 'margins.on_all_sides', field: 'margins',
    re: /\b(?:page\s+)?margins?\s+(one|two|1|2)[-\s]inch(?:es)?\s+on\s+all\s+sides\b/i,
    value: (m) => inches(m[1]) },
  { id: 'margins.n_inch_all_sides', field: 'margins',
    re: /\b(one|two|1|2)[-\s]inch\s+margins\s+on\s+all\s+sides\b/i,
    value: (m) => inches(m[1]) },
  { id: 'margins.with_n_inch', field: 'margins',
    re: /\bwith\s+(one|two|1|2)[-\s]inch\s+margins\b/i,
    value: (m) => inches(m[1]) },

  // ── technical-volume page limit (POSITIVE forms only — the deferral rules run separately) ──
  // ANCHORED forms first. A solicitation states several page caps — the DoW T3CP Component
  // instructions cap the Technical Volume at 10 AND a Volume 5 feasibility summary at 3 — and
  // the generic patterns below match both. Whichever appears first in the text would win, which
  // is luck, not reading. These rules require the cap to be stated ABOUT the Technical Volume.
  { id: 'page_limit.technical_volume_not_exceed', field: 'page_limit_technical',
    re: /\btechnical\s+volume\b[^.]{0,80}?\b(?:shall|must|may|will|is|are)\s+not\s+(?:to\s+)?exceed\s+(?:\w+\s+)?\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.technical_volume_limited', field: 'page_limit_technical',
    re: /\btechnical\s+volume\b[^.]{0,80}?\b(?:limited\s+to|maximum\s+of|no\s+more\s+than)\s+(?:\w+\s+)?\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.not_exceed', field: 'page_limit_technical',
    re: /\b(?:shall|must|may|will|is|are)\s+not\s+(?:to\s+)?exceed\s+(?:\w+\s+)?\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.limited_to', field: 'page_limit_technical',
    re: /\blimited\s+to\s+(?:\w+\s+)?\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.n_page_limit', field: 'page_limit_technical',
    re: /\b(\d{1,3})[-\s]page\s+(?:limit|maximum)\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.maximum_of', field: 'page_limit_technical',
    re: /\bmaximum\s+of\s+\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },
  { id: 'page_limit.no_more_than', field: 'page_limit_technical',
    re: /\bno\s+more\s+than\s+\(?(\d{1,3})\)?\s+pages\b/i,
    value: (m) => int(m[1], 1, 100) },

  // ── narrative CHARACTER cap ──
  // A different ruler from pages: the cover-sheet abstract, project summary and anticipated-
  // benefits discussion are pasted into fixed-size agency form fields that truncate at the cap.
  // The DoW 2026 BAA states it as "Each section should be no more than 3,000 characters."
  // The bound is 100..100,000: below 100 the match is almost always a stray count in prose
  // ("within 30 characters of..."), and no agency narrative field runs past six figures.
  { id: 'character_limit.no_more_than', field: 'character_limit_narrative',
    re: /\bno\s+more\s+than\s+\(?([\d,]{3,7})\)?\s+characters\b/i,
    value: (m) => int(m[1].replace(/,/g, ''), 100, 100_000) },
  { id: 'character_limit.limit_to', field: 'character_limit_narrative',
    re: /\blimit(?:ed)?\s+to\s+\(?([\d,]{3,7})\)?\s+characters\b/i,
    value: (m) => int(m[1].replace(/,/g, ''), 100, 100_000) },
  { id: 'character_limit.not_exceed', field: 'character_limit_narrative',
    re: /\b(?:shall|must|may|will|is|are|should)\s+not\s+(?:to\s+)?exceed\s+\(?([\d,]{3,7})\)?\s+characters\b/i,
    value: (m) => int(m[1].replace(/,/g, ''), 100, 100_000) },
  { id: 'character_limit.maximum_of', field: 'character_limit_narrative',
    re: /\bmaximum\s+of\s+\(?([\d,]{3,7})\)?\s+characters\b/i,
    value: (m) => int(m[1].replace(/,/g, ''), 100, 100_000) },
  { id: 'character_limit.n_character_limit', field: 'character_limit_narrative',
    re: /\b([\d,]{3,7})[-\s]character\s+(?:limit|maximum)\b/i,
    value: (m) => int(m[1].replace(/,/g, ''), 100, 100_000) },

  // ── typeface (only when a typeface NAME sits beside a font/typeface token) ──
  { id: 'font_family.font_then_name', field: 'font_family',
    re: new RegExp(`\\b(?:font|typeface|type\\s*face)\\b[^.]{0,60}?\\b(${TYPEFACES})\\b`, 'i'),
    value: (m) => m[1] },
  { id: 'font_family.name_then_font', field: 'font_family',
    re: new RegExp(`\\b(${TYPEFACES})\\b[^.]{0,40}?\\b(?:font|typeface|type\\s*face)\\b`, 'i'),
    value: (m) => m[1] },

  // ── layout fragments (compose submission_format; never a column of their own) ──
  { id: 'layout.single_column', field: '~single_column',
    re: /\bsingle[-\s]column\b/i, value: () => true },
  { id: 'layout.single_spaced', field: '~single_spaced',
    re: /\bsingle[-\s]spaced\b/i, value: () => true },
  { id: 'layout.double_spaced', field: '~double_spaced',
    re: /\bdouble[-\s]spaced\b/i, value: () => true },
  { id: 'layout.paper_letter', field: '~paper',
    re: /\b8\s*(?:1\/2|\.5)?\s*["'″′]?\s*[x×]\s*11\b/i,
    value: () => '8.5 x 11 in' },

  // ── findings with no column — surfaced as curator notes ──
  { id: 'note.deadline_time', field: '~deadline_time',
    re: /\bno\s+later\s+than\s+(\d{1,2}:\d{2}\s*[ap]\.?\s?m\.?)\s*(ET|EST|EDT|PT|PST|PDT|CT|MT)\b/i,
    value: (m) => `${m[1].replace(/\s+/g, '')} ${m[2].toUpperCase()}` },
  { id: 'note.no_active_media', field: '~no_active_media',
    re: /\bdo\s+not\s+(?:include\s+or\s+embed|embed|include)\s+active\s+graphics\b/i,
    value: () => true },
  { id: 'note.no_encryption', field: '~no_encryption',
    re: /\bdo\s+not\s+lock,?\s*(?:password\s+protect,?\s*)?(?:or\s+)?encrypt\b/i,
    value: () => true },
];

/* ── Component-scoped rules must not become solicitation-wide ────────────────────────────────
 *
 * A joint BAA is not one voice. The DoW 2026 SBIR BAA sets the common rules and then carries each
 * Service's own instructions INLINE, under its own heading, each of which may override. Measured on
 * the real R1 document, the anchored technical-volume rule matched this line on page 31:
 *
 *     "• DON Phase I Technical Volume (Volume 2) page limit is not to exceed 10 pages."
 *
 * — one bullet below "The information provided in the DON Proposal Submission Instructions takes
 * precedence over the DoW Instructions posted for this BAA." That is a NAVY rule. It became the
 * solicitation-wide page_limit_technical = 10, stamped `pattern_match`, and an Air Force or Army
 * proposer was told their technical volume was capped at 10 pages on the authority of a Navy
 * instruction.
 *
 * This is worse than the fabricated default the provenance doctrine was written against. A default
 * is badged red, "Default — unverified", and invites challenge. This arrived badged "Read from
 * source" with a page number and a verbatim excerpt — MORE credible than a default, and wrong.
 *
 * Two things made it invisible, and both are fixed here:
 *
 *   1. The match ANCHORS on "technical volume", so the excerpt began there and the "DON" that
 *      disqualified it sat just outside the quoted span. A reviewer checking the citation saw a
 *      sentence that read as document-wide. The excerpt now extends left to the start of its own
 *      sentence or bullet, so the qualifier travels WITH the evidence.
 *   2. Nothing looked for the qualifier. A positive match whose own sentence names a specific
 *      Component is now rejected as a solicitation-wide value and recorded as a note instead, which
 *      also lets the DEFERRAL rules below run — and the deferral is the truth for the document as a
 *      whole: this BAA does defer the technical-volume page limit to the Component instructions.
 *
 * Scope note: this is deliberately NOT applied to every field. A Component qualifier on a font or
 * margin rule is usually restating the common rule, and suppressing those would lose real
 * information. It is applied to the fields where a Component override is both common and
 * consequential — the page and character limits that gate a submission.
 */
const COMPONENT_QUALIFIER =
  /\b(?:DON|DoN|DAF|USAF|DHA|MDA|DTRA|DARPA|SOCOM|NGA|NRO|NAVAIR|NAVSEA|NAVWAR|SPAWAR|CBD|USSF|DLA|OSD)\b|\bDepartment\s+of\s+the\s+(?:Navy|Army|Air\s+Force)\b|\b(?:Air\s+Force|Army|Navy|Space\s+Force|Marine\s+Corps)\b/;

/** Fields where a Component override is common AND consequential enough to reject document-wide. */
const COMPONENT_SCOPED_FIELDS = new Set(['page_limit_technical', 'character_limit_narrative']);

/** Widen a match back to the start of its own sentence or bullet, so qualifiers stay visible. */
const SENTENCE_LOOKBACK = 240;
function sentenceAround(norm: string, start: number, end: number): string {
  const from = Math.max(0, start - SENTENCE_LOOKBACK);
  const before = norm.slice(from, start);
  // Nearest sentence end, bullet, or list marker to the LEFT — whichever is closest to the match.
  const cut = Math.max(
    before.lastIndexOf('. '), before.lastIndexOf('•'), before.lastIndexOf('; '),
    before.lastIndexOf(': '), before.lastIndexOf('- '),
  );
  const head = cut >= 0 ? before.slice(cut + 1) : before;
  return `${head}${norm.slice(start, end)}`.replace(/\s+/g, ' ').trim();
}

/** The document says the rule lives elsewhere — a positive fact, not a missing value. */
const DEFERRAL_RULES: Array<{ id: string; field: string; re: RegExp; reason: string }> = [
  { id: 'page_limit.deferred_component_a', field: 'page_limit_technical',
    re: /\brefer\s+to\s+[^.]{0,120}?Component[-\s]specific[^.]{0,140}?page\s+limit/i,
    reason: 'The solicitation defers the technical-volume page limit to the Service/Component-specific topic instructions.' },
  { id: 'page_limit.deferred_component_b', field: 'page_limit_technical',
    re: /\bpage\s+limits?\b[^.]{0,140}?Component[-\s]specific/i,
    reason: 'The solicitation defers the technical-volume page limit to the Service/Component-specific instructions.' },
  { id: 'page_limit.deferred_topic', field: 'page_limit_technical',
    re: /\bpage\s+limits?\b[^.]{0,100}?\b(?:specified|stated|found)\s+in\s+the\s+topic\b/i,
    reason: 'The solicitation defers the page limit to the individual topic.' },
];

// ── Line-oriented rules (lists keep their line structure; run them on the RAW text) ──

// "a. \tVolume 1: Proposal Cover Sheet". The separator is deliberately NOT `.` — a period after
// the number is a sentence end, not a title separator, and admitting it turns prose like
// "…upload this form to Volume 5. For additional details…" into a volume named
// "For additional details" (a real line in the DoW T3CP Component instructions).
const VOLUME_LINE_RE = /^[^\n]{0,12}?\bVolume\s+(\d{1,2})\s*[:–-]\s*(.{3,110})$/i;

/** "Volume 1: Proposal Cover Sheet" … a contiguous 1..N run is the document's volume list. */
function extractVolumes(text: string, idx: PageIndex): { volumes: ParsedVolume[]; cited: Cited | null } {
  const found = new Map<number, { name: string; offset: number }>();
  let offset = 0;
  for (const line of text.split('\n')) {
    const m = VOLUME_LINE_RE.exec(fold(line).trim());
    if (m) {
      const n = parseInt(m[1], 10);
      const name = m[2].replace(/\s+/g, ' ').replace(/[.;,\s]+$/, '').trim();
      // First mention wins — later ones are template headers and cross-references.
      if (n >= 1 && n <= 20 && name && !found.has(n)) found.set(n, { name, offset });
    }
    offset += line.length + 1;
  }
  // Require a contiguous run from 1. A stray "Volume 3: …" cross-reference must not become
  // a one-volume skeleton that silently replaces the six-volume default.
  const volumes: ParsedVolume[] = [];
  let first: number | null = null;
  for (let n = 1; found.has(n); n++) {
    const v = found.get(n)!;
    if (first === null) first = v.offset;
    volumes.push({ name: v.name, format: 'dsip_standard', items: [] });
  }
  if (volumes.length < 3 || first === null) return { volumes: [], cited: null };
  return {
    volumes,
    cited: cite(text, idx, first, `Volume 1: ${volumes[0].name}`, 'volumes'),
  };
}

const SECTION_ANCHOR_RE = /(?:cover|contain|include|address)\s+the\s+following\s+(?:items|sections|elements)?\s*(?:in\s+the\s+order\s+given\s+below)?\s*:/i;
const NUMBERED_LINE_RE = /^\s*(\d{1,2})[.)]\s*\t?\s*(.+)$/;

/**
 * The mandated Technical Volume section order, read off the document's own numbered list.
 * Continuation lines are joined (item 12 of the DoW BAA wraps across two lines), and the
 * walk stops the moment the numbering breaks — so a following unrelated list can't bleed in.
 */
function extractRequiredSections(text: string, idx: PageIndex): { sections: string[]; cited: Cited | null } {
  const lines = text.split('\n');
  const offsets: number[] = [];
  { let o = 0; for (const l of lines) { offsets.push(o); o += l.length + 1; } }

  for (let i = 0; i < lines.length; i++) {
    if (!SECTION_ANCHOR_RE.test(lines[i])) continue;
    const sections: string[] = [];
    let expect = 1;
    for (let j = i + 1; j < lines.length && j < i + 80; j++) {
      const line = lines[j];
      if (!line.trim()) { if (sections.length) continue; else continue; }
      const m = NUMBERED_LINE_RE.exec(line);
      if (m && parseInt(m[1], 10) === expect) {
        sections.push(m[2].replace(/\s+/g, ' ').trim());
        expect++;
        continue;
      }
      if (m) break;                       // numbering jumped — a different list
      if (!sections.length) break;        // prose before the list even started
      // Continuation of the previous item (wrapped line) — join it, but only plain prose.
      if (/^[a-z(“"']/.test(line.trim()) || /^[A-Z][a-z]/.test(line.trim())) {
        const prev = sections.length - 1;
        const joined = `${sections[prev]} ${line.replace(/\s+/g, ' ').trim()}`;
        if (joined.length <= 220) { sections[prev] = joined; continue; }
      }
      break;
    }
    if (sections.length >= 4) {
      return {
        sections: sections.map((s) => s.replace(/[.;,\s]+$/, '')),
        cited: cite(text, idx, offsets[i], lines[i].replace(/\s+/g, ' ').trim(), 'required_sections'),
      };
    }
  }
  return { sections: [], cited: null };
}

// ── Anchor construction ─────────────────────────────────────────────────────

const EXCERPT_PAD = 70;
const EXCERPT_MAX = 260;

interface Cited { anchor: SourceAnchor; pageResolved: boolean; docSegment: number | null; docSegmentPages: number | null }

/** Build the citation for a match: the anchor plus which document/page it was found in. */
function cite(
  text: string, idx: PageIndex, offset: number, excerpt: string, sectionKey: string,
): Cited {
  const from = Math.max(0, offset - EXCERPT_PAD);
  const context = text.slice(from, Math.min(text.length, offset + EXCERPT_MAX)).replace(/\s+/g, ' ').trim();
  const hit = pageAt(idx, offset);
  return {
    anchor: {
      page: hit.page,
      excerpt: excerpt.length > EXCERPT_MAX ? `${excerpt.slice(0, EXCERPT_MAX - 1)}…` : excerpt,
      excerpt_context: context || undefined,
      char_offset: offset,
      char_length: excerpt.length,
      section_key: sectionKey,
      method: 'pattern_match',
    },
    pageResolved: idx.resolved,
    docSegment: hit.segment,
    docSegmentPages: hit.segmentPages,
  };
}

// ── The extractor ───────────────────────────────────────────────────────────

/**
 * Extract every rule this document states unambiguously.
 *
 * Returns ONLY proven values. Callers layer their own fallbacks on top and record the
 * per-field provenance — see parseSolicitation, which merges pattern → ai → default.
 */
export function extractByPattern(text: string): PatternExtraction {
  const empty: PatternExtraction = {
    compliance: {}, volumes: [], evidence: {}, deferrals: [], notes: [], hasAny: false,
  };
  if (!hasUsableSourceText(text)) return empty;

  const raw = fold(text);
  const { norm, map } = normalize(raw);
  const idx = buildPageIndex(raw);

  const compliance: ParsedCompliance = {};
  const evidence: Record<string, PatternEvidence> = {};
  const pseudo: Record<string, { value: RuleValue; offset: number; excerpt: string }> = {};

  const componentScoped: string[] = [];
  const componentLocked = new Set<string>();
  for (const rule of RULES) {
    if (evidence[rule.field] || pseudo[rule.field]) continue;   // first (strongest) rule wins
    // Once the STRONGEST evidence for a field turned out to be Component-scoped, the weaker rules
    // below it cannot outrank it. Measured: after the anchored DON rule was rejected, the generic
    // `page_limit.n_page_limit` matched "Include, within the 10-page limit" nine pages later — a
    // back-reference to the very rule just rejected, in the same Component's section, and it does
    // not even name a volume. Letting an unanchored fragment fill a field whose best evidence was
    // disqualified reintroduces the bug through the back door.
    if (componentLocked.has(rule.field)) continue;
    const m = rule.re.exec(norm);
    if (!m) continue;
    const value = rule.value(m);
    if (value === undefined) continue;

    const offset = map[m.index] ?? 0;
    // The excerpt is the EVIDENCE a reviewer checks, so quote the whole statement — not just the
    // span the regex happened to anchor on. See COMPONENT_QUALIFIER above: the disqualifying word
    // sat one token to the left of the match, outside the quote, and that is what hid the bug.
    const excerpt = sentenceAround(norm, m.index, m.index + m[0].length);
    if (rule.field.startsWith('~')) { pseudo[rule.field] = { value, offset, excerpt }; continue; }

    // A rule stated for ONE Component is not this solicitation's rule. Record it, do not adopt it,
    // and leave the field open so the deferral rules can explain the empty cell honestly.
    if (COMPONENT_SCOPED_FIELDS.has(rule.field) && COMPONENT_QUALIFIER.test(excerpt)) {
      componentLocked.add(rule.field);
      componentScoped.push(
        `A Component-specific ${rule.field.replace(/_/g, ' ')} appears in this document and was NOT `
        + `applied solicitation-wide — it binds only that Component: "${excerpt}"`,
      );
      continue;
    }

    (compliance as Record<string, unknown>)[toCamel(rule.field)] = value;
    evidence[rule.field] = { rule: rule.id, ...cite(raw, idx, offset, excerpt, rule.field) };
  }

  // ── deferrals ──
  // A deferral explains an EMPTY cell. If the same ingest already produced a cited value for
  // that field, the cell is not empty and the deferral is stale — this is the ordinary case for
  // a multi-document solicitation: the BAA says "the page limit is in the Component-specific
  // instructions", and those instructions are attached and state 10. The value wins, and it
  // carries a citation into the document that actually set it.
  const deferrals: PatternDeferral[] = [];
  const seenDeferral = new Set<string>();
  for (const d of DEFERRAL_RULES) {
    if (seenDeferral.has(d.field) || evidence[d.field]) continue;
    const m = d.re.exec(norm);
    if (!m) continue;
    seenDeferral.add(d.field);
    deferrals.push({
      field: d.field,
      reason: d.reason,
      ...cite(raw, idx, map[m.index] ?? 0, m[0].trim(), d.field),
    });
  }

  // ── composed submission_format (only from PROVEN fragments) ──
  const parts: string[] = [];
  const partOffsets: number[] = [];
  const take = (key: string, render: (v: RuleValue) => string) => {
    const p = pseudo[key];
    if (p) { parts.push(render(p.value)); partOffsets.push(p.offset); }
  };
  take('~paper', (v) => String(v));
  take('~single_column', () => 'single column');
  take('~single_spaced', () => 'single-spaced');
  take('~double_spaced', () => 'double-spaced');
  if (compliance.margins) parts.push(String(compliance.margins));
  if (compliance.minFontSize) parts.push(`${compliance.minFontSize}-pt minimum font`);
  if (parts.length >= 2) {
    compliance.submissionFormat = `${parts.join(', ')}.`;
    const off = partOffsets.length ? Math.min(...partOffsets) : (evidence.margins?.anchor.char_offset ?? 0);
    evidence.submission_format = {
      rule: 'submission_format.composed',
      ...cite(raw, idx, off, compliance.submissionFormat, 'submission_format'),
    };
  }

  // ── line-oriented lists ──
  const { volumes, cited: volCited } = extractVolumes(raw, idx);
  if (volCited) evidence.volumes = { rule: 'volumes.numbered_list', ...volCited };

  const { sections, cited: secCited } = extractRequiredSections(raw, idx);
  if (sections.length && secCited) {
    compliance.requiredSections = sections;
    evidence.required_sections = { rule: 'required_sections.ordered_list', ...secCited };
  }

  // ── notes ──
  const notes: string[] = [];
  if (pseudo['~deadline_time']) notes.push(`Submission deadline time: ${pseudo['~deadline_time'].value}.`);
  if (pseudo['~no_active_media']) notes.push('Active graphics (video, animation, embedded media) are prohibited in the uploaded file.');
  if (pseudo['~no_encryption']) notes.push('The uploaded file must not be locked, password-protected, or encrypted.');
  for (const d of deferrals) notes.push(d.reason);
  // A Component rule we declined to adopt is a FINDING, not a discard: the curator needs to know
  // the document contains it, so they can apply it if this build is for that Component. Deduped —
  // several rules can match the same sentence, and the curator should read it once.
  for (const c of new Set(componentScoped)) notes.push(c);
  if (!idx.resolved) notes.push('No page markers in the extracted text — evidence cites excerpts, not page numbers.');
  if (idx.segments > 1) {
    notes.push(
      `Extracted text spans ${idx.segments} documents (page numbering restarts at each) — ` +
      'each citation names the document it was read from.',
    );
  }

  const hasAny = Object.keys(evidence).length > 0 || volumes.length > 0;
  return { compliance, volumes, evidence, deferrals, notes, hasAny };
}

/** page_limit_technical → pageLimitTechnical (the ParsedCompliance field names). */
function toCamel(col: string): string {
  return col.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
