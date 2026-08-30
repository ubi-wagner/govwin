/**
 * Shared topic extraction logic.
 *
 * Extracted from /api/admin/extract-topics so it can be called both by the
 * route handler (manual "Extract Topics" button) and by the rfp-upload route
 * (automatic extraction after PDF upload).
 */

import { sql } from '@/lib/db';

/**
 * Topic-number patterns in DoD SBIR/STTR/BAA solicitations — BOTH generations.
 *
 * ── WHY THERE ARE TWO, AND WHY THIS WAS FINDING NOTHING ──────────────────────────────────────
 * The legacy pattern (`AF261-001`, `N241-015`) is what this file shipped with. The current DoD
 * format is not that shape: `DON26BZ01-NV001`, `DHA26BZ01-DV005`, `DAF26BZ01-NV500` — letters,
 * year, a cycle block, THEN the dash. The old regex needs a separator right after the digits, so
 * it matches none of them.
 *
 * Measured on the DoW 2026 SBIR BAA: 66 real topics across six components, and the shipped pattern
 * found 0 of them. Over the whole document it matched four strings — `AUG22-19822`, `RRA815-1`,
 * `S10-S13`, `T022.htm` — every one a false positive.
 *
 * That matters for the order of the fix. `findTopicNumbers` also read only the first 30,000
 * characters (see below), and widening THAT window without correcting the pattern would have
 * turned "no topics" into four fabricated ones. Neither half is safe alone.
 */
const TOPIC_NUMBER_RE = /\b([A-Z]{1,5}\d{2,3}[.-]\w{1,10})\b/g;
/** The current format: component, two-digit year, cycle block, dash, NV/DV + three digits. */
const MODERN_TOPIC_RE = /\b([A-Z]{2,6}\d{2}[A-Z]{1,3}\d{2}-[A-Z]{1,3}\d{3})\b/g;

export interface ExtractedTopic {
  topicNumber: string;
  title: string;
  branch: string | null;
  description: string | null;
}

export interface ExtractTopicsResult {
  topics: ExtractedTopic[];
  skippedExisting: number;
  totalFound: number;
  source: 'toc' | 'fullscan' | 'none';
  topicNumbers: string[];
  message?: string;
}

/**
 * Scan for topic numbers — across the WHOLE document.
 *
 * ── THE 30,000-CHARACTER WINDOW ──────────────────────────────────────────────────────────────
 * This read `text.slice(0, 30000)`, on the assumption that topic numbers appear in a
 * table-of-contents near the front. On the DoW 2026 SBIR BAA every one of the 139 topic-number
 * mentions falls OUTSIDE that window — the first is at character 98,881, and the DHA topic index
 * is at 850,107. So the function returned an empty array and the caller reported, truthfully and
 * uselessly, that the solicitation contains no topics.
 *
 * It is the third fixed-prefix window this codebase has been caught by: the drafter's
 * `full_text[:18000]`, the ranker's 296-character card corpus, and this. The shape is always the
 * same — a document whose SPECIFIC content lives deep, read through a window sized for its
 * preface. A prefix is the worst possible window over a document ordered general-to-specific.
 *
 * Scanning 1M characters with two regexes is milliseconds; the prefix bought nothing.
 */
function findTopicNumbers(text: string): string[] {
  const matches = new Set<string>();
  for (const source of [MODERN_TOPIC_RE.source, TOPIC_NUMBER_RE.source]) {
    const re = new RegExp(source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      const candidate = m[1];
      // Must look like a component prefix followed by a number, and be long enough that a
      // date range or a file name cannot pass. `AUG22-19822` and `T022.htm` both fail here.
      if (/^[A-Z]{1,6}\d/.test(candidate) && candidate.length >= 7 && !/\.[a-z]{2,4}$/.test(candidate)) {
        matches.add(candidate);
      }
    }
  }
  return Array.from(matches);
}

/**
 * Extract topics by scanning the full text for structured topic blocks.
 * Each DoD SBIR topic typically follows this pattern:
 *   TOPIC_NUMBER: Title
 *   OUSD(R&E) CRITICAL TECHNOLOGY AREA(S): ...
 *   OBJECTIVE: ...
 *   DESCRIPTION: ...
 *   PHASE I: ...
 */
