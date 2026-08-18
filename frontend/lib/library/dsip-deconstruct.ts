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
