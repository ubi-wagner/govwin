/**
 * Strip a document's RUNNING PAGE FURNITURE — the header/footer lines a word processor repeats on
 * every page, plus bare page numbers — before its pages become library atoms.
 *
 * Why this exists. When a past proposal is atomized at page grain, each atom's content is that
 * page's extracted text, furniture and all. A DSIP submission's header typically carries the
 * SOLICITATION's own identifiers, so every atom from that document ends up stamped with them.
 * Measured on the filed FX23.5-CSO proposal, three lines repeat across 20–25 of its 40 pages:
 *
 *     Topic: X23.5_CSO    Proposal Number: FX235-CSO1-0859
 *     "Base-Wide Counter-UAS and Defeat of Drone Surveillance Utilizing Innovative LED-Based …"
 *     1
 *
 * Retrieval then grounds a NEW proposal's section on those atoms and the model faithfully carries
 * the identifiers across. Observed on the T3CP build: a technical section for topic OSW26BZ04-DP013
 * opened by citing "Topic: X23.5_CSO Proposal Number: FX235-CSO1-0859" — a different solicitation,
 * from a different agency, two years earlier. Nothing downstream can undo that; the wrong text is
 * simply in the library, indistinguishable from the company's real prose.
 *
 * The detection is structural, not a keyword list: furniture is what REPEATS across pages. A line
 * appearing verbatim on many pages is furniture no matter what it says, and a line unique to one
 * page is content no matter how much it looks like a header. That keeps the rule honest for
 * footers we have never seen.
 *
 * What it deliberately does NOT do is reason about POSITION. An earlier version only considered
 * lines at the top or bottom of a page, on the theory that furniture is positional. It is — on the
 * PAGE. It is not in the extracted TEXT: a PDF's text layer comes out in content-stream order, not
 * visual order, and in the document above the same footer lands anywhere from line 2 to line 33.
 * Position-based detection found nothing at all on the real file.
 */

/** Pages needed before repetition means anything. Under this, "repeated" is coincidence. */
const MIN_PAGES = 4;
/** Furniture is short. A repeated long paragraph is boilerplate the company chose to repeat. */
const MAX_FURNITURE_CHARS = 160;
/**
 * A line must appear on at least this share of the pages IN ITS OWN RUN — the span from its first
 * page to its last — not of the whole document.
 *
 * The denominator matters because a merged DSIP submission is several documents concatenated. Its
 * technical volume carries one header, its cost volume another, its cover sheet none. Measured
 * against the whole file, a header running through all 10 pages of a 32-page package's technical
 * volume looks like it covers 31% and falls under any sane threshold — while within the volume it
 * actually heads, it covers 100%. That is what let the DON26BX header survive: "Proposal Number:
 * N26BX-NP002-0450 / Open Topic Number: DON26BX03-NP002" on 10 consecutive pages, missed, and
 * carried into the new proposal's Statement of Work.
 */
const MIN_SHARE = 0.4;
/** …and on at least this many pages, so a short run needs several hits, not one. */
const MIN_PAGES_SEEN = 3;
/**
 * How long a run has to be before density means "running header" rather than "a table".
 *
 * Density alone cannot tell them apart — measured on the filed F2-17528 proposal, the header
 * "Topic Number: AFX23D-TCSO1 Proposal Number: F 2 - 1 7 5 2 8" and the cost form's line labels
 * ("Subcontractor Costs", "Total Direct Material Costs (TDM) $35,000.00") BOTH appear on 100% of
 * the pages in their run. What separates them is how far the run reaches: the header runs 17
 * pages, the cost table 4. A running header heads a VOLUME; a repeated label belongs to one form
 * that happens to span a few pages. Under this, an aggressive density rule deleted the cost
 * volume's own figures.
 *
 * The trade is deliberately conservative: a header on a genuinely short document is missed rather
 * than a table being destroyed. Whatever is removed is reported on the plan and shown in the
 * upload preview, so a curator can see a mis-detection before the library is written.
 */
