/**
 * GET   /api/portal/[tenantSlug]/portals/[portalId]                 — portal + shadow grants
 * POST  /api/portal/[tenantSlug]/portals/[portalId]?action=accept   — accept guardrails → launch
 *   body { guardrailConfig, revokeShadow? }
 * POST  /api/portal/[tenantSlug]/portals/[portalId]?action=revoke-shadow — revoke shadow admin
 * PATCH /api/portal/[tenantSlug]/portals/[portalId]                 — set status (execute/closeout/…)
 *
 * The accept-at-launch gate + the customer's revoke control. RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { acceptGuardrails, revokeShadowAdmin, setPortalStatus } from '@/lib/portal-launch';

const STATUSES = ['guardrails_pending', 'launched', 'executing', 'closeout', 'archived', 'abandoned'];

async function gate(tenantSlug: string, portalId: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(portalId)) return { error: NextResponse.json({ error: 'Invalid portal id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId, 'tenant_user');
    if ('error' in g) return g.error;
    const data = await withTenant(g.tenantId, async (tx) => {
      const [portal] = await tx<Array<Record<string, unknown>>>`
        SELECT id, opportunity_id, proposal_id, label, status, guardrail_config, launched_at, created_at
        FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid AND id = ${portalId}::uuid LIMIT 1`;
      const grants = await tx`
        SELECT id, admin_user_id, admin_email, source, active, granted_at, revoked_at
        FROM shadow_admin_grants WHERE tenant_id = ${g.tenantId}::uuid AND portal_id = ${portalId}::uuid ORDER BY granted_at DESC`;
      return { portal: portal ?? null, shadowGrants: grants };
    });
    if (!data.portal) return NextResponse.json({ error: 'Portal not found', code: 'NOT_FOUND' }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error('[portal/portals/:id] GET error', err);
    return NextResponse.json({ error: 'Failed to load portal', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const action = new URL(request.url).searchParams.get('action');
    // Accept-at-launch + revoke are customer-admin controls.
    const g = await gate(tenantSlug, portalId, 'tenant_admin');
    if ('error' in g) return g.error;

    if (action === 'accept') {
      let body: { guardrailConfig?: unknown; revokeShadow?: boolean };
      try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
      const { launched } = await acceptGuardrails(g.tenantId, portalId, body.guardrailConfig ?? {}, { revokeShadow: body.revokeShadow, acceptedBy: g.userId });
      if (!launched) return NextResponse.json({ error: 'Portal not pending (already launched?)', code: 'CONFLICT' }, { status: 409 });
      return NextResponse.json({ data: { launched: true } });
    }
    if (action === 'revoke-shadow') {
      const { revoked } = await revokeShadowAdmin(g.tenantId, portalId, g.userId);
      return NextResponse.json({ data: { revoked } });
    }
    return NextResponse.json({ error: 'Unknown action', code: 'VALIDATION_ERROR' }, { status: 400 });
  } catch (err) {
    console.error('[portal/portals/:id] POST error', err);
    return NextResponse.json({ error: 'Action failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; portalId: string }> }) {
  try {
    const { tenantSlug, portalId } = await params;
    const g = await gate(tenantSlug, portalId, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { status?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.status || !STATUSES.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${STATUSES.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    await setPortalStatus(g.tenantId, portalId, body.status);
    return NextResponse.json({ data: { status: body.status } });
  } catch (err) {
    console.error('[portal/portals/:id] PATCH error', err);
    return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
