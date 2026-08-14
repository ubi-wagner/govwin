/**
 * GET /api/admin/template-stable
 *
 * The template-bridge master roster (template bridge Phase 3, docs/TEMPLATE_BRIDGE_DESIGN.md).
 * Lists master_templates with their bridge head version and fan-out REACH — how many
 * tenants carry the latest version vs. are behind. Admin/platform-scope (cross-tenant).
 *
 * Auth: rfp_admin / master_admin.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';

function authz(session: unknown): { userId: string } | null {
  const u = (session as { user?: { id?: string; role?: unknown } } | null)?.user;
  if (!u?.id) return null;
  const role = isRole(u.role) ? u.role : null;
  if (!role || !hasRoleAtLeast(role, 'rfp_admin')) return null;
  return { userId: u.id };
}

export async function GET() {
  try {
    if (!authz(await auth())) {
      return NextResponse.json({ error: 'rfp_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    let masters;
    try {
      masters = await sql`
        SELECT m.id, m.template_key AS "templateKey", m.title, m.category, m.agency, m.format,
               m.version, m.status, m.updated_at AS "updatedAt",
               COALESCE(b.head_version, 0)::int AS "bridgeVersion",
               COALESCE(c.tenants_total, 0)::int AS "tenantsTotal",
               COALESCE(c.tenants_current, 0)::int AS "tenantsCurrent"
        FROM master_templates m
        LEFT JOIN LATERAL (
          SELECT max(version) AS head_version FROM template_bridge WHERE template_id = m.id
        ) b ON true
        LEFT JOIN LATERAL (
          SELECT count(*) AS tenants_total,
                 count(*) FILTER (WHERE tc.bridge_version >= b.head_version) AS tenants_current
          FROM tenant_template_cards tc WHERE tc.template_id = m.id
        ) c ON true
        ORDER BY m.category ASC, m.title ASC
      `;
    } catch (e) {
      console.error('[admin/template-stable] roster query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    return NextResponse.json({ data: { masters } });
  } catch (e) {
    console.error('[admin/template-stable] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
