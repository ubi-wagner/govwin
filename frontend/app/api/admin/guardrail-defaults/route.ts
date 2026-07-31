/**
 * GET   /api/admin/guardrail-defaults  — the RFP-admin default guardrails + hard limits
 * PATCH /api/admin/guardrail-defaults  — update them { limits?, defaults? }
 *
 * The global default guardrail template (guardrail_templates, tenant_id NULL,
 * is_default; mig 097/098) holds the caps (max 3 stages, 10 collaborators, 1 manager,
 * 3 nudges) and defaults that bound every customer portal at accept-launch. RFP-admin
 * only. Changes apply to future portal launches (frozen configs are unaffected).
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import type { Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const [row] = await sql<Array<{ id: string; config: unknown }>>`
      SELECT id, config FROM guardrail_templates WHERE tenant_id IS NULL AND is_default = true LIMIT 1
    `;
    return NextResponse.json({ data: { defaults: row?.config ?? null } });
  } catch (err) {
    console.error('[admin/guardrail-defaults] GET error', err);
    return NextResponse.json({ error: 'Failed to load defaults', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { id?: string; email?: string; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    let body: { limits?: Record<string, number>; defaults?: Record<string, unknown> };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    // Merge patch into the existing config (jsonb concat at the top-level keys).
    const patch: Record<string, unknown> = {};
    if (body.limits && typeof body.limits === 'object') patch.limits = body.limits;
    if (body.defaults && typeof body.defaults === 'object') patch.defaults = body.defaults;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Provide limits and/or defaults', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    try {
      const [row] = await sql<Array<{ config: unknown }>>`
        UPDATE guardrail_templates
        SET config = config || ${sql.json(patch as Parameters<typeof sql.json>[0])}, updated_at = now()
        WHERE tenant_id IS NULL AND is_default = true
        RETURNING config
      `;
      if (!row) return NextResponse.json({ error: 'Default template not found', code: 'NOT_FOUND' }, { status: 404 });
      await emitEventSingle({
        namespace: 'finder',
        type: 'guardrail_defaults.updated',
        actor: userActor(user.id ?? '', user.email ?? undefined),
        tenantId: null,
        payload: { patchedKeys: Object.keys(patch) },
      });
      return NextResponse.json({ data: { defaults: row.config } });
    } catch (e) {
      console.error('[admin/guardrail-defaults] PATCH query failed', e);
      return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (err) {
    console.error('[admin/guardrail-defaults] PATCH error', err);
    return NextResponse.json({ error: 'Update failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
