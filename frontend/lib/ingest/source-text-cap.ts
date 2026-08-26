/**
 * How much of a solicitation we read, and saying so when it is not all of it.
 *
 * THE RULE THIS EXISTS TO KEEP (docs/INGEST_PROVENANCE.md): a value the product did not read from
 * the solicitation must never look like one it did. Its corollary is what silent truncation broke —
 * "we did not find a page limit in the source" and "we never looked at the part of the source that
 * states it" are different facts, and only one of them is honest.
 *
 * Extraction was capped at 500,000 characters in three places in the frontend and 200,000 in the
 * shredder, all with a bare `.slice()` that told nobody. Measured against the real documents in
 * this repo:
 *
 *     DoW 2026 SBIR BAA    1,013,966 chars →   50.7% discarded
 *     DoD 25.1 SBIR BAA    1,341,245 chars →   62.7% discarded
 *     DoD 25.A STTR BAA      449,600 chars →    fits
 *
 * Both truncated documents are live in the sandbox at exactly 500,000. Any compliance rule living
 * past that point is invisible to the pattern extractor, which then reports "not stated" — and the
 * field falls back to a red "Default — unverified" that looks like a considered finding rather than
 * a blind spot we created.
 *
 * TWO PARTS, and the second matters more than the first. Raising the cap fixes today's documents;
 * REPORTING the cap fixes the class, because any fixed limit is eventually too small and the next
 * one must not be silent.
 */

/**
 * Per-document extraction ceiling.
 *
 * Sized from measurement, not taste: the largest real solicitation in the repo is 1.34M characters,
 * so this carries ~50% headroom over observed reality. It is a guard against a pathological file
 * exhausting memory, not a content decision — which is exactly why crossing it has to be recorded.
 */
export const MAX_SOURCE_TEXT_CHARS = 2_000_000;

/** What happened when the text met the ceiling. Stamped onto the document; read by readiness. */
export interface SourceTextExtraction {
  /** Characters kept. */
  chars: number;
  /** True when the document was longer than the cap and the tail was dropped. */
  truncated: boolean;
  /** The document's real length, so "how much did we lose" is answerable later. */
  originalChars: number;
  /** The ceiling in force at extraction time — a later raise must not rewrite history. */
  capChars: number;
}

export interface CappedSourceText extends SourceTextExtraction {
  text: string;
}

/**
 * Apply the ceiling and report it.
 *
 * Callers must persist the returned flags — a cap nobody records is the bug this module replaces.
 */
export function capSourceText(raw: string | null | undefined, cap = MAX_SOURCE_TEXT_CHARS): CappedSourceText {
  const s = raw ?? '';
  const originalChars = s.length;
  const truncated = originalChars > cap;
  const text = truncated ? s.slice(0, cap) : s;
  return { text, chars: text.length, truncated, originalChars, capChars: cap };
}

/**
 * One line an admin can act on, or null when the whole document was read.
 *
 * Deliberately states the SHARE lost, not just the count: "we read 500,000 characters" sounds
 * thorough, and "49% of this document was not read" does not.
 */
export function truncationNotice(e: SourceTextExtraction | null | undefined): string | null {
  if (!e?.truncated) return null;
  const lostPct = e.originalChars > 0
    ? Math.round(((e.originalChars - e.chars) / e.originalChars) * 100)
    : 0;
  return `Only the first ${e.chars.toLocaleString()} of ${e.originalChars.toLocaleString()} characters `
    + `were read (${lostPct}% of this document was not examined). Rules stated past that point cannot `
    + `have been found — treat any "not stated in the source" result on this solicitation as unverified.`;
}

/** Read the stamp back off a document's metadata, tolerating rows written before it existed. */
export function extractionOf(metadata: unknown): SourceTextExtraction | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const e = (metadata as { extraction?: unknown }).extraction;
  if (!e || typeof e !== 'object') return null;
  const o = e as Record<string, unknown>;
  if (typeof o.chars !== 'number' || typeof o.truncated !== 'boolean') return null;
  return {
    chars: o.chars,
    truncated: o.truncated,
    originalChars: typeof o.originalChars === 'number' ? o.originalChars : o.chars,
    capChars: typeof o.capChars === 'number' ? o.capChars : MAX_SOURCE_TEXT_CHARS,
  };
}
