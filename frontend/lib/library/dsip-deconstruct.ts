/**
 * DSIP full-proposal deconstruct — the deterministic volume segmenter.
 *
 * A submitted DSIP (Defense SBIR/STTR Innovation Portal) proposal downloads as ONE merged
 * PDF: Volume 1 (Proposal Cover Sheet) · Volume 2 (Technical Volume) · Volume 3 (Cost
 * Volume) · Volume 4 (Company Commercialization Report) · Volume 5 (Supporting Documents)
 * (+ sometimes Volume 6, the Fraud/Waste/Abuse training certificate). This module finds
 * those volume boundaries so the package atomizer can deconstruct the single upload into
 * per-volume FOUNDATION documents + volume-tagged primitives — the exact inverse of
 * provision → build → package.
 *
 * TWO entries over one matcher:
 *   • detectDsipFromBlocks — over the document reader's heading-grouped blocks (the shape
 *     `planDocumentAtomization` actually has; a marker is a block HEADING or a short
 *     standalone block, so the reader's space-joined block text can't hide one).
 *   • detectDsipProposal — over raw multi-line text (line = unit), for callers that only
 *     hold extracted text.
 *
 * Doctrine (docs/INGEST_PROVENANCE.md): DB-free, key-free, DETERMINISTIC — a volume
 * boundary is only ever a label the document itself carries, and every segment CITES the
 * matched marker. No marker → no segment → no fabricated structure.
 */

export interface DsipVolumeMeta { name: string; volKey: string | null }

const VOLUME_META: Record<number, DsipVolumeMeta> = {
  1: { name: 'Proposal Cover Sheet', volKey: 'overview' },
  2: { name: 'Technical Volume', volKey: 'technical' },
  3: { name: 'Cost Volume', volKey: 'cost' },
  4: { name: 'Company Commercialization Report', volKey: 'commercialization' },
  5: { name: 'Supporting Documents', volKey: 'supporting' },
  6: { name: 'Fraud, Waste and Abuse Training', volKey: 'supporting' },
};

// A marker must be a SHORT standalone label (volume separators/cover pages print them
// standalone; prose like "as described in Volume 3 of this proposal" is never a whole
// short label and never a heading of that shape).
const MAX_MARKER_LEN = 90;

// "Volume 2", "Vol. 2 — Technical Volume", "VOLUME 3: Cost Proposal", …
const NUMBERED_RE = /^(?:volume|vol\.?)\s*(?:no\.?|number)?\s*#?\s*([1-6])\b\s*[-–—:.)]?\s*(.{0,70})$/i;

// Name-only separators (some merges omit the number on interior cover pages).
const NAMED_RES: Array<{ volume: number; re: RegExp }> = [
  { volume: 1, re: /^(?:proposal\s+)?cover\s+sheets?$/i },
  { volume: 2, re: /^technical\s+(?:volume|proposal)$/i },
  { volume: 3, re: /^cost\s+(?:volume|proposal)$/i },
  { volume: 4, re: /^(?:company\s+)?commercialization\s+report$/i },
  { volume: 5, re: /^supporting\s+documents?$/i },
  { volume: 6, re: /^fraud,?\s+waste,?\s+(?:and|&)\s+abuse\b.{0,40}$/i },
];

/** Match ONE candidate label. Returns the labeled volume number, or null. */
export function matchVolumeMarker(label: string | null | undefined): number | null {
  const line = (label ?? '').trim();
  if (!line || line.length > MAX_MARKER_LEN) return null;
  const m = NUMBERED_RE.exec(line);
  if (m) return Number(m[1]);
  const named = NAMED_RES.find((n) => n.re.test(line));
  return named ? named.volume : null;
}

interface UnitMarker { volume: number; unitIndex: number; label: string }

/** First sighting per volume number across ordered units (DSIP page furniture repeats the
 *  volume label on every page of that volume — dedupe keeps one segment per volume). */
