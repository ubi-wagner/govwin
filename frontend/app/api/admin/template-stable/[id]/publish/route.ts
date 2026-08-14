/**
 * POST /api/admin/template-stable/[id]/publish
 *
 * Push ONE master forward: publish its current content as a new bridge version and
 * fan it out to every tenant (template bridge Phase 3, docs/TEMPLATE_BRIDGE_DESIGN.md).
 * Use to version-up a single template or force a re-fan-out that catches lagging
 * tenants up to the head. Instances are untouched; tenant cards get the new
 * skeleton + an "update available" flag.
 *
 * Body: { eventType?: 'updated' | 'republished' }  (default 'republished')
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import { publishAndFanOutTemplate, type TemplateBridgeEventType } from '@/lib/template-bridge';

interface RouteContext { params: Promise<{ id: string }> }

function authz(session: unknown): { userId: string; email: string | null } | null {
  const u = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  if (!u?.id) return null;
  const role = isRole(u.role) ? u.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { userId: u.id, email: u.email ?? null };
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const who = authz(await auth());
    if (!who) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const { id } = await ctx.params;
    if (!isValidUUID(id)) {
      return NextResponse.json({ error: 'Invalid template id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let body: { eventType?: unknown };
    try { body = await request.json(); } catch { body = {}; }
    const eventType: TemplateBridgeEventType =
      body.eventType === 'updated' ? 'updated' : 'republished';

    // Confirm the master exists (a clean 404 beats a null-snapshot no-op).
    let master: { title: string } | undefined;
    try {
      [master] = await sql<Array<{ title: string }>>`SELECT title FROM master_templates WHERE id = ${id}::uuid LIMIT 1`;
    } catch (e) {
      console.error('[admin/template-stable/publish] master lookup failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!master) {
      return NextResponse.json({ error: 'Master template not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let res;
    try {
      res = await publishAndFanOutTemplate(id, eventType, who.userId);
    } catch (e) {
      console.error('[admin/template-stable/publish] publish failed:', e);
      return NextResponse.json({ error: 'Publish failed', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!res) {
      return NextResponse.json({ error: 'Publish produced no bridge version', code: 'PUBLISH_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'template.published',
        actor: userActor(who.userId, who.email ?? undefined),
        tenantId: null,
        payload: { templateId: id, title: master.title, version: res.event.version, eventType, tenantsApplied: res.tenantsApplied },
      });
    } catch (e) { console.error('[admin/template-stable/publish] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: { templateId: id, version: res.event.version, tenantsApplied: res.tenantsApplied } });
  } catch (e) {
    console.error('[admin/template-stable/publish] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
