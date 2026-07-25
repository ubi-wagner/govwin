/**
 * GET  /api/portal/[tenantSlug]/uploads — List uploaded library units
 * POST /api/portal/[tenantSlug]/uploads — Upload a file to S3 + create library_unit
 *
 * Handles file uploads for tenant library. Files are stored in S3 under
 * customers/{tenantSlug}/uploads/ and a library_atoms 'reference' atom is created
 * with source='upload' (filename/storage key/category in source_anchor).
 *
 * Auth: tenant_user or above with tenant access.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { createAtom } from '@/lib/atoms';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

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

    // ── Business logic ───────────────────────────────────────────
    try {
      // Uploaded files register as 'reference' atoms in the canonical library
      // (library_atoms); filename/storage key/category live in source_anchor.
      const uploads = await sql`
        SELECT
          id,
          title AS filename,
          source_anchor->>'category' AS category,
          source AS source_type,
          status,
          source_anchor->>'storageKey' AS storage_key,
          created_at
        FROM library_atoms
        WHERE tenant_id = ${tenantId}::uuid
          AND vault_id IS NULL
          AND source = 'upload'
        ORDER BY created_at DESC
        LIMIT 200
      `;

      return NextResponse.json({ data: { uploads } });
    } catch (dbErr) {
      console.error('[portal/uploads/list] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to list uploads', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/uploads/list] error:', err);
    return NextResponse.json(
      { error: 'Failed to list uploads', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

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

    // ── Parse multipart form data ────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: 'Invalid form data', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json(
        { error: 'file is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const category = (formData.get('category') as string) || 'general';
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: 'File type not allowed. Accepted: PDF, DOCX, TXT, XLSX', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const MAX_SIZE = 50 * 1024 * 1024; // 50 MB
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'File too large (max 50 MB)', code: 'TOO_LARGE' },
        { status: 413 },
      );
    }

    // ── Upload to S3 ─────────────────────────────────────────────
    try {
      const { randomUUID } = await import('crypto');
      const fileId = randomUUID();
      const storageKey = `customers/${tenantSlug}/uploads/${fileId}/${file.name}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const { putObject } = await import('@/lib/storage/s3-client');
      await putObject({
        key: storageKey,
        body: fileBuffer,
        contentType: file.type,
        metadata: { 'uploaded-by': sessionUser.id },
      });

      // ── Create the reference atom (canonical library_atoms) ──────────
      // The uploaded file registers as a 'reference' atom (the registered source
      // document); its storage key, original filename, and category live in
      // source_anchor so the GET listing above can surface them.
      const content = `Uploaded file: ${file.name}`;
      const { atomId } = await createAtom(
        tenantId,
        {
          grain: 'reference',
          title: file.name,
          content,
          source: 'upload',
          creatorKind: 'import',
          status: 'draft',
          sourceAnchor: { storageKey, filename: file.name, category },
        },
        { id: sessionUser.id, kind: 'import' },
      );
      const unit = { id: atomId };

      // ── Emit event ─────────────────────────────────────────────────
      await emitEventSingle({
        namespace: 'library',
        type: 'unit.uploaded',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
          unitId: unit.id,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          storageKey,
        },
      });

      return NextResponse.json(
        { data: { id: unit.id, filename: file.name, storageKey } },
        { status: 201 },
      );
    } catch (uploadErr) {
      console.error('[portal/uploads/create] upload error:', uploadErr);
      return NextResponse.json(
        { error: 'Upload failed', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/uploads/create] error:', err);
    return NextResponse.json(
      { error: 'Upload failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