function findMarkers(labels: Array<string | null>): UnitMarker[] {
  const first = new Map<number, UnitMarker>();
  labels.forEach((label, unitIndex) => {
    const volume = matchVolumeMarker(label);
    if (volume != null && !first.has(volume)) first.set(volume, { volume, unitIndex, label: (label ?? '').trim() });
  });
  return [...first.values()].sort((a, b) => a.unitIndex - b.unitIndex);
}

/** `declared` = the uploader SAID this is a complete past proposal: 2+ distinct volumes
 *  suffice. Undeclared auto-detection is deliberately stricter — 3+ distinct volumes
 *  INCLUDING the Technical Volume — so an ordinary whitepaper never gets carved up. */
function passesThreshold(markers: UnitMarker[], declared: boolean): boolean {
  if (markers.length < (declared ? 2 : 3)) return false;
  return declared ? true : markers.some((m) => m.volume === 2);
}

// ── Block mode (the atomizer's shape) ────────────────────────────────────────────────

export interface DsipBlockSegment {
  volumeNumber: number;
  volumeName: string;
  volKey: string | null;
  /** The exact heading/label matched (the provenance citation). */
  markerExcerpt: string;
  /** Block-index range [blockStart, blockEnd) into the caller's block array. */
  blockStart: number;
  blockEnd: number;
}
export interface DsipBlockDetection { isDsipProposal: boolean; segments: DsipBlockSegment[]; distinctVolumes: number }

/**
 * Detect + segment over reader blocks. A block is a marker when its HEADING matches, or —
 * for heading-less separator pages — when its whole (short) text matches. The reader joins
 * a block's node texts with spaces, so only genuinely standalone labels qualify.
 */
export function detectDsipFromBlocks(
  blocks: Array<{ heading?: string | null; text: string }>,
  opts?: { declared?: boolean },
): DsipBlockDetection {
  const labels = blocks.map((b) => {
    const h = (b.heading ?? '').trim();
    if (h) return h;
    const t = (b.text ?? '').trim();
    return t.length <= MAX_MARKER_LEN ? t : null;
  });
  const markers = findMarkers(labels);
  if (!passesThreshold(markers, !!opts?.declared)) {
    return { isDsipProposal: false, segments: [], distinctVolumes: markers.length };
  }
  const segments: DsipBlockSegment[] = markers.map((m, i) => {
    const meta = VOLUME_META[m.volume] ?? { name: `Volume ${m.volume}`, volKey: null };
    return {
      volumeNumber: m.volume,
      volumeName: meta.name,
      volKey: meta.volKey,
      markerExcerpt: m.label.slice(0, 120),
      blockStart: m.unitIndex,
      blockEnd: i + 1 < markers.length ? markers[i + 1].unitIndex : blocks.length,
    };
  });
  return { isDsipProposal: true, segments, distinctVolumes: markers.length };
}

/** The segment containing a block index — null for front matter before the first marker. */
export function volumeOfBlock(segments: DsipBlockSegment[], blockIndex: number): DsipBlockSegment | null {
  let hit: DsipBlockSegment | null = null;
  for (const s of segments) {
    if (s.blockStart <= blockIndex) hit = s;
    else break;
  }
  return hit;
}

// ── Text mode (raw extracted text; line = unit) ──────────────────────────────────────

export interface DsipSegment {
  volumeNumber: number;
  volumeName: string;
  volKey: string | null;
  markerExcerpt: string;
  /** Char offsets into the text the detection ran over. end is exclusive. */
  startOffset: number;
  endOffset: number;
}
export interface DsipDetection { isDsipProposal: boolean; segments: DsipSegment[]; distinctVolumes: number }

