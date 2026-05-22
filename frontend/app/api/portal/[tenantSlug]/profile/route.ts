import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { tenantSlug } = await ctx.params;
  const role = (session.user as { role?: string }).role ?? '';
  const userId = (session.user as { id?: string }).id ?? '';

  try {
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });

    const hasAccess = await verifyTenantAccess(userId, role, tenant.id as string);
    if (!hasAccess) return NextResponse.json({ error: 'Access denied', code: 'FORBIDDEN' }, { status: 403 });

    const tenantId = tenant.id as string;

    const [tenantInfo] = await sql`
      SELECT id, name, legal_name, website, billing_email, status, product_tier,
             subscription_status, created_at
      FROM tenants WHERE id = ${tenantId}
    `;

    const [profile] = await sql`
      SELECT naics_codes, keywords, agency_priorities, set_aside_types,
             technology_focus, company_summary, research_areas, target_agencies
      FROM tenant_profiles WHERE tenant_id = ${tenantId}
    `;

    return NextResponse.json({ data: { tenant: tenantInfo ?? null, profile: profile ?? null } });
  } catch (e) {
    console.error('[api/portal/profile] GET failed', e);
    return NextResponse.json({ error: 'Failed to load profile', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const { tenantSlug } = await ctx.params;
  const role = (session.user as { role?: string }).role ?? '';
  const userId = (session.user as { id?: string }).id ?? '';

  // Only admins can edit profile
  if (role !== 'tenant_admin' && role !== 'master_admin' && role !== 'rfp_admin') {
    return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
  }

  try {
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });

    const hasAccess = await verifyTenantAccess(userId, role, tenant.id as string);
    if (!hasAccess) return NextResponse.json({ error: 'Access denied', code: 'FORBIDDEN' }, { status: 403 });

    const tenantId = tenant.id as string;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    // Update tenants table
    if (body.name && typeof body.name === 'string') {
      await sql`
        UPDATE tenants
        SET name = ${body.name},
            legal_name = ${(body.legalName as string) ?? null},
            website = ${(body.website as string) ?? null},
            billing_email = ${(body.billingEmail as string) ?? null}
        WHERE id = ${tenantId}
      `;
    }

    // Upsert tenant_profiles
    const naicsCodes = Array.isArray(body.naicsCodes) ? body.naicsCodes.filter((s: unknown) => typeof s === 'string') : [];
    const keywords = Array.isArray(body.keywords) ? body.keywords.filter((s: unknown) => typeof s === 'string') : [];
    const targetAgencies = Array.isArray(body.targetAgencies) ? body.targetAgencies.filter((s: unknown) => typeof s === 'string') : [];
    const setAsideTypes = Array.isArray(body.setAsideTypes) ? body.setAsideTypes.filter((s: unknown) => typeof s === 'string') : [];
    const researchAreas = Array.isArray(body.researchAreas) ? body.researchAreas.filter((s: unknown) => typeof s === 'string') : [];
    const companySummary = typeof body.companySummary === 'string' ? body.companySummary : null;
    const technologyFocus = typeof body.technologyFocus === 'string' ? body.technologyFocus : null;

    await sql`
      INSERT INTO tenant_profiles (tenant_id, naics_codes, keywords, target_agencies, set_aside_types, research_areas, company_summary, technology_focus)
      VALUES (${tenantId}, ${naicsCodes}, ${keywords}, ${targetAgencies}, ${setAsideTypes}, ${researchAreas}, ${companySummary}, ${technologyFocus})
      ON CONFLICT (tenant_id) DO UPDATE SET
        naics_codes = EXCLUDED.naics_codes,
        keywords = EXCLUDED.keywords,
        target_agencies = EXCLUDED.target_agencies,
        set_aside_types = EXCLUDED.set_aside_types,
        research_areas = EXCLUDED.research_areas,
        company_summary = EXCLUDED.company_summary,
        technology_focus = EXCLUDED.technology_focus
    `;

    return NextResponse.json({ data: { updated: true } });
  } catch (e) {
    console.error('[api/portal/profile] PATCH failed', e);
    return NextResponse.json({ error: 'Failed to save profile', code: 'DB_ERROR' }, { status: 500 });
  }
}
