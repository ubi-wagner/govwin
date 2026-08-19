/**
 * Whose words are these? (LIB-HYGIENE)
 *
 * Atomizing an uploaded solicitation package fills a tenant's library with the agency's own
 * instruction text — "Volume 1 shall not exceed 10 pages", form field labels, submission
 * directions. Retrieval then offers that text to the drafter, and the visible failure is a
 * proposal quoting the RFP's instructions back at the evaluator.
 *
 * THE FENCE THAT DIDN'T WORK. The obvious fix is structural: exclude anything filed under the
 * reference folder. It was tried and it was wrong — the same folder holds the tenant's uploaded
 * PAST PROPOSALS and every figure harvested from them, which is the best material they own. Live
 * scoring proved it: with the fence on, the tenant's own section scored 4.39 against a
 * boilerplate atom's 1.06 — the fence was throwing out the winner to catch the loser. Reverted.
 *
 * THE PROPERTY THAT ACTUALLY SEPARATES THEM is not where a file sits, it is who wrote it, and
 * that has a deterministic test: **text appearing verbatim in the shared solicitation corpus was
 * written by the agency.** A company's own capability narrative does not appear inside a
 * government solicitation. So the check reads the text, not the folder, and cannot mis-fence a
 * tenant's writing no matter where they filed it.
 *
 * CROSS-TENANT BY NECESSITY, AND SAFE. The corpus is `solicitation_documents.extracted_text` —
 * PLATFORM-owned master records that belong to no tenant, so the read uses `sqlBypass`
 * (docs/RLS_CUTOVER.md sanctions exactly this: admin/platform reads on RLS-forced tables). Nothing
 * about another tenant is read, returned, or inferred: the only thing that crosses is a yes/no
 * about the AGENCY's public text, and the answer is stored on the tenant's own row.
 *
 * BEST-EFFORT. An upload must never fail because this check could not run. Unknown ⇒ `false` ⇒ the
 * atom stays retrievable, which is the pre-existing behaviour.
 */
import { sqlBypass } from '@/lib/db';

/**
 * Below this, a match means nothing. A one-line atom ("Technical Volume") legitimately appears in
 * both a solicitation and a company's own proposal, and flagging it would fence real material.
 */
const MIN_PROBE_CHARS = 120;

/** How much contiguous text to look for. Long enough that a coincidence is not plausible. */
const PROBE_CHARS = 180;

/** Never scan the whole corpus: bounded work per atom, on the upload path. */
const MAX_DOCS_SCANNED = 400;

/** Collapse everything that differs between an extractor's output and a stored atom. */
export function normalizeForCorpusMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The slice of an atom to look for in the corpus.
 *
 * Taken from the MIDDLE, not the start. Openings are the most-shared part of any document — a
 * heading, a title, a numbered label — and matching on one would flag a tenant's own section
 * merely for being called "Technical Approach". The middle of a passage is where authorship lives.
 *
 * Exported for the test, which is the only way to pin "we probe the middle" as a decision rather
 * than an accident of slicing.
 */
export function corpusProbe(text: string | null | undefined): string | null {
  const norm = normalizeForCorpusMatch(text ?? '');
  if (norm.length < MIN_PROBE_CHARS) return null;
  if (norm.length <= PROBE_CHARS) return norm;
  const start = Math.floor((norm.length - PROBE_CHARS) / 2);
  return norm.slice(start, start + PROBE_CHARS);
}

/**
 * Does this text appear verbatim in the shared solicitation corpus?
 *
 * Never throws. Never blocks. `false` on any doubt — the cost of a missed flag is one low-ranked
 * candidate; the cost of a false flag is a tenant's own writing made unreachable.
 */
export async function isCorpusVerbatim(text: string | null | undefined): Promise<boolean> {
  const probe = corpusProbe(text);
  if (!probe) return false;
  try {
    // Normalize the corpus side the same way, in SQL, so an extractor's line wrapping cannot
    // defeat the match. Bounded by MAX_DOCS_SCANNED; `strpos` short-circuits on the first hit.
    //
    // '\\s+' — DOUBLE backslash. This is a JavaScript template literal, so a lone `\s` is just the
    // character `s`: Postgres would receive the pattern 's+' and helpfully replace every run of
    // the letter S in the corpus with a space. Written that way first, and the live drive caught
    // it immediately — identical text failed to match itself. The unit tests could not see it;
    // they never reach SQL.
    const [hit] = await sqlBypass<Array<{ found: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM (
          SELECT extracted_text FROM solicitation_documents
          WHERE extracted_text IS NOT NULL AND length(extracted_text) > 0
          ORDER BY updated_at DESC
          LIMIT ${MAX_DOCS_SCANNED}
        ) d
        WHERE strpos(lower(regexp_replace(d.extracted_text, '\\s+', ' ', 'g')), ${probe}) > 0
      ) AS "found"
    `;
    return hit?.found === true;
  } catch (e) {
    console.error('[corpus-verbatim] check failed (non-fatal, treated as not-verbatim):', e);
    return false;
  }
}
