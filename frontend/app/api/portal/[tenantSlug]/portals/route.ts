/**
 * GET  /api/portal/[tenantSlug]/portals            — list this tenant's portals (all builds)
 * POST /api/portal/[tenantSlug]/portals            — RFP-Admin: approve a FREE (comped) portal
 *   body { opportunityId, proposalId?, label? } → creates the portal (guardrails_pending),
 *   assumes the T&C shadow-admin grant, and records a $0 completed `purchases` row so the
 *   grant is audited exactly like a paid comp-code purchase. Gated to rfp_admin+ — a tenant
 *   admin can no longer self-serve a free unlocked build (that was the revenue bypass); they
 *   buy through the comp-code purchase flow (POST .../purchase).
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
import { randomUUID } from 'crypto';

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
    // Free portals are an RFP-Admin *approval* (a comp of the paid build), never self-serve:
    // only our staff may mint one, and it is audited exactly as a purchase.
    const g = await gate(tenantSlug, 'rfp_admin');
    if ('error' in g) return g.error;
    let body: { opportunityId?: string; proposalId?: string; label?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.opportunityId || !isValidUUID(body.opportunityId)) {
      return NextResponse.json({ error: 'opportunityId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.proposalId && !isValidUUID(body.proposalId)) {
      return NextResponse.json({ error: 'Invalid proposalId', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const opportunityId = body.opportunityId;
    const proposalId = body.proposalId ?? null;
    const label = (body.label ?? 'primary').slice(0, 80);
    const productType = 'proposal_phase1';
    const created = await createPortal(g.tenantId, opportunityId, proposalId, label, g.userId);
    if (!created) {
      return NextResponse.json({ error: 'A portal with that label already exists for this opportunity', code: 'CONFLICT' }, { status: 409 });
    }
    // T&C: RFP admins may act on this portal (role-based grant) until the customer accepts guardrails.
    await assumeShadowAdmin(g.tenantId, created.portalId, { source: 't_and_c', grantedBy: g.userId });

    // Audit-as-purchased: a $0 completed purchase so an RFP-Admin-approved free portal lands
    // in the ledger exactly like a comp-code purchase (amount 0, marked as an admin grant).
    // Hard part of the operation — we never leave an un-audited free build.
    await withTenant(g.tenantId, async (tx) => {
      await tx`
        INSERT INTO purchases
          (tenant_id, opportunity_id, product_type, amount_cents, status, promo_code, metadata)
        VALUES (
          ${g.tenantId}::uuid, ${opportunityId}::uuid, ${productType}, 0, 'completed',
          NULL, ${tx.json({ comp: true, grant: 'admin', portalId: created.portalId, approvedBy: g.userId })}
        )
      `;
    });

    // portal.created (lifecycle) + purchase.completed (revenue/audit + the admin automation).
    await emitEventSingle({
      namespace: 'capture',
      type: 'portal.created',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: g.tenantId,
      payload: { portalId: created.portalId, opportunityId, proposalId, status: 'guardrails_pending' },
    });
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'purchase.completed',
        actor: userActor(g.userId, g.email ?? undefined),
        tenantId: g.tenantId,
        payload: { correlationId: randomUUID(), productType, opportunityId, portalId: created.portalId, comp: true, grant: 'admin' },
      });
    } catch (evtErr) {
      console.error('[portal/portals] purchase.completed emit failed (non-fatal)', evtErr);
    }
    return NextResponse.json({ data: { portalId: created.portalId, label, status: 'guardrails_pending', comp: true } });
  } catch (err) {
    console.error('[portal/portals] POST error', err);
    return NextResponse.json({ error: 'Failed to create portal', code: 'DB_ERROR' }, { status: 500 });
  }
}
