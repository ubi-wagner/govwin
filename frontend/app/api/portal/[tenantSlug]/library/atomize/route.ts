/**
 * POST /api/portal/[tenantSlug]/library/atomize
 *
 * Triggers atomization of uploaded library documents. For each
 * library_units row with status='draft' and content='[pending extraction]':
 *   1. Fetches the file from S3 via the source_id column (storage key)
 *   2. Determines format from the file extension (stored in tags array)
 *   3. Calls the appropriate format-aware reader (docx/pptx/pdf/txt/md)
 *   4. Creates one library_units row per atom with structured content
 *   5. Updates the parent row with extracted text, sets status to 'approved'
 *   6. Returns atom info so the frontend can redirect to the review page
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { readDocx } from '@/lib/import/docx-reader';
import { readPptx } from '@/lib/import/pptx-reader';
import { readPdf } from '@/lib/import/pdf-reader';
import { readText } from '@/lib/import/text-reader';
import type { ImportResult, ImportedAtom } from '@/lib/import/types';
import type { CanvasNode, HeadingContent, TextBlockContent, ListContent } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
  }

  const { tenantSlug } = await ctx.params;

  // Resolve tenant
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
  }

  // Parse optional fileIds from request body to scope atomization
  let fileIds: string[] | null = null;
  try {
    const body = await request.json();
    if (Array.isArray(body?.fileIds) && body.fileIds.length > 0) {
      const valid = body.fileIds.filter(
        (id: unknown) => typeof id === 'string' && isValidUUID(id),
      ) as string[];
      if (valid.length === 0) {
        // The caller scoped to specific ids but none were valid UUIDs — reject
        // explicitly rather than silently broadening to "atomize ALL pending".
        return NextResponse.json(
          { error: 'fileIds contained no valid ids', code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      fileIds = valid;
    }
  } catch {
    // No body or invalid JSON — atomize all pending (backwards compatible)
  }

  // Find pending library units
  // Actual columns: id, tenant_id, content, category, subcategory, tags,
  //   embedding, confidence, status, source_type, source_id, usage_count,
  //   parent_unit_id, created_at, updated_at (plus 017 migration columns)
  let pending: {
    id: string;
    sourceId: string | null;
    tags: string[] | null;
  }[];
  try {
    pending = fileIds
      ? await sql<{
          id: string;
          sourceId: string | null;
          tags: string[] | null;
        }[]>`
          SELECT id, source_id, tags
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'draft'
            AND content = '[pending extraction]'
            AND id = ANY(${fileIds}::uuid[])
          ORDER BY created_at ASC
          LIMIT 20
        `
      : await sql<{
          id: string;
          sourceId: string | null;
          tags: string[] | null;
        }[]>`
          SELECT id, source_id, tags
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'draft'
            AND content = '[pending extraction]'
          ORDER BY created_at ASC
          LIMIT 20
        `;
  } catch (e) {
    console.error('[library/atomize] pending query failed:', e);
    return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
  }

  if (pending.length === 0) {
    return NextResponse.json({ data: { atomized: 0, atomsCreated: 0, atoms: [], message: 'No pending documents' } });
  }

  const userId = sessionUser.id;

  // ── Start event for multi-step atomization ─────────────────────
  const eventId = await emitEventStart({
    namespace: 'library',
    type: 'document.atomized',
    actor: userActor(userId),
    tenantId,
    payload: { pendingCount: pending.length },
  });

  let atomized = 0;
  let totalAtomsCreated = 0;
  const allAtomInfo: Array<{ id: string; category: string; headingText: string | null; charLength: number }> = [];

  for (const unit of pending) {
    // Storage key: check source_id column (upload route stores it there)
    const storageKey = unit.sourceId;
    if (!storageKey) {
      try {
        await sql`UPDATE library_units SET status = 'archived', content = '[no storage key]' WHERE id = ${unit.id}::uuid`;
      } catch (e) {
        console.error('[library/atomize] archive no-key unit failed:', e);
      }
      continue;
    }

    // Determine file extension from tags array (first element) or from the storage key path
    let ext = '';
    if (unit.tags && unit.tags.length > 0) {
      // The upload route stores the extension as the first tag
      const firstTag = unit.tags[0].toLowerCase();
      if (/^[a-z0-9]+$/.test(firstTag)) {
        ext = firstTag;
      }
    }
    if (!ext) {
      // Fallback: extract extension from the storage key path
      const keyExt = storageKey.split('.').pop()?.toLowerCase() ?? '';
      if (/^[a-z0-9]+$/.test(keyExt)) {
        ext = keyExt;
      }
    }

    // Fetch the file from S3
    let fileBytes: Buffer | null = null;
    try {
      fileBytes = (await getObjectBuffer(storageKey)) as Buffer | null;
    } catch (err) {
      console.error(`[atomize] S3 fetch failed for ${storageKey}`, err);
      continue;
    }

    if (!fileBytes || fileBytes.length === 0) {
      try {
        await sql`UPDATE library_units SET status = 'archived', content = '[empty file]' WHERE id = ${unit.id}::uuid`;
      } catch (e) {
        console.error('[library/atomize] archive empty-file unit failed:', e);
      }
      continue;
    }

    // Determine the original filename from the storage key for the reader
    const sourceFilename = storageKey.split('/').pop() ?? `document.${ext}`;

    // Call the appropriate format-aware reader
    let importResult: ImportResult;
    try {
      switch (ext) {
        case 'docx':
        case 'doc':
          importResult = await readDocx(fileBytes, sourceFilename);
          break;
        case 'pptx':
        case 'ppt':
          importResult = await readPptx(fileBytes, sourceFilename);
          break;
        case 'pdf':
          importResult = await readPdf(fileBytes, sourceFilename);
          break;
        case 'txt':
        case 'md':
          importResult = await readText(fileBytes, sourceFilename);
          break;
        default:
          // Unknown format — try as plain text
          importResult = await readText(fileBytes, sourceFilename);
          break;
      }
    } catch (err) {
      console.error(`[atomize] Reader failed for ${storageKey} (ext=${ext})`, err);
      try {
        await sql`UPDATE library_units SET status = 'archived', content = '[extraction failed]' WHERE id = ${unit.id}::uuid`;
      } catch (dbErr) {
        console.error('[library/atomize] archive extraction-failed unit failed:', dbErr);
      }
      continue;
    }

    // Build full extracted text from all atoms for the parent row
    const fullText = importResult.atoms
      .map((atom) => atom.nodes.map(getNodeText).join('\n'))
      .join('\n\n');

    // Mark the parent unit as seminal and update with full extracted text + metadata
    try {
      await sql`
        UPDATE library_units
        SET content = ${fullText.slice(0, 100000)},
            status = 'approved',
            is_seminal = true,
            source_filename = ${sourceFilename},
            source_storage_key = ${storageKey},
            document_metadata = ${JSON.stringify(importResult.metadata)}::jsonb,
            updated_at = now()
        WHERE id = ${unit.id}::uuid
      `;
    } catch (dbErr) {
      console.error(`[library/atomize] parent unit update failed for ${unit.id}:`, dbErr);
      continue;
    }
    atomized++;

    // Create child atoms with structured storage
    for (const atom of importResult.atoms) {
      const atomContent = atom.nodes.map(getNodeText).join('\n').trim();
      if (!atomContent) continue;

      const atomType = getAtomType(atom);

      let row: { id: string };
      try {
        [row] = await sql<{ id: string }[]>`
          INSERT INTO library_units
            (tenant_id, content, category, tags, status, source_type, source_id,
             parent_unit_id, canvas_nodes, document_metadata, source_filename,
             source_storage_key, heading_text, char_offset, char_length)
          VALUES
            (${tenantId}::uuid,
             ${atomContent.slice(0, 50000)},
             ${atom.suggestedCategory},
             ${sql.array(atom.suggestedTags)}::text[],
             'draft',
             'upload',
             ${atomType},
             ${unit.id}::uuid,
             ${JSON.stringify(atom.nodes)}::jsonb,
             ${JSON.stringify(importResult.metadata)}::jsonb,
             ${importResult.sourceFilename},
             ${storageKey},
             ${atom.headingText},
             ${atom.charOffset},
             ${atom.charLength})
          RETURNING id
        `;
      } catch (dbErr) {
        console.error(`[library/atomize] atom insert failed for unit ${unit.id}:`, dbErr);
        continue;
      }

      totalAtomsCreated++;
      allAtomInfo.push({
        id: row.id,
        category: atom.suggestedCategory,
        headingText: atom.headingText,
        charLength: atom.charLength,
      });
    }
  }

  await emitEventEnd(eventId, {
    result: { documentsAtomized: atomized, atomsCreated: totalAtomsCreated },
  });

  return NextResponse.json({
    data: {
      atomized,
      atomsCreated: totalAtomsCreated,
      atoms: allAtomInfo,
    },
  });
  } catch (err) {
    console.error('[library/atomize] Unexpected error', err);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Helpers
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
function getAtomType(atom: ImportedAtom): string {
  if (atom.nodes.length === 0) return 'empty';
  const types = atom.nodes.map((n) => n.type);
  if (types.includes('heading')) return 'section';
  if (types.some((t) => t === 'bulleted_list' || t === 'numbered_list')) return 'list';
  return 'paragraph';
}