function extractTopicsFromText(text: string, topicNumbers: string[]): ExtractedTopic[] {
  const topics: ExtractedTopic[] = [];

  for (const tn of topicNumbers) {
    /**
     * Find the occurrence that IS the topic entry, not one that merely mentions it.
     *
     * `indexOf` takes the first, and in a real BAA the first mention of a topic number is usually
     * a cross-reference — "The following instructions apply to topics: DON26BZ01-NV001 through
     * DON26BZ01-NV039". Taking it produced a topic whose title was the literal string "through
     * DON26BZ01-NV039", and another titled with a bullet from the surrounding list.
     *
     * The entry itself is followed by a TITLE: prose, no other topic code, not a range word, not a
     * bullet. Score each occurrence on that and take the best. Same failure as the contents-page
     * trap in the highlight drive — the first hit for a heading is where it is LISTED.
     */
    const occurrences: number[] = [];
    for (let i = text.indexOf(tn); i !== -1 && occurrences.length < 40; i = text.indexOf(tn, i + 1)) occurrences.push(i);
    if (occurrences.length === 0) continue;
    const looksLikeEntry = (i: number): number => {
      const after = text.slice(i + tn.length, i + tn.length + 140).replace(/^[\s:\t–—-]+/, '');
      const firstLine = (after.split('\n')[0] ?? '').trim();
      if (!firstLine) return -1;
      if (/^(through|thru|to)\b/i.test(firstLine)) return -1;       // a range
      if (/^[•o\-*]\s/.test(firstLine)) return -1;                   // a bullet in a list
      if (/[A-Z]{2,6}\d{2}[A-Z]{1,3}\d{2}-/.test(firstLine)) return -1; // names another topic
      const words = firstLine.split(/\s+/).filter(Boolean).length;
      return words >= 3 && firstLine.length >= 12 ? firstLine.length : 0;
    };
    const startIdx = occurrences
      .map((i) => ({ i, s: looksLikeEntry(i) }))
      .sort((a, b) => b.s - a.s)[0];
    if (!startIdx || startIdx.s <= 0) continue;   // no occurrence reads like an entry — skip it

    // Find the end of this topic block (next topic number or +5000 chars)
    let endIdx = text.length;
    for (const other of topicNumbers) {
      if (other === tn) continue;
      const otherIdx = text.indexOf(other, startIdx.i + tn.length + 10);
      if (otherIdx > startIdx.i && otherIdx < endIdx) {
        endIdx = otherIdx;
      }
    }
    const block = text.slice(startIdx.i, Math.min(endIdx, startIdx.i + 5000));

    // Extract title -- usually the first line after the topic number
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    const firstLine = lines[0] ?? '';
    // Title is either "AF261-001: Title Here" or "AF261-001\nTitle Here"
    let title = firstLine.replace(tn, '').replace(/^[\s:–—-]+/, '').trim();
    if (!title && lines.length > 1) {
      title = lines[1].replace(/^[\s:–—-]+/, '').trim();
    }
    // Strip the document's own label. DoD topic entries are written "TITLE: Amphibious Combat
    // Vehicle Manoeuvre Improvements" — the word TITLE is the form's label, not part of the name,
    // and carrying it into the card puts it in front of every topic in the customer's list.
    title = title.replace(/^TITLE\s*[:\-–—]\s*/i, '').trim();
    // Cap at 200 chars
    title = title.slice(0, 200);

    // Detect the branch from the topic-number prefix.
    //
    // The 2-letter lookup alone left 52 of 69 topics on this BAA unmapped: the current codes carry
    // a THREE-letter component (DON, DAF, DPA, OSW, SOC), and `slice(0,2)` turns DON into "DO",
    // which is in no table. Try three letters, then two, then one — most specific first, so a
    // longer code cannot be shadowed by a shorter prefix that happens to collide.
    const branchMap: Record<string, string> = {
      DON: 'Navy', DAF: 'Air Force', DPA: 'DARPA', DHA: 'DHA', SOC: 'SOCOM',
      OSW: 'OSD', SCO: 'OSD', MDA: 'MDA', DTR: 'DTRA', CBD: 'CBD', DLA: 'DLA', SDA: 'SDA',
      AF: 'Air Force', DA: 'DARPA', SO: 'SOCOM', DH: 'DHA', CB: 'CBD', DT: 'DTRA', MI: 'MDA',
      N: 'Navy', A: 'Army',
    };
    const up = tn.toUpperCase();
    const branch: string | null =
      branchMap[up.slice(0, 3)] ?? branchMap[up.slice(0, 2)] ?? branchMap[up[0]] ?? null;

    // Extract description -- look for OBJECTIVE or DESCRIPTION heading
    let description: string | null = null;
    const descMatch = block.match(/(?:OBJECTIVE|DESCRIPTION)[:\s]*\n?([\s\S]{20,1000}?)(?:\n(?:PHASE|REFERENCES|KEYWORDS)|\n\n\n)/i);
    if (descMatch) {
      description = descMatch[1].trim().slice(0, 1000);
    }

    if (title) {
      topics.push({ topicNumber: tn, title, branch, description });
    }
  }

  return topics;
}

