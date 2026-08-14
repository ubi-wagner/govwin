/**
 * Scout candidate classification — deterministic NEW-vs-UPDATE matcher (#176).
 *
 * Given a scout finding (a "potential opportunity" a crawler or the HITL source-scout surfaced),
 * decide whether it is a genuinely NEW opportunity or an UPDATE to one we ALREADY have — by
 * matching it against the existing `opportunities` master list. This is the deterministic anchor
 * for the "ai_similar_to / ai_similarity_score" dedup: the opportunity_scout AGENT's advisory
 * `possible_update` judgment rides on TOP of this, it does not replace it.
 *
 * Pure + side-effect-free (unit-testable without a DB). The DB wrapper lives in lib/scout/candidates.ts.
 *
 * All candidate text is UNTRUSTED external input; this module only reads/normalizes strings for
 * comparison — it never evals, executes, or interprets any field as an instruction.
 */

export interface CandidateInput {
  title: string;
  agency?: string | null;
  solicitationNumber?: string | null;
  source?: string | null;
  sourceId?: string | null;
  url?: string | null;
  description?: string | null;
}

export interface ExistingOpp {
  id: string;
  source: string | null;
  sourceId: string | null;
  title: string | null;
  agency: string | null;
  solicitationNumber: string | null;
}

export type Classification = 'new' | 'update' | 'unknown';

export interface ClassifyResult {
  classification: Classification;
  matchOpportunityId: string | null;
  score: number; // 0..1 confidence of the best match
  reason: string;
  signal: string; // which rule fired: source_id | sol_number | title_exact* | title_similarity | none
}

// ── Bands ────────────────────────────────────────────────────────────
/** best match >= this ⇒ UPDATE (confident). */
export const UPDATE_THRESHOLD = 0.6;
/** best match in [AMBIGUOUS_THRESHOLD, UPDATE_THRESHOLD) ⇒ UNKNOWN (surface the possible match, admin decides). */
export const AMBIGUOUS_THRESHOLD = 0.4;

// ── Normalization ────────────────────────────────────────────────────

/** Lowercase, replace every non-alphanumeric with a space, collapse whitespace. */
function normText(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Solicitation-number normalization: uppercase, keep only [A-Z0-9], drop separators. */
function normNumber(s: string | null | undefined): string {
  if (!s) return '';
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

// Common words that carry no matching signal in federal opportunity titles.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'on', 'with', 'sbir', 'sttr',
  'phase', 'i', 'ii', 'iii', 'program', 'topic', 'solicitation', 'fy', 'fy2026',
  'department', 'office', 'system', 'systems', 'technology', 'technologies',
]);

function tokenize(s: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const t of normText(s).split(' ')) {
    if (t.length >= 2 && !STOPWORDS.has(t)) out.add(t);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ── Per-opportunity score ────────────────────────────────────────────

interface PerOpp {
  score: number;
  signal: string;
  reason: string;
}

function scoreAgainst(c: CandidateInput, o: ExistingOpp): PerOpp {
  const cSrc = normText(c.source);
  const oSrc = normText(o.source);
  const cSrcId = normText(c.sourceId);
  const oSrcId = normText(o.sourceId);
  const cNum = normNumber(c.solicitationNumber);
  const oNum = normNumber(o.solicitationNumber);
  const cTitleN = normText(c.title);
  const oTitleN = normText(o.title);
  const agencyMatch = normText(c.agency) !== '' && normText(c.agency) === normText(o.agency);

  // 1. Same source NOTICE (source + source_id both present and equal) — the strongest signal:
  //    it is literally the same posting re-crawled.
  if (cSrc && cSrcId && cSrc === oSrc && cSrcId === oSrcId) {
    return { score: 0.98, signal: 'source_id', reason: `same source notice (${c.source}/${c.sourceId})` };
  }

  // 2. Same solicitation number — an amendment / re-post of a known solicitation.
  if (cNum && cNum === oNum) {
    return { score: 0.95, signal: 'sol_number', reason: `same solicitation number ${c.solicitationNumber}` };
  }

  // 3. Exact normalized title.
  if (cTitleN && cTitleN === oTitleN) {
    return agencyMatch
      ? { score: 0.92, signal: 'title_exact_agency', reason: 'identical title + same agency' }
      : { score: 0.85, signal: 'title_exact', reason: 'identical title' };
  }

  // 4. Fuzzy title similarity (token Jaccard). Same-agency corroboration boosts it into the
  //    UPDATE band; without agency it stays weaker.
  const titleSim = jaccard(tokenize(c.title), tokenize(o.title));
  if (titleSim > 0) {
    const pct = Math.round(titleSim * 100);
    const score = agencyMatch ? Math.min(0.55 + titleSim * 0.45, 0.9) : titleSim * 0.7;
    return {
      score,
      signal: 'title_similarity',
      reason: `title ${pct}% similar${agencyMatch ? ' + same agency' : ''}`,
    };
  }

  return { score: 0, signal: 'none', reason: 'no overlap' };
}

// ── Public: classify one candidate against the master list ───────────

/**
 * Classify a candidate against the existing opportunities. Deterministic:
 *   best >= UPDATE_THRESHOLD      → 'update' (matchOpportunityId set)
 *   best in [AMBIGUOUS, UPDATE)   → 'unknown' (possible match surfaced, admin decides)
 *   best <  AMBIGUOUS_THRESHOLD   → 'new' (no meaningful match)
 */
export function classifyCandidateAgainst(c: CandidateInput, opps: ExistingOpp[]): ClassifyResult {
  let best: PerOpp & { id: string } = { id: '', score: 0, signal: 'none', reason: 'no existing opportunity matched' };
  for (const o of opps) {
    const s = scoreAgainst(c, o);
    if (s.score > best.score) best = { ...s, id: o.id };
  }

  if (best.score >= UPDATE_THRESHOLD) {
    return { classification: 'update', matchOpportunityId: best.id || null, score: round(best.score), reason: best.reason, signal: best.signal };
  }
  if (best.score >= AMBIGUOUS_THRESHOLD) {
    return { classification: 'unknown', matchOpportunityId: best.id || null, score: round(best.score), reason: `possible match — ${best.reason}`, signal: best.signal };
  }
  return { classification: 'new', matchOpportunityId: null, score: round(best.score), reason: best.score > 0 ? `weak signal only — ${best.reason}` : 'no existing opportunity matched', signal: best.signal };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
