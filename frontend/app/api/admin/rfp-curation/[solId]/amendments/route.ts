/**
 * Amendments for a solicitation — GET (list) + POST (log a detected amendment).
 *
 * GET  → the amendments for this solicitation with fan-out stats (flagged / acknowledged counts).
 * POST → log a detected amendment (status='detected'); an admin then confirms it to fan out.
 *
 * Auth: rfp_admin or master_admin (platform-scope op).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, enterBypass } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { logAmendment, type ComplianceDeltaItem, type AmendmentSeverity } from '@/lib/amendments';

interface RouteContext {
  params: Promise<{ solId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SEVERITIES = ['critical', 'major', 'minor', 'info'];

function requireAdmin(role: unknown): role is Role {
  return role === 'rfp_admin' || role === 'master_admin';
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { role?: unknown };
    if (!requireAdmin(user.role)) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    // Admin cross-tenant read: the flagged/acknowledged counts scan proposal_amendment_flags
    // (RLS'd) across ALL tenants → route the context-aware sql to the owner/bypass pool
    // (docs/RLS_CUTOVER.md), else it DENY-ALLs post-flip.
    enterBypass();
    const { solId } = await ctx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let rows;
    try {
      rows = await sql`
        SELECT a.id, a.label, a.summary, a.compliance_delta AS "complianceDelta", a.severity, a.source,
               a.status, a.detected_at AS "detectedAt", a.reviewed_at AS "reviewedAt",
               (SELECT count(*)::int FROM proposal_amendment_flags f WHERE f.amendment_id = a.id) AS "flagged",
               (SELECT count(*)::int FROM proposal_amendment_flags f WHERE f.amendment_id = a.id AND f.acknowledged_at IS NOT NULL) AS "acknowledged"
        FROM solicitation_amendments a
        WHERE a.solicitation_id = ${solId}::uuid
        ORDER BY a.detected_at DESC
      `;
    } catch (e) {
      console.error('[amendments] GET failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { amendments: rows } });
  } catch (e) {
    console.error('[amendments] GET error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    if (!requireAdmin(user.role) || !user.id) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterBypass(); // admin (platform-scope) writer → owner/bypass pool (docs/RLS_CUTOVER.md)
    const { solId } = await ctx.params;
    if (!UUID_RE.test(solId)) {
      return NextResponse.json({ error: 'Invalid solicitation ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { label?: unknown; summary?: unknown; severity?: unknown; complianceDelta?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const summary = typeof body.summary === 'string' ? body.summary.trim() : '';
    if (!label || !summary) {
      return NextResponse.json({ error: 'label and summary are required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const severity: AmendmentSeverity = SEVERITIES.includes(body.severity as string)
      ? (body.severity as AmendmentSeverity)
      : 'major';
    // Sanitize the delta: keep only well-formed items.
    const rawDelta = Array.isArray(body.complianceDelta) ? body.complianceDelta : [];
    const complianceDelta: ComplianceDeltaItem[] = rawDelta
      .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
      .map((d) => ({
        change: (['added', 'removed', 'changed'].includes(d.change as string) ? d.change : 'changed') as ComplianceDeltaItem['change'],
        requirement: typeof d.requirement === 'string' ? d.requirement.slice(0, 500) : '',
        detail: typeof d.detail === 'string' ? d.detail.slice(0, 2000) : '',
      }))
      .slice(0, 100);

    // Confirm the solicitation exists before writing.
    let exists: { id: string }[];
    try {
      exists = await sql`SELECT id FROM curated_solicitations WHERE id = ${solId}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[amendments] existence check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (exists.length === 0) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let result: { id: string };
    try {
      result = await logAmendment({
        solicitationId: solId,
        label,
        summary,
        complianceDelta,
        severity,
        actorId: user.id,
        actorEmail: user.email ?? null,
        role: user.role as Role,
      });
    } catch (e) {
      console.error('[amendments] logAmendment failed', e);
      return NextResponse.json({ error: 'Failed to log amendment', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { id: result.id } });
  } catch (e) {
    console.error('[amendments] POST error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
