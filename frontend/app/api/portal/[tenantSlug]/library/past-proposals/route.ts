/**
 * GET /api/portal/[tenantSlug]/library/past-proposals
 *
 * The library's "past proposals" surface (#18). A past proposal is an uploaded package
 * (`document_cocoons`, source='upload') whose sections were atomized into `library_atoms`.
 * Lists each with its section count and whether it's already been TEMPLIFIED (turned into
 * a reusable `document_templates` skeleton via /templates/extract with a cocoonId) — so the
 * UI can offer "Save as reusable template" or cross-link to the template + "start a draft".
 *
 * Auth: any tenant member (tenant_user+) with tenant access; admins reach it via shadow.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point

    let rows;
    try {
      rows = await sql`
        SELECT
          c.id,
          c.name,
          c.program_type AS "programType",
          c.source,
          c.created_at   AS "createdAt",
          (
            SELECT COUNT(*)::int FROM library_atoms a
            WHERE a.cocoon_id = c.id AND a.grain = 'primitive' AND a.status <> 'archived'
          ) AS "sectionCount",
          tpl.id   AS "templateId",
          tpl.name AS "templateName"
        FROM document_cocoons c
        LEFT JOIN LATERAL (
          SELECT t.id, t.name FROM document_templates t
          WHERE t.tenant_id = c.tenant_id
            AND t.metadata->>'templifiedFromCocoon' = c.id::text
          ORDER BY t.created_at DESC
          LIMIT 1
        ) tpl ON true
        WHERE c.tenant_id = ${tenantId}::uuid
          AND EXISTS (
            SELECT 1 FROM library_atoms a
            WHERE a.cocoon_id = c.id AND a.grain = 'primitive' AND a.status <> 'archived'
          )
        ORDER BY c.created_at DESC
      `;
    } catch (e) {
      console.error('[portal/library/past-proposals] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { pastProposals: rows } });
  } catch (e) {
    console.error('[portal/library/past-proposals] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
