/**
 * ASK THE DOCUMENTS, THEN ANNOTATE THE CALL.
 *
 * The database half of `lib/harvest/match.ts`. Takes a finding whose documents have been
 * harvested (mig 255), looks for the same or similar files anywhere else the platform already
 * holds them, and writes the verdict onto the finding as EVIDENCE (mig 256).
 *
 * ── WHAT IT IS ALLOWED TO CHANGE ───────────────────────────────────────────────────────────────
 *   certain      may move `classification` to `update` and set `match_opportunity_id`
 *   flag         changes NOTHING — it is written down for a person to read
 *   boilerplate  changes nothing, and is recorded so a curator knows why it is not evidence
 *
 * A `flag` deliberately has no power. Filename-plus-size is a good reason to look and a bad
 * reason to act: the two cheapest signals on the two most-repeated attributes in government
 * document naming.
 *
 * ── AND IT ONLY EVER MOVES THE CALL ONE WAY ────────────────────────────────────────────────────
 * `new` → `update` on certain evidence; never `update` → `new`. If the title matcher already
 * decided this is an amendment to something, a document that happens to be shared is a weaker
 * reason to undo that than the reasoning that produced it. Releasing an amendment AS NEW is the
 * expensive mistake this whole queue exists to prevent — forking a solicitation that should have
 * stayed one record — so the annotation is allowed to prevent that error and not to cause it.
 */
import { sqlBypass } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { judgeDocument, strongest, type DocMatch, type CandidateDoc } from './match';

export type OwnerKind = 'solicitation' | 'finding';

export interface EvidenceEntry {
  verdict: DocMatch['verdict'];
  ownerKind: OwnerKind;
  ownerId: string | null;
  filename: string;
  score: number;
  reason: string;
}

export interface DocumentEvidence {
  checkedAt: string;
  documents: number;
  verdict: DocMatch['verdict'] | 'none';
  matches: EvidenceEntry[];
}

export interface JudgeResult {
  ok: boolean;
  findingId: string;
  evidence: DocumentEvidence;
  /** Set when the evidence moved the finding's classification. */
  reclassifiedTo?: 'update';
  matchedOpportunityId?: string | null;
  error?: string;
  code?: string;
}

/** An empty verdict, written deliberately — see the migration note on `none` vs NULL. */
const nothing = (documents: number): DocumentEvidence => ({
  checkedAt: new Date().toISOString(),
  documents,
  verdict: 'none',
  matches: [],
});

/**
 * Judge one finding by its harvested documents.
 *
 * `sqlBypass` throughout: `scout_findings` and its documents are PLATFORM scope (no `tenant_id`),
 * and a tenant-context write of a platform row updates zero rows under `govtech_app` — the
 * isolation policy is tenant-EQUALITY and NULL equals nothing.
 */