const MIN_RUN_PAGES = 8;
/**
 * A furniture line is identifying text, not a lone token. Without this, a word repeated down a
 * table column ("Base", "Option" in a Phase I task schedule) reads as a perfect run and the table
 * loses a column. Page numbers are exempt — they are handled by `isBarePageNumber`.
 */
const MIN_FURNITURE_CHARS = 12;
const MIN_FURNITURE_WORDS = 2;

/** Whitespace-collapsed, lowercased. Digits are KEPT — see `pageNumberKey`. */
function normalize(line: string): string {
  return line.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * A page-number-bearing line, with its digits collapsed so every page's copy is one key.
 *
 * Digit collapsing is what lets "Page 3 of 15" and "Page 4 of 15" be recognized as the same
 * footer. It is confined to lines that actually carry page numbering, because applied broadly it
 * is destructive: captions like "Table 1" … "Table 5" all collapse to "table #", look like one
 * repeated line, and get deleted from the body of every page.
 *
 * Returns null for a line with no page numbering, which then matches only verbatim.
 */
function pageNumberKey(line: string): string | null {
  const n = normalize(line);
  const pattern = /\bpage\s+\d+(\s*(?:of|\/)\s*\d+)?\b|\b\d+\s*(?:of|\/)\s*\d+\b/;
  if (!pattern.test(n)) return null;
  // The line must BE page numbering, not merely contain it. A footer is the number plus a little
  // ("Immobileyes Inc. — Page 3 of 15"); a sentence that happens to cite a page is content
  // ("…the schedule continued on page 4 of the attachment…"). Matching on containment alone made
  // every such sentence digit-collapsible, so a body line repeated across a run was confirmed as
  // furniture and variant expansion then deleted each of its individual forms — silently removing
  // real prose from every page.
  const remainder = n.replace(pattern, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
  const wordsLeft = remainder ? remainder.split(/\s+/).length : 0;
  return wordsLeft <= 3 ? n.replace(/\d+/g, '#') : null;
}

/** A line that is nothing but a page number (with optional "Page"/"of N" scaffolding). */
function isBarePageNumber(line: string): boolean {
  return /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(line.trim());
}

/**
 * Is this line substantial enough to be a running header, rather than a repeated table cell?
 * A page-number line is exempt: `isBarePageNumber` removes those regardless of repetition.
 */
function isSubstantial(line: string): boolean {
  if (isBarePageNumber(line)) return true;
  const t = line.trim();
  return t.length >= MIN_FURNITURE_CHARS && t.split(/\s+/).length >= MIN_FURNITURE_WORDS;
}

/** Every furniture key a line could match under (verbatim, and page-numbered form if any). */
function keysOf(line: string): string[] {
  const keys = [normalize(line)];
  const pn = pageNumberKey(line);
  if (pn) keys.push(pn);
  return keys;
}

/**
 * Find the running furniture in a set of page texts.
 *
 * Exported for the atomize preview, so a curator can be shown what will be removed rather than
 * having it happen invisibly.
 */
export function detectRunningFurniture(pages: string[]): Set<string> {
  const real = pages.filter((p) => p && p.trim());
  if (real.length < MIN_PAGES) return new Set();

  // Record WHICH pages each key appears on — a line repeated twice on one page still counts that
  // page once, so a page that happens to list a phrase twice cannot make it look like furniture.
  const pagesSeen = new Map<string, Set<number>>();
  real.forEach((page, pi) => {
    for (const raw of page.split('\n')) {
      const line = raw.trim();
      if (!line || line.length > MAX_FURNITURE_CHARS) continue;
      if (!isSubstantial(line)) continue;
      for (const k of keysOf(line)) {
        if (!pagesSeen.has(k)) pagesSeen.set(k, new Set());
        pagesSeen.get(k)!.add(pi);
      }
    }
  });

  const furniture = new Set<string>();
  for (const [key, pageSet] of pagesSeen) {
    if (!key || pageSet.size < MIN_PAGES_SEEN) continue;
    // Density within the line's OWN run, not across the whole document. See MIN_SHARE.
    const seen = [...pageSet];
    const span = Math.max(...seen) - Math.min(...seen) + 1;
    if (span < MIN_RUN_PAGES) continue;
    if (pageSet.size / span >= MIN_SHARE) furniture.add(key);
  }

  // Expand each confirmed line to its VARIANTS — same header, different number.
  //
  // A document can carry more than one footer. The filed FX23.5-CSO proposal repeats
  // "…Proposal Number: FX235-CSO1-0859" on 25 of 40 pages, and "…-0853" on a handful more: the
  // same header with a different number, too rare on its own to clear the threshold, and left
  // behind on exactly the pages ("Defense Need", "Commercialization Partners") a technical draft
  // is most likely to ground on.
  //
  // Expansion is safe in a way that blanket digit collapsing is not, because it only ever grows
  // from a line ALREADY proven to be furniture by verbatim repetition. "Table 1" … "Table 5" can
  // never be swept up: no member of that family is ever confirmed in the first place.
  const confirmedShapes = new Set<string>();
  for (const key of furniture) confirmedShapes.add(key.replace(/\d+/g, '#'));
  if (confirmedShapes.size) {
    for (const page of real) {
      for (const raw of page.split('\n')) {
        const line = raw.trim();
        if (!line || line.length > MAX_FURNITURE_CHARS) continue;
        const key = normalize(line);
        if (furniture.has(key)) continue;
        if (confirmedShapes.has(key.replace(/\d+/g, '#'))) furniture.add(key);
      }
    }
  }
  return furniture;
}

/**
 * Remove running furniture and bare page numbers from one page's text.
 *
 * Pass the set from `detectRunningFurniture` over the WHOLE document — repetition is a property of
 * the document, so it cannot be judged from a single page.
 */
export function stripFurniture(page: string, furniture: Set<string>): string {
  if (!page) return '';
  const kept: string[] = [];
  for (const raw of page.split('\n')) {
    const line = raw.trim();
    if (!line) { kept.push(''); continue; }
    if (isBarePageNumber(line)) continue;
    if (line.length <= MAX_FURNITURE_CHARS && keysOf(line).some((k) => furniture.has(k))) continue;
    kept.push(raw);
  }
  // Collapse the blank runs the removals leave behind.
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Strip running furniture from every page of a document.
 *
 * Returns the cleaned pages alongside what was removed, so the caller can report it. A page that
 * is ENTIRELY furniture comes back empty and the caller's own minimum-length rule drops it — this
 * function never decides whether a page is worth keeping.
 */
export function stripDocumentFurniture(pages: string[]): {
  pages: string[];
  furniture: string[];
  removedChars: number;
} {
  const furniture = detectRunningFurniture(pages);
  if (furniture.size === 0) return { pages, furniture: [], removedChars: 0 };

  let removedChars = 0;
  const cleaned = pages.map((p) => {
    const out = stripFurniture(p, furniture);
    removedChars += Math.max(0, (p?.length ?? 0) - out.length);
    return out;
  });

  // Report the furniture in its ORIGINAL form, not a collapsed key — "page # of #" is not
  // something a human can recognize as the footer they are looking at.
  const samples: string[] = [];
  const wanted = new Set(furniture);
  for (const page of pages) {
    if (wanted.size === 0) break;
    for (const raw of (page ?? '').split('\n')) {
      const line = raw.trim();
      if (!line || line.length > MAX_FURNITURE_CHARS) continue;
      // Bare page numbers are removed unconditionally, so listing each of "Page 1 of 15" …
      // "Page 15 of 15" only buries the one or two lines a curator actually needs to check.
      if (isBarePageNumber(line)) continue;
      for (const k of keysOf(line)) {
        if (wanted.has(k)) { samples.push(line); wanted.delete(k); }
      }
    }
  }
  return { pages: cleaned, furniture: samples, removedChars };
}
