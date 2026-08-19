/**
 * Strip a document's RUNNING PAGE FURNITURE — the header/footer lines a word processor repeats on
 * every page, plus bare page numbers — before its pages become library atoms.
 *
 * Why this exists. When a past proposal is atomized at page grain, each atom's content is that
 * page's extracted text, furniture and all. A DSIP submission's footer typically carries the
 * SOLICITATION's own identifiers, so every atom from that document ends up stamped with them:
 *
 *     Defense Need 11 The Immobileyes HALAR-Laser c-UAS Solutions Address …
 *     Topic: X23.5_CSO        Proposal Number: FX235-CSO1-0859
 *
 * Retrieval then grounds a NEW proposal's section on those atoms and the model faithfully carries
 * the identifiers across. Observed on the T3CP build: a technical section for topic OSW26BZ04-DP013
 * opened by citing "Topic: X23.5_CSO Proposal Number: FX235-CSO1-0859" — a different solicitation,
 * from a different agency, two years earlier. Nothing downstream can undo that; the wrong text is
 * simply in the library, indistinguishable from the company's real prose.
 *
 * The detection is structural, not a keyword list: furniture is what REPEATS. A line appearing in
 * the same position across many pages is furniture no matter what it says, and a line unique to one
 * page is content no matter how much it looks like a header. That keeps the rule honest for
 * documents whose footers we have never seen.
 */

/** Pages needed before repetition means anything. Under this, "repeated" is coincidence. */
const MIN_PAGES = 4;
/** Furniture is short. A repeated long paragraph is boilerplate the company chose to repeat. */
const MAX_FURNITURE_CHARS = 160;
/** A line must appear on at least this SHARE of pages to count as running furniture. */
const MIN_SHARE = 0.4;
/** …and on at least this many pages, so a 4-page document needs 3, not 1.6. */
const MIN_PAGES_SEEN = 3;
/**
 * How many non-empty lines at each EDGE of a page can be furniture. Running headers and footers
 * are positional — they sit at the top or the bottom, never mid-paragraph. Without this, digit
 * collapsing over-reaches: captions like "Table 1" … "Table 5" on five pages all normalize to
 * "table #", look repeated, and get stripped as a running header. Requiring the edge keeps the
 * digit collapse (which is what catches "Page 3 of 15") without eating numbered body content.
 */
const EDGE_LINES = 3;

/**
 * Normalize a line for repetition counting. Digits collapse to `#` so "Page 3 of 15" and
 * "Page 4 of 15" — the same footer — are recognized as the same line rather than 15 distinct ones.
 */
function normalize(line: string): string {
  return line
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\d+/g, '#');
}

/** A line that is nothing but a page number (with optional "Page"/"of N" scaffolding). */
function isBarePageNumber(line: string): boolean {
  return /^(?:page\s*)?\d{1,4}(?:\s*(?:of|\/)\s*\d{1,4})?$/i.test(line.trim());
}

/**
 * The candidate lines of one page: the non-empty lines at its top and bottom edges, paired with
 * whether each is short enough to be furniture. Returns normalized keys.
 */
function edgeKeys(page: string): Set<string> {
  const lines = page.split('\n').map((l) => l.trim()).filter(Boolean);
  const edges = lines.length <= EDGE_LINES * 2
    ? lines
    : [...lines.slice(0, EDGE_LINES), ...lines.slice(-EDGE_LINES)];
  const keys = new Set<string>();
  for (const line of edges) {
    if (line.length > MAX_FURNITURE_CHARS) continue;
    keys.add(normalize(line));
  }
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

  // Count DISTINCT pages per normalized line — a line repeated twice on one page still counts once,
  // so a page that happens to list a phrase twice cannot make it look like furniture. Only the
  // page's EDGE lines are candidates: furniture sits at the top or the bottom, and restricting to
  // those is what stops the digit collapse from eating numbered body content.
  const pagesSeen = new Map<string, number>();
  for (const page of real) {
    for (const key of edgeKeys(page)) pagesSeen.set(key, (pagesSeen.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(MIN_PAGES_SEEN, Math.ceil(real.length * MIN_SHARE));
  const furniture = new Set<string>();
  for (const [key, count] of pagesSeen) {
    if (count >= threshold && key) furniture.add(key);
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
  // Remove only at the edges, matching how furniture was DETECTED. A footer phrase that also
  // appears mid-page is content there, and stripping it would silently edit the company's prose.
  const nonEmpty = page.split('\n').map((l) => l.trim()).filter(Boolean);
  const edgeCount = Math.min(EDGE_LINES, nonEmpty.length);
  let seenFromTop = 0;
  const fromBottom = new Set<number>();
  {
    let n = 0;
    const raws = page.split('\n');
    for (let i = raws.length - 1; i >= 0 && n < edgeCount; i--) {
      if (raws[i].trim()) { fromBottom.add(i); n++; }
    }
  }

  const kept: string[] = [];
  const raws = page.split('\n');
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    const line = raw.trim();
    if (!line) { kept.push(''); continue; }
    seenFromTop++;
    const atEdge = seenFromTop <= edgeCount || fromBottom.has(i);
    if (!atEdge) { kept.push(raw); continue; }
    if (isBarePageNumber(line)) continue;
    if (line.length <= MAX_FURNITURE_CHARS && furniture.has(normalize(line))) continue;
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

  // Report the furniture in its ORIGINAL form, not the digit-collapsed key — "Page # of #" is not
  // something a human can recognize as the footer they are looking at.
  const samples: string[] = [];
  const wanted = new Set(furniture);
  for (const page of pages) {
    if (wanted.size === 0) break;
    for (const raw of (page ?? '').split('\n')) {
      const line = raw.trim();
      if (!line || line.length > MAX_FURNITURE_CHARS) continue;
      const key = normalize(line);
      if (wanted.has(key)) { samples.push(line); wanted.delete(key); }
    }
  }
  return { pages: cleaned, furniture: samples, removedChars };
}
