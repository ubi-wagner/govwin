/**
 * POST   /api/admin/opportunities/[oppId]/watch  → arm update-monitoring on a master opportunity
 * DELETE /api/admin/opportunities/[oppId]/watch  → disarm it
 *
 * The admin "pin for updates" (RANK-8, mig 181 opportunities.update_watch). Arming a MASTER opp makes
 * a subsequent re-publish (any mid-window master edit or amendment confirm → newer bridge version,
 * docs/MID_WINDOW_RULES.md) fan an elevated capture:opportunity.updated notification to EVERY tenant
 * holding its mirror card — pre-purchase, before any proposal exists (amendments additionally REPLAY
 * onto the proposal at provision).
 * rfp_admin+; opportunities is the platform catalog (no tenant_id, RLS-off) so writes use sqlBypass.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isValidUUID } from '@/lib/validation';
import type { Role } from '@/lib/rbac';
import { sqlBypass } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

async function gate(oppId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const user = session.user as { id?: string; email?: string; role?: Role };
  if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
    return { error: NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  if (!isValidUUID(oppId)) return { error: NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  return { userId: user.id ?? '', email: user.email ?? null };
}

export async function POST(_request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  try {
    const { oppId } = await params;
    const g = await gate(oppId);
    if ('error' in g) return g.error;
    const [row] = await sqlBypass<Array<{ id: string }>>`
      UPDATE opportunities SET update_watch = true, update_watch_at = now(), update_watch_by = ${g.userId}::uuid
      WHERE id = ${oppId}::uuid RETURNING id`;
    if (!row) return NextResponse.json({ error: 'Opportunity not found', code: 'NOT_FOUND' }, { status: 404 });
    await emitEventSingle({
      namespace: 'finder', type: 'opportunity.update_watch_set',
      actor: userActor(g.userId, g.email ?? undefined), tenantId: null,
      payload: { opportunityId: oppId },
    });
    return NextResponse.json({ data: { watching: true } });
  } catch (err) {
    console.error('[admin/opportunities/watch] POST error', err);
    return NextResponse.json({ error: 'Failed to set watch', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ oppId: string }> }) {
  try {
    const { oppId } = await params;
    const g = await gate(oppId);
    if ('error' in g) return g.error;
    const [row] = await sqlBypass<Array<{ id: string }>>`
      UPDATE opportunities SET update_watch = false, update_watch_at = null, update_watch_by = null
      WHERE id = ${oppId}::uuid RETURNING id`;
    if (!row) return NextResponse.json({ error: 'Opportunity not found', code: 'NOT_FOUND' }, { status: 404 });
    await emitEventSingle({
      namespace: 'finder', type: 'opportunity.update_watch_cleared',
      actor: userActor(g.userId, g.email ?? undefined), tenantId: null,
      payload: { opportunityId: oppId },
    });
    return NextResponse.json({ data: { watching: false } });
  } catch (err) {
    console.error('[admin/opportunities/watch] DELETE error', err);
    return NextResponse.json({ error: 'Failed to clear watch', code: 'DB_ERROR' }, { status: 500 });
  }
}
