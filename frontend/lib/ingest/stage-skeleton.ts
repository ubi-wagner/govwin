/**
 * Ingest Studio — STAGE and LAND (the split that gives the matrix a gate).
 *
 * `materializeSkeleton` used to parse and WRITE in one call. That put agent-derived values
 * straight into `solicitation_compliance` — the single most consequential business table we own,
 * the one a customer builds a submission against and is rejected over — with no review step. It
 * is also the one place we broke our own non-negotiable agent rule (docs/AGENT_WORKFORCE.md):
 * *advisory → guardrail → land-or-review; agent output NEVER auto-writes a business table.*
 *
 * So the write is split in two:
 *
 *   stageSkeleton()  proposes a matrix into `solicitation_compliance_drafts`. Inspectable,
 *                    supersedable, and invisible to every tenant. Nothing is landed.
 *   landSkeleton()   promotes a reviewed draft into `solicitation_compliance` +
 *                    `solicitation_volumes` (+ the topic cards). THE ONLY WRITER.
 *
 * What makes the review in between worth having is migration 187/188: every staged value carries
 * the sentence it was read from, its page, and which document. So a reviewer — human or
 * adversarial agent — can *check* a value rather than merely believe it.
 *
 * docs/INGEST_STUDIO_DESIGN.md is canonical.
 */
import { sql } from '@/lib/db';
import type { JSONValue } from 'postgres';
import { coerceJsonb } from '@/lib/jsonb';
import { auditProvenance, type ProvenanceAudit } from './provenance-audit';
import { materializeSkeleton, type MaterializeResult } from './materialize';
import { republishSolicitationCards } from '@/lib/curation/republish';
import type { ParsedSolicitation } from './skeleton';

/** Phases of the Ingest Studio state machine (curated_solicitations.ingest_phase, mig 189). */
export const INGEST_PHASES = ['not_started', 'extract', 'matrix', 'review', 'landed', 'molds', 'complete'] as const;
export type IngestPhase = (typeof INGEST_PHASES)[number];

/** Ordered, so "what comes next" is one lookup and never a chain of ifs. */
const PHASE_ORDER: IngestPhase[] = ['not_started', 'extract', 'matrix', 'review', 'landed', 'molds', 'complete'];
export function nextPhase(p: IngestPhase): IngestPhase {
  const i = PHASE_ORDER.indexOf(p);
  return i < 0 || i === PHASE_ORDER.length - 1 ? 'complete' : PHASE_ORDER[i + 1];
}

export interface ComplianceDraft {
  id: string;
  solicitationId: string;
  parsed: ParsedSolicitation;
  fieldProvenance: Record<string, unknown>;
  audit: ProvenanceAudit | Record<string, never>;
  review: Record<string, unknown>;
  guidance: string | null;
  status: 'staged' | 'reviewed' | 'landed' | 'superseded' | 'rejected';
  phase: string;
  createdAt: string;
  reviewedAt: string | null;
  landedAt: string | null;
}

/** Row shape as postgres.js returns it — camelCase, per the toCamel SOP (CLAUDE.md §Data Layer). */
type DraftRow = {
  id: string; solicitationId: string; parsed: unknown; fieldProvenance: unknown; audit: unknown;
  review: unknown; guidance: string | null; status: ComplianceDraft['status']; phase: string;
  createdAt: Date | string; reviewedAt: Date | string | null; landedAt: Date | string | null;
};

const iso = (v: Date | string | null): string | null =>
  v == null ? null : typeof v === 'string' ? v : v.toISOString();

function toDraft(r: DraftRow): ComplianceDraft {
  return {
    id: r.id,
    solicitationId: r.solicitationId,
    parsed: coerceJsonb<ParsedSolicitation>(r.parsed, { compliance: {}, volumes: [], topics: [] }),
    fieldProvenance: coerceJsonb<Record<string, unknown>>(r.fieldProvenance, {}),
    audit: coerceJsonb<ProvenanceAudit | Record<string, never>>(r.audit, {}),
    review: coerceJsonb<Record<string, unknown>>(r.review, {}),
    guidance: r.guidance,
    status: r.status,
    phase: r.phase,
    createdAt: iso(r.createdAt)!,
    reviewedAt: iso(r.reviewedAt),
    landedAt: iso(r.landedAt),
  };
}