export async function judgeFindingByDocuments(findingId: string): Promise<JudgeResult> {
  let mine: Array<{ filename: string; size: number | null; hash: string | null }>;
  try {
    mine = await sqlBypass<Array<{ filename: string; size: number | null; hash: string | null }>>`
      SELECT original_filename AS filename, file_size AS size, content_hash AS hash
        FROM scout_finding_documents
       WHERE finding_id = ${findingId}::uuid AND content_hash IS NOT NULL`;
  } catch (err) {
    console.error('[judge] could not read the harvested documents:', err);
    return { ok: false, findingId, evidence: nothing(0),
      error: 'Could not read the harvested documents', code: 'DB_ERROR' };
  }

  if (!mine.length) {
    // Nothing harvested, or everything failed. That is NOT "no match" — it is "nothing to ask",
    // and recording it as a verdict would claim a check that never happened.
    return { ok: false, findingId, evidence: nothing(0),
      error: 'No harvested documents to judge — harvest this finding first', code: 'NOT_HARVESTED' };
  }

  const hashes = mine.map((d) => d.hash!).filter(Boolean);
  const matches: EvidenceEntry[] = [];

  try {
    /**
     * How many DISTINCT solicitations carry each of these hashes. This one query is the whole
     * boilerplate guard: a hash under many solicitations identifies none of them.
     */
    const spread = await sqlBypass<Array<{ hash: string; owners: number }>>`
      SELECT content_hash AS hash, count(DISTINCT solicitation_id)::int AS owners
        FROM solicitation_documents
       WHERE content_hash = ANY(${hashes}::text[])
       GROUP BY content_hash`;
    const ownerCount = new Map(spread.map((r) => [r.hash, r.owners]));

    // ── candidates from CURATED solicitations ────────────────────────────────────────────────
    // Exact hash, or a size within tolerance — the size band is the index-friendly half of the
    // "close enough" test, and the filename comparison happens in the pure layer afterwards.
    const minSize = Math.min(...mine.map((d) => d.size ?? Infinity));
    const maxSize = Math.max(...mine.map((d) => d.size ?? 0));
    const curated = await sqlBypass<Array<{
      ownerId: string; filename: string; size: number | null; hash: string | null;
    }>>`
      SELECT solicitation_id AS "ownerId", original_filename AS filename,
             file_size AS size, content_hash AS hash
        FROM solicitation_documents
       WHERE content_hash = ANY(${hashes}::text[])
          OR (file_size IS NOT NULL
              AND file_size BETWEEN ${Math.floor(minSize * 0.9) || 0} AND ${Math.ceil(maxSize * 1.1)})
       LIMIT 500`;

    // ── candidates from OTHER findings ───────────────────────────────────────────────────────
    const others = await sqlBypass<Array<{
      ownerId: string; filename: string; size: number | null; hash: string | null;
    }>>`
      SELECT finding_id AS "ownerId", original_filename AS filename,
             file_size AS size, content_hash AS hash
        FROM scout_finding_documents
       WHERE finding_id <> ${findingId}::uuid AND content_hash IS NOT NULL
       LIMIT 500`;

    const consider = (rows: typeof curated, kind: OwnerKind) => {
      for (const d of mine) {
        const self: CandidateDoc = { ownerId: null, filename: d.filename, size: d.size, hash: d.hash };
        for (const r of rows) {
          const theirs: CandidateDoc = {
            ownerId: r.ownerId, filename: r.filename, size: r.size, hash: r.hash,
            hashOwnerCount: r.hash ? ownerCount.get(r.hash) : undefined,
          };
          const m = judgeDocument(self, theirs);
          if (m) matches.push({ ...m, ownerKind: kind });
        }
      }
    };
    consider(curated, 'solicitation');
    consider(others, 'finding');
  } catch (err) {
    console.error('[judge] could not look for counterparts:', err);
    return { ok: false, findingId, evidence: nothing(mine.length),
      error: 'Could not look for matching documents', code: 'DB_ERROR' };
  }

  const best = strongest(matches);
  const evidence: DocumentEvidence = {
    checkedAt: new Date().toISOString(),
    documents: mine.length,
    verdict: best?.verdict ?? 'none',
    // Strongest first, so a reader meets the decisive entry before the context.
    matches: matches.sort((a, b) => b.score - a.score).slice(0, 25),
  };

  try {
    /**
     * The annotation. `classification` moves ONLY on certain evidence against a curated
     * solicitation, and ONLY out of `new`/`unknown` — see the header on why this is one-way.
     *
     * The compare-and-swap on `classification` is what keeps this safe against a curator who
     * decided in the meantime: if the row is no longer where this judgement assumed, the call is
     * left alone and only the evidence is written.
     */
    const canMove = best?.verdict === 'certain'
      && matches.some((m) => m.verdict === 'certain' && m.ownerKind === 'solicitation' && m.ownerId);
    const target = canMove
      ? matches.find((m) => m.verdict === 'certain' && m.ownerKind === 'solicitation' && m.ownerId)!.ownerId
      : null;

    if (canMove && target) {
      const moved = await sqlBypass`
        UPDATE scout_findings
           SET document_evidence = ${sqlBypass.json(evidence as unknown as Parameters<typeof sqlBypass.json>[0])},
               classification = 'update',
               match_opportunity_id = ${target}::uuid,
               match_reason = ${`document match — ${best!.reason}`},
               similarity_score = 1,
               classified_at = now()
         WHERE id = ${findingId}::uuid
           AND classification IN ('new', 'unknown')`;
      if (moved.count > 0) {
        return { ok: true, findingId, evidence, reclassifiedTo: 'update', matchedOpportunityId: target };
      }
      // It moved under us, or was already `update`. Record the evidence and leave the call.
    }

    await sqlBypass`
      UPDATE scout_findings
         SET document_evidence = ${sqlBypass.json(evidence as unknown as Parameters<typeof sqlBypass.json>[0])}
       WHERE id = ${findingId}::uuid`;
  } catch (err) {
    console.error('[judge] could not record the evidence:', err);
    return { ok: false, findingId, evidence, error: 'Could not record the evidence', code: 'DB_ERROR' };
  }

  return { ok: true, findingId, evidence };
}

/** Read back what a finding's documents said, for a surface that renders it. */
export async function readDocumentEvidence(findingId: string): Promise<DocumentEvidence | null> {
  try {
    const [row] = await sqlBypass<Array<{ evidence: unknown }>>`
      SELECT document_evidence AS evidence FROM scout_findings WHERE id = ${findingId}::uuid`;
    if (!row || row.evidence == null) return null;
    return coerceJsonb<DocumentEvidence>(row.evidence, nothing(0));
  } catch (err) {
    console.error('[judge] could not read the evidence:', err);
    return null;
  }
}