export function detectDsipProposal(fullText: string, opts?: { declared?: boolean }): DsipDetection {
  const text = fullText ?? '';
  const lines = text.split('\n');
  const offsets: number[] = [];
  { let off = 0; for (const l of lines) { offsets.push(off); off += l.length + 1; } }
  const markers = findMarkers(lines);
  if (!passesThreshold(markers, !!opts?.declared)) {
    return { isDsipProposal: false, segments: [], distinctVolumes: markers.length };
  }
  const segments: DsipSegment[] = markers.map((m, i) => {
    const meta = VOLUME_META[m.volume] ?? { name: `Volume ${m.volume}`, volKey: null };
    return {
      volumeNumber: m.volume,
      volumeName: meta.name,
      volKey: meta.volKey,
      markerExcerpt: m.label.slice(0, 120),
      startOffset: offsets[m.unitIndex],
      endOffset: i + 1 < markers.length ? offsets[markers[i + 1].unitIndex] : text.length,
    };
  });
  return { isDsipProposal: true, segments, distinctVolumes: markers.length };
}

/** The segment containing a char offset — null for front matter before the first marker. */
export function volumeOfOffset(segments: DsipSegment[], offset: number): DsipSegment | null {
  let hit: DsipSegment | null = null;
  for (const s of segments) {
    if (s.startOffset <= offset) hit = s;
    else break;
  }
  return hit;
}

// ── Page mode (real DSIP full-proposal downloads) ────────────────────────────────────
//
// A genuine DSIP merge carries NO "Volume N" banners. Its anatomy (verified against
// Navy SBIR, AF STTR Ph-II, and AFWERX CSO downloads) is recognizable from PAGE HEADS —
// the text immediately after each page separator the PDF reader injects ("-- N of M --"):
//   V1  p1 "…(SBIR/STTR) Program - Proposal Cover Sheet", then the DSIP form region
//       (cert questions, abstract/benefits, contacts, "VOL I -" labels).
//   V2  the firm's uploaded technical volume — STRONG anchors: an inner "Page 1 of N"
//       restart, or a topic/proposal-number page header first appearing; WEAK fallback:
//       the first page after the last provable form-region page (marked inferred).
//   V3  the DSIP cost form: "SBIR|STTR Phase X Proposal  Proposal Number …" head
//       (fallback "Cost Volume Details").
//   V4  "SBIR|STTR Company Commercialization Report" head.
//   V5  the remainder after the CCR (letters / FWA certificate) — inferred.
// Every segment cites its page + matched head; inferred boundaries say so — the preview
// gate is where a human confirms or adjusts them (the tenant ingestion analyzer loop).

export interface DsipPageSegment {
  volumeNumber: number;
  volumeName: string;
  volKey: string | null;
  markerExcerpt: string;   // the cited page head (or the inference evidence)
  pageStart: number;       // 1-based, inclusive
  pageEnd: number;         // inclusive
  inferred: boolean;       // boundary inferred (no direct marker) — surface for HITL review
}
export interface DsipPageDetection {
  isDsipProposal: boolean;
  pages: string[];         // per-page text (index 0 = page 1)
  segments: DsipPageSegment[];
  distinctVolumes: number;
}

const PAGE_SEP_RE = /--\s*(\d+)\s*of\s*(\d+)\s*--/g;

/** Split reader fullText on its "-- N of M --" page separators. Empty when none. */
export function splitReaderPages(fullText: string): string[] {
  const text = fullText ?? '';
  const marks: Array<{ page: number; index: number; len: number }> = [];
  for (const m of text.matchAll(PAGE_SEP_RE)) {
    marks.push({ page: Number(m[1]), index: m.index ?? 0, len: m[0].length });
  }
  if (marks.length < 2) return [];
  const pages: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const start = marks[i].index + marks[i].len;
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    pages[marks[i].page - 1] = text.slice(start, end).trim();
  }
  for (let i = 0; i < pages.length; i++) if (pages[i] == null) pages[i] = '';
  return pages;
}

const head = (page: string) => (page ?? '').replace(/\s+/g, ' ').trim().slice(0, 220);

