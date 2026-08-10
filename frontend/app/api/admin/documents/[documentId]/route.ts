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
import { putObject, getObjectBuffer, deleteObject, listObjects } from '@/lib/storage/s3-client';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

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
  | { ok: true; email: string; userId: string }
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
  const userId = (session.user as { id?: string }).id || 'unknown';
  return { ok: true, email, userId };
}

// ─── GET — load a document ─────────────────────────────────────────────

export async function GET(
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

    const { searchParams } = request.nextUrl;

    // If ?history is present, return save history
    if (searchParams.has('history')) {
      const historyPrefix = `reference/documents/${documentId}/history/`;
      const { objects } = await listObjects(historyPrefix, '/');
      const history = objects.map(o => ({
        key: o.key,
        timestamp: parseInt(o.key.split('/').pop()?.replace('.json', '') || '0'),
        size: o.size,
      })).sort((a, b) => b.timestamp - a.timestamp);
      return NextResponse.json({ data: { history } });
    }

    // If ?version=<key> is present, load a specific history version
    const versionKey = searchParams.get('version');
    if (versionKey) {
      const buf = await getObjectBuffer(versionKey);
      if (!buf) {
        return NextResponse.json(
          { error: 'Version not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      const document = JSON.parse(buf.toString('utf8'));
      return NextResponse.json({ data: { document } });
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

    // Return the real actor so the editor stamps provenance/history to the signed-in
    // admin (was hard-coded "Admin") and can key its local autosave draft.
    return NextResponse.json({ data: { document, meta, actor: { id: authResult.userId, name: authResult.email } } });
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

    // ── Start event ────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'document.saved',
      actor: userActor(authResult.userId, authResult.email),
      tenantId: null,
      payload: { documentId, title: document.metadata?.title ?? null },
    });

    // Save previous version to history
    const docKey = `reference/documents/${documentId}.json`;
    const currentBuf = await getObjectBuffer(docKey);
    if (currentBuf) {
      const historyKey = `reference/documents/${documentId}/history/${Date.now()}.json`;
      await putObject({
        key: historyKey,
        body: currentBuf,
        contentType: 'application/json',
      });
    }

    // Save full document to S3
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

    await emitEventEnd(startId, {
      result: { documentId, version: document.metadata?.version_number ?? 1 },
    });

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

    // ── Start event ────────────────────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'finder',
      type: 'document.deleted',
      actor: userActor(authResult.userId, authResult.email),
      tenantId: null,
      payload: { documentId },
    });

    // Delete from S3
    const docKey = `reference/documents/${documentId}.json`;
    await deleteObject(docKey);

    // Remove from index
    const index = await loadIndex();
    const filtered = index.filter(m => m.id !== documentId);
    await saveIndex(filtered);

    await emitEventEnd(startId, {
      result: { documentId, deleted: true },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[admin/documents/[id]] DELETE error', err);
    return NextResponse.json(
      { error: 'Failed to delete document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
