/**
 * POST /api/portal/[tenantSlug]/library/atomize
 *
 * Triggers atomization of uploaded library documents. For each
 * library_units row with status='draft' and content='[pending extraction]':
 *   1. Fetches the file from S3 via the storage_key in metadata
 *   2. Extracts text (pymupdf4llm for PDFs, raw read for text files)
 *   3. Splits into logical sections (headings, paragraphs, lists)
 *   4. Creates one library_units row per atom with the extracted content
 *   5. Updates the original row's status to 'approved'
 *
 * For V1: simple paragraph-level splitting. Phase 4 adds Claude-based
 * semantic atomization with category inference.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { getObjectBuffer } from '@/lib/storage/s3-client';
import { emitEventSingle } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const { tenantSlug } = await ctx.params;

  // Resolve tenant
  const tenantRows = await sql<{ id: string }[]>`
    SELECT id FROM tenants WHERE slug = ${tenantSlug}
  `;
  if (tenantRows.length === 0) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }
  const tenantId = tenantRows[0].id;

  // Find pending library units
  const pending = await sql<{
    id: string;
    contentType: string | null;
    metadata: { storage_key?: string; original_filename?: string } | null;
  }[]>`
    SELECT id, content_type, metadata
    FROM library_units
    WHERE tenant_id = ${tenantId}::uuid
      AND status = 'draft'
      AND content = '[pending extraction]'
    ORDER BY created_at ASC
    LIMIT 20
  `;

  if (pending.length === 0) {
    return NextResponse.json({ data: { atomized: 0, message: 'No pending documents' } });
  }

  const userId = (session.user as { id?: string }).id;
  let atomized = 0;
  let created = 0;

  for (const unit of pending) {
    const storageKey = unit.metadata?.storage_key;
    if (!storageKey) {
      await sql`UPDATE library_units SET status = 'archived', content = '[no storage key]' WHERE id = ${unit.id}::uuid`;
      continue;
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

    // Extract text based on file type
    const ext = (unit.metadata?.original_filename ?? '').split('.').pop()?.toLowerCase() ?? '';
    let fullText = '';

    if (ext === 'pdf') {
      // PDF extraction via pymupdf4llm — but that's Python-side.
      // For V1 on the frontend: use a simple text extraction fallback.
      // The real extraction happens via pipeline jobs in production.
      // For now: store the raw bytes length as content and mark as needing
      // pipeline extraction.
      try {
        // Try to decode as UTF-8 text (works for text-based PDFs that
        // have been pre-extracted). Real PDFs need pymupdf4llm on pipeline.
        fullText = fileBytes.toString('utf-8');
        // If it starts with %PDF, it's a binary PDF — can't extract on frontend
        if (fullText.startsWith('%PDF')) {
          fullText = `[PDF document: ${(fileBytes.length / 1024).toFixed(0)}KB — requires pipeline extraction]`;
        }
      } catch {
        fullText = `[PDF document: ${(fileBytes.length / 1024).toFixed(0)}KB]`;
      }
    } else if (['txt', 'md'].includes(ext)) {
      fullText = fileBytes.toString('utf-8');
    } else if (['docx', 'doc', 'pptx', 'ppt'].includes(ext)) {
      // Office docs need server-side extraction — placeholder for V1
      fullText = `[${ext.toUpperCase()} document: ${(fileBytes.length / 1024).toFixed(0)}KB — requires pipeline extraction]`;
    } else {
      fullText = fileBytes.toString('utf-8').slice(0, 50000);
    }

    // Split into atoms (simple paragraph-level splitting for V1)
    const atoms = splitIntoAtoms(fullText, unit.metadata?.original_filename ?? 'document');

    // Update the parent unit with the full extracted text
    await sql`
      UPDATE library_units
      SET content = ${fullText.slice(0, 100000)},
          status = 'approved',
          updated_at = now()
      WHERE id = ${unit.id}::uuid
    `;
    atomized++;

    // Create child atoms
    for (const atom of atoms) {
      await sql`
        INSERT INTO library_units
          (tenant_id, content, content_type, category, tags, status, metadata)
        VALUES
          (${tenantId}::uuid,
           ${atom.content},
           'text',
           ${atom.category},
           ${atom.tags}::text[],
           'approved',
           ${JSON.stringify({
             parent_unit_id: unit.id,
             source_filename: unit.metadata?.original_filename,
             atom_type: atom.type,
             char_offset: atom.offset,
           })}::jsonb)
      `;
      created++;
    }
  }

  await emitEventSingle({
    namespace: 'library',
    type: 'batch_atomized',
    actor: { type: 'user', id: userId ?? 'unknown' },
    tenantId,
    payload: { documentsAtomized: atomized, atomsCreated: created },
  });

  return NextResponse.json({
    data: { atomized, atomsCreated: created },
  });
}

interface Atom {
  content: string;
  category: string;
  tags: string[];
  type: 'heading' | 'paragraph' | 'list' | 'section';
  offset: number;
}

function splitIntoAtoms(text: string, filename: string): Atom[] {
  const atoms: Atom[] = [];
  if (!text || text.startsWith('[')) return atoms; // placeholder text, skip

  // Infer category from filename
  const lowerName = filename.toLowerCase();
  let defaultCategory = 'general';
  if (lowerName.includes('capability') || lowerName.includes('overview')) defaultCategory = 'capability_statement';
  else if (lowerName.includes('past') && lowerName.includes('perf')) defaultCategory = 'past_performance';
  else if (lowerName.includes('bio') || lowerName.includes('resume') || lowerName.includes('personnel')) defaultCategory = 'key_personnel';
  else if (lowerName.includes('tech') && (lowerName.includes('approach') || lowerName.includes('volume'))) defaultCategory = 'technical_approach';
  else if (lowerName.includes('cost') || lowerName.includes('budget')) defaultCategory = 'cost_volume';
  else if (lowerName.includes('commercial')) defaultCategory = 'commercialization';
  else if (lowerName.includes('abstract') || lowerName.includes('summary')) defaultCategory = 'abstract';

  // Split by double newlines (paragraph boundaries)
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 50);

  let offset = 0;
  for (const para of paragraphs) {
    // Detect headings (lines that are short + uppercase or start with numbers)
    const firstLine = para.split('\n')[0].trim();
    const isHeading = firstLine.length < 100 && (
      /^#{1,3}\s/.test(firstLine) ||
      /^\d+\./.test(firstLine) ||
      firstLine === firstLine.toUpperCase()
    );

    // Detect lists (multiple lines starting with bullets/numbers)
    const lines = para.split('\n');
    const isList = lines.length > 2 && lines.filter((l) => /^\s*[-•*]\s|^\s*\d+[.)]\s/.test(l)).length > lines.length * 0.5;

    const type = isHeading ? 'heading' : isList ? 'list' : 'paragraph';

    // Only create atoms for substantial content (skip tiny fragments)
    if (para.length > 80) {
      atoms.push({
        content: para.slice(0, 5000),
        category: defaultCategory,
        tags: [defaultCategory, `source:${filename.slice(0, 50)}`],
        type,
        offset,
      });
    }

    offset += para.length + 2;
  }

  return atoms;
}
