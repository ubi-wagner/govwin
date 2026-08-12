import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, enterTenant, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

export const dynamic = 'force-dynamic';

interface Params { params: Promise<{ tenantSlug: string; proposalId: string }> }

/**
 * POST — admin dismisses the library-seed suggestion for this proposal.
 *
 * Persists library_seed_jobs.status='skipped' (a reserved CHECK value, mig 133) so the
 * suggestion stops re-prompting on the next poll/reload. Skippable from EITHER
 * 'awaiting_selection' (candidate picker) or 'awaiting_review' (decision tree) — the two
 * states whose panel shows a Skip button. Previously the panel skipped via the /decide
 * route, which guards status='awaiting_review' and writes only section_decisions (never
 * status) — so Skip was cosmetic (optimistic-only) and the seed re-prompted forever.
 *
 * CAS-guarded (WHERE status IN awaiting_*): an idempotent no-op once applied/already skipped.
 * Body: { seedJobId: string }
 */
export async function POST(req: Request, { params }: Params) {
  const { tenantSlug, proposalId } = await params;

  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' }, { status: 401 });

  const sessionUser = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  // Reuse is now self-serve: tenant_admin+ (own tenant, verified below) — was rfp/master only.
  if (!role || !sessionUser.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  let body: { seedJobId?: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON', code: 'BAD_REQUEST' }, { status: 400 });
  }
  const { seedJobId } = body;
  if (!seedJobId) {
    return NextResponse.json({ error: 'seedJobId required', code: 'BAD_REQUEST' }, { status: 400 });
  }

  const tenant = await getTenantBySlug(tenantSlug).catch(() => null);
  if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  const tenantId = tenant.id as string;

  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) {
    return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
  }

  enterTenant(tenantId);

  try {
    // CAS: only an active (awaiting_*) job for THIS proposal+tenant can be skipped.
    const skipped = await sql<{ id: string }[]>`
      UPDATE library_seed_jobs
      SET status = 'skipped', updated_at = now()
      WHERE id          = ${seedJobId}::uuid
        AND proposal_id = ${proposalId}::uuid
        AND tenant_id   = ${tenantId}::uuid
        AND status IN ('awaiting_selection', 'awaiting_review')
      RETURNING id
    `;
    if (skipped.length === 0) {
      return NextResponse.json({ error: 'Job not found or not skippable', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Audit the dismissal — the reuse chain's opt-out was previously off-ledger.
    try {
      await emitEventSingle({
        namespace: 'proposal', type: 'seed.skipped', actor: userActor(sessionUser.id ?? 'system'), tenantId,
        payload: { proposalId, seedJobId },
      });
    } catch (ev) { console.error('[seed-job/skip] audit emit failed', ev); }

    return NextResponse.json({ data: { skipped: true } });
  } catch (e) {
    console.error('[seed-job/skip/POST]', e);
    return NextResponse.json({ error: 'Server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
