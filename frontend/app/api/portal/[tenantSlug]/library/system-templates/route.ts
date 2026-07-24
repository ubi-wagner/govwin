/**
 * Shared system-scaffold catalog + copy-on-use (docs/LIBRARY_AND_VAULTS_DESIGN.md §4).
 *   GET  — list the shared system starter foundations any tenant can add.
 *   POST { foundationId } — copy that foundation into MY library (derived_from
 *          lineage), materializing a per-tenant copy on demand instead of
 *          deep-seeding every template into every tenant.
 * tenant_user+ with verified tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listSystemFoundations, isSystemFoundation, copyFoundationToTenant } from '@/lib/library/foundation';

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    return NextResponse.json({ data: await listSystemFoundations() });
  } catch (e) {
    console.error('[library/system-templates GET]', e);
    return NextResponse.json({ error: 'Failed to load system templates', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    let body: { foundationId?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const foundationId = typeof body.foundationId === 'string' ? body.foundationId : '';
    if (!foundationId) return NextResponse.json({ error: 'foundationId is required', code: 'BAD_REQUEST' }, { status: 400 });
    // Guard: only shared system-scaffold foundations may be copied this way.
    if (!(await isSystemFoundation(foundationId))) {
      return NextResponse.json({ error: 'Not a system template', code: 'NOT_FOUND' }, { status: 404 });
    }
    const d = await copyFoundationToTenant(foundationId, g.tenantId, { id: g.userId }, { collection: 'my_library' });
    return NextResponse.json({
      data: { foundationId: d.foundationId, sections: d.sectionIds.length, groups: d.groupIds.length, atoms: d.atomIds.length },
    }, { status: 201 });
  } catch (e) {
    console.error('[library/system-templates POST]', e);
    return NextResponse.json({ error: 'Failed to add template to library', code: 'DB_ERROR' }, { status: 500 });
  }
}
