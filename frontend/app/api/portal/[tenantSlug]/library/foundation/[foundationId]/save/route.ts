/**
 * PUT /api/portal/[tenantSlug]/library/foundation/[foundationId]/save — P2.2.
 * Decompose-on-save for a library foundation: persist the edited canvas onto the
 * foundation's `canvas_nodes` and refresh its section/group/atom grains
 * (redecomposeFoundation). The foundation id is stable; the taxonomy is preserved.
 * Body: { content: CanvasDocument }. Returns { data: { foundationId, sections, groups, atoms } }.
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { redecomposeFoundation } from '@/lib/library/foundation';
import { emitEventSingle, userActor } from '@/lib/events';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export async function PUT(request: Request, ctx: { params: Promise<{ tenantSlug: string; foundationId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    const su = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });

    const { tenantSlug, foundationId } = await ctx.params;
    if (!isValidUUID(foundationId)) return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });

    let body: { content?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body.content || typeof body.content !== 'object') {
      return NextResponse.json({ error: 'content (CanvasDocument) is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const content = { ...(body.content as Record<string, unknown>) };
    delete content.__revisionMeta; // transient AI marker — never persisted
    if (JSON.stringify(content).length > 2_000_000) {
      return NextResponse.json({ error: 'Content too large', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    try {
      const d = await redecomposeFoundation(tenantId, foundationId, content as unknown as CanvasDocument, { id: su.id });
      // Audit the redecompose (deletes+rebuilds the whole atom subtree) so library content
      // history is visible to events/automation consumers — best-effort, never fails the save.
      try {
        await emitEventSingle({
          namespace: 'library', type: 'foundation.saved', actor: userActor(su.id), tenantId,
          payload: { foundationId: d.foundationId, sections: d.sectionIds.length, groups: d.groupIds.length, atoms: d.atomIds.length },
        });
      } catch (ev) { console.error('[library/foundation save] audit emit failed', ev); }
      return NextResponse.json({ data: { foundationId: d.foundationId, sections: d.sectionIds.length, groups: d.groupIds.length, atoms: d.atomIds.length } });
    } catch (e) {
      if (e instanceof Error && e.message === 'foundation not found') {
        return NextResponse.json({ error: 'Foundation not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      throw e;
    }
  } catch (e) {
    console.error('[library/foundation save]', e);
    return NextResponse.json({ error: 'Failed to save canvas', code: 'DB_ERROR' }, { status: 500 });
  }
}
