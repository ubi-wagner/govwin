/**
 * GET /api/admin/rfp-curation/[solId]/assessment
 *
 * The read-on-review surface for the OnIngestAssessmentRequested advisory manager (#12). The
 * "Assess readiness" button (POST .../assess-ingest) fires `rfp_ingest_manager`, whose coordination
 * plan lands async in the workflow instance's `step_results['ai_ingest_manager']` — but only the
 * immediate DETERMINISTIC snapshot was ever rendered. This reads the LATEST
 * OnIngestAssessmentRequested instance for the solicitation and returns the parsed agent plan
 * (stage · readiness · agent plan · blockers · next actions; see lib/ingest/assessment.ts).
 *
 * Auth: rfp_admin / master_admin (platform/our-org op — no tenant scope). The instance is
 * platform-scope (tenant_id NULL), so the read uses sqlBypass with an explicit solicitation filter.
 * Advisory + read-only — it never runs an agent, changes status, or pushes.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { coerceJsonb } from '@/lib/jsonb';
import { parseIngestAssessment } from '@/lib/ingest/assessment';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: Request, ctx: { params: Promise<{ solId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { solId } = await ctx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Latest OnIngestAssessmentRequested instance for this solicitation. Platform-scope (tenant_id
    // NULL) → sqlBypass with an explicit payload filter (the RLS session var is not pinned here).
    let inst: { stepResults: unknown; startedAt: Date | string | null } | undefined;
    try {
      [inst] = await sqlBypass<Array<{ stepResults: unknown; startedAt: Date | string | null }>>`
        SELECT step_results AS "stepResults", started_at AS "startedAt"
        FROM process_instances
        WHERE workflow_name LIKE 'OnIngestAssessmentRequested%'
          AND payload->>'solicitationId' = ${solId}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[rfp-curation] assessment read failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!inst) {
      return NextResponse.json({ data: { stage: null, readiness: null, summary: null, agentPlan: [], blockers: [], nextActions: [], generatedAt: null, hasAny: false } });
    }

    const started = inst.startedAt
      ? (inst.startedAt instanceof Date ? inst.startedAt : new Date(inst.startedAt))
      : null;
    const generatedIso = started && !Number.isNaN(started.getTime()) ? started.toISOString() : null;

    const assessment = parseIngestAssessment(coerceJsonb<Record<string, unknown>>(inst.stepResults, {}), generatedIso);
    return NextResponse.json({ data: assessment });
  } catch (e) {
    console.error('[rfp-curation] assessment GET error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }
}
