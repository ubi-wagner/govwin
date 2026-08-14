/**
 * GET /api/portal/[tenantSlug]/templates
 *
 * The portal template browser's data source (Tier 2, #4). Lists the templates a
 * tenant can start a standalone document from: their OWN extracted templates
 * (`tenant_id = tenant`) plus the shared SYSTEM library (`is_system = true`).
 * Bodies are omitted (too large) — the create-route reads the chosen template's
 * body server-side.
 *
 * Optional filters: ?templateType= &programType= &agency=.
 *
 * Auth: any tenant member (tenant_user+ with tenant access). RFP/master admin
 * reach it cross-tenant via the shadow account.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { DOC_TYPES } from '@/lib/documents/starter';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
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

    const url = new URL(request.url);
    const templateType = url.searchParams.get('templateType');
    const programType = url.searchParams.get('programType');
    const agency = url.searchParams.get('agency');
    if (templateType && !(DOC_TYPES as readonly string[]).includes(templateType)) {
      return NextResponse.json({ error: 'Invalid templateType', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let templates;
    try {
      // Own tenant templates + the shared system library. `has_body` tells the
      // browser whether "start from template" yields a filled skeleton or just an
      // outline/page-rules starter. `sections` (from metadata) previews the outline.
      templates = await sql`
        SELECT id, name, description, template_type, agency, program_type,
               node_count, is_system,
               (tenant_id = ${tenantId}::uuid) AS is_mine,
               created_at, updated_at,
               (
                 COALESCE(jsonb_array_length(canvas_document->'nodes'), 0) > 0
                 OR COALESCE(jsonb_array_length(canvas_document->'sections'), 0) > 0
               ) AS has_body,
               CASE WHEN jsonb_typeof(metadata->'sections') = 'array'
                    THEN metadata->'sections' ELSE '[]'::jsonb END AS sections
        FROM document_templates
        -- Phase 5 (template bridge, docs/TEMPLATE_BRIDGE_DESIGN.md §6): the shared is_system reads are
        -- RETIRED here. The pristine starter stable is now the tenant-OWNED template-card gallery
        -- (/portal/[t]/templates page → tenant_template_cards, mig 177), so a customer never depends on a
        -- live shared object. This chooser now returns ONLY the tenant's own SAVED templates (skeletons
        -- extracted from their past proposals) — never another tenant's, never the shared system rows.
        WHERE tenant_id = ${tenantId}::uuid AND is_system = false
          AND (${templateType}::text IS NULL OR template_type = ${templateType})
          AND (${programType}::text IS NULL OR program_type = ${programType})
          AND (${agency}::text IS NULL OR agency = ${agency})
        ORDER BY name ASC
      `;
    } catch (e) {
      console.error('[portal/templates] list query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({ data: { templates } });
  } catch (e) {
    console.error('[portal/templates] GET failed:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
