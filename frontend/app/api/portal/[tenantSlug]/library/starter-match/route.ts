/**
 * GET /api/portal/[tenantSlug]/library/starter-match?title=…&vehicle=… — resolve the
 * starter foundation+section that scaffolds a required item / section (P6.1, the
 * mold → starter-template link). Returns { data: StarterMatch | null }. tenant_user+.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { matchStarterFoundation } from '@/lib/library/starter-match';

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
  return { tenantId };
}

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;

    const url = new URL(request.url);
    const title = (url.searchParams.get('title') ?? '').trim();
    const vehicle = url.searchParams.get('vehicle');
    if (!title) return NextResponse.json({ error: 'title is required', code: 'BAD_REQUEST' }, { status: 400 });

    const match = await matchStarterFoundation(g.tenantId, { title, vehicle });
    return NextResponse.json({ data: match });
  } catch (e) {
    console.error('[library/starter-match GET]', e);
    return NextResponse.json({ error: 'Failed to resolve starter match', code: 'DB_ERROR' }, { status: 500 });
  }
}
