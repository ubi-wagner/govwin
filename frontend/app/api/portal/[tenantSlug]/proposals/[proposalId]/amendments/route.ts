/**
 * Proposal amendment flags — GET (unacknowledged flags for the banner) + POST (acknowledge one).
 *
 * GET  → the amendment flags on this proposal (with the amendment detail + delta) for the banner.
 * POST → { flagId } acknowledges a flag (the tenant has reviewed the change).
 *
 * Auth: tenant_admin+ to acknowledge; tenant_user+ to read.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { acknowledgeAmendmentFlag } from '@/lib/amendments';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

async function resolve(ctx: RouteContext, minRole: Role) {
  const { tenantSlug, proposalId } = await ctx.params;
  if (!isValidUUID(proposalId)) {
    return { error: NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  }
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const user = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(user.role) ? user.role : null;
  if (!role || !user.id) {
    return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!hasRoleAtLeast(role, minRole)) {
    return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(user.id, role, tenantId))) {
    return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  enterTenant(tenantId);
  return { user: { id: user.id, email: user.email ?? null, role }, tenantId, proposalId };
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const r = await resolve(ctx, 'tenant_user');
    if ('error' in r) return r.error;
    const { tenantId, proposalId } = r;
    let rows;
    try {
      rows = await sql`
        SELECT f.id AS "flagId", f.acknowledged_at AS "acknowledgedAt",
               a.id AS "amendmentId", a.label, a.summary, a.severity,
               a.compliance_delta AS "complianceDelta", a.detected_at AS "detectedAt"
        FROM proposal_amendment_flags f
        JOIN solicitation_amendments a ON a.id = f.amendment_id
        WHERE f.proposal_id = ${proposalId}::uuid AND f.tenant_id = ${tenantId}::uuid
        ORDER BY a.detected_at DESC
      `;
    } catch (e) {
      console.error('[proposal-amendments] GET failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { flags: rows } });
  } catch (e) {
    console.error('[proposal-amendments] GET error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const r = await resolve(ctx, 'tenant_admin');
    if ('error' in r) return r.error;
    const { user, tenantId, proposalId } = r;
    let body: { flagId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (typeof body.flagId !== 'string' || !isValidUUID(body.flagId)) {
      return NextResponse.json({ error: 'flagId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const { acknowledged } = await acknowledgeAmendmentFlag({
        flagId: body.flagId,
        proposalId,
        tenantId,
        actorId: user.id,
        actorEmail: user.email,
        role: user.role,
      });
      if (!acknowledged) {
        return NextResponse.json({ error: 'Flag not found or already acknowledged', code: 'CONFLICT' }, { status: 409 });
      }
      return NextResponse.json({ data: { acknowledged: true } });
    } catch (e) {
      console.error('[proposal-amendments] acknowledge failed', e);
      return NextResponse.json({ error: 'Failed to acknowledge', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[proposal-amendments] POST error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
