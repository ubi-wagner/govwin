/**
 * Scout candidate queue — the DB layer for the "potential NEW or UPDATED OPP" review→release
 * queue (#176). One reviewable surface (`scout_findings`, purpose in opportunity/both) that an
 * rfp_admin works:  classify → release-as-new | release-as-update | dismiss.
 *
 *   - releaseAsNew    → lib/intake.stageIntake  → a staged opportunity + curated_solicitation
 *                       (status 'new') in the RFP Triage Queue → admin curates → releases (push).
 *   - releaseAsUpdate → lib/amendments.logAmendment on the matched opportunity's curated
 *                       solicitation → admin confirms → fan-out to every built proposal.
 *   - dismiss         → status='dismissed', outcome=reason.
 *
 * Platform-scope (no tenant_id). Every transition posts a finder:* system_event so the chain is
 * auditable. All candidate text is UNTRUSTED external input — treated strictly as data.
 */

import { createHash, randomUUID } from 'crypto';
import { sqlBypass as sql } from '@/lib/db';
import { coerceJsonb } from '@/lib/jsonb';
import { emitEventSingle, userActor } from '@/lib/events';
import { stageIntake } from '@/lib/intake';
import { logAmendment, type AmendmentSeverity } from '@/lib/amendments';
import {
  classifyCandidateAgainst,
  type CandidateInput,
  type ExistingOpp,
  type ClassifyResult,
} from './classify';

export interface CandidateRow {
  id: string;
  sourceId: string | null;
  sourceName: string | null;
  purpose: string;
  kind: string | null;
  title: string | null;
  url: string | null;
  snippet: string | null;
  discoveredAt: string;
  status: string;
  outcome: string | null;
  classification: 'new' | 'update' | 'unknown';
  matchOpportunityId: string | null;
  matchTitle: string | null;
  matchIsActive: boolean | null;
  similarityScore: number | null;
  matchReason: string | null;
  classifiedAt: string | null;
  releasedKind: 'new' | 'update' | null;
  releasedRef: string | null;
  reviewedAt: string | null;
  raw: Record<string, unknown>;
}

interface Actor {
  actorId: string;
  actorEmail?: string | null;
}

/** Build the classifier input from a finding row + its raw payload (raw overrides top-level). */
export function candidateFromFinding(row: {
  title: string | null;
  url: string | null;
  snippet: string | null;
  raw: unknown;
  sourceId?: string | null;
}): CandidateInput {
  const raw = coerceJsonb<Record<string, unknown>>(row.raw, {});
  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  return {
    title: str(raw.title) ?? row.title ?? '',
    agency: str(raw.agency),
    solicitationNumber: str(raw.solicitationNumber) ?? str(raw.solicitation_number) ?? str(raw.number),
    source: str(raw.source),
    sourceId: str(raw.sourceId) ?? str(raw.source_id),
    url: str(raw.url) ?? row.url,
    description: str(raw.description) ?? row.snippet,
  };
}

/** Read the bounded existing-opportunity set the classifier matches against (non-archived). */
async function loadExistingOpps(): Promise<ExistingOpp[]> {
  return sql<ExistingOpp[]>`
    SELECT id, source, source_id, title, agency, solicitation_number
    FROM opportunities
    WHERE submission_stage IS DISTINCT FROM 'archived'
    ORDER BY created_at DESC
    LIMIT 5000
  `;
}

/** List candidates for the review queue (default: unresolved opportunity findings). */
export async function listCandidates(opts?: { status?: string; includeResolved?: boolean }): Promise<CandidateRow[]> {
  const statusFilter = opts?.includeResolved
    ? sql`f.status IN ('new','reviewed','pursued','dismissed')`
    : sql`f.status IN ('new','reviewed')`;
  const rows = await sql<CandidateRow[]>`
    SELECT f.id, f.source_id, s.name AS source_name, f.purpose, f.kind, f.title, f.url, f.snippet,
           f.discovered_at, f.status, f.outcome, f.classification, f.match_opportunity_id,
           o.title AS match_title, o.is_active AS match_is_active,
           f.similarity_score, f.match_reason, f.classified_at,
           f.released_kind, f.released_ref, f.reviewed_at, f.raw
    FROM scout_findings f
    LEFT JOIN scout_sources s ON s.id = f.source_id
    LEFT JOIN opportunities o ON o.id = f.match_opportunity_id
    WHERE f.purpose IN ('opportunity','both') AND ${statusFilter}
    ORDER BY (f.status = 'new') DESC, f.classified_at IS NULL DESC, f.discovered_at DESC
    LIMIT 200
  `;
  return rows;
}

