/**
 * GET /api/portal/[tenantSlug]/atoms/select — the scored selector for a section mold.
 *   ?vol=key_personnel&kinds=bio,narrative&context=army,sbir,autonomy&limit=8
 *
 * Ranks the tenant's atoms for a section by tag overlap (pre-vector): scope by vol/kind,
 * boost by shared opportunity context (agency/program/phase/tech), tie-break by
 * outcome/usage/recency. Feeds the AI drafter's <library_atoms> and the admin picker.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { selectForSection } from '@/lib/atoms';

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
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const url = new URL(request.url);
    const csv = (k: string) => (url.searchParams.get(k) ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const atoms = await selectForSection(tenantId, {
      vol: url.searchParams.get('vol') ?? null,
      kinds: csv('kinds'),
      context: csv('context'),
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });
    return NextResponse.json({ data: { atoms } });
  } catch (err) {
    console.error('[portal/atoms/select] error', err);
    return NextResponse.json({ error: 'Select failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
