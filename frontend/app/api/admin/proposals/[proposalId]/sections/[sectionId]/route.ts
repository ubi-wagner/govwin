/**
 * PUT /api/admin/proposals/[proposalId]/sections/[sectionId]
 *
 * Saves the canvas document JSON to proposal_sections.content.
 * Creates a canvas_versions row for revert capability.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { randomUUID } from 'crypto';
import { emitEventSingle } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';

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
  if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
    return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

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
    const [current] = await sql<{ content: unknown; version: number }[]>`
      SELECT content, version FROM proposal_sections
      WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid
    `;
    if (!current) {
      return NextResponse.json({ error: 'Section not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Number the snapshot from the section's LIVE version counter (NOT client-supplied
    // metadata.version_number, which the editor page hardcodes to 1 — so the old code archived
    // every admin save onto version 1 with DO UPDATE, permanently overwriting the section's v1
    // history and never advancing the counter). Mirror the portal save / lock-section /
    // proposal-advance / land-revisions pattern: archive the CURRENT (pre-save) content at the
    // live version (DO NOTHING — never clobber existing history), then advance the counter so the
    // invariant proposal_sections.version > MAX(canvas_versions.version_number) holds and the next
    // save's archive lands in a free slot.
    const versionNumber = current.version ?? 1;

    try {
      await sql`
        INSERT INTO canvas_versions (section_id, version_number, content, created_by, snapshot_reason)
        VALUES (${sectionId}::uuid, ${versionNumber}, ${sql.json((current.content ?? {}) as Parameters<typeof sql.json>[0])}, ${userId ?? null}::uuid, 'auto_save')
        ON CONFLICT (section_id, version_number) DO NOTHING
      `;
    } catch (err) {
      console.error('[admin/canvas-save] version snapshot failed (non-fatal)', err);
    }

    await sql`
      UPDATE proposal_sections
      SET content = ${JSON.stringify(content)},
          status = 'in_progress',
          version = version + 1,
          updated_at = now()
      WHERE id = ${sectionId}::uuid
    `;

    await emitEventSingle({
      namespace: 'proposal',
      type: 'section.saved',
      actor: { type: 'user', id: userId ?? 'unknown', email: (session.user as { email?: string }).email ?? undefined },
      payload: {
        correlationId: randomUUID(),
        proposalId,
        sectionId,
        versionNumber: versionNumber + 1, // the new live version (snapshot archived the prior at versionNumber)
        nodeCount: Array.isArray((content as { nodes?: unknown[] })?.nodes) ? (content as { nodes: unknown[] }).nodes.length : 0,
      },
    });

    return NextResponse.json({ data: { saved: true, version: versionNumber + 1 } });
  } catch (err) {
    console.error('[admin/canvas-save] failed', err);
    return NextResponse.json({ error: 'Failed to save section', code: 'DB_ERROR' }, { status: 500 });
  }
}