/** Load one finding (opportunity-scoped). Returns null if not found or not an opportunity finding. */
async function loadFinding(findingId: string) {
  const [row] = await sql<
    { id: string; title: string | null; url: string | null; snippet: string | null; raw: unknown;
      sourceId: string | null; status: string; classification: string; matchOpportunityId: string | null;
      similarityScore: number | null; matchReason: string | null }[]
  >`
    SELECT id, title, url, snippet, raw, source_id, status, classification,
           match_opportunity_id, similarity_score, match_reason
    FROM scout_findings
    WHERE id = ${findingId}::uuid AND purpose IN ('opportunity','both')
  `;
  return row ?? null;
}

/** Classify (or re-classify) one finding against the master list; store the verdict. */
export async function classifyFinding(findingId: string, actor: Actor): Promise<ClassifyResult | { error: string }> {
  const finding = await loadFinding(findingId);
  if (!finding) return { error: 'finding not found' };
  const opps = await loadExistingOpps();
  const result = classifyCandidateAgainst(candidateFromFinding(finding), opps);

  await sql`
    UPDATE scout_findings
    SET classification = ${result.classification},
        match_opportunity_id = ${result.matchOpportunityId}::uuid,
        similarity_score = ${result.score},
        match_reason = ${result.reason},
        classified_at = now()
    WHERE id = ${findingId}::uuid
  `;
  await emitEventSingle({
    namespace: 'finder',
    type: 'candidate.classified',
    actor: userActor(actor.actorId, actor.actorEmail ?? undefined),
    tenantId: null,
    payload: { findingId, classification: result.classification, matchOpportunityId: result.matchOpportunityId, score: result.score },
  });
  return result;
}

/** Release a candidate as a NEW opportunity → stage it into the RFP intake/curation queue. */
export async function releaseAsNew(
  findingId: string,
  actor: Actor,
  overrides?: Partial<CandidateInput> & { programType?: string | null },
): Promise<{ opportunityId: string; solicitationId: string } | { error: string }> {
  const finding = await loadFinding(findingId);
  if (!finding) return { error: 'finding not found' };
  if (finding.status === 'pursued' || finding.status === 'dismissed') return { error: 'already resolved' };

  const c = candidateFromFinding(finding);
  const title = (overrides?.title ?? c.title)?.trim();
  const agency = (overrides?.agency ?? c.agency)?.trim();
  if (!title) return { error: 'title is required to stage intake' };
  if (!agency) return { error: 'agency is required to stage intake (add it in the finding before releasing)' };

  const staged = await stageIntake(
    {
      title,
      agency,
      solicitationNumber: overrides?.solicitationNumber ?? c.solicitationNumber ?? null,
      programType: overrides?.programType ?? null,
      description: overrides?.description ?? c.description ?? null,
      intakeMeta: { foundBy: 'scout', sourceUrl: c.url ?? undefined, raw: coerceJsonb<Record<string, unknown>>(finding.raw, {}) },
    },
    actor.actorId,
  );
  if ('error' in staged) return { error: staged.error };

  // Idempotent compare-and-swap: only resolve if still unresolved.
  await sql`
    UPDATE scout_findings
    SET status = 'pursued', outcome = 'released as new opportunity (staged for curation)',
        released_kind = 'new', released_ref = ${staged.opportunityId}::uuid,
        acted_at = now(), reviewed_by = ${actor.actorId}::uuid, reviewed_at = now()
    WHERE id = ${findingId}::uuid AND status IN ('new','reviewed')
  `;
  await emitEventSingle({
    namespace: 'finder',
    type: 'candidate.released',
    actor: userActor(actor.actorId, actor.actorEmail ?? undefined),
    tenantId: null,
    payload: { findingId, kind: 'new', opportunityId: staged.opportunityId, solicitationId: staged.solicitationId },
  });
  return { opportunityId: staged.opportunityId, solicitationId: staged.solicitationId };
}

