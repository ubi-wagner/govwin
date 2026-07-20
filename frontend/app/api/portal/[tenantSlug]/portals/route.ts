/**
 * GET  /api/portal/[tenantSlug]/portals            — list this tenant's portals (all builds)
 * POST /api/portal/[tenantSlug]/portals            — create a portal for a card
 *   body { opportunityId, proposalId?, label? } → creates the portal (guardrails_pending)
 *   + assumes the T&C shadow-admin grant so RFP admins can jumpstart until accept.
 *
 * Multi-proposal: many portals per opportunity via distinct labels. RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { createPortal, assumeShadowAdmin } from '@/lib/portal-launch';
import { emitEventSingle, userActor } from '@/lib/events';

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    const portals = await withTenant(g.tenantId, async (tx) =>
      tx`SELECT id, opportunity_id, proposal_id, label, status, guardrail_config, launched_at,
                paid_at, curation_due_at, created_at
         FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid ORDER BY created_at DESC`,
    );
    return NextResponse.json({ data: { portals } });
  } catch (err) {
    console.error('[portal/portals] GET error', err);
    return NextResponse.json({ error: 'Failed to load portals', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { opportunityId?: string; proposalId?: string; label?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.opportunityId || !isValidUUID(body.opportunityId)) {
      return NextResponse.json({ error: 'opportunityId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.proposalId && !isValidUUID(body.proposalId)) {
      return NextResponse.json({ error: 'Invalid proposalId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const label = (body.label ?? 'primary').slice(0, 80);
    const created = await createPortal(g.tenantId, body.opportunityId, body.proposalId ?? null, label, g.userId);
    if (!created) {
      return NextResponse.json({ error: 'A portal with that label already exists for this opportunity', code: 'CONFLICT' }, { status: 409 });
    }
    // T&C: RFP admins may act on this portal (role-based grant) until the customer accepts guardrails.
    await assumeShadowAdmin(g.tenantId, created.portalId, { source: 't_and_c', grantedBy: g.userId });
    await emitEventSingle({
      namespace: 'capture',
      type: 'portal.created',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { portalId: created.portalId, opportunityId: body.opportunityId, proposalId: body.proposalId ?? null, status: 'guardrails_pending' },
    });
    return NextResponse.json({ data: { portalId: created.portalId, label, status: 'guardrails_pending' } });
  } catch (err) {
    console.error('[portal/portals] POST error', err);
    return NextResponse.json({ error: 'Failed to create portal', code: 'DB_ERROR' }, { status: 500 });
  }
}
