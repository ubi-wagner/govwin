/**
 * Ingest a vault foundation into the tenant's MAIN library (P8.6) — tenant-side only.
 * POST — copies the whole grain tree with derived_from lineage; copies land vault_id NULL
 * + visibility='tenant', so the customer harvests vault content into their proposal library.
 * A collaborator has no ingest right (rights.ingest === false) → 403.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { resolveVaultAccess, ingestVaultFoundation } from '@/lib/vaults/vaults';

export async function POST(_request: Request, { params }: { params: Promise<{ tenantSlug: string; vaultId: string; atomId: string }> }) {
  try {
    const { tenantSlug, vaultId, atomId } = await params;
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const u = session.user as { id?: string; role?: unknown; email?: string };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!isValidUUID(atomId)) return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;

    const access = await resolveVaultAccess(vaultId, { userId: u.id, email: u.email ?? null, role });
    if (!access || access.ownerTenantId !== tenantId) return NextResponse.json({ error: 'Vault not found', code: 'NOT_FOUND' }, { status: 404 });
    if (!access.rights.ingest) return NextResponse.json({ error: 'Only the tenant can ingest vault content', code: 'FORBIDDEN' }, { status: 403 });
    enterTenant(tenantId); // RLS choke point

    const r = await ingestVaultFoundation(vaultId, atomId, tenantId, { id: u.id });
    return NextResponse.json({ data: { foundationId: r.foundationId } }, { status: 201 });
  } catch (e) {
    console.error('[vault ingest POST]', e);
    return NextResponse.json({ error: 'Failed to ingest vault artifact', code: 'DB_ERROR' }, { status: 500 });
  }
}
