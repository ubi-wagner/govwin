/**
 * PUT /api/admin/proposals/[proposalId]/sections/[sectionId]
 *
 * Saves the canvas document JSON to proposal_sections.content.
 * Creates a canvas_versions row for revert capability.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle } from '@/lib/events';

interface RouteContext {
  params: Promise<{ proposalId: string; sectionId: string }>;
}

export async function PUT(request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
  }
  const userId = (session.user as { id?: string }).id;

  const { proposalId, sectionId } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }
  const content = body?.content;

  if (!content || typeof content !== 'object') {
    return NextResponse.json({ error: 'content (CanvasDocument JSON) required', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    const current = await sql<{ content: unknown }[]>`
      SELECT content FROM proposal_sections
      WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid
    `;
    if (current.length === 0) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const versionNumber = (content as { metadata?: { version_number?: number } })?.metadata?.version_number ?? 1;

    await sql`
      UPDATE proposal_sections
      SET content = ${JSON.stringify(content)}::jsonb,
          status = 'in_progress',
          updated_at = now()
      WHERE id = ${sectionId}::uuid
    `;

    try {
      await sql`
        INSERT INTO canvas_versions (section_id, version_number, content, created_by, snapshot_reason)
        VALUES (${sectionId}::uuid, ${versionNumber}, ${JSON.stringify(content)}::jsonb, ${userId ?? null}::uuid, 'auto_save')
        ON CONFLICT (section_id, version_number) DO UPDATE SET
          content = EXCLUDED.content,
          created_at = now()
      `;
    } catch (err) {
      console.error('[canvas-save] version snapshot failed (non-fatal)', err);
    }

    await emitEventSingle({
      namespace: 'capture',
      type: 'proposal.section.saved',
      actor: { type: 'user', id: userId ?? 'unknown', email: (session.user as { email?: string }).email ?? undefined },
      payload: {
        proposalId,
        sectionId,
        versionNumber,
        nodeCount: Array.isArray((content as { nodes?: unknown[] })?.nodes) ? (content as { nodes: unknown[] }).nodes.length : 0,
      },
    });

    return NextResponse.json({ data: { saved: true, versionNumber } });
  } catch (err) {
    console.error('[admin/canvas-save] failed', err);
    return NextResponse.json({ error: 'Failed to save section', code: 'DB_ERROR' }, { status: 500 });
  }
}
