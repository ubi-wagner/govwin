/**
 * Vault members (P8.4) — invite partner emails into a nook + list them.
 *   GET  — list the vault's members.
 *   POST { email } — invite a partner email (→ vault-scoped partner_user; upsert).
 * tenant_admin only; the vault must belong to the caller's tenant (checked via
 * resolveVaultAccess tenant side, which also covers shadow).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveVaultAccess, inviteVaultMember, listVaultMembers } from '@/lib/vaults/vaults';

async function gate(tenantSlug: string, vaultId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; role?: unknown; email?: string };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, 'tenant_admin')) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  // The caller must be tenant-side of THIS vault (its owner + manage right).
  const access = await resolveVaultAccess(vaultId, { userId: u.id, email: u.email ?? null, role });
  if (!access || access.side !== 'tenant' || access.ownerTenantId !== tenantId || !access.rights.manage) {
    return { error: NextResponse.json({ error: 'Vault not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  return { tenantId, userId: u.id, email: u.email ?? null };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; vaultId: string }> }) {
  try {
    const { tenantSlug, vaultId } = await params;
    const g = await gate(tenantSlug, vaultId);
    if ('error' in g) return g.error;
    return NextResponse.json({ data: await listVaultMembers(vaultId, g.tenantId) });
  } catch (e) {
    console.error('[vault members GET]', e);
    return NextResponse.json({ error: 'Failed to list members', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; vaultId: string }> }) {
  try {
    const { tenantSlug, vaultId } = await params;
    const g = await gate(tenantSlug, vaultId);
    if ('error' in g) return g.error;
    let body: { email?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'BAD_REQUEST' }, { status: 400 }); }
    const email = typeof body.email === 'string' ? body.email.trim() : '';
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: 'a valid email is required', code: 'BAD_REQUEST' }, { status: 400 });
    }
    const member = await inviteVaultMember(vaultId, g.tenantId, { id: g.userId, email: g.email }, email);
    return NextResponse.json({ data: member }, { status: 201 });
  } catch (e) {
    console.error('[vault members POST]', e);
    return NextResponse.json({ error: 'Failed to invite member', code: 'DB_ERROR' }, { status: 500 });
  }
}
