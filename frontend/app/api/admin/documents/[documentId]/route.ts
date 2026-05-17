/**
 * /api/admin/documents/[documentId] — single document operations.
 *
 * GET    → load a document (full JSON)
 * PUT    → save/update a document
 * DELETE → delete a document
 *
 * Auth: master_admin or rfp_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { putObject, getObjectBuffer, deleteObject } from '@/lib/storage/s3-client';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

// ─── Types ─────────────────────────────────────────────────────────────

interface DocumentMeta {
  id: string;
  title: string;
  description: string;
  formatPreset: string;
  format: string;
  nodeCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const INDEX_KEY = 'reference/documents/_index.json';

// ─── Index helpers ─────────────────────────────────────────────────────

async function loadIndex(): Promise<DocumentMeta[]> {
  try {
    const buf = await getObjectBuffer(INDEX_KEY);
    if (!buf) return [];
    return JSON.parse(buf.toString('utf8'));
  } catch {
    return [];
  }
}

async function saveIndex(index: DocumentMeta[]): Promise<void> {
  await putObject({
    key: INDEX_KEY,
    body: Buffer.from(JSON.stringify(index, null, 2)),
    contentType: 'application/json',
  });
}

// ─── Auth helper ───────────────────────────────────────────────────────

async function checkAdmin(): Promise<
  | { ok: true; email: string }
  | { ok: false; response: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      ),
    };
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      ),
    };
  }
  const email = (session.user as { email?: string }).email || 'unknown';
  return { ok: true, email };
}

// ─── GET — load a document ─────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const authResult = await checkAdmin();
    if (!authResult.ok) return authResult.response;

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const docKey = `reference/documents/${documentId}.json`;
    const buf = await getObjectBuffer(docKey);
    if (!buf) {
      return NextResponse.json(
        { error: 'Document not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    let document: CanvasDocument;
    try {
      document = JSON.parse(buf.toString('utf8'));
    } catch {
      return NextResponse.json(
        { error: 'Document file is corrupted', code: 'INTERNAL_ERROR' },
        { status: 500 },
      );
    }

    // Find the meta entry from index
    const index = await loadIndex();
    const meta = index.find(m => m.id === documentId) || null;

    return NextResponse.json({ data: { document, meta } });
  } catch (err) {
    console.error('[admin/documents/[id]] GET error', err);
    return NextResponse.json(
      { error: 'Failed to load document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

// ─── PUT — save a document ─────────────────────────────────────────────

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const authResult = await checkAdmin();
    if (!authResult.ok) return authResult.response;

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let body: { document?: CanvasDocument };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const { document } = body;
    if (!document || typeof document !== 'object') {
      return NextResponse.json(
        { error: 'document object is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Save full document to S3
    const docKey = `reference/documents/${documentId}.json`;
    await putObject({
      key: docKey,
      body: Buffer.from(JSON.stringify(document, null, 2)),
      contentType: 'application/json',
    });

    // Update index entry
    const now = new Date().toISOString();
    const index = await loadIndex();
    const idx = index.findIndex(m => m.id === documentId);
    if (idx >= 0) {
      index[idx].title = document.metadata?.title || index[idx].title;
      index[idx].nodeCount = document.nodes?.length || 0;
      index[idx].updatedAt = now;
    }
    await saveIndex(index);

    return NextResponse.json({
      data: { id: documentId, version: document.metadata?.version_number || 1 },
    });
  } catch (err) {
    console.error('[admin/documents/[id]] PUT error', err);
    return NextResponse.json(
      { error: 'Failed to save document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

// ─── DELETE — delete a document ────────────────────────────────────────

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const authResult = await checkAdmin();
    if (!authResult.ok) return authResult.response;

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Delete from S3
    const docKey = `reference/documents/${documentId}.json`;
    await deleteObject(docKey);

    // Remove from index
    const index = await loadIndex();
    const filtered = index.filter(m => m.id !== documentId);
    await saveIndex(filtered);

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[admin/documents/[id]] DELETE error', err);
    return NextResponse.json(
      { error: 'Failed to delete document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
