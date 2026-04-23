/**
 * POST /api/admin/rfp-upload
 *
 * Admin-only manual RFP upload. Accepts multipart form data with
 * one or more files + metadata, stores each file to the bucket
 * under `rfp-pipeline/{opp-uuid}/...`, creates the opportunity +
 * curated_solicitations + solicitation_documents rows, and
 * enqueues a shred job so the pipeline extracts text + runs Claude.
 *
 * Form fields (multipart/form-data):
 *   title            — solicitation title (required)
 *   agency           — agency name (required)
 *   office           — program office (optional)
 *   program_type     — sbir_phase_1 | sbir_phase_2 | sttr_phase_1 | ... | cso | baa | ota (required)
 *   solicitation_number — optional
 *   close_date       — ISO 8601 (optional)
 *   posted_date      — ISO 8601 (optional)
 *   description      — short summary (optional)
 *   files[]          — one or more File objects (required, at least 1)
 *
 * Returns: { data: { solicitation_id, opportunity_id, document_ids[] } }
 */

import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { ForbiddenError, UnauthenticatedError } from '@/lib/errors';
import { putObject } from '@/lib/storage/s3-client';
import { rfpPipelinePath } from '@/lib/storage/paths';

// Max aggregate upload size — guards against memory blowout. Individual
// Next.js API routes default to 4.5 MB but we accept up to ~30 MB total
// via the Request.formData() streaming path.
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md'];

const MetaSchema = z.object({
  title: z.string().min(1).max(500),
  agency: z.string().min(1).max(500),
  office: z.string().max(500).optional().nullable(),
  programType: z.enum([
    'sbir_phase_1', 'sbir_phase_2', 'sttr_phase_1', 'sttr_phase_2',
    'sbir_phase_3', 'sttr_phase_3', 'baa', 'ota', 'cso', 'rif', 'nofo', 'other',
  ]),
  solicitationNumber: z.string().max(200).optional().nullable(),
  closeDate: z.string().optional().nullable(),
  postedDate: z.string().optional().nullable(),
  description: z.string().max(5000).optional().nullable(),
});

function extFromFilename(name: string): string {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return (m?.[1] ?? '').toLowerCase();
}

