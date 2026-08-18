/**
 * POST /api/admin/rfp-curation/[solId]/assess-ingest
 *
 * Admin-agent Phase 1 producer. Requests an ADVISORY ingest-readiness assessment of a
 * curated solicitation: emits `finder.ingest.assessment_requested`, which triggers the
 * OnIngestAssessmentRequested workflow → the platform-scope `rfp_ingest_manager` agent
 * (docs/ADMIN_AGENT_DESIGN.md). The agent reads the ingest state (shred/extract →
 * compliance matrix → skeleton), infers the pipeline stage, and produces a coordination
 * plan (which specialist agents to run next) — advisory only, never mutates.
 *
 * Auth: rfp_admin or master_admin (platform/our-org op — no tenant scope).
 * Returns: { data: { solicitationId, requested: true, snapshot } } where snapshot is the
 * DETERMINISTIC ingest-stage readout (stage + flags + missing stages), computed inline so the admin
 * sees an immediate assessment even before the agent's richer LLM coordination plan lands. The
 * snapshot logic mirrors rfp_ingest_manager._get_ingest_state (pipeline) — keep the two in step.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { auditProvenance, summarizeAudit } from '@/lib/ingest/provenance-audit';
import { coerceJsonb } from '@/lib/jsonb';
import type { Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, routeCtx: RouteContext) {
  try {
    // ── Auth: rfp_admin / master_admin only (platform-scope op) ──────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { solId } = await routeCtx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json(
        { error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Verify the solicitation exists + read the deterministic ingest-state flags in one query.
    //    (Booleans computed in SQL so we never pull full_text/ai_extracted blobs across the wire.) ──
    let rows: {
      hasFullText: boolean;
      hasAiExtracted: boolean;
      status: string | null;
      compCount: string | number;
      hasOutline: boolean;
    }[];
    try {
      rows = await sql`
        SELECT
          (full_text IS NOT NULL AND length(full_text) > 0) AS "hasFullText",
          (ai_extracted IS NOT NULL AND ai_extracted::text NOT IN ('null', '{}', '[]', '""')) AS "hasAiExtracted",
          status,
          (SELECT count(*) FROM solicitation_compliance WHERE solicitation_id = ${solId}::uuid) AS "compCount",
          EXISTS(SELECT 1 FROM solicitation_outlines WHERE solicitation_id = ${solId}::uuid) AS "hasOutline"
        FROM curated_solicitations WHERE id = ${solId}::uuid
      `;
    } catch (dbErr) {
      console.error('[rfp-curation] assess-ingest fetch failed:', dbErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Solicitation not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Deterministic stage detection — mirrors rfp_ingest_manager._get_ingest_state.
    const s = rows[0];
    const hasFullText = s.hasFullText;
    const hasAiExtracted = s.hasAiExtracted;
    const compCount = Number(s.compCount) || 0;
    const hasCompliance = compCount > 0;
    const hasOutline = s.hasOutline;
    const status = s.status ?? '';
    let stage: string;
    if (!hasFullText) stage = 'shredding';
    else if (!hasAiExtracted) stage = 'extracting';
    else if (!hasCompliance) stage = 'matrixing';
    else if (!hasOutline) stage = 'skeletoning';
    else if (!['review_requested', 'approved', 'pushed_to_pipeline'].includes(status)) stage = 'ready_for_qa';
    else stage = 'release_ready';
    const missingStages: { stage: string; agent: string }[] = [];
    if (!hasAiExtracted) missingStages.push({ stage: 'extracting', agent: 'ingest_analyst' });
    if (!hasCompliance) missingStages.push({ stage: 'matrixing', agent: 'matrix_stager' });
    if (!hasOutline) missingStages.push({ stage: 'skeletoning', agent: 'skeleton_architect' });

    // ── Provenance audit — the CROSS-DOCUMENT reconciliation ──
    // Stage flags say a matrix EXISTS; they cannot say whether any of it was read. This does:
    // per-field provenance, which values are still system defaults, and — the one an admin
    // cannot see any other way — whether a rule the umbrella solicitation DEFERS elsewhere is
    // actually reachable from what is on file. A DoW BAA that points at the Component-specific
    // instructions for its page limit is release-blocked until those instructions are attached,
    // and the matrix looks perfectly healthy the whole time. (docs/INGEST_PROVENANCE.md)
    let audit: ReturnType<typeof auditProvenance> | null = null;
    try {
      const [comp] = await sql<Array<Record<string, unknown>>>`
        SELECT * FROM solicitation_compliance WHERE solicitation_id = ${solId}::uuid LIMIT 1`;
      const docs = await sql<Array<{ documentType: string | null; fileName: string | null }>>`
        SELECT document_type AS "documentType", original_filename AS "fileName"
        FROM solicitation_documents WHERE solicitation_id = ${solId}::uuid`;
      audit = auditProvenance({
        fieldProvenance: coerceJsonb<Record<string, unknown>>(comp?.fieldProvenance, {}),
        values: comp ?? {},
        documents: docs,
      });
    } catch (auditErr) {
      // Non-fatal: the stage snapshot is still useful without the audit.
      console.error('[rfp-curation] assess-ingest provenance audit failed:', auditErr);
    }

    const snapshot = {
      stage,
      status,
      flags: { hasFullText, hasAiExtracted, complianceRowCount: compCount, hasOutline },
      missingStages,
      provenance: audit && {
        read: audit.read, defaulted: audit.defaulted, deferred: audit.deferred,
        unknown: audit.unknown, fieldsTotal: audit.fieldsTotal,
        coverage: Number(audit.coverage.toFixed(2)),
        unresolvedDeferrals: audit.unresolvedDeferrals.map((f) => ({
          field: f.field, label: f.label, reason: f.reason, page: f.page,
        })),
        findings: audit.findings,
        summary: summarizeAudit(audit),
      },
    };

    // ── Emit the trigger (start/end). The workflow reads payload.solicitationId
    //    off the END event, so it is carried in the emitEventEnd result. ──
    let startId: string;
    try {
      startId = await emitEventStart({
        namespace: 'finder',
        type: 'ingest.assessment_requested',
        actor: userActor(user.id!, user.email),
        payload: { solicitationId: solId },
      });
    } catch (evtErr) {
      console.error('[rfp-curation] assess-ingest emitEventStart failed:', evtErr);
      return NextResponse.json(
        { error: 'Internal error', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    try {
      await emitEventEnd(startId, {
        result: { solicitationId: solId, requested: true },
      });
    } catch (evtErr) {
      console.error('[rfp-curation] assess-ingest emitEventEnd failed:', evtErr);
      // The start row is emitted; the end failing is non-fatal to the caller.
    }

    return NextResponse.json({ data: { solicitationId: solId, requested: true, snapshot } });
  } catch (error) {
    console.error('[rfp-curation] assess-ingest failed:', error);
    return NextResponse.json(
      { error: 'Failed to request ingest assessment', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
