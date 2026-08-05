/**
 * Confirm or dismiss a detected amendment — POST { action: 'confirm' | 'dismiss' }.
 *
 * confirm → fans the amendment out to every proposal built from the solicitation (per-proposal flag
 *           the tenant must acknowledge) + emits the customer-facing capture:amendment.flagged events.
 * dismiss → closes a false positive.
 *
 * Auth: rfp_admin or master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { confirmAmendment, dismissAmendment } from '@/lib/amendments';

interface RouteContext {
  params: Promise<{ solId: string; amendmentId: string }>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const user = session.user as { id?: string; email?: string; role?: unknown };
    if ((user.role !== 'rfp_admin' && user.role !== 'master_admin') || !user.id) {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { solId, amendmentId } = await ctx.params;
    if (!UUID_RE.test(solId) || !UUID_RE.test(amendmentId)) {
      return NextResponse.json({ error: 'Invalid ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    let body: { action?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.action !== 'confirm' && body.action !== 'dismiss') {
      return NextResponse.json({ error: "action must be 'confirm' or 'dismiss'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const actor = { actorId: user.id, actorEmail: user.email ?? null, role: user.role as Role };
    try {
      if (body.action === 'confirm') {
        const { confirmed, flagged, tenants } = await confirmAmendment({ ...actor, amendmentId, solicitationId: solId });
        if (!confirmed) {
          return NextResponse.json({ error: 'Amendment not found or already resolved', code: 'CONFLICT' }, { status: 409 });
        }
        return NextResponse.json({ data: { confirmed: true, flagged, tenants } });
      }
      const { dismissed } = await dismissAmendment({ ...actor, amendmentId, solicitationId: solId });
      if (!dismissed) {
        return NextResponse.json({ error: 'Amendment is not in a dismissible state', code: 'CONFLICT' }, { status: 409 });
      }
      return NextResponse.json({ data: { dismissed: true } });
    } catch (e) {
      console.error('[amendments] action failed', e);
      return NextResponse.json({ error: 'Amendment action failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[amendments] action error', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
