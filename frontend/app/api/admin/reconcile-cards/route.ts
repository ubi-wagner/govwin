/**
 * POST /api/admin/reconcile-cards
 *
 * Reconcile EVERY active/trial tenant's opportunity mirror to the bridge head — the scheduled/manual
 * self-healing sweep for the forward-only bridge. Read-repair on the customer feed (cards GET) heals
 * a tenant that VISITS; this heals the ones that don't (so the digest + admin views are accurate and
 * no tenant that missed a push stays permanently empty). Idempotent — each tenant only advances the
 * cards it's behind on.
 *
 * Auth: an rfp_admin/master_admin session, OR (for a headless cron) `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is configured. Returns { data: { tenants, totalApplied, perTenant } }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { enterBypass } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { reconcileActiveTenants } from '@/lib/opportunity-bridge';
import { emitEventSingle, systemActor, userActor } from '@/lib/events';

export async function POST(request: Request) {
  try {
    // Headless-cron path: a bearer secret (only when configured) authorizes without a session.
    const cronSecret = process.env.CRON_SECRET;
    const authz = request.headers.get('authorization') ?? '';
    const viaCron = !!cronSecret && authz === `Bearer ${cronSecret}`;

    let actor = systemActor('cron');
    if (!viaCron) {
      const session = await auth();
      if (!session?.user) {
        return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
      }
      const user = session.user as { id?: string; email?: string; role?: Role };
      if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
        return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
      }
      actor = userActor(user.id ?? '', user.email ?? undefined);
    }

    // Platform-wide sweep touches EVERY tenant's mirror → run on the owner/bypass pool so its
    // per-tenant behind-detection reads the real state (docs/RLS_CUTOVER.md). Each applyToTenant
    // still re-scopes its write via withTenant(tenantId); without bypass the detection read would
    // DENY-ALL post-flip and over-select (correct output, wasted work). Matches the sibling admin routes.
    enterBypass();
    const perTenant = await reconcileActiveTenants();
    const totalApplied = perTenant.reduce((s, t) => s + t.applied, 0);

    // Admin audit (tenantId=null): a platform-wide sweep, not tenant-scoped.
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'cards.reconciled',
        actor,
        tenantId: null,
        payload: { tenants: perTenant.length, totalApplied, healed: perTenant.filter((t) => t.applied > 0).length },
      });
    } catch (e) { console.error('[admin/reconcile-cards] event emit failed (non-fatal)', e); }

    return NextResponse.json({ data: { tenants: perTenant.length, totalApplied, perTenant } });
  } catch (err) {
    console.error('[admin/reconcile-cards] error', err);
    return NextResponse.json({ error: 'Reconcile failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
