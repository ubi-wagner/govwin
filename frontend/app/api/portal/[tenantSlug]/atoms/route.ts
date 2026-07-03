/**
 * GET  /api/portal/[tenantSlug]/atoms            — list/facet the tenant's atoms
 *   ?dimension=&value=&grain=&status=&q=&limit=
 * POST /api/portal/[tenantSlug]/atoms            — create an atom (primitive | group | reference)
 *   body { grain, title?, content?, canvasNodes?, summary?, source?, creatorKind?, cocoonId?,
 *          sourceAnchor?, originProposalId?, originSectionId?, visibility?, status?,
 *          memberAtomIds?, parentAtomIds?, tags? }
 *
 * The atomize + register surface (mig 101/102). RLS-scoped.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { createAtom, listAtoms, type CreateAtomInput, type CreatorKind } from '@/lib/atoms';

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
  return { tenantId, userId: u.id, role };
}

const GRAINS = ['primitive', 'group', 'reference'];
const CREATOR_KINDS = ['admin', 'ai', 'collaborator', 'system', 'import'];

export async function GET(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    const url = new URL(request.url);
    const atoms = await listAtoms(g.tenantId, {
      dimension: url.searchParams.get('dimension') ?? undefined,
      value: url.searchParams.get('value') ?? undefined,
      grain: (url.searchParams.get('grain') as CreateAtomInput['grain']) ?? undefined,
      status: (url.searchParams.get('status') as 'draft' | 'approved' | 'archived') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    });
    return NextResponse.json({ data: { atoms } });
  } catch (err) {
    console.error('[portal/atoms] GET error', err);
    return NextResponse.json({ error: 'Failed to load atoms', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string }> }) {
  try {
    const { tenantSlug } = await params;
    const g = await gate(tenantSlug, 'tenant_user');
    if ('error' in g) return g.error;
    let body: CreateAtomInput;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    if (!body?.grain || !GRAINS.includes(body.grain)) {
      return NextResponse.json({ error: `grain must be one of ${GRAINS.join(', ')}`, code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.grain === 'group' && (!Array.isArray(body.memberAtomIds) || body.memberAtomIds.length === 0)) {
      return NextResponse.json({ error: 'a group atom needs memberAtomIds', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.creatorKind && !CREATOR_KINDS.includes(body.creatorKind)) {
      return NextResponse.json({ error: 'invalid creatorKind', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // An admin-created atom is 'admin'; anything else defaults to the collaborator kind.
    const kind: CreatorKind = body.creatorKind ?? (hasRoleAtLeast(g.role, 'tenant_admin') || g.role === 'rfp_admin' || g.role === 'master_admin' ? 'admin' : 'collaborator');
    const created = await createAtom(g.tenantId, body, { id: g.userId, kind });
    return NextResponse.json({ data: created });
  } catch (err) {
    console.error('[portal/atoms] POST error', err);
    return NextResponse.json({ error: 'Failed to create atom', code: 'DB_ERROR' }, { status: 500 });
  }
}