/** Release a candidate as an UPDATE → log an amendment on the matched opportunity's solicitation. */
export async function releaseAsUpdate(
  findingId: string,
  actor: Actor & { role: 'rfp_admin' | 'master_admin' },
  input: { label?: string; summary?: string; severity?: AmendmentSeverity },
): Promise<{ amendmentId: string; solicitationId: string } | { error: string }> {
  const finding = await loadFinding(findingId);
  if (!finding) return { error: 'finding not found' };
  if (finding.status === 'pursued' || finding.status === 'dismissed') return { error: 'already resolved' };
  if (!finding.matchOpportunityId) return { error: 'no matched opportunity — re-classify or release as new instead' };

  // Resolve the matched opportunity's curated solicitation (amendments key off it).
  const [sol] = await sql<{ id: string }[]>`
    SELECT id FROM curated_solicitations
    WHERE opportunity_id = ${finding.matchOpportunityId}::uuid
    ORDER BY created_at DESC LIMIT 1
  `;
  if (!sol) return { error: 'matched opportunity has no curated solicitation to amend' };

  const c = candidateFromFinding(finding);
  const label = input.label?.trim() || `Scout-detected update: ${c.title || finding.title || 'solicitation change'}`.slice(0, 200);
  const summary = input.summary?.trim() || `${finding.matchReason ?? 'possible update'} — scouted from ${c.url ?? finding.url ?? 'source'}. Re-check compliance for changes.`;

  const { id: amendmentId } = await logAmendment({
    actorId: actor.actorId,
    actorEmail: actor.actorEmail ?? null,
    role: actor.role,
    solicitationId: sol.id,
    label,
    summary,
    complianceDelta: [],
    severity: input.severity ?? 'info',
    source: 'amendment_monitor',
  });

  await sql`
    UPDATE scout_findings
    SET status = 'pursued', outcome = 'released as update (amendment logged for review)',
        released_kind = 'update', released_ref = ${amendmentId}::uuid,
        acted_at = now(), reviewed_by = ${actor.actorId}::uuid, reviewed_at = now()
    WHERE id = ${findingId}::uuid AND status IN ('new','reviewed')
  `;
  await emitEventSingle({
    namespace: 'finder',
    type: 'candidate.released',
    actor: userActor(actor.actorId, actor.actorEmail ?? undefined),
    tenantId: null,
    payload: { findingId, kind: 'update', amendmentId, solicitationId: sol.id, matchOpportunityId: finding.matchOpportunityId },
  });
  return { amendmentId, solicitationId: sol.id };
}

/** Dismiss a candidate (noise / duplicate / not pursue-worthy). */
export async function dismissCandidate(findingId: string, actor: Actor, reason?: string): Promise<{ dismissed: boolean }> {
  const rows = await sql<{ id: string }[]>`
    UPDATE scout_findings
    SET status = 'dismissed', outcome = ${reason?.trim() || 'dismissed by admin'},
        acted_at = now(), reviewed_by = ${actor.actorId}::uuid, reviewed_at = now()
    WHERE id = ${findingId}::uuid AND purpose IN ('opportunity','both') AND status IN ('new','reviewed')
    RETURNING id
  `;
  if (rows.length === 0) return { dismissed: false };
  await emitEventSingle({
    namespace: 'finder',
    type: 'candidate.dismissed',
    actor: userActor(actor.actorId, actor.actorEmail ?? undefined),
    tenantId: null,
    payload: { findingId, reason: reason ?? null },
  });
  return { dismissed: true };
}

/**
 * Materialize the HITL source-scout's extracted opportunities (source_diffs.extracted_opportunities)
 * as scout_findings rows so BOTH scout producers feed the one review queue. Best-effort, idempotent
 * (dedup_hash). Classifies each on arrival. Returns the number of new candidate rows created.
 */
export async function materializeExtractedOpportunities(
  profileId: string,
  sourceName: string,
  extracted: unknown[],
  actor: Actor,
): Promise<number> {
  let created = 0;
  for (const item of extracted) {
    if (!item || typeof item !== 'object') continue;
    const e = item as Record<string, unknown>;
    const title = typeof e.title === 'string' ? e.title.trim() : '';
    if (!title) continue;
    const num = typeof e.solicitation_number === 'string' ? e.solicitation_number : (typeof e.number === 'string' ? e.number : '');
    const dedupHash = createHash('sha256').update(`sourcediff:${profileId}:${num || title.toLowerCase()}`).digest('hex');
    const url = typeof e.url === 'string' ? e.url : null;
    const desc = typeof e.description === 'string' ? e.description : null;
    const raw = { ...e, foundVia: 'source_scout', sourceProfileName: sourceName };
    const rows = await sql<{ id: string }[]>`
      INSERT INTO scout_findings (id, source_id, purpose, kind, title, url, snippet, status, dedup_hash, raw)
      VALUES (${randomUUID()}::uuid, NULL, 'opportunity', 'update', ${title}, ${url},
              ${desc ? desc.slice(0, 500) : null}, 'new', ${dedupHash},
              ${sql.json(raw as Parameters<typeof sql.json>[0])})
      ON CONFLICT (dedup_hash) WHERE dedup_hash IS NOT NULL DO NOTHING
      RETURNING id
    `;
    if (rows.length > 0) {
      created++;
      // Classify immediately (best-effort; a failure here must not break the scout run).
      try { await classifyFinding(rows[0].id, actor); } catch { /* best-effort */ }
    }
  }
  return created;
}
