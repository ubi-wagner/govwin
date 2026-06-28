/**
 * Portal storage — presigned download URL for a tenant's own objects.
 *
 *   GET ?download=<key> → { data: { url } }  (presigned GET, 1h)
 *
 * Tenant-scoped: the key MUST live under `customers/<slug>/` (assertKeyBelongsToTenant),
 * so a tenant can never presign another tenant's object. Backs the canvas image
 * node's display in the portal (fixes the missing-route 404 from the gap sweep).
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { getSignedGetUrl } from '@/lib/storage/s3-client';
import { assertKeyBelongsToTenant } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ tenantSlug: string }> }

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    const { tenantSlug } = await ctx.params;
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; role?: unknown };
    const role = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const hasAccess = await verifyTenantAccess(su.id, role, tenant.id as string);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    const downloadKey = request.nextUrl.searchParams.get('download');
    if (!downloadKey) {
      return NextResponse.json({ error: 'download key is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    // Isolation: the key must belong to THIS tenant or we refuse to sign it.
    try {
      assertKeyBelongsToTenant(downloadKey, tenantSlug);
    } catch {
      return NextResponse.json({ error: 'Key does not belong to this tenant', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = await getSignedGetUrl(downloadKey, 3600);
    return NextResponse.json({ data: { url } });
  } catch (err) {
    console.error('[portal/storage] failed', err);
    return NextResponse.json({ error: 'Storage error', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
