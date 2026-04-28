/**
 * POST /api/portal/[tenantSlug]/library/upload
 *
 * Accepts multipart form data with one or more files. For each file:
 *   1. Stores to S3 at customers/{slug}/uploads/{yyyy}/{mm}/{uuid}.{ext}
 *   2. Creates a library_units row (status='draft', category='uploaded')
 *      with a placeholder content string
 *   3. Returns { data: { uploaded: [{ id, filename }] } }
 *
 * Actual text extraction + atomization is handled later by a pipeline job.
 */

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { putObject } from '@/lib/storage/s3-client';
import { customerPath } from '@/lib/storage/paths';
import { emitEventSingle } from '@/lib/events';

const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'pptx', 'ppt', 'txt', 'md'];

function extFromFilename(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return (m?.[1] ?? '').toLowerCase();
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string }> },
) {
  try {
  const { tenantSlug } = await params;

  // ---------- Auth ----------
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json(
      { error: 'Invalid session', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }

  // tenant_user or higher
  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return NextResponse.json(
      { error: 'Insufficient permissions', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Tenant lookup + access check ----------
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Tenant not found', code: 'NOT_FOUND' },
      { status: 404 },
    );
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Forbidden', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  // ---------- Parse form data ----------
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'Invalid multipart body', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  const files: File[] = [];
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File) files.push(entry);
  }
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'At least one file is required', code: 'VALIDATION_ERROR' },
      { status: 422 },
    );
  }

  // ---------- Validate ----------
  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    const ext = extFromFilename(f.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { error: `Unsupported file type: .${ext} (allowed: ${ALLOWED_EXTENSIONS.join(', ')})`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      { error: `Total upload size ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit`, code: 'VALIDATION_ERROR' },
      { status: 413 },
    );
  }

  // ---------- Upload each file ----------
  const uploaded: { id: string; filename: string }[] = [];

  for (const file of files) {
    const ext = extFromFilename(file.name);
    const fileUuid = randomUUID();
    const displayName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).slice(0, 255);

    // Build S3 key via the canonical path helper
    const storageKey = customerPath({
      tenantSlug,
      kind: 'upload',
      name: fileUuid,
      ext,
    });

    const buffer = Buffer.from(await file.arrayBuffer());

    try {
      await putObject({
        key: storageKey,
        body: buffer,
        contentType: file.type || undefined,
        metadata: {
          'original-filename': displayName,
          'uploaded-by': sessionUser.id,
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error('[library/upload] S3 put failed', { key: storageKey, err: detail });
      return NextResponse.json(
        { error: 'File upload failed', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    // Create a placeholder library_units row
    try {
      const [row] = await sql<{ id: string }[]>`
        INSERT INTO library_units (
          tenant_id,
          content,
          category,
          status,
          source_type,
          source_id,
          tags
        ) VALUES (
          ${tenantId}::uuid,
          '[pending extraction]',
          'uploaded',
          'draft',
          'upload',
          ${storageKey},
          ${sql.array([ext])}
        )
        RETURNING id
      `;
      uploaded.push({ id: row.id, filename: displayName });
    } catch (err) {
      console.error('[library/upload] DB insert failed', err);
      return NextResponse.json(
        { error: 'Failed to create library record', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }
  }

  await emitEventSingle({
    namespace: 'library',
    type: 'files_uploaded',
    actor: { type: 'user', id: sessionUser.id },
    tenantId,
    payload: { fileCount: uploaded.length, files: uploaded.map(f => ({ id: f.id, filename: f.filename })) },
  });

  return NextResponse.json(
    { data: { uploaded } },
    { status: 201 },
  );
  } catch (err) {
    console.error('[library/upload] Unexpected error', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