/** The live draft for a solicitation: newest not-yet-superseded. Null when nothing is staged. */
export async function getOpenDraft(solicitationId: string): Promise<ComplianceDraft | null> {
  const rows = await sql<DraftRow[]>`
    SELECT id, solicitation_id AS "solicitationId", parsed, field_provenance AS "fieldProvenance",
           audit, review, guidance, status, phase,
           created_at AS "createdAt", reviewed_at AS "reviewedAt", landed_at AS "landedAt"
    FROM solicitation_compliance_drafts
    WHERE solicitation_id = ${solicitationId}::uuid AND status IN ('staged', 'reviewed')
    ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ? toDraft(rows[0]) : null;
}

/**
 * STAGE a parsed solicitation as a PROPOSED matrix. Writes nothing a tenant can see.
 *
 * Supersedes any open draft rather than mutating it — re-running a phase must not erase what was
 * previously proposed or what the reviewers said about it. The provenance audit is computed and
 * stored at staging time so the review phase reasons over deterministic evidence rather than
 * re-deriving (or guessing) it.
 */
export async function stageSkeleton(
  solicitationId: string,
  parsed: ParsedSolicitation,
  opts: { phase?: 'extract' | 'matrix' | 'review'; guidance?: string | null; userId?: string | null } = {},
): Promise<ComplianceDraft> {
  const documents = await sql<Array<{ documentType: string | null; fileName: string | null }>>`
    SELECT document_type AS "documentType", original_filename AS "fileName"
    FROM solicitation_documents WHERE solicitation_id = ${solicitationId}::uuid`;

  // Provenance entries in the SAME shape the landed column uses, so landing is a copy and a
  // reviewer sees exactly what a curator will see — and so the audit below reads the same
  // structure it will read off a landed row. (parse.fieldSources is a bare
  // {column: 'pattern_match'} map; auditProvenance expects {column: {source: …}} entries, so it
  // must be given THIS, not that — feeding it the raw map silently scores every field
  // "unknown" and reports 0 read, which is exactly wrong for a matrix that was read.)
  const c = parsed.compliance ?? {};
  const prov: Record<string, JSONValue> = {};
  for (const [col, source] of Object.entries(parsed.fieldSources ?? {})) {
    const ev = parsed.fieldEvidence?.[col];
    const def = parsed.deferrals?.[col];
    prov[col] = def
      ? { source, deferred: true, reason: def.reason, rule: def.rule, page: def.page ?? null,
          excerpt: def.excerpt, charOffset: def.charOffset ?? null, docSegment: def.docSegment ?? null }
      : ev
        ? { source, rule: ev.rule, page: ev.page ?? null, excerpt: ev.excerpt,
            charOffset: ev.charOffset ?? null, docSegment: ev.docSegment ?? null }
        : { source };
  }

  const audit = auditProvenance({
    fieldProvenance: prov,
    values: c as unknown as Record<string, unknown>,
    documents,
  });

  await sql`
    UPDATE solicitation_compliance_drafts SET status = 'superseded'
    WHERE solicitation_id = ${solicitationId}::uuid AND status IN ('staged', 'reviewed')`;

  const [row] = await sql<DraftRow[]>`
    INSERT INTO solicitation_compliance_drafts
      (solicitation_id, parsed, field_provenance, audit, guidance, phase, created_by, status)
    VALUES (${solicitationId}::uuid, ${sql.json(parsed as unknown as JSONValue)}, ${sql.json(prov)},
            ${sql.json(audit as unknown as JSONValue)}, ${opts.guidance ?? null},
            ${opts.phase ?? 'matrix'}, ${opts.userId ?? null}::uuid, 'staged')
    RETURNING id, solicitation_id AS "solicitationId", parsed, field_provenance AS "fieldProvenance",
              audit, review, guidance, status, phase,
              created_at AS "createdAt", reviewed_at AS "reviewedAt", landed_at AS "landedAt"`;
  return toDraft(row);
}

/** Attach an adversarial verdict to the open draft. Advisory — it lands nothing by itself. */
export async function recordDraftReview(
  solicitationId: string,
  review: Record<string, unknown>,
): Promise<ComplianceDraft | null> {
  const rows = await sql<DraftRow[]>`
    UPDATE solicitation_compliance_drafts
    SET review = ${sql.json(review as unknown as JSONValue)}, status = 'reviewed', reviewed_at = now()
    WHERE id = (
      SELECT id FROM solicitation_compliance_drafts
      WHERE solicitation_id = ${solicitationId}::uuid AND status IN ('staged', 'reviewed')
      ORDER BY created_at DESC LIMIT 1
    )
    RETURNING id, solicitation_id AS "solicitationId", parsed, field_provenance AS "fieldProvenance",
              audit, review, guidance, status, phase,
              created_at AS "createdAt", reviewed_at AS "reviewedAt", landed_at AS "landedAt"`;
  return rows[0] ? toDraft(rows[0]) : null;
}

export interface LandResult extends MaterializeResult { draftId: string }

/** Refused landings carry a reason the UI can show verbatim. */
export class LandBlockedError extends Error {
  constructor(message: string, readonly blockers: string[]) {
    super(message);
    this.name = 'LandBlockedError';
  }
}

/**
 * LAND a staged draft: the ONLY writer of solicitation_compliance + solicitation_volumes.
 *
 * `auto` reflects an automation policy, and it is deliberately NOT all-powerful: a policy may
 * decide how much review a sound matrix needs, it may not publish one we already know is
 * unfounded. So an audit BLOCKER (an unresolved deferral with no rule-bearing document on file,
 * or a matrix where nothing at all was read) refuses the auto path and parks a human. A human
 * landing the same draft explicitly is always allowed — that is a person taking responsibility
 * for a known gap, which is a different act from a machine doing it silently.
 */
export async function landSkeleton(
  solicitationId: string,
  opts: { userId?: string | null; auto?: boolean; publish?: boolean; nowIso: string },
): Promise<LandResult> {
  const draft = await getOpenDraft(solicitationId);
  if (!draft) throw new LandBlockedError('No staged matrix to land — run the Matrix phase first.', []);

  const audit = draft.audit as ProvenanceAudit;
  const blockers = Array.isArray(audit?.findings)
    ? audit.findings.filter((f) => f.severity === 'blocker').map((f) => f.issue)
    : [];
  if (opts.auto && blockers.length) {
    throw new LandBlockedError(
      'Auto-landing refused: the staged matrix has unresolved blockers. A person must land this one.',
      blockers,
    );
  }

  // CLAIM THE DRAFT FIRST — compare-and-swap on its status, BEFORE any business write. Two
  // concurrent landers both read the same open draft above; without this they both ran the
  // materializer and its interleaved DELETE+INSERTs 500'd one of them (caught live by the
  // coverage drive's concurrent-lands case). The CAS serializes them on the draft row: exactly
  // one request wins the claim and materializes; the loser gets the same clean refusal as
  // landing with nothing staged.
  const priorStatus = draft.status;
  const claimed = await sql<Array<{ id: string }>>`
    UPDATE solicitation_compliance_drafts
    SET status = 'landed', landed_at = now(), landed_by = ${opts.userId ?? null}::uuid
    WHERE id = ${draft.id}::uuid AND status IN ('staged', 'reviewed')
    RETURNING id`;
  if (claimed.length === 0) {
    throw new LandBlockedError('No staged matrix to land — another request just landed it.', []);
  }

  try {
    const result = await materializeSkeleton(solicitationId, draft.parsed, {
      publish: opts.publish ?? false,
      nowIso: opts.nowIso,
    });
    // A land on a PUSHED solicitation rewrites the compliance the tenant mirrors
    // summarize — refresh their cards (no-op pre-push; materialize's own `publish`
    // path already fanned 'published' versions for the first-release case).
    if (!opts.publish) {
      await republishSolicitationCards({ solicitationId, actorId: opts.userId ?? null });
    }
    return { ...result, draftId: draft.id };
  } catch (e) {
    // The claim without the write would be a draft that says "landed" over a matrix that never
    // changed — release it so the truth stays reachable and a retry is possible.
    await sql`
      UPDATE solicitation_compliance_drafts
      SET status = ${priorStatus}, landed_at = NULL, landed_by = NULL
      WHERE id = ${draft.id}::uuid`.catch(() => { /* the throw below is the primary signal */ });
    throw e;
  }
}

/** Read the phase without pulling the row's blobs. */
export async function getIngestPhase(solicitationId: string): Promise<IngestPhase> {
  const [row] = await sql<Array<{ ingestPhase: IngestPhase }>>`
    SELECT ingest_phase AS "ingestPhase" FROM curated_solicitations WHERE id = ${solicitationId}::uuid`;
  return row?.ingestPhase ?? 'not_started';
}

/**
 * Advance the phase. Compare-and-swap on the expected current phase so two concurrent gate
 * clicks cannot double-advance (the same discipline as the workflow status writes in
 * CLAUDE.md §Data Layer). Returns false when the swap did not apply.
 */
export async function setIngestPhase(
  solicitationId: string, to: IngestPhase, expected?: IngestPhase,
): Promise<boolean> {
  const rows = expected
    ? await sql`UPDATE curated_solicitations SET ingest_phase = ${to}, updated_at = now()
                WHERE id = ${solicitationId}::uuid AND ingest_phase = ${expected} RETURNING id`
    : await sql`UPDATE curated_solicitations SET ingest_phase = ${to}, updated_at = now()
                WHERE id = ${solicitationId}::uuid RETURNING id`;
  return rows.length > 0;
}
