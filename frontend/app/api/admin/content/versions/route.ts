/**
 * Version history API for CMS content blocks.
 *
 * GET  ?id={blockId}          — Returns version history for a block
 * POST { id, version }        — Revert a block to a specific version
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

// ─── GET: version history for a block ─────────────────────────────────

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing required param: id', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const [row] = await sql<{ metadata: Record<string, unknown> }[]>`
      SELECT metadata FROM cms_content WHERE id = ${id} LIMIT 1
    `;

    if (!row) {
      return NextResponse.json({ error: 'Block not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const versions = Array.isArray(meta._versions) ? meta._versions : [];
    const currentVersion = typeof meta._currentVersion === 'number' ? meta._currentVersion : 0;

    return NextResponse.json({
      data: {
        currentVersion,
        versions,
      },
    });
  } catch (e) {
    console.error('[api/admin/content/versions GET] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ─── POST: revert to a specific version ──────────────────────────────

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const userId = (session.user as { id?: string }).id;
    if (!userId) {
      return NextResponse.json({ error: 'Missing user id in session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const userEmail = (session.user as { email?: string }).email;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const id = typeof body.id === 'string' ? body.id.trim() : '';
    const targetVersion = typeof body.version === 'number' ? body.version : -1;

    if (!id) {
      return NextResponse.json({ error: 'Missing required field: id', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (targetVersion < 0) {
      return NextResponse.json({ error: 'Missing or invalid version number', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // Read current block
    const [current] = await sql<{
      id: string;
      title: string;
      body: string;
      excerpt: string | null;
      featuredImage: string | null;
      displayOrder: number;
      metadata: Record<string, unknown>;
    }[]>`
      SELECT id, title, body, excerpt, featured_image, display_order, metadata
      FROM cms_content
      WHERE id = ${id}
      LIMIT 1
    `;

    if (!current) {
      return NextResponse.json({ error: 'Block not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const meta = (current.metadata ?? {}) as Record<string, unknown>;
    const versions = Array.isArray(meta._versions) ? meta._versions : [];

    // Find the target version in the versions array
    const targetSnapshot = versions.find(
      (v: unknown) => (v as Record<string, unknown>).version === targetVersion
    ) as Record<string, unknown> | undefined;

    if (!targetSnapshot) {
      return NextResponse.json({ error: `Version ${targetVersion} not found`, code: 'NOT_FOUND' }, { status: 404 });
    }

    // Snapshot current state before reverting
    const currentVersion = typeof meta._currentVersion === 'number' ? meta._currentVersion : 0;
    const { _versions: _v, _currentVersion: _cv, ...cleanMeta } = meta;
    void _v;
    void _cv;
    const snapshot = {
      version: currentVersion,
      savedAt: new Date().toISOString(),
      savedBy: userEmail ?? userId,
      title: current.title,
      body: current.body,
      excerpt: current.excerpt,
      featuredImage: current.featuredImage,
      displayOrder: current.displayOrder,
      metadata: cleanMeta,
    };

    const newVersions = [snapshot, ...versions];
    if (newVersions.length > 20) newVersions.length = 20;

    const newVersion = currentVersion + 1;
    const restoredMeta = (targetSnapshot.metadata ?? {}) as Record<string, unknown>;
    const mergedMeta = {
      ...restoredMeta,
      _versions: newVersions,
      _currentVersion: newVersion,
    };

    await sql`
      UPDATE cms_content
      SET title = ${(targetSnapshot.title as string) ?? ''},
          body = ${(targetSnapshot.body as string) ?? ''},
          excerpt = ${(targetSnapshot.excerpt as string | null) ?? null},
          featured_image = ${(targetSnapshot.featuredImage as string | null) ?? null},
          display_order = ${(targetSnapshot.displayOrder as number) ?? 0},
          metadata = ${JSON.stringify(mergedMeta)}::jsonb,
          status = 'draft',
          published = false,
          updated_at = now()
      WHERE id = ${id}
    `;

    return NextResponse.json({
      data: {
        reverted: true,
        toVersion: targetVersion,
        newVersion,
      },
    });
  } catch (e) {
    console.error('[api/admin/content/versions POST] error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
