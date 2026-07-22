/**
 * POST /api/portal/[tenantSlug]/purchase — buy a proposal workspace for a (pinned) opportunity.
 *
 * body { opportunityId, promoCode, label? }
 *
 * Founding-cohort path: a valid `comp` promo code (e.g. the seeded `rfppipelinetest`)
 * simulates a completed Stripe payment WITHOUT charging — it records a real `purchases`
 * row (status='completed', amount 0, promo_code stamped), opens the portal in the new
 * `curation_pending` state with a 72h SLA timer (paid_at / curation_due_at), and grants
 * the T&C shadow-admin so an RFP expert can curate inside the tenant. It then mirrors the
 * Stripe webhook's paid side-effects: emit `capture:purchase.completed` (drives the admin
 * notification automation) + park a 72h `rfp_admin` "set up the workspace" HITL gate.
 *
 * The customer then sees "Waiting for RFP Expert Curation" until the admin releases.
 * Percent/amount codes and real Stripe checkout are intentionally out of scope here
 * (the modal still offers the Stripe redirect for the real-payment path).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { withTenant } from '@/lib/rls';
import { emitEventSingle } from '@/lib/events';
import { launchProjectCollaboration } from '@/lib/process/project-collaboration';
import { randomUUID } from 'crypto';

const CURATION_SLA_HOURS = 72;

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, userEmail: u.email ?? null };
}

type PurchaseResult =
  | { ok: true; portalId: string; curationDueAt: string; comp: true }
  | { ok: false; reason: 'invalid_code' | 'not_comp' | 'already_purchased' };

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_admin');
    if ('error' in g) return g.error;

    let body: { opportunityId?: string; promoCode?: string; label?: string };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    if (!body.opportunityId || !isValidUUID(body.opportunityId)) {
      return NextResponse.json({ error: 'A valid opportunityId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const promoCode = (body.promoCode ?? '').trim();
    if (!promoCode) {
      return NextResponse.json({ error: 'A code is required for this checkout', code: 'PROMO_REQUIRED' }, { status: 400 });
    }
    const opportunityId = body.opportunityId;
    const label = (body.label ?? 'primary').slice(0, 80);
    const productType = 'proposal_phase1';

    // Atomic: validate the code, open the curation-pending portal, record the paid
    // purchase, consume the code, and grant the T&C shadow-admin — one tenant tx (RLS).
    let result: PurchaseResult;
    try {
      result = await withTenant(g.tenantId, async (tx): Promise<PurchaseResult> => {
        const [promo] = await tx<Array<{ id: string; kind: string }>>`
          SELECT id, kind FROM promo_codes
          WHERE lower(code) = lower(${promoCode}) AND active = true
            AND (expires_at IS NULL OR expires_at > now())
            AND (max_uses IS NULL OR used_count < max_uses)
          FOR UPDATE
        `;
        if (!promo) return { ok: false, reason: 'invalid_code' };
        if (promo.kind !== 'comp') return { ok: false, reason: 'not_comp' };

        // Open the portal in curation_pending with the 72h SLA clock. ON CONFLICT
        // (already a portal for this opp+label) → treat as already purchased.
        const portalRows = await tx<Array<{ id: string; curationDueAt: string }>>`
          INSERT INTO proposal_portals
            (tenant_id, opportunity_id, label, status, paid_at, curation_due_at, created_by)
          VALUES (
            ${g.tenantId}::uuid, ${opportunityId}::uuid, ${label}, 'curation_pending',
            now(), now() + (${CURATION_SLA_HOURS}::int) * interval '1 hour', ${g.userId}::uuid
          )
          ON CONFLICT (tenant_id, opportunity_id, label) DO NOTHING
          RETURNING id, curation_due_at
        `;
        if (portalRows.length === 0) return { ok: false, reason: 'already_purchased' };
        const portalId = portalRows[0].id;

        await tx`
          INSERT INTO purchases
            (tenant_id, opportunity_id, product_type, amount_cents, status, promo_code, metadata)
          VALUES (
            ${g.tenantId}::uuid, ${opportunityId}::uuid, ${productType}, 0, 'completed',
            ${promoCode}, ${tx.json({ comp: true, portalId, kind: 'comp' })}
          )
        `;
        await tx`UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ${promo.id}::uuid`;

        // T&C shadow-admin grant so an RFP expert can curate inside the tenant portal.
        await tx`
          INSERT INTO shadow_admin_grants (tenant_id, portal_id, admin_user_id, admin_email, source, granted_by)
          VALUES (${g.tenantId}::uuid, ${portalId}::uuid, NULL, NULL, 't_and_c', ${g.userId}::uuid)
        `;

        return { ok: true, portalId, curationDueAt: portalRows[0].curationDueAt, comp: true };
      });
    } catch (dbErr) {
      console.error('[portal/purchase] transaction failed', dbErr);
      return NextResponse.json({ error: 'Failed to complete purchase', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!result.ok) {
      if (result.reason === 'already_purchased') {
        return NextResponse.json({ error: 'This opportunity already has a workspace', code: 'ALREADY_PURCHASED' }, { status: 409 });
      }
      if (result.reason === 'not_comp') {
        return NextResponse.json({ error: 'That code requires card checkout, which is not enabled yet', code: 'CODE_NEEDS_STRIPE' }, { status: 400 });
      }
      return NextResponse.json({ error: 'That code is not valid', code: 'INVALID_PROMO_CODE' }, { status: 400 });
    }

    // Paid side-effects (best-effort, non-fatal) — mirror the Stripe webhook:
    // the audit/automation event + the 72h rfp_admin "curate + release" HITL gate.
    try {
      await emitEventSingle({
        namespace: 'capture',
        type: 'purchase.completed',
        actor: { type: 'user', id: g.userId, email: g.userEmail ?? undefined },
        tenantId: g.tenantId,
        payload: { correlationId: randomUUID(), productType, opportunityId, portalId: result.portalId, promoCode, comp: true },
      });
    } catch (evtErr) {
      console.error('[portal/purchase] event emit failed (non-fatal)', evtErr);
    }
    try {
      await launchProjectCollaboration({
        actor: { id: g.userId, email: g.userEmail, tenantId: g.tenantId },
        actorType: 'user',
        tenantId: g.tenantId,
        scope: 'opp',
        opportunityId,
        taskType: 'proposal_setup',
        taskTitle: 'Curate + release the purchased proposal workspace',
        assigneeRole: 'rfp_admin',
        entityType: 'opportunity',
        entityRef: opportunityId,
        nudgeDays: [1, 3],
        dueMinutes: CURATION_SLA_HOURS * 60,
      });
    } catch (setupErr) {
      console.error('[portal/purchase] curation-gate launch failed (non-fatal)', setupErr);
    }

    return NextResponse.json({
      data: { portalId: result.portalId, status: 'curation_pending', curationDueAt: result.curationDueAt, comp: true },
    });
  } catch (err) {
    console.error('[portal/purchase] POST error', err);
    return NextResponse.json({ error: 'Failed to process purchase', code: 'DB_ERROR' }, { status: 500 });
  }
}
