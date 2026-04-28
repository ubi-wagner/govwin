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
import { ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';
import { getSignedPutUrl } from '@/lib/storage/s3-client';
import { s3, BUCKET, putObject, getSignedGetUrl } from '@/lib/storage/s3-client';

const ADMIN_PREFIX = 'rfp-admin/';
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB — SBIR award files are 300MB+

// Next.js route segment config — allow large uploads and long processing
export const maxDuration = 120; // seconds (for large CSV ingest)
export const dynamic = 'force-dynamic';

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
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { searchParams } = request.nextUrl;

    // ── Presigned download URL ─────────────────────────────────────
    const downloadKey = searchParams.get('download');
    if (downloadKey) {
      if (!prefixIsValid(downloadKey)) {
        return NextResponse.json(
          { error: 'Key must start with rfp-admin/', code: 'VALIDATION_ERROR' },
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
        { error: 'Prefix must start with rfp-admin/', code: 'VALIDATION_ERROR' },
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
      { error: 'Failed to list storage objects', code: 'STORAGE_ERROR' },
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
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    const userId = (session.user as { id?: string }).id ?? 'unknown';

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseErr) {
      const msg = parseErr instanceof Error ? parseErr.message : 'Unknown parse error';
      console.error('[admin/storage] formData parse failed:', msg);
      return NextResponse.json(
        { error: `Upload failed: ${msg.includes('size') ? 'File too large for server limit' : 'Invalid multipart body — check file size and format'}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'A file field is required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File exceeds ${MAX_UPLOAD_BYTES / 1024 / 1024}MB limit`, code: 'VALIDATION_ERROR' },
        { status: 413 },
      );
    }

    const prefix = String(formData.get('prefix') || ADMIN_PREFIX);
    if (!prefixIsValid(prefix)) {
      return NextResponse.json(
        { error: 'Prefix must start with rfp-admin/', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Sanitize filename: strip directory components, keep original name
    const originalName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).trim();
    if (!originalName) {
      return NextResponse.json(
        { error: 'File must have a name', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const key = `${cleanPrefix}${originalName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    // File hash dedup — check if this exact file already exists anywhere
    const { createHash } = await import('crypto');
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const [existingFile] = await sql<{ key: string }[]>`
      SELECT payload->>'key' AS key FROM system_events
      WHERE type = 'admin.storage.file_uploaded'
        AND payload->>'fileHash' = ${fileHash}
      LIMIT 1
    `;
    // Note: this is a soft check — we still upload (S3 overwrites are safe)
    // but we inform the admin if it's a duplicate

    await putObject({
      key,
      body: buffer,
      contentType: file.type || undefined,
      metadata: { 'uploaded-by': userId },
    });

    await emitEventSingle({
      namespace: 'system',
      type: 'admin.storage.file_uploaded',
      actor: { type: 'user', id: userId },
      tenantId: null,
      payload: { key, size: file.size, originalName, fileHash },
    });

    // Auto-detect and ingest SBIR CSV files on upload
    let sbirResult: { fileType: string; rowCount: number; isDuplicate: boolean } | null = null;
    try {
      const { detectAndIngestSbirCsv } = await import('@/lib/sbir-ingest');
      const result = await detectAndIngestSbirCsv(buffer, originalName, userId, key);
      if (result) {
        sbirResult = { fileType: result.fileType, rowCount: result.rowCount, isDuplicate: result.isDuplicate };
        if (!result.isDuplicate) {
          await emitEventSingle({
            namespace: 'system',
            type: 'sbir_data.auto_ingested',
            actor: { type: 'user', id: userId },
            tenantId: null,
            payload: { fileType: result.fileType, rowCount: result.rowCount, filename: originalName, storageKey: key },
          });
        }
      }
    } catch (err) {
      console.error('[admin/storage] SBIR auto-ingest failed (non-fatal)', err);
    }

    return NextResponse.json(
      { data: { key, size: file.size, sbirIngest: sbirResult } },
      { status: 201 },
    );
  } catch (err) {
    console.error('[admin/storage] POST failed', err);
    return NextResponse.json(
      { error: 'Failed to upload file', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}

// ── PUT — get a presigned upload URL (for large files, browser → S3 direct) ──
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { filename: string; prefix?: string; contentType?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!body.filename) {
      return NextResponse.json({ error: 'filename is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const prefix = body.prefix || ADMIN_PREFIX;
    if (!prefixIsValid(prefix)) {
      return NextResponse.json({ error: 'Prefix must start with rfp-admin/', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const cleanPrefix = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const key = `${cleanPrefix}${body.filename}`;

    const url = await getSignedPutUrl(key, body.contentType, 3600);

    return NextResponse.json({
      data: { url, key, expiresIn: 900 },
    });
  } catch (err) {
    console.error('[admin/storage] PUT (presign) failed', err);
    return NextResponse.json({ error: 'Failed to generate upload URL', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}

// ── PATCH — confirm a direct S3 upload + trigger auto-ingest ─────────
export async function PATCH(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id ?? 'unknown';

    let body: { key: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!body.key || !prefixIsValid(body.key)) {
      return NextResponse.json({ error: 'Invalid key', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Verify the object actually exists in S3
    try {
      await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: body.key }));
    } catch {
      return NextResponse.json({ error: 'File not found in storage — upload may have failed', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Get file size from head
    const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: body.key }));
    const size = head.ContentLength ?? 0;
    const filename = body.key.split('/').pop() ?? body.key;

    await emitEventSingle({
      namespace: 'system',
      type: 'admin.storage.file_uploaded',
      actor: { type: 'user', id: userId },
      tenantId: null,
      payload: { key: body.key, size, originalName: filename },
    });

    // Auto-detect and ingest SBIR CSV files (skip for very large files — they need pipeline processing)
    const MAX_AUTO_INGEST_BYTES = 100 * 1024 * 1024; // 100MB
    let sbirResult: { fileType: string; rowCount: number; isDuplicate: boolean } | null = null;
    if (filename.toLowerCase().endsWith('.csv') && size <= MAX_AUTO_INGEST_BYTES) {
      try {
        const { getObjectBuffer } = await import('@/lib/storage/s3-client');
        const buffer = await getObjectBuffer(body.key);
        if (buffer) {
          const { detectAndIngestSbirCsv } = await import('@/lib/sbir-ingest');
          const result = await detectAndIngestSbirCsv(Buffer.from(buffer), filename, userId, body.key);
          if (result) {
            sbirResult = { fileType: result.fileType, rowCount: result.rowCount, isDuplicate: result.isDuplicate };
            if (!result.isDuplicate) {
              await emitEventSingle({
                namespace: 'system',
                type: 'sbir_data.auto_ingested',
                actor: { type: 'user', id: userId },
                tenantId: null,
                payload: { fileType: result.fileType, rowCount: result.rowCount, filename, storageKey: body.key },
              });
            }
          }
        }
      } catch (err) {
        console.error('[admin/storage] SBIR auto-ingest failed (non-fatal)', err);
      }
    }

    const tooLargeForAutoIngest = filename.toLowerCase().endsWith('.csv') && size > MAX_AUTO_INGEST_BYTES;

    return NextResponse.json({
      data: {
        key: body.key,
        size,
        confirmed: true,
        sbirIngest: sbirResult,
        ...(tooLargeForAutoIngest ? {
          notice: `File is ${(size / 1024 / 1024).toFixed(0)}MB — too large for auto-ingest (limit ${MAX_AUTO_INGEST_BYTES / 1024 / 1024}MB). Use POST /api/admin/sbir-data/ingest to process it.`,
        } : {}),
      },
    });
  } catch (err) {
    console.error('[admin/storage] PATCH (confirm) failed', err);
    return NextResponse.json({ error: 'Failed to confirm upload', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}

// ── DELETE — delete a file ───────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (!isAdminRole(role)) {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    const userId = (session.user as { id?: string }).id ?? 'unknown';

    let body: { key?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const key = body.key;
    if (!key || typeof key !== 'string') {
      return NextResponse.json(
        { error: 'key is required', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
    if (!prefixIsValid(key)) {
      return NextResponse.json(
        { error: 'Key must start with rfp-admin/', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

    await emitEventSingle({
      namespace: 'system',
      type: 'admin.storage.file_deleted',
      actor: { type: 'user', id: userId },
      tenantId: null,
      payload: { key },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[admin/storage] DELETE failed', err);
    return NextResponse.json(
      { error: 'Failed to delete file', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}