function slugSafeName(name: string): string {
  // Keep basename only (strip any injected path), lowercase, replace
  // non-alphanumeric with hyphens. Matches SECTION_SLUG_RE in
  // lib/storage/paths.ts (^[a-z0-9][a-z0-9-]{0,63}$).
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name;
  const withoutExt = base.replace(/\.[^.]+$/, '');
  const slug = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  // Ensure starts with alphanumeric (slug regex requires first char [a-z0-9])
  return slug.replace(/^[^a-z0-9]+/, '') || 'file';
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json(
      { error: 'Authentication required', code: 'UNAUTHENTICATED' },
      { status: 401 },
    );
  }
  // rfp_admin or higher required
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json(
      { error: 'rfp_admin role required', code: 'FORBIDDEN' },
      { status: 403 },
    );
  }
  const userId = (session.user as { id?: string }).id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid multipart body', code: 'INVALID_BODY' },
      { status: 400 },
    );
  }

  const metaInput = {
    title: String(formData.get('title') ?? ''),
    agency: String(formData.get('agency') ?? ''),
    office: formData.get('office') ? String(formData.get('office')) : null,
    programType: String(formData.get('programType') ?? ''),
    solicitationNumber: formData.get('solicitationNumber') ? String(formData.get('solicitationNumber')) : null,
    closeDate: formData.get('closeDate') ? String(formData.get('closeDate')) : null,
    postedDate: formData.get('postedDate') ? String(formData.get('postedDate')) : null,
    description: formData.get('description') ? String(formData.get('description')) : null,
  };

  const parsed = MetaSchema.safeParse(metaInput);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Invalid metadata',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues,
      },
      { status: 422 },
    );
  }
  const meta = parsed.data;

  // Collect files
  const files: File[] = [];
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File) files.push(entry);
  }
  if (files.length === 0) {
    return NextResponse.json(
      { error: 'At least one file is required', code: 'NO_FILES' },
      { status: 422 },
    );
  }

  let totalBytes = 0;
  for (const f of files) {
    totalBytes += f.size;
    const ext = extFromFilename(f.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        {
          error: `Unsupported file type: .${ext} (allowed: ${ALLOWED_EXTENSIONS.join(', ')})`,
          code: 'UNSUPPORTED_FILE_TYPE',
        },
        { status: 422 },
      );
    }
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return NextResponse.json(
      {
        error: `Total upload size ${(totalBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_TOTAL_BYTES / 1024 / 1024}MB limit`,
        code: 'TOO_LARGE',
      },
      { status: 413 },
    );
  }

  // Generate opportunity UUID up front so we can use it for storage paths
  const oppId = randomUUID();

  // Insert opportunity row. source_id derived from the UUID for uniqueness.
  // Source is 'manual_upload' to distinguish from ingester-sourced rows.
  // postgres.js's tagged-template type-check doesn't like undefined, so
  // we explicitly narrow all nullable params to `string | null | Date`.
  const officeParam: string | null = meta.office ?? null;
  const solNumParam: string | null = meta.solicitationNumber ?? null;
  const closeParam: Date | null = meta.closeDate ? new Date(meta.closeDate) : null;
  const postedParam: Date | null = meta.postedDate ? new Date(meta.postedDate) : null;
  const descParam: string | null = meta.description ?? null;

  let oppRowId: string;
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO opportunities
        (id, source, source_id, title, agency, office, program_type,
         solicitation_number, close_date, posted_date, description,
         content_hash, is_active)
      VALUES
        (${oppId}::uuid, 'manual_upload', ${'manual-' + oppId},
         ${meta.title}, ${meta.agency}, ${officeParam},
         ${meta.programType}, ${solNumParam},
         ${closeParam}, ${postedParam},
         ${descParam},
         md5(${meta.title} || ${descParam ?? ''}),
         true)
      RETURNING id
    `;
    oppRowId = rows[0].id;
  } catch (err) {
    console.error('[rfp-upload] opportunity insert failed', err);
    return NextResponse.json(
      { error: 'Failed to create opportunity row', code: 'DB_ERROR' },
      { status: 500 },
    );
  }

  // Insert curated_solicitations row (status='new' so it appears in triage)
  let solId: string;
  try {
    const rows = await sql<{ id: string }[]>`
      INSERT INTO curated_solicitations (opportunity_id, namespace, status)
      VALUES (${oppRowId}::uuid, 'pending', 'new')
      RETURNING id
    `;
    solId = rows[0].id;
  } catch (err) {
    console.error('[rfp-upload] curated_solicitations insert failed', err);
    return NextResponse.json(
      { error: 'Failed to create solicitation row', code: 'DB_ERROR' },
      { status: 500 },
    );
  }

  // Upload each file and create a solicitation_documents row
  const documentIds: string[] = [];
  let firstPdfKey: string | null = null;
  for (const file of files) {
    const ext = extFromFilename(file.name);
    const safeName = slugSafeName(file.name);
    // Keep the admin's original filename (with extension) for display.
    // Strip any path traversal but don't slugify — that breaks display + PDF
    // type detection (.pdf extension must be preserved).
    const displayName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).slice(0, 255);
    // Build the storage key. First PDF (typical source) goes to source.pdf;
    // additional files become attachments/<filename>.
    let storageKey: string;
    if (ext === 'pdf' && !firstPdfKey) {
      storageKey = rfpPipelinePath({ opportunityId: oppRowId, kind: 'source', ext: 'pdf' });
      firstPdfKey = storageKey;
    } else {
      storageKey = rfpPipelinePath({
        opportunityId: oppRowId,
        kind: 'attachment',
        name: safeName, // already extension-stripped + slugified
        ext,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      await putObject({
        key: storageKey,
        body: buffer,
        contentType: file.type || undefined,
        metadata: {
          'original-filename': displayName,
          'uploaded-by': userId ?? 'unknown',
          'solicitation-id': solId,
        },
      });
    } catch (err) {
      console.error('[rfp-upload] S3 put failed', err);
      return NextResponse.json(
        { error: `Storage upload failed for ${file.name}`, code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    try {
      const docRows = await sql<{ id: string }[]>`
        INSERT INTO solicitation_documents
          (solicitation_id, document_type, original_filename, storage_key,
           file_size, content_type, uploaded_by)
        VALUES
          (${solId}::uuid,
           ${firstPdfKey === storageKey ? 'source' : 'attachment'},
           ${displayName},
           ${storageKey},
           ${file.size},
           ${file.type || null},
           ${userId ?? null}::uuid)
        RETURNING id
      `;
      documentIds.push(docRows[0].id);
    } catch (err) {
      console.error('[rfp-upload] document insert failed', err);
      return NextResponse.json(
        { error: 'Failed to record document', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  }

  // Enqueue a shred job so the pipeline extracts text + runs Claude.
  // Picked up by the dispatcher on the next tick.
  try {
    await sql`
      INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
      VALUES ('system', 'shred_solicitation', 'pending', 2,
              ${JSON.stringify({ solicitation_id: solId, triggered_by: 'manual_upload' })}::jsonb)
    `;
  } catch (err) {
    // Non-fatal — admin can manually retry via "Release for AI" in the workspace
    console.warn('[rfp-upload] shred job enqueue failed (non-fatal)', err);
  }

  return NextResponse.json(
    {
      data: {
        opportunity_id: oppRowId,
        solicitation_id: solId,
        document_ids: documentIds,
        total_bytes: totalBytes,
      },
    },
    { status: 201 },
  );
}

// Next.js 15: opt into streaming body handling so large multipart doesn't
// hit the default 4.5MB memory buffer.
export const config = {
  api: {
    bodyParser: false,
  },
};