/**
 * Extract topics from a solicitation's text.
 *
 * If `text` is provided, it is used directly. Otherwise, the function reads
 * text from the solicitation_documents table (extracted_text) or the
 * curated_solicitations table (full_text).
 *
 * Returns structured topic data without writing anything to the DB -- the
 * caller decides what to do with the results.
 */
export async function extractTopicsForSolicitation(
  solicitationId: string,
  text?: string | null,
): Promise<ExtractTopicsResult> {
  // Resolve text if not provided
  if (!text) {
    try {
      const docRows = await sql<{ extractedText: string | null }[]>`
        SELECT extracted_text FROM solicitation_documents
        WHERE solicitation_id = ${solicitationId}::uuid
          AND document_type = 'source'
          AND extracted_text IS NOT NULL
        ORDER BY created_at ASC LIMIT 1
      `;
      if (docRows.length > 0 && docRows[0].extractedText) {
        text = docRows[0].extractedText;
      }
    } catch (err) {
      console.error('[extract-topics] Failed to load solicitation documents:', err);
    }
  }

  if (!text) {
    try {
      const csRows = await sql<{ fullText: string | null }[]>`
        SELECT full_text FROM curated_solicitations
        WHERE id = ${solicitationId}::uuid
      `;
      text = csRows[0]?.fullText ?? null;
    } catch (err) {
      console.error('[extract-topics] Failed to load curated solicitation text:', err);
    }
  }

  if (!text || text.length < 100) {
    return {
      topics: [],
      skippedExisting: 0,
      totalFound: 0,
      source: 'none',
      topicNumbers: [],
      message: 'No text available. Upload the source PDF and wait for extraction, or add topics manually.',
    };
  }

  // Step 1: Find topic-number-like patterns in the text
  const topicNumbers = findTopicNumbers(text);

  if (topicNumbers.length === 0) {
    return {
      topics: [],
      skippedExisting: 0,
      totalFound: 0,
      source: 'none',
      topicNumbers: [],
      message: 'No topic numbers found in the document. This RFP may use individual topic files — use the file-drop path to upload them.',
    };
  }

  // Step 2: Extract structured topic data from the text blocks
  const topics = extractTopicsFromText(text, topicNumbers);

  // Filter out topics that already exist under this solicitation
  let existingRows: { topicNumber: string }[];
  try {
    existingRows = await sql<{ topicNumber: string }[]>`
      SELECT topic_number FROM opportunities
      WHERE solicitation_id = ${solicitationId}::uuid
        AND topic_number IS NOT NULL
    `;
  } catch (err) {
    console.error('[extract-topics] Failed to load existing topics:', err);
    existingRows = [];
  }
  const existing = new Set(existingRows.map((r) => r.topicNumber));
  const newTopics = topics.filter((t) => !existing.has(t.topicNumber));

  return {
    topics: newTopics,
    skippedExisting: topics.length - newTopics.length,
    totalFound: topics.length,
    source: 'toc',
    topicNumbers,
  };
}