// V1 — the DSIP cover sheet opener (page 1).
const COVER_RE = /small business (?:innovation research|technology transfer)\s*\(\s*S[BT]IR\s*\)\s*program\s*-\s*proposal cover sheet/i;
// V1 form-region vocabulary — the finite DSIP form furniture (used to find where V1 ENDS).
const FORM_REGION_RE = /^(?:\d{1,2}\.\s|VOL\s+I\b|firm certificate|firm information|agency information|proposal information|contact information|principal investigator|corporate official|technical abstract|anticipated benefits|supporting documentation:|signature|disclaimer)|OFFEROR CERTIFIES|SBAS? Company Registry|fraud-related|ITAR\/EAR|essentially equivalent|Recombinant DNA|Audit Agency|Federal Acquisition Regulation|venture capital owned company/i;
// V2 strong anchors: the uploaded tech doc's own furniture.
const INNER_PAGE1_RE = /\bPage\s+1\s+of\s+\d+\b/i;
const TOPIC_HEADER_RE = /^(?:topic(?:\s+number)?\s*:|proposal number\s*:)/i;
// V3 — the DSIP cost form head (+ fallback).
const COST_FORM_RE = /^(?:SBIR|STTR)\s+Phase\s+\S+\s+Proposal\s+Proposal\s+Number/i;
const COST_DETAILS_RE = /^Cost Volume Details/i;
// V4 — the CCR head.
const CCR_RE = /^(?:SBIR|STTR) Company Commercialization Report/i;

/** Detect + segment a REAL DSIP full-proposal download from reader page text. */
export function detectDsipFromPages(fullText: string): DsipPageDetection {
  const pages = splitReaderPages(fullText);
  const none: DsipPageDetection = { isDsipProposal: false, pages, segments: [], distinctVolumes: 0 };
  // Trailing separator can mint an empty last page — ignore empties at the tail.
  let n = pages.length;
  while (n > 0 && !pages[n - 1]) n--;
  if (n < 4) return none;
  const heads = pages.slice(0, n).map(head);

  // The three provable anchors first.
  if (!COVER_RE.test(heads[0])) return none;
  let costStart = -1;
  for (let p = 1; p < n; p++) if (COST_FORM_RE.test(heads[p]) || COST_DETAILS_RE.test(heads[p])) { costStart = p; break; }
  let ccrStart = -1;
  for (let p = Math.max(1, costStart + 1); p < n; p++) if (CCR_RE.test(heads[p])) { ccrStart = p; break; }
  if (costStart < 0 || ccrStart < 0) return none; // not a full DSIP merge — let other modes try

  // V2 start: earliest STRONG anchor before the cost form; else infer from the last
  // provable form-region page (the DSIP form is contiguous from page 1).
  let techStart = -1;
  let techInferred = false;
  let techEvidence = '';
  for (let p = 1; p < costStart; p++) {
    if (INNER_PAGE1_RE.test(heads[p]) || TOPIC_HEADER_RE.test(heads[p])) { techStart = p; techEvidence = heads[p].slice(0, 120); break; }
  }
  if (techStart < 0) {
    let lastForm = 0; // page-1 is V1 by definition
    for (let p = 1; p < costStart; p++) if (FORM_REGION_RE.test(heads[p])) lastForm = p;
    techStart = lastForm + 1;
    techInferred = true;
    techEvidence = `inferred: first page after the final DSIP form page p${lastForm + 1} ("${heads[lastForm].slice(0, 80)}")`;
    if (techStart >= costStart) { techStart = costStart; } // degenerate: no tech span provable
  }

  const segments: DsipPageSegment[] = [];
  const push = (volumeNumber: number, pageStart: number, pageEnd: number, markerExcerpt: string, inferred: boolean) => {
    if (pageEnd < pageStart) return;
    const meta = VOLUME_META[volumeNumber] ?? { name: `Volume ${volumeNumber}`, volKey: null };
    segments.push({ volumeNumber, volumeName: meta.name, volKey: meta.volKey, markerExcerpt, pageStart: pageStart + 1, pageEnd: pageEnd + 1, inferred });
  };
  push(1, 0, techStart - 1, heads[0].slice(0, 120), false);
  if (techStart < costStart) push(2, techStart, costStart - 1, techEvidence, techInferred);
  push(3, costStart, ccrStart - 1, heads[costStart].slice(0, 120), false);
  // V4 runs to the last CCR-headed page; the remainder (letters / FWA cert) is V5 — inferred.
  let ccrEnd = ccrStart;
  for (let p = ccrStart + 1; p < n; p++) { if (CCR_RE.test(heads[p])) ccrEnd = p; else break; }
  push(4, ccrStart, ccrEnd, heads[ccrStart].slice(0, 120), false);
  if (ccrEnd + 1 < n) push(5, ccrEnd + 1, n - 1, `inferred: remainder after the Commercialization Report ("${heads[ccrEnd + 1].slice(0, 80)}")`, true);

  return { isDsipProposal: true, pages, segments, distinctVolumes: segments.length };
}

