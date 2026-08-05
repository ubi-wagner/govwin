/**
 * GET /api/admin/proposals  — recent proposals across ALL tenants, for the admin doorbell picker.
 *
 * Admin oversight read (cross-tenant), so it runs on the bypass connection. Returns a compact list
 * (id, title, tenant, stage, locked) the Proposal Auto-Drive card populates its dropdown from.
 *
 * Auth: rfp_admin / master_admin.
 * Returns: { data: { proposals: [{ id, title, tenantSlug, tenantName, stage, isLocked }] } }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sqlBypass } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(request: Request) {
  try {
    const session = await auth();
    const u = session?.user as { id?: string; role?: unknown } | undefined;
    const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
    if (!u?.id || !role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const url = new URL(request.url);
    const limitParam = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 50;

    let rows: {
      id: string;
      title: string | null;
      tenantSlug: string | null;
      tenantName: string | null;
      stage: string;
      isLocked: boolean;
    }[];
    try {
      rows = await sqlBypass<typeof rows>`
        SELECT p.id, p.title, t.slug AS "tenantSlug", t.name AS "tenantName",
               p.stage, p.is_locked AS "isLocked"
        FROM proposals p
        JOIN tenants t ON t.id = p.tenant_id
        ORDER BY p.updated_at DESC NULLS LAST, p.created_at DESC
        LIMIT ${limit}
      `;
    } catch (dbErr) {
      console.error('[admin/proposals] list failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { proposals: rows } });
  } catch (err) {
    console.error('[admin/proposals] error:', err);
    return NextResponse.json(
      { error: 'Failed to list proposals', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
