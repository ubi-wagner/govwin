/**
 * GET    /api/portal/[tenantSlug]/library/[unitId]  — Fetch one library unit
 * PATCH  /api/portal/[tenantSlug]/library/[unitId]  — Update a library unit
 * DELETE /api/portal/[tenantSlug]/library/[unitId]  — Delete a library unit (blocked for seminal)
 * POST   /api/portal/[tenantSlug]/library/[unitId]  — Re-atomize a seminal document
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { readDocx } from '@/lib/import/docx-reader';
import { readPptx } from '@/lib/import/pptx-reader';
import { readPdf } from '@/lib/import/pdf-reader';
import { readText } from '@/lib/import/text-reader';
import type { ImportResult } from '@/lib/import/types';
import type { CanvasNode, HeadingContent, TextBlockContent, ListContent } from '@/lib/types/canvas-document';

type RouteParams = { params: Promise<{ tenantSlug: string; unitId: string }> };

/** Shared auth + tenant verification, returns context or an error response. */
async function authorize(request: Request, { params }: RouteParams, minRole: Role) {
  try {
    const { tenantSlug, unitId } = await params;

    if (!isValidUUID(unitId)) {
      return { error: NextResponse.json({ error: 'Invalid unit id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
    }

    const session = await auth();
    if (!session?.user) {
      return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
    }

    if (!hasRoleAtLeast(role, minRole)) {
      return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
    }

    return { tenantId, unitId, role, userId: sessionUser.id };
  } catch (err) {
    console.error('[library/unit/authorize] error', err);
    return { error: NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 }) };
  }
}

export async function GET(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_user');
  if ('error' in ctx) return ctx.error;

  try {
    const [unit] = await sql`
      SELECT * FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (!unit) {
      return NextResponse.json(
        { error: 'Library unit not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    return NextResponse.json({ data: unit });
  } catch (err) {
    console.error('[library/unit/get] DB query failed', err);
    return NextResponse.json(
      { error: 'Failed to fetch library unit', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_user');
  if ('error' in ctx) return ctx.error;

  // ---------- Parse body ----------
  let body: {
    content?: string;
    category?: string;
    subcategory?: string;
    tags?: string[];
    status?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // ---------- Validate ----------
  const allowedFields = ['content', 'category', 'subcategory', 'tags', 'status'];
  const updates: Array<ReturnType<typeof sql>> = [];

  if (body.content !== undefined) {
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.push(sql`content = ${body.content}`);
  }

  if (body.category !== undefined) {
    if (typeof body.category !== 'string') {
      return NextResponse.json({ error: 'category must be a string', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.push(sql`category = ${body.category}`);
  }

  if (body.subcategory !== undefined) {
    if (typeof body.subcategory !== 'string') {
      return NextResponse.json({ error: 'subcategory must be a string', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.push(sql`subcategory = ${body.subcategory}`);
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) {
      return NextResponse.json({ error: 'tags must be an array', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    updates.push(sql`tags = ${sql.array(body.tags)}`);
  }

  if (body.status !== undefined) {
    if (!['draft', 'approved', 'archived'].includes(body.status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be one of: draft, approved, archived', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Validate status transition: fetch current status
    try {
      const [current] = await sql<{ status: string }[]>`
        SELECT status FROM library_units
        WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
      `;
      if (!current) {
        return NextResponse.json(
          { error: 'Library unit not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      const from = current.status;
      const to = body.status;
      // Allowed transitions:
      //   approved -> archived, archived -> approved, draft -> approved,
      //   approved -> draft, any -> archived, archived -> approved
      const allowed =
        to === 'archived' ||                         // any -> archived
        (from === 'archived' && to === 'approved') || // restore
        (from === 'draft' && to === 'approved') ||    // accept
        (from === 'approved' && to === 'draft');      // send back
      if (!allowed) {
        return NextResponse.json(
          { error: `Cannot transition from '${from}' to '${to}'`, code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
    } catch (err) {
      console.error('[library/unit/patch] Status transition check failed', err);
      return NextResponse.json(
        { error: 'Failed to validate status transition', code: 'DB_ERROR' },
        { status: 500 },
      );
    }

    updates.push(sql`status = ${body.status}`);
  }

  // Check that at least one valid field was provided
  const providedKeys = Object.keys(body).filter((k) => allowedFields.includes(k));
  if (providedKeys.length === 0) {
    return NextResponse.json(
      { error: `No valid fields to update. Allowed: ${allowedFields.join(', ')}`, code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  // Always update the timestamp
  updates.push(sql`updated_at = now()`);

  // ── Start event for library unit update ──────────────────────────
  const patchStartId = await emitEventStart({
    namespace: 'library',
    type: 'unit.updated',
    actor: { type: 'user', id: ctx.userId },
    tenantId: ctx.tenantId,
    payload: { unitId: ctx.unitId, updatedFields: providedKeys },
  });

  // ---------- Execute ----------
  try {
    const setClause = updates.reduce(
      (acc, fragment, i) => (i === 0 ? fragment : sql`${acc}, ${fragment}`),
    );

    const result = await sql`
      UPDATE library_units
      SET ${setClause}
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (result.count === 0) {
      await emitEventEnd(patchStartId, { error: { message: 'Library unit not found', code: 'NOT_FOUND' } });
      return NextResponse.json(
        { error: 'Library unit not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    await emitEventEnd(patchStartId, {
      result: { correlationId: randomUUID(), unitId: ctx.unitId, updatedFields: providedKeys },
    });

    return NextResponse.json({ data: { updated: true } });
  } catch (err) {
    console.error('[library/unit/patch] DB update failed', err);
    await emitEventEnd(patchStartId, { error: { message: String(err), code: 'DB_ERROR' } });
    return NextResponse.json(
      { error: 'Failed to update library unit', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_admin');
  if ('error' in ctx) return ctx.error;

  // ── Start event for library unit deletion ──────────────────────
  const deleteStartId = await emitEventStart({
    namespace: 'library',
    type: 'unit.deleted',
    actor: { type: 'user', id: ctx.userId },
    tenantId: ctx.tenantId,
    payload: { unitId: ctx.unitId },
  });

  try {
    // Check if this is a seminal unit — seminal units cannot be deleted
    const [unit] = await sql<{ isSeminal: boolean | null }[]>`
      SELECT is_seminal FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (!unit) {
      await emitEventEnd(deleteStartId, { error: { message: 'Library unit not found', code: 'NOT_FOUND' } });
      return NextResponse.json(
        { error: 'Library unit not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (unit.isSeminal) {
      await emitEventEnd(deleteStartId, { error: { message: 'Cannot delete seminal documents', code: 'FORBIDDEN' } });
      return NextResponse.json(
        { error: 'Cannot delete original documents. Archive them instead.', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const result = await sql`
      DELETE FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (result.count === 0) {
      await emitEventEnd(deleteStartId, { error: { message: 'Library unit not found', code: 'NOT_FOUND' } });
      return NextResponse.json(
        { error: 'Library unit not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    await emitEventEnd(deleteStartId, {
      result: { correlationId: randomUUID(), unitId: ctx.unitId },
    });

    return NextResponse.json({ data: { deleted: true } });
  } catch (err) {
    console.error('[library/unit/delete] DB delete failed', err);
    await emitEventEnd(deleteStartId, { error: { message: String(err), code: 'STORAGE_ERROR' } });
    return NextResponse.json(
      { error: 'Failed to delete library unit', code: 'STORAGE_ERROR' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// POST — Re-atomize a seminal document
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  routeParams: RouteParams,
) {
  const ctx = await authorize(request, routeParams, 'tenant_admin');
  if ('error' in ctx) return ctx.error;

  // Parse body
  let body: { action?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  if (body.action !== 'reatomize') {
    return NextResponse.json(
      { error: 'Unknown action. Supported: reatomize', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }

  try {
    // 1. Fetch the seminal unit
    const [unit] = await sql<{
      id: string;
      isSeminal: boolean | null;
      sourceStorageKey: string | null;
      sourceFilename: string | null;
      tenantId: string;
    }[]>`
      SELECT id, is_seminal, source_storage_key, source_filename, tenant_id
      FROM library_units
      WHERE id = ${ctx.unitId}::uuid AND tenant_id = ${ctx.tenantId}::uuid
    `;

    if (!unit) {
      return NextResponse.json(
        { error: 'Library unit not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (!unit.isSeminal) {
      return NextResponse.json(
        { error: 'Re-atomization is only available for original (seminal) documents', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!unit.sourceStorageKey) {
      return NextResponse.json(
        { error: 'No source file stored for this document', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // 2. Start event
    const eventId = await emitEventStart({
      namespace: 'library',
      type: 'document.reatomized',
      actor: userActor(ctx.userId),
      tenantId: ctx.tenantId,
      payload: { unitId: ctx.unitId },
    });

    // 3. Archive all existing child atoms
    try {
      await sql`
        UPDATE library_units
        SET status = 'archived', updated_at = now()
        WHERE parent_unit_id = ${ctx.unitId}::uuid
          AND tenant_id = ${ctx.tenantId}::uuid
          AND status != 'archived'
      `;
    } catch (err) {
      console.error('[library/unit/reatomize] archive child atoms failed:', err);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // 4. Re-read the original file from S3
    let fileBytes: Buffer | null = null;
    try {
      fileBytes = (await getObjectBuffer(unit.sourceStorageKey)) as Buffer | null;
    } catch (err) {
      console.error(`[reatomize] S3 fetch failed for ${unit.sourceStorageKey}`, err);
      await emitEventEnd(eventId, { result: { error: 'S3 fetch failed' } });
      return NextResponse.json(
        { error: 'Failed to retrieve original file from storage', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    if (!fileBytes || fileBytes.length === 0) {
      await emitEventEnd(eventId, { result: { error: 'Empty file' } });
      return NextResponse.json(
        { error: 'Original file is empty or missing', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    // 5. Determine format and re-run the reader
    const filename = unit.sourceFilename ?? 'document';
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';

    let importResult: ImportResult;
    try {
      switch (ext) {
        case 'docx':
        case 'doc':
          importResult = await readDocx(fileBytes, filename);
          break;
        case 'pptx':
        case 'ppt':
          importResult = await readPptx(fileBytes, filename);
          break;
        case 'pdf':
          importResult = await readPdf(fileBytes, filename);
          break;
        case 'txt':
        case 'md':
          importResult = await readText(fileBytes, filename);
          break;
        default:
          importResult = await readText(fileBytes, filename);
          break;
      }
    } catch (err) {
      console.error(`[reatomize] Reader failed for ${unit.sourceStorageKey}`, err);
      await emitEventEnd(eventId, { result: { error: 'Reader failed' } });
      return NextResponse.json(
        { error: 'Document re-processing failed', code: 'PROCESSING_ERROR' },
        { status: 500 },
      );
    }

    // 6. Build full text and update the parent
    const fullText = importResult.atoms
      .map((atom) => atom.nodes.map(getNodeText).join('\n'))
      .join('\n\n');

    try {
      await sql`
        UPDATE library_units
        SET content = ${fullText.slice(0, 100000)},
            document_metadata = ${sql.json(importResult.metadata as Parameters<typeof sql.json>[0])},
            updated_at = now()
        WHERE id = ${ctx.unitId}::uuid
      `;
    } catch (err) {
      console.error('[library/unit/reatomize] parent unit update failed:', err);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // Resolve the acting user once — child atoms carry author + gen-1 lineage.
    let authorName: string | null = null;
    try {
      const [u] = await sql<{ name: string | null }[]>`
        SELECT name FROM users WHERE id = ${ctx.userId}::uuid LIMIT 1
      `;
      authorName = u?.name ?? null;
    } catch {
      // non-critical
    }

    // 7. Create new child atoms
    let atomsCreated = 0;
    for (const atom of importResult.atoms) {
      const atomContent = atom.nodes.map(getNodeText).join('\n').trim();
      if (!atomContent) continue;

      const atomType = getAtomType(atom);

      try {
        await sql`
          INSERT INTO library_units
            (tenant_id, content, category, tags, status, source_type, source_id,
             parent_unit_id, canvas_nodes, document_metadata, meta, source_filename,
             source_storage_key, heading_text, char_offset, char_length)
          VALUES
            (${ctx.tenantId}::uuid,
             ${atomContent.slice(0, 50000)},
             ${atom.suggestedCategory},
             ${sql.array(atom.suggestedTags)}::text[],
             'draft',
             'upload',
             ${atomType},
             ${ctx.unitId}::uuid,
             ${sql.json(atom.nodes as unknown as Parameters<typeof sql.json>[0])},
             ${sql.json(importResult.metadata as Parameters<typeof sql.json>[0])},
             ${sql.json({ authorUserId: ctx.userId, authorName, lineage: { parentUnitId: ctx.unitId, rootUnitId: ctx.unitId, generation: 1 } })},
             ${importResult.sourceFilename},
             ${unit.sourceStorageKey},
             ${atom.headingText},
             ${atom.charOffset},
             ${atom.charLength})
        `;
      } catch (err) {
        console.error(`[library/unit/reatomize] child atom insert failed:`, err);
        continue;
      }
      atomsCreated++;
    }

    await emitEventEnd(eventId, {
      result: { atomsCreated, sourceFilename: filename },
    });

    return NextResponse.json({
      data: {
        reatomized: true,
        atomsCreated,
        sourceFilename: filename,
      },
    });
  } catch (err) {
    console.error('[library/unit/reatomize] Unexpected error', err);
    return NextResponse.json(
      { error: 'Re-atomization failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers (duplicated from atomize route for independence)
// ---------------------------------------------------------------------------

/** Extract plain text from a CanvasNode for content storage. */
function getNodeText(node: CanvasNode): string {
  if (!node.content) return '';
  switch (node.type) {
    case 'heading': return (node.content as HeadingContent).text;
    case 'text_block': return (node.content as TextBlockContent).text;
    case 'bulleted_list':
    case 'numbered_list':
      return (node.content as ListContent).items.map((i) => i.text).join('\n');
    default: return '';
  }
}

/** Determine the primary type of an atom based on its node composition. */
function getAtomType(atom: { nodes: CanvasNode[] }): string {
  if (atom.nodes.length === 0) return 'empty';
  const types = atom.nodes.map((n) => n.type);
  if (types.includes('heading')) return 'section';
  if (types.some((t) => t === 'bulleted_list' || t === 'numbered_list')) return 'list';
  return 'paragraph';
}
