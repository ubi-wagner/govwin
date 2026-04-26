/**
 * /api/admin/storage — S3 file manager for the rfp-admin/ prefix.
 *
 * GET    ?prefix=rfp-admin/…          → list objects + sub-prefixes
 * GET    ?download=rfp-admin/…/key    → presigned download URL (300s)
 * POST   multipart (file + prefix)    → upload file
 * DELETE  { key }                     → delete object
 *
 * Auth: master_admin or rfp_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/auth';
import { emitEventSingle } from '@/lib/events';
import { s3, BUCKET, putObject, getSignedGetUrl } from '@/lib/storage/s3-client';

const ADMIN_PREFIX = 'rfp-admin/';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

function isAdminRole(role: string | undefined): boolean {
  return role === 'master_admin' || role === 'rfp_admin';
}

function prefixIsValid(prefix: string): boolean {
  return prefix.startsWith(ADMIN_PREFIX);
}

// ── GET — list objects or generate presigned download URL ─────────────
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required' },
        { status: 403 },
      );
    }

    const { searchParams } = request.nextUrl;

    // ── Presigned download URL ─────────────────────────────────────
    const downloadKey = searchParams.get('download');
    if (downloadKey) {
      if (!prefixIsValid(downloadKey)) {
        return NextResponse.json(
          { error: 'Key must start with rfp-admin/' },
          { status: 400 },
        );
      }
      const url = await getSignedGetUrl(downloadKey, 300);
      return NextResponse.json({ data: { url } });
    }

    // ── List objects ───────────────────────────────────────────────
    const prefix = searchParams.get('prefix') || ADMIN_PREFIX;
    if (!prefixIsValid(prefix)) {
      return NextResponse.json(
        { error: 'Prefix must start with rfp-admin/' },
        { status: 400 },
      );
    }

    const command = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      Delimiter: '/',
    });

    const response = await s3.send(command);

    const objects = (response.Contents ?? [])
      .filter((obj) => obj.Key !== prefix) // exclude the folder marker itself
      .map((obj) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        lastModified: obj.LastModified?.toISOString() ?? null,
      }));

    const prefixes = (response.CommonPrefixes ?? []).map(
      (cp) => cp.Prefix ?? '',
    );

    return NextResponse.json({ data: { objects, prefixes } });
  } catch (err) {
    console.error('[admin/storage] GET failed', err);
    return NextResponse.json(
      { error: 'Failed to list storage objects' },
      { status: 500 },
    );
  }
}

// ── POST — upload a file ─────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required' },
        { status: 403 },
      );
    }
    const userId = (session.user as { id?: string }).id ?? 'unknown';

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'Invalid multipart body' },
        { status: 400 },
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'A file field is required' },
        { status: 422 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit` },
        { status: 413 },
      );
    }

    const prefix = String(formData.get('prefix') || ADMIN_PREFIX);
    if (!prefixIsValid(prefix)) {
      return NextResponse.json(
        { error: 'Prefix must start with rfp-admin/' },
        { status: 400 },
      );
    }

    // Sanitize filename: strip directory components, keep original name
    const originalName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).trim();
    if (!originalName) {
      return NextResponse.json(
        { error: 'File must have a name' },
        { status: 422 },
      );
    }

    const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const key = `${cleanPrefix}${originalName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    await putObject({
      key,
      body: buffer,
      contentType: file.type || undefined,
      metadata: { 'uploaded-by': userId },
    });

    await emitEventSingle({
      namespace: 'admin',
      type: 'admin.storage.file_uploaded',
      actor: { type: 'user', id: userId },
      tenantId: null,
      payload: { key, size: file.size, originalName },
    });

    return NextResponse.json(
      { data: { key, size: file.size } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[admin/storage] POST failed', err);
    return NextResponse.json(
      { error: 'Failed to upload file' },
      { status: 500 },
    );
  }
}

// ── DELETE — delete a file ───────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required' },
        { status: 403 },
      );
    }
    const userId = (session.user as { id?: string }).id ?? 'unknown';

    let body: { key?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const key = body.key;
    if (!key || typeof key !== 'string') {
      return NextResponse.json(
        { error: 'key is required' },
        { status: 422 },
      );
    }
    if (!prefixIsValid(key)) {
      return NextResponse.json(
        { error: 'Key must start with rfp-admin/' },
        { status: 400 },
      );
    }

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    await emitEventSingle({
      namespace: 'admin',
      type: 'admin.storage.file_deleted',
      actor: { type: 'user', id: userId },
      tenantId: null,
      payload: { key },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[admin/storage] DELETE failed', err);
    return NextResponse.json(
      { error: 'Failed to delete file' },
      { status: 500 },
    );
  }
}
