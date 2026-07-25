/**
 * Collaboration vaults ("nooks") — tenant-side list + create (P8.3).
 *   GET  — list the tenant's active nooks.
 *   POST { partnerName, partnerOrg? } — create a nook for a partner.
 * tenant_admin only (incl. shadow rfp_admin) — creating/managing a nook is a manage right.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createVault, listVaults } from '@/lib/vaults/vaults';

async function gate(tenantSlug: string, minRole: Role) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, minRole)) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_admin');
    if ('error' in g) return g.error;
    return NextResponse.json({ data: await listVaults(g.tenantId) });
  } catch (e) {
    console.error('[vaults GET]', e);
    return NextResponse.json({ error: 'Failed to list vaults', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_admin');
    if ('error' in g) return g.error;
    let body: { partnerName?: unknown; partnerOrg?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 }); }
    const partnerName = typeof body.partnerName === 'string' ? body.partnerName.trim() : '';
    const partnerOrg = typeof body.partnerOrg === 'string' ? body.partnerOrg.trim() : null;
    if (!partnerName) return NextResponse.json({ error: 'partnerName is required', code: 'BAD_REQUEST' }, { status: 400 });
    const vault = await createVault(g.tenantId, { id: g.userId, email: g.email }, { partnerName, partnerOrg });
    return NextResponse.json({ data: vault }, { status: 201 });
  } catch (e) {
    console.error('[vaults POST]', e);
    return NextResponse.json({ error: 'Failed to create vault', code: 'DB_ERROR' }, { status: 500 });
  }
}
