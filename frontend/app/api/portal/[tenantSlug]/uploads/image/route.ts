/**
 * Portal image upload — canvas image nodes in a tenant's proposal sections.
 *
 *   POST multipart (file) → { data: { storageKey, url, ... } }
 *
 * Tenant-scoped: stored under `customers/<slug>/images/` (customerImagePath), so a
 * customer's proposal images stay in their isolated prefix. Mirrors the admin
 * upload-image route; fixes the missing-route 404 from the gap sweep (the portal
 * `/uploads` route rejects images, and there was no `/uploads/image`).
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { putObject, getSignedGetUrl } from '@/lib/storage/s3-client';
import { customerImagePath } from '@/lib/storage/paths';

export const dynamic = 'force-dynamic';

interface Ctx { params: Promise<{ tenantSlug: string }> }

const VALID_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'];

export async function POST(request: NextRequest, ctx: Ctx) {
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
    // Partner-containment: writing into the shared tenant image prefix is a tenant-member action
    // (tenant_user+). Partners contribute content only through vault upload/atomize, not here.
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const hasAccess = await verifyTenantAccess(su.id, role, tenant.id as string);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // `request.formData()` THROWS on a body that is not multipart — a wrong content-type, a JSON
    // body, a truncated upload. Unguarded, that reached the outer catch and answered
    // `500 {code:'STORAGE_ERROR', error:'Image upload failed'}`: the caller is told storage broke
    // when the caller sent a malformed request, and the ops dashboard records a storage incident
    // that never happened. Two lines below, a MISSING file is correctly a 422 VALIDATION_ERROR —
    // an unparseable body is the same class of client mistake and gets the same answer.
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'Request body must be multipart/form-data with a file field', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'File is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (!VALID_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'File must be an image (PNG, JPEG, GIF, WebP, SVG)', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 10MB', code: 'VALIDATION_ERROR' }, { status: 413 });
    }

    const ext = (file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')) || 'png';
    const storageKey = customerImagePath(tenantSlug, `${randomUUID()}.${ext}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject({ key: storageKey, body: buffer, contentType: file.type });
    const url = await getSignedGetUrl(storageKey, 3600);

    return NextResponse.json({
      data: { storageKey, url, size: file.size, contentType: file.type, originalName: file.name },
    });
  } catch (err) {
    console.error('[portal/uploads/image] failed', err);
    return NextResponse.json({ error: 'Image upload failed', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}
