/**
 * IS THIS THE SAME OPPORTUNITY WE ALREADY HAVE — JUDGED BY ITS DOCUMENTS?
 *
 * The pure half. No database, no network, so the decision can be tested against cases rather than
 * against a fixture corpus — the same split `lib/scout/classify.ts` makes.
 *
 * `classify.ts` answers this from source id, solicitation number and title. This answers it from
 * the FILES, which is the signal that survives an agency re-titling a notice or an aggregator
 * inventing its own numbering. The two are combined, not swapped: document evidence ANNOTATES the
 * existing call rather than replacing it.
 *
 * ── THREE VERDICTS, AND THE MIDDLE ONE IS THE POINT ────────────────────────────────────────────
 *   certain       the same bytes, and those bytes identify exactly one opportunity
 *   flag          the filename and size agree closely — a human should look
 *   boilerplate   the same bytes, under MANY opportunities, so they identify none of them
 *
 * ── WHY `boilerplate` EXISTS, MEASURED ON THIS BOX ─────────────────────────────────────────────
 * "Exact hash means certain" is wrong on its own, and provably so against the real corpus here:
 *
 *     DoW 2026 SBIR BAA FULL_R1_04132026.pdf   ONE hash, EIGHT solicitations
 *
 * That is the umbrella BAA attached to every topic under it. A matcher that treated an exact hash
 * as identity would declare all eight topics the same opportunity, and would do it with total
 * confidence, on the most common document in the whole corpus.
 *
 * The guard needs no threshold and no tuning, because the right rule is a statement about what a
 * hash can IDENTIFY: **an exact match is certain only when it resolves to exactly one
 * opportunity.** Resolve to several and the document cannot distinguish between them — by
 * construction, not by heuristic. It is still reported, as context, and it never decides.
 */

/** How many opportunities a hash may appear under and still identify one of them. */
export const IDENTIFYING_LIMIT = 1;

/** A size may differ by this fraction and still be "the same document, re-wrapped". */
export const SIZE_TOLERANCE = 0.05;

/** Filename similarity at or above this is worth a human's attention. */
export const NAME_SIMILARITY = 0.72;

export type DocVerdict = 'certain' | 'flag' | 'boilerplate';

/**
 * Strip everything that varies between two postings of the same file and keep what identifies it.
 *
 * Case, punctuation, separators and a version/revision suffix all change freely when an
 * aggregator re-hosts a document — `topics.pdf` vs `AF251-D001_topics_v2.pdf` is the normal shape
 * of the problem, not an edge case. The extension is dropped too: the same document is often
 * served as `.pdf` from one host and `.PDF` from another.
 */
export function normaliseFilename(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(v|ver|version|rev|r)\s*\d+\b/g, ' ')
    .replace(/\b\d{6,8}\b/g, ' ')          // a date stamp: 04132026
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Token-set similarity, 0..1 — the fraction of the SMALLER name's tokens the larger one contains.
 *
 * Deliberately not Jaccard. An aggregator's filename is routinely the agency's plus extra
 * qualifiers (`AF251-D001_topics_v2.pdf` against `topics.pdf`), and Jaccard punishes that
 * containment heavily — 1 shared token over 3 distinct is 0.33, which reads as "unrelated" for
 * two names where one wholly contains the other. Containment is the relation actually being
 * tested here, and it is asymmetric on purpose.
 */
export function filenameSimilarity(a: string, b: string): number {
  const ta = new Set(normaliseFilename(a).split(' ').filter(Boolean));
  const tb = new Set(normaliseFilename(b).split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let shared = 0;
  for (const t of small) if (large.has(t)) shared += 1;
  return shared / small.size;
}

/** Within a few percent — the same document with a page added or a different PDF producer. */
export function sizesAgree(a: number | null, b: number | null, tolerance = SIZE_TOLERANCE): boolean {
  if (a === null || b === null || a <= 0 || b <= 0) return false;
  return Math.abs(a - b) / Math.max(a, b) <= tolerance;
}

export interface CandidateDoc {
  /** The opportunity or solicitation this document hangs off, when it has one. */
  ownerId: string | null;
  filename: string;
  size: number | null;
  hash: string | null;
  /** How many DISTINCT opportunities carry these exact bytes, this one included. */
  hashOwnerCount?: number;
}

export interface DocMatch {
  verdict: DocVerdict;
  ownerId: string | null;
  filename: string;
  /** 1 for an exact hash; the filename similarity otherwise. */
  score: number;
  reason: string;
}

/**
 * Judge one harvested document against one candidate.
 *
 * Returns null when there is nothing worth saying — which is most pairs, and saying nothing about
 * them is the difference between a queue a curator reads and one they stop opening.
 */
export function judgeDocument(mine: CandidateDoc, theirs: CandidateDoc): DocMatch | null {
  if (mine.hash && theirs.hash && mine.hash === theirs.hash) {
    const owners = theirs.hashOwnerCount ?? 1;
    if (owners > IDENTIFYING_LIMIT) {
      return {
        verdict: 'boilerplate',
        ownerId: theirs.ownerId,
        filename: theirs.filename,
        score: 1,
        reason: `identical bytes, but this file is attached to ${owners} opportunities — it is a `
          + 'shared attachment and cannot say which one this is',
      };
    }
    return {
      verdict: 'certain',
      ownerId: theirs.ownerId,
      filename: theirs.filename,
      score: 1,
      reason: `identical bytes (sha256 ${String(mine.hash).slice(0, 12)}…), and this file is `
        + 'attached to exactly one opportunity',
    };
  }

  // Different bytes. The filename and the size together are what is left, and neither alone is
  // enough: "instructions.pdf" matches across every agency on earth, and two unrelated documents
  // are within 5% of each other's size constantly.
  const sim = filenameSimilarity(mine.filename, theirs.filename);
  if (sim >= NAME_SIMILARITY && sizesAgree(mine.size, theirs.size)) {
    const pct = Math.round(sim * 100);
    const delta = mine.size && theirs.size
      ? Math.round((Math.abs(mine.size - theirs.size) / Math.max(mine.size, theirs.size)) * 1000) / 10
      : 0;
    return {
      verdict: 'flag',
      ownerId: theirs.ownerId,
      filename: theirs.filename,
      score: sim,
      reason: `different bytes, but the name is ${pct}% the same and the size differs by ${delta}% `
        + '— worth a look before this is released as new',
    };
  }

  return null;
}

/**
 * The strongest verdict in a set, and the one a caller should act on.
 *
 * `certain` outranks `flag` outranks `boilerplate`. Boilerplate is deliberately RANKED, not
 * discarded: "we have seen this exact file before, on eight other opportunities" is worth showing
 * a curator even though it decides nothing.
 */
export function strongest(matches: DocMatch[]): DocMatch | null {
  const rank: Record<DocVerdict, number> = { certain: 3, flag: 2, boilerplate: 1 };
  return matches.reduce<DocMatch | null>(
    (best, m) => (!best || rank[m.verdict] > rank[best.verdict]
      || (rank[m.verdict] === rank[best.verdict] && m.score > best.score) ? m : best),
    null,
  );
}