/** The page-mode segment containing a 1-based page number. */
export function volumeOfPage(segments: DsipPageSegment[], page: number): DsipPageSegment | null {
  for (const s of segments) if (page >= s.pageStart && page <= s.pageEnd) return s;
  return null;
}

// ── Sidecar classification (the rest of the DSIP package) ────────────────────────────
//
// A DSIP proposal ships as the merged Full_Proposal PLUS standalone sidecars. Their
// filenames are DSIP's own taxonomy — deterministic, no content read needed:
//   *_SBC_*            → SBC registry confirmations (V1 certs)
//   *Budget*           → the cost workbook export (V3)
//   *CCR*              → the standalone Company Commercialization Report (V4)
//   *_Addt_Cost_Info_* → additional cost information (V3)
//   *_Fund_Agrmnt_Cert_* / *_Lifecycle_Cert_* / *_Other_* → supporting certs/docs (V5)
export function classifyDsipSidecar(filename: string): { volumeNumber: number; volKey: string; label: string } | null {
  const f = (filename ?? '').toLowerCase();
  if (/full_proposal/.test(f)) return null; // the merged doc — segmented, not a sidecar
  if (/coversheet|cover_sheet/.test(f)) return { volumeNumber: 1, volKey: 'overview', label: 'Proposal cover sheet' };
  if (/_sbc_|sbc_\d+/.test(f)) return { volumeNumber: 1, volKey: 'overview', label: 'SBC registry confirmation' };
  if (/addt_cost|additional_cost/.test(f)) return { volumeNumber: 3, volKey: 'cost', label: 'Additional cost information' };
  if (/budget/.test(f)) return { volumeNumber: 3, volKey: 'cost', label: 'Cost volume workbook' };
  if (/ccr/.test(f)) return { volumeNumber: 4, volKey: 'commercialization', label: 'Company Commercialization Report' };
  if (/fund_agrmnt_cert|funding_agreement/.test(f)) return { volumeNumber: 5, volKey: 'supporting', label: 'Funding agreement certification' };
  if (/lifecycle_cert/.test(f)) return { volumeNumber: 5, volKey: 'supporting', label: 'Lifecycle certification' };
  if (/_other_|_other\./.test(f)) return { volumeNumber: 5, volKey: 'supporting', label: 'Other supporting document' };
  if (/foreign_affiliation/.test(f)) return { volumeNumber: 5, volKey: 'supporting', label: 'Foreign affiliations disclosure' };
  if (/fwa/.test(f)) return { volumeNumber: 6, volKey: 'supporting', label: 'Fraud, Waste and Abuse training certificate' };
  // The standalone technical upload ("…Proposal.pdf" — NOT Full_Proposal, handled above).
  if (/\dproposal\.pdf$|_proposal\.pdf$/.test(f)) return { volumeNumber: 2, volKey: 'technical', label: 'Technical volume' };
  return null;
}
