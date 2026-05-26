/**
 * /api/admin/documents — Admin Document Builder CRUD.
 *
 * Documents are stored as JSON files at `reference/documents/{id}.json` in S3,
 * decoupled from the proposal system. A lightweight index file at
 * `reference/documents/_index.json` stores metadata for fast listing.
 *
 * GET  → list all documents (from index)
 * POST → create a new document from a preset
 *
 * Auth: master_admin or rfp_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { putObject, getObjectBuffer } from '@/lib/storage/s3-client';
import { CANVAS_PRESETS } from '@/lib/types/canvas-document';
import type { CanvasDocument } from '@/lib/types/canvas-document';
import { emitEventSingle, userActor } from '@/lib/events';

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

// ─── GET — list all documents ──────────────────────────────────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const index = await loadIndex();
    return NextResponse.json({ data: index });
  } catch (err) {
    console.error('[admin/documents] GET error', err);
    return NextResponse.json(
      { error: 'Failed to list documents', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}

// ─── POST — create new document ────────────────────────────────────────

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
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    let body: { title?: string; description?: string; preset?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const { title, description, preset } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json(
        { error: 'title is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!preset || typeof preset !== 'string') {
      return NextResponse.json(
        { error: 'preset is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const canvasRules = CANVAS_PRESETS[preset] ?? CANVAS_PRESETS.letter_standard;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const createdBy = (session.user as { email?: string }).email || 'unknown';

    const document: CanvasDocument = {
      version: 1,
      document_id: id,
      canvas: canvasRules,
      nodes: [],
      metadata: {
        title: title.trim(),
        volume_id: '',
        required_item_id: '',
        proposal_id: '',
        solicitation_id: '',
        created_at: now,
        last_modified_at: now,
        last_modified_by: createdBy,
        version_number: 1,
        status: 'empty',
      },
    };

    // Save document to S3
    const docKey = `reference/documents/${id}.json`;
    await putObject({
      key: docKey,
      body: Buffer.from(JSON.stringify(document, null, 2)),
      contentType: 'application/json',
    });

    // Update index
    const index = await loadIndex();
    const meta: DocumentMeta = {
      id,
      title: title.trim(),
      description: description?.trim() || '',
      formatPreset: preset,
      format: canvasRules.format,
      nodeCount: 0,
      createdBy,
      createdAt: now,
      updatedAt: now,
    };
    index.push(meta);
    await saveIndex(index);

    const userId = (session.user as { id?: string }).id;
    try {
      await emitEventSingle({
        namespace: 'finder',
        type: 'document.created',
        actor: userActor(userId ?? 'unknown', createdBy !== 'unknown' ? createdBy : undefined),
        tenantId: null,
        payload: { documentId: id, title: title.trim(), preset },
      });
    } catch (e) {
      console.error('[admin/documents] event emission failed:', e);
    }

    return NextResponse.json({ data: { id, title: title.trim(), preset } }, { status: 201 });
  } catch (err) {
    console.error('[admin/documents] POST error', err);
    return NextResponse.json(
      { error: 'Failed to create document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
