import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject, deleteObject, getSignedGetUrl } from '@/lib/storage/s3-client';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3, BUCKET } from '@/lib/storage/s3-client';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

function dropboxPrefix(tenantSlug: string, proposalId: string, userId: string): string {
  return `customers/${tenantSlug}/proposals/${proposalId}/dropbox/${userId}/`;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/dropbox
 *
 * List files in the current user's dropbox.
 * Admin can pass ?userId= to see any user's dropbox.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Verify proposal belongs to tenant
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Admin can view any user's dropbox
    const url = new URL(request.url);
    const isAdmin = hasRoleAtLeast(role, 'tenant_admin');
    const targetUserId = isAdmin && url.searchParams.get('userId')
      ? url.searchParams.get('userId')!
      : sessionUser.id;

    const prefix = dropboxPrefix(tenantSlug, proposalId, targetUserId);

    try {
      const command = new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        MaxKeys: 100,
      });
      const response = await s3.send(command);
      const files = (response.Contents || []).map((obj) => {
        const key = obj.Key || '';
        const filename = key.split('/').pop() || key;
        return {
          key,
          filename,
          size: obj.Size || 0,
          lastModified: obj.LastModified?.toISOString() || null,
        };
      });

      return NextResponse.json({ data: { files, userId: targetUserId } });
    } catch (s3Err) {
      console.error('[api/portal/proposals/dropbox] S3 list error:', s3Err);
      return NextResponse.json({ data: { files: [], userId: targetUserId } });
    }
  } catch (e) {
    console.error('[api/portal/proposals/dropbox] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/dropbox
 *
 * Upload a file to the user's dropbox.
 * Expects multipart form data with a 'file' field.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Verify proposal belongs to tenant
    const [proposal] = await sql<{ id: string }[]>`
      SELECT id FROM proposals
      WHERE id = ${proposalId} AND tenant_id = ${tenantId}
      LIMIT 1
    `;
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Parse multipart form data
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Expected multipart form data', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'File field is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // File size limit (50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 50MB)', code: 'PAYLOAD_TOO_LARGE' }, { status: 413 });
    }

    // Sanitize filename
    const safeFilename = file.name
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 200);

    const key = `${dropboxPrefix(tenantSlug, proposalId, sessionUser.id)}${safeFilename}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      await putObject({
        key,
        body: buffer,
        contentType: file.type || 'application/octet-stream',
      });
    } catch (s3Err) {
      console.error('[api/portal/proposals/dropbox] S3 upload error:', s3Err);
      return NextResponse.json(
        { error: 'File upload failed', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.dropbox_file_uploaded',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        proposalId,
        filename: safeFilename,
        size: buffer.length,
      },
    });

    return NextResponse.json({
      data: {
        key,
        filename: safeFilename,
        size: buffer.length,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/dropbox] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/dropbox
 *
 * Delete a file from the user's dropbox.
 * Body: { key: string }
 * Admin can delete any file; users can only delete their own.
 */
export async function DELETE(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { key?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const key = typeof body.key === 'string' ? body.key : '';
    if (!key) {
      return NextResponse.json({ error: 'File key is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Verify the key belongs to this tenant and proposal
    const expectedBase = `customers/${tenantSlug}/proposals/${proposalId}/dropbox/`;
    if (!key.startsWith(expectedBase)) {
      return NextResponse.json({ error: 'Invalid file key', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Non-admins can only delete their own files
    const isAdmin = hasRoleAtLeast(role, 'tenant_admin');
    const ownPrefix = dropboxPrefix(tenantSlug, proposalId, sessionUser.id);
    if (!isAdmin && !key.startsWith(ownPrefix)) {
      return NextResponse.json({ error: 'Can only delete your own files', code: 'FORBIDDEN' }, { status: 403 });
    }

    try {
      await deleteObject(key);
    } catch (s3Err) {
      console.error('[api/portal/proposals/dropbox] S3 delete error:', s3Err);
      return NextResponse.json(
        { error: 'File deletion failed', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    await emitEventSingle({
      namespace: 'proposal',
      type: 'proposal.dropbox_file_deleted',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        correlationId: randomUUID(),
        tenantId,
        proposalId,
        key,
      },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (e) {
    console.error('[api/portal/proposals/dropbox] DELETE error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
