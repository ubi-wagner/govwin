/**
 * GET /api/portal/[tenantSlug]/taxonomy — the curated tag vocabulary (mig 101).
 *   ?dimension=vol&program=cso   — filter to one dimension / a program's applicable vol: terms
 *
 * The single source of truth for the tag picker. Global (not tenant data), auth-gated.
 * Open dims (tech/party/sol/topic) are free values and aren't seeded — the UI allows any.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!(await verifyTenantAccess(u.id, role, tenant.id as string))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const url = new URL(request.url);
    const dimension = url.searchParams.get('dimension');
    const program = url.searchParams.get('program');

    let rows: Array<{ dimension: string; value: string; label: string; programTypes: string[] }>;
    try {
      rows = await sql<Array<{ dimension: string; value: string; label: string; programTypes: string[] }>>`
        SELECT dimension, value, label, program_types AS "programTypes"
        FROM taxonomy_terms
        WHERE is_active = true
          ${dimension ? sql`AND dimension = ${dimension}` : sql``}
          ${program ? sql`AND (program_types = '{}' OR ${program} = ANY(program_types))` : sql``}
        ORDER BY dimension, sort_order
      `;
    } catch (e) {
      console.error('[portal/taxonomy] query failed', e);
      return NextResponse.json({ error: 'Failed to load taxonomy', code: 'DB_ERROR' }, { status: 500 });
    }

    // group by dimension for the picker
    const byDimension: Record<string, Array<{ value: string; label: string }>> = {};
    for (const r of rows) {
      (byDimension[r.dimension] ??= []).push({ value: r.value, label: r.label });
    }
    // the open dims the UI should render as free-text
    const openDimensions = ['tech', 'party', 'sol', 'topic'];
    return NextResponse.json({ data: { byDimension, openDimensions } });
  } catch (err) {
    console.error('[portal/taxonomy] error', err);
    return NextResponse.json({ error: 'Failed to load taxonomy', code: 'DB_ERROR' }, { status: 500 });
  }
}
