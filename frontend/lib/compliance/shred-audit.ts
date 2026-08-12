/**
 * Shred-completeness audit — did the ingest capture EVERY obligation the solicitation states into the
 * compliance structure (volume_required_items + solicitation_compliance)? Run at CURATION time, before
 * release, so an RFP admin can fill a gap before any tenant builds against an under-shredded matrix.
 *
 * Two layers, gated like the rest of the platform's AI (semantic retrieval / vision / embeddings):
 *   • ALWAYS ON — a deterministic obligation→captured diff off `curated_solicitations.full_text`:
 *     extract obligation-bearing sentences ("shall / must / is required to / will provide …"), and for
 *     each, check whether its salient terms are represented in ANY captured requirement. Sentences with
 *     little overlap surface as CANDIDATE GAPS. Cheap, deterministic, no key — catches gross
 *     under-shredding and gives the admin a concrete review list.
 *   • GATED (ANTHROPIC_API_KEY) — a semantic deep pass that ranks true misses vs. the captured set.
 *     Inert without a key: the report ships the deterministic result alone (never blocks curation).
 *
 * Advisory only — it never edits the matrix; it hands the RFP admin a ranked review list.
 */
import { sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';

export interface ShredAuditReport {
  solicitationId: string;
  hasFullText: boolean;
  obligationsFound: number;
  requirementsCaptured: number;
  /** captured / obligations, capped at 1 — a rough "how much of the stated burden is in the matrix". */
  coverageRatio: number;
  /** Heuristic: real obligation text present, but the captured set is suspiciously sparse. */
  thin: boolean;
  /** Obligation sentences whose salient terms appear in no captured requirement — the review list. */
  candidateGaps: string[];
  /** Whether the gated semantic pass ran (real ANTHROPIC_API_KEY); the deterministic layer always runs. */
  aiPass: boolean;
}

const OBLIGATION_CUE =
  /\b(shall|must|is required to|are required to|will (?:provide|submit|include|describe)|required to (?:submit|provide|include)|at a minimum|no later than|page limit|font size|margins?)\b/i;

const STOP = new Set([
  'shall', 'must', 'will', 'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'their', 'they',
  'each', 'any', 'all', 'are', 'is', 'be', 'to', 'of', 'in', 'on', 'or', 'a', 'an', 'as', 'at', 'by',
  'proposal', 'proposals', 'offeror', 'offerors', 'section', 'volume', 'include', 'provide', 'submit',
  'required', 'describe', 'following', 'shall', 'should', 'may', 'not', 'no', 'more', 'than', 'been',
]);

/** Crude sentence split (period/semicolon/newline/bullet), trimmed, non-trivial length. */
export function splitSentences(text: string): string[] {
  return (text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.;:])\s+|\n+|(?=•|•|\d+\.\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
}

/** Content terms (lowercased, len>=4, not stopwords) used to test representation in the captured set. */
export function salientTerms(sentence: string): string[] {
  const seen = new Set<string>();
  for (const raw of sentence.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []) {
    if (!STOP.has(raw)) seen.add(raw);
  }
  return [...seen];
}

/**
 * Deterministic audit (always on). `aiPass=false` here; the gated semantic pass wraps this.
 */
export async function auditShredCompleteness(solicitationId: string): Promise<ShredAuditReport> {
  const [sol] = await sql<{ fullText: string | null }[]>`
    SELECT full_text AS "fullText" FROM curated_solicitations WHERE id = ${solicitationId}::uuid LIMIT 1`;
  const fullText = sol?.fullText ?? '';

  const items = await sql<{ itemName: string | null }[]>`
    SELECT vri.item_name AS "itemName"
    FROM volume_required_items vri
    JOIN solicitation_volumes sv ON sv.id = vri.volume_id
    WHERE sv.solicitation_id = ${solicitationId}::uuid`;
  const comp = await sql<{ requiredDocuments: unknown; requiredSections: unknown }[]>`
    SELECT required_documents AS "requiredDocuments", required_sections AS "requiredSections"
    FROM solicitation_compliance WHERE solicitation_id = ${solicitationId}::uuid`;

  // The captured corpus: every requirement label the shred DID record, lowercased, as one haystack.
  const docs = comp.flatMap((c) => coerceJsonb<unknown[]>(c.requiredDocuments, []) ?? []);
  const secs = comp.flatMap((c) => coerceJsonb<unknown[]>(c.requiredSections, []) ?? []);
  const label = (v: unknown): string =>
    typeof v === 'string' ? v : (v as { name?: string; label?: string; text?: string } | null)?.name
      ?? (v as { label?: string } | null)?.label ?? (v as { text?: string } | null)?.text ?? '';
  const capturedReqTerms = [
    ...items.map((i) => i.itemName ?? ''),
    ...docs.map(label),
    ...secs.map(label),
  ].map((l) => salientTerms(l)).filter((t) => t.length > 0);
  const requirementsCaptured = items.length + docs.length;

  // An obligation is COVERED when some captured requirement is clearly NAMED within it — ≥60% of that
  // requirement label's salient terms appear in the obligation. Reverse-direction (label ⊆ obligation),
  // so a verbose obligation that names a captured requirement ("...a detailed Technical Approach
  // describing the methodology") isn't falsely flagged just for carrying extra descriptive words.
  const covered = (oblTerms: Set<string>): boolean =>
    capturedReqTerms.some((req) => req.filter((t) => oblTerms.has(t)).length / req.length >= 0.6);

  const obligations = splitSentences(fullText).filter((s) => OBLIGATION_CUE.test(s));
  const candidateGaps: string[] = [];
  for (const s of obligations) {
    const terms = new Set(salientTerms(s));
    if (terms.size === 0) continue;
    if (!covered(terms)) candidateGaps.push(s.length > 240 ? `${s.slice(0, 237)}…` : s);
  }

  const obligationsFound = obligations.length;
  const coverageRatio = obligationsFound > 0 ? Math.min(1, requirementsCaptured / obligationsFound) : 1;
  const thin = obligationsFound >= 5 && requirementsCaptured < obligationsFound * 0.5;

  return {
    solicitationId,
    hasFullText: fullText.length > 200,
    obligationsFound,
    requirementsCaptured,
    coverageRatio: Math.round(coverageRatio * 100) / 100,
    thin,
    candidateGaps: candidateGaps.slice(0, 25),
    aiPass: false,
  };
}
