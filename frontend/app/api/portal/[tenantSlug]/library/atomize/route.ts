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
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { emitEventSingle } from '@/lib/events';
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
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const sessionUser = session.user as {
    id?: string;
    role?: unknown;
    tenantId?: string | null;
  };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  if (!hasRoleAtLeast(role, 'tenant_user')) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { tenantSlug } = await ctx.params;

  // Resolve tenant
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantId = tenant.id as string;

  const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
  if (!hasAccess) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Find pending library units
  // Actual columns: id, tenant_id, content, category, subcategory, tags,
  //   embedding, confidence, status, source_type, source_id, usage_count,
  //   parent_unit_id, created_at, updated_at (plus 017 migration columns)
  const pending = await sql<{
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

  if (pending.length === 0) {
    return NextResponse.json({ data: { atomized: 0, atomsCreated: 0, atoms: [], message: 'No pending documents' } });
  }

  const userId = sessionUser.id;
  let atomized = 0;
  let totalAtomsCreated = 0;
  const allAtomInfo: Array<{ id: string; category: string; headingText: string | null; charLength: number }> = [];

  for (const unit of pending) {
    // Storage key: check source_id column (upload route stores it there)
    const storageKey = unit.sourceId;
    if (!storageKey) {
      await sql`UPDATE library_units SET status = 'archived', content = '[no storage key]' WHERE id = ${unit.id}::uuid`;
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
      await sql`UPDATE library_units SET status = 'archived', content = '[empty file]' WHERE id = ${unit.id}::uuid`;
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
      await sql`UPDATE library_units SET status = 'archived', content = '[extraction failed]' WHERE id = ${unit.id}::uuid`;
      continue;
    }

    // Build full extracted text from all atoms for the parent row
    const fullText = importResult.atoms
      .map((atom) => atom.nodes.map(getNodeText).join('\n'))
      .join('\n\n');

    // Update the parent unit with the full extracted text and metadata
    await sql`
      UPDATE library_units
      SET content = ${fullText.slice(0, 100000)},
          status = 'approved',
          updated_at = now()
      WHERE id = ${unit.id}::uuid
    `;
    atomized++;

    // Create child atoms
    for (const atom of importResult.atoms) {
      const atomContent = atom.nodes.map(getNodeText).join('\n').trim();
      if (!atomContent) continue;

      const atomMetadata = {
        parent_unit_id: unit.id,
        source_filename: importResult.sourceFilename,
        atom_type: getAtomType(atom),
        heading_text: atom.headingText,
        char_offset: atom.charOffset,
        canvas_nodes: atom.nodes,
        document_metadata: importResult.metadata,
      };

      const [row] = await sql<{ id: string }[]>`
        INSERT INTO library_units
          (tenant_id, content, category, tags, status, source_type, source_id, parent_unit_id)
        VALUES
          (${tenantId}::uuid,
           ${atomContent.slice(0, 50000)},
           ${atom.suggestedCategory},
           ${sql.array(atom.suggestedTags)}::text[],
           'draft',
           'atom',
           ${JSON.stringify(atomMetadata)},
           ${unit.id}::uuid)
        RETURNING id
      `;

      totalAtomsCreated++;
      allAtomInfo.push({
        id: row.id,
        category: atom.suggestedCategory,
        headingText: atom.headingText,
        charLength: atom.charLength,
      });
    }
  }

  await emitEventSingle({
    namespace: 'library',
    type: 'batch_atomized',
    actor: { type: 'user', id: userId ?? 'unknown' },
    tenantId,
    payload: { documentsAtomized: atomized, atomsCreated: totalAtomsCreated },
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
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
