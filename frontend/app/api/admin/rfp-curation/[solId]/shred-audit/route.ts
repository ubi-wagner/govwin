/**
 * POST /api/admin/rfp-curation/[solId]/shred-audit
 *
 * Shred-completeness audit for a curated solicitation: does the captured compliance structure cover
 * every obligation the solicitation states? Returns a deterministic obligation→captured diff (always
 * on) with a candidate-gap review list; the semantic deep pass is gated on ANTHROPIC_API_KEY. Advisory
 * — never edits the matrix. Run BEFORE release so the admin can fill a gap first.
 *
 * Auth: rfp_admin or master_admin (platform-scope op — no tenant scope).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enterBypass } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { auditShredCompleteness } from '@/lib/compliance/shred-audit';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    if ((user.role !== 'rfp_admin' && user.role !== 'master_admin') || !user.id) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    // Platform-scope read (curated_solicitations + volume_required_items are not tenant-scoped): the
    // owner/bypass pool so it is unaffected by the govtech_app tenant policies post-flip.
    enterBypass();

    const { solId } = await ctx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let report;
    try {
      report = await auditShredCompleteness(solId);
    } catch (e) {
      console.error('[shred-audit] audit failed', e);
      return NextResponse.json({ error: 'Audit failed', code: 'DB_ERROR' }, { status: 500 });
    }

    // Audit event (finder namespace — admin/platform op, tenantId null).
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'shred.audited',
        actor: userActor(user.id, user.email ?? undefined),
        payload: {
          solicitationId: solId,
          obligationsFound: report.obligationsFound,
          requirementsCaptured: report.requirementsCaptured,
          candidateGaps: report.candidateGaps.length,
          thin: report.thin,
          aiPass: report.aiPass,
        },
      });
    } catch {
      // best-effort — never fail the audit on the audit-log write
    }

    return NextResponse.json({ data: report });
  } catch (e) {
    console.error('[shred-audit] error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
