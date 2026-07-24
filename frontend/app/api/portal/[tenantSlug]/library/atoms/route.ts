/**
 * GET /api/portal/[tenantSlug]/library/atoms — the faceted library list (P3.1).
 *   ?kind=&form=&context=&collection=&vehicle=&grain=&q=&page=&pageSize=
 * ANDed taxonomy filter (kind × form × context × collection × vehicle) + grain filter
 * + escaped search + pagination, returning { atoms, total, facets } where facets are
 * per-dimension value counts for the filter chips. Read is open to collaborators
 * (partner_user); visibility is enforced by the viewer predicate.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { listAtomsFaceted, viewerFromRole, type Grain } from '@/lib/atoms';

const GRAINS = new Set(['foundation', 'section', 'group', 'primitive', 'reference']);

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'partner_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });

    const p = new URL(request.url).searchParams;
    const grainRaw = p.get('grain') ?? undefined;
    const grain = grainRaw && GRAINS.has(grainRaw) ? (grainRaw as Grain) : undefined;
    const res = await listAtomsFaceted(tenantId, {
      kind: p.get('kind') ?? undefined,
      form: p.get('form') ?? undefined,
      context: p.get('context') ?? undefined,
      collection: p.get('collection') ?? undefined,
      vehicle: p.get('vehicle') ?? undefined,
      grain,
      q: p.get('q') ?? undefined,
      page: p.get('page') ? Number(p.get('page')) : undefined,
      pageSize: p.get('pageSize') ? Number(p.get('pageSize')) : undefined,
    }, viewerFromRole(u.id, role));
    return NextResponse.json({ data: res });
  } catch (e) {
    console.error('[library/atoms GET]', e);
    return NextResponse.json({ error: 'Failed to load the library', code: 'DB_ERROR' }, { status: 500 });
  }
}
