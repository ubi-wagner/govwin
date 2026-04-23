/**
 * GET /api/admin/rfp-document/[id]/signed-url
 *
 * Returns a 15-minute signed GET URL for a solicitation_document.
 * Used by the workspace "View" buttons so admins can open the PDF
 * directly without proxying through the app.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { getSignedGetUrl } from '@/lib/storage/s3-client';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json(
      { error: 'rfp_admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }

  const { id } = await ctx.params;

  const rows = await sql<{ storageKey: string; originalFilename: string }[]>`
    SELECT storage_key, original_filename
    FROM solicitation_documents
    WHERE id = ${id}::uuid
  `;
  if (rows.length === 0) {
    return NextResponse.json(
      { error: 'Document not found', code: 'NOT_FOUND' },
      { status: 404 },
    );
  }

  try {
    const url = await getSignedGetUrl(rows[0].storageKey, 15 * 60);
    return NextResponse.json({ data: { url, filename: rows[0].originalFilename } });
  } catch (err) {
    console.error('[signed-url] failed', err);
    return NextResponse.json(
      { error: 'Failed to generate signed URL', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}
