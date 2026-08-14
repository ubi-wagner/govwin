/**
 * POST /api/admin/template-stable/sync
 *
 * Sync the lib/templates code catalog into the template stable (template bridge
 * Phase 3, docs/TEMPLATE_BRIDGE_DESIGN.md): materialize NEW masters + version-up
 * CHANGED masters, publish each to the bridge, and fan out to every tenant.
 * Unchanged masters are skipped. This is the admin "push new / version-up old"
 * front door — adding or editing a catalog entry and syncing lands it on every
 * tenant's owned shelf as a forward version (instances untouched).
 *
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { syncTemplateStableFromCatalog } from '@/lib/template-stable-sync';

function authz(session: unknown): { userId: string; email: string | null } | null {
  const u = (session as { user?: { id?: string; email?: string; role?: unknown } } | null)?.user;
  if (!u?.id) return null;
  const role = isRole(u.role) ? u.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { userId: u.id, email: u.email ?? null };
}

export async function POST() {
  try {
    const who = authz(await auth());
    if (!who) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let results;
    try {
      results = await syncTemplateStableFromCatalog(who.userId);
    } catch (e) {
      console.error('[admin/template-stable/sync] sync failed:', e);
      return NextResponse.json({ error: 'Sync failed', code: 'DB_ERROR' }, { status: 500 });
    }

    const created = results.filter((r) => r.action === 'created').length;
    const updated = results.filter((r) => r.action === 'updated').length;
    const unchanged = results.filter((r) => r.action === 'unchanged').length;
    const errored = results.filter((r) => r.action === 'error').length;

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'template.stable_synced',
        actor: userActor(who.userId, who.email ?? undefined),
        tenantId: null,
        payload: { created, updated, unchanged, errored, total: results.length },
      });
    } catch (e) { console.error('[admin/template-stable/sync] event emit failed (non-fatal):', e); }

    return NextResponse.json({ data: { summary: { created, updated, unchanged, errored, total: results.length }, results } });
  } catch (e) {
    console.error('[admin/template-stable/sync] POST failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
