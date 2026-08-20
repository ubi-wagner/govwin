/**
 * POST /api/admin/rfp-upload
 *
 * Admin-only manual RFP upload. Accepts multipart form data with
 * one or more files + metadata, stores each file to the bucket
 * under `rfp-pipeline/{opp-uuid}/...`, creates the opportunity +
 * curated_solicitations + solicitation_documents rows, and emits a
 * finder:rfp.uploaded event so the OnRfpUploaded workflow shreds
 * the document via the workflow processor (crash-recoverable).
 *
 * Supports two modes:
 *
 * 1) New solicitation (default):
 *   title            — solicitation title (required)
 *   agency           — agency name (required)
 *   office           — program office (optional)
 *   programType      — sbir_phase_1 | sbir_phase_2 | ... | baa | ota (required)
 *   solicitationNumber — optional
 *   closeDate        — ISO 8601 (optional)
 *   postedDate       — ISO 8601 (optional)
 *   description      — short summary (optional)
 *   files            — one or more File objects (required, at least 1)
 *
 * 2) Attach to existing solicitation:
 *   solicitationId   — existing curated_solicitations.id (required)
 *   documentType     — rfp | nofo | instructions | amendment | etc. (optional, default 'source')
 *   isPrimary        — 'true' to mark as primary doc (optional)
 *   files            — one or more File objects (required, at least 1)
 *
 * Returns: { data: { solicitation_id, opportunity_id, document_ids[] } }
 */

import { capSourceText } from '@/lib/ingest/source-text-cap';
import { randomUUID, createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { ForbiddenError, UnauthenticatedError } from '@/lib/errors';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { republishSolicitationCards } from '@/lib/curation/republish';
import { extractTopicsForSolicitation } from '@/lib/extract-topics';
import { putObject } from '@/lib/storage/s3-client';
import { rfpPipelinePath } from '@/lib/storage/paths';
import { isValidUUID } from '@/lib/validation';

// Max aggregate upload size — guards against memory blowout. Individual
// Next.js API routes default to 4.5 MB but we accept up to ~30 MB total
// via the Request.formData() streaming path.
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md'];

// solicitation_documents.document_type CHECK set — validate client input against
// it so a bad value fails fast as a 400 instead of a 500 CHECK violation on the
// attach-to-existing insert path (effectiveType = docType).
const VALID_DOCUMENT_TYPES = [
  'source', 'rfp', 'nofo', 'instructions', 'amendment', 'qa',
  'template', 'supporting', 'attachment', 'topic', 'other',
] as const;

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
  try {
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

  // ── Attach-to-existing mode ──────────────────────────────────────
  // When solicitationId is provided, skip opportunity/solicitation creation
  // and just attach documents to the existing solicitation.
  const existingSolId = formData.get('solicitationId') ? String(formData.get('solicitationId')) : null;
  if (existingSolId && !isValidUUID(existingSolId)) {
    return NextResponse.json(
      { error: 'Invalid solicitationId', code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const requestedDocType = formData.get('documentType') ? String(formData.get('documentType')) : null;
  // Per-file types for a NEW solicitation, aligned by index to `files`. Unparseable or absent
  // ⇒ [] and the first-PDF-is-source fallback applies. Values are validated per file below.
  let fileTypes: string[] = [];
  try {
    const raw = formData.get('documentTypes');
    if (raw) { const parsed: unknown = JSON.parse(String(raw)); if (Array.isArray(parsed)) fileTypes = parsed.map(String); }
  } catch { /* malformed → fall back to the default typing */ }
  if (
    requestedDocType !== null &&
    !VALID_DOCUMENT_TYPES.includes(requestedDocType as (typeof VALID_DOCUMENT_TYPES)[number])
  ) {
    return NextResponse.json(
      { error: `Invalid documentType (allowed: ${VALID_DOCUMENT_TYPES.join(', ')})`, code: 'VALIDATION_ERROR' },
      { status: 400 },
    );
  }
  const requestedIsPrimary = formData.get('isPrimary') === 'true';

  // Metadata is only required when creating a new solicitation
  let meta: z.infer<typeof MetaSchema> | null = null;
  if (!existingSolId) {
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
    meta = parsed.data;
  }

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

  // ── Global dedup check ─────────────────────────────────────────────
  // Compute SHA-256 of each file's bytes. Check solicitation_documents
  // for a matching content_hash globally. If found, return the existing
  // solicitation so the admin can navigate there instead of creating a
  // duplicate. Admin can override by acknowledging the duplicate (future
  // UI — for now it's a hard reject with a link).
  const fileBuffers: { file: File; buffer: Buffer; hash: string; displayName: string; index: number }[] = [];
  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex');
    const displayName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).slice(0, 255);
    fileBuffers.push({ file, buffer, hash, displayName, index: fileBuffers.length });
  }

  // Check all hashes at once against the global document store
  const hashes = fileBuffers.map((fb) => fb.hash);
  let dupeRows: { contentHash: string; originalFilename: string; solicitationId: string; solTitle: string | null }[];
  try {
    dupeRows = await sql<
      { contentHash: string; originalFilename: string; solicitationId: string; solTitle: string | null }[]
    >`
      SELECT sd.content_hash, sd.original_filename, sd.solicitation_id,
             COALESCE(cs.solicitation_title, o.title) AS sol_title
      FROM solicitation_documents sd
      LEFT JOIN curated_solicitations cs ON cs.id = sd.solicitation_id
      LEFT JOIN opportunities o ON o.id = cs.opportunity_id
      -- Dedupe is PER SOLICITATION (mig 192). The same file legitimately belongs to more than one
      -- solicitation — every DoW SBIR topic attaches the SAME BAA preface, and an umbrella BAA and
      -- its topic share the topic PDF. Only a re-upload into the SAME solicitation is a duplicate.
      -- Attaching to an existing solicitation scopes to it; a NEW solicitation can never collide.
      WHERE sd.content_hash = ANY(${hashes}::text[])
        AND ${existingSolId}::uuid IS NOT NULL
        AND sd.solicitation_id = ${existingSolId}::uuid
    `;
  } catch (err) {
    console.error('[rfp-upload] duplicate check query failed', err);
    return NextResponse.json(
      { error: 'Failed to check for duplicate files', code: 'DB_ERROR' },
      { status: 500 },
    );
  }

  if (dupeRows.length > 0) {
    const first = dupeRows[0];
    return NextResponse.json(
      {
        error: `This file is already attached to "${first.solTitle ?? 'this solicitation'}". Attaching the same file to a DIFFERENT solicitation is allowed — only a repeat upload into the same one is refused.`,
        code: 'DUPLICATE_FILE',
        details: {
          existingSolicitationId: first.solicitationId,
          existingFilename: first.originalFilename,
          matchedHash: first.contentHash,
        },
      },
      { status: 409 },
    );
  }

  // ── Start event for the multi-step upload operation ────────────────
  const eventId = await emitEventStart({
    namespace: 'finder',
    type: existingSolId ? 'rfp.attached' : 'rfp.uploaded',
    actor: userActor(userId ?? 'unknown'),
    tenantId: null,
    payload: {
      fileCount: files.length,
      totalBytes,
      existingSolicitationId: existingSolId ?? undefined,
    },
  });

  // ── Resolve or create the solicitation ────────────────────────────
  let oppRowId: string;
  let solId: string;

  if (existingSolId) {
    // Attach-to-existing: look up the solicitation to get its opportunity_id
    try {
      const solRows = await sql<{ id: string; opportunityId: string }[]>`
        SELECT cs.id, cs.opportunity_id
        FROM curated_solicitations cs
        WHERE cs.id = ${existingSolId}::uuid
      `;
      if (solRows.length === 0) {
        await emitEventEnd(eventId, { error: { message: 'Solicitation not found', code: 'NOT_FOUND' } });
        return NextResponse.json(
          { error: 'Solicitation not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }
      solId = solRows[0].id;
      oppRowId = solRows[0].opportunityId;
    } catch (err) {
      console.error('[rfp-upload] solicitation lookup failed', err);
      await emitEventEnd(eventId, { error: { message: err instanceof Error ? err.message : String(err), code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'Failed to look up solicitation', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } else {
    // ── New solicitation flow ─────────────────────────────────────────
    if (!meta) {
      await emitEventEnd(eventId, { error: { message: 'Missing metadata', code: 'VALIDATION_ERROR' } });
      return NextResponse.json(
        { error: 'Metadata (title, agency, programType) required for new solicitations', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const oppId = randomUUID();
    const officeParam: string | null = meta.office ?? null;
    const solNumParam: string | null = meta.solicitationNumber ?? null;
    const closeParam: Date | null = meta.closeDate ? new Date(meta.closeDate) : null;
    const postedParam: Date | null = meta.postedDate ? new Date(meta.postedDate) : null;
    const descParam: string | null = meta.description ?? null;

    // Wrap opportunity + solicitation creation in transaction
    try {
      const txResult = await sql.begin(async (tx: any) => {
        const oppRows = await tx<{ id: string }[]>`
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
             -- content_hash carries a UNIQUE constraint (009, for the automated
             -- ingester's content dedup). A MANUAL upload is a deliberate, distinct
             -- creation, so mix in the fresh oppId → each manual upload is unique and
             -- a duplicate title (even with an empty description) no longer 500s.
             -- True duplicate FILES are still caught by the solicitation_documents
             -- content_hash dedup (the 409 above).
             md5(${meta.title} || ${descParam ?? ''} || ${oppId}),
             true)
          RETURNING id
        `;

        const solRows = await tx<{ id: string }[]>`
          INSERT INTO curated_solicitations (opportunity_id, namespace, status)
          VALUES (${oppRows[0].id}::uuid, 'pending', 'new')
          RETURNING id
        `;

        return { oppRowId: oppRows[0].id, solId: solRows[0].id };
      });
      oppRowId = txResult.oppRowId;
      solId = txResult.solId;
    } catch (err) {
      console.error('[rfp-upload] opportunity/solicitation creation failed', err);
      await emitEventEnd(eventId, { error: { message: err instanceof Error ? err.message : String(err), code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'Failed to create opportunity/solicitation rows', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  }

  // ── If isPrimary requested, clear existing primary flags first ────
  if (requestedIsPrimary) {
    try {
      await sql`
        UPDATE solicitation_documents
        SET is_primary = false
        WHERE solicitation_id = ${solId}::uuid AND is_primary = true
      `;
    } catch (err) {
      console.error('[rfp-upload] clear primary flags failed (non-fatal)', err);
    }
  }

  // Upload each file and create a solicitation_documents row.
  // fileBuffers were pre-computed above (hash + buffer + displayName).
  const documentIds: string[] = [];
  let firstPdfKey: string | null = null;
  for (const fb of fileBuffers) {
    const ext = extFromFilename(fb.file.name);
    const safeName = slugSafeName(fb.file.name);
    let storageKey: string;
    // The 'source' slot (…/source.pdf) belongs to a NEW solicitation's primary document only.
    // Attach-to-existing must never claim it — the original upload already owns that key, and
    // taking it again is a unique-constraint 500 (proven by the coverage drive: attaching the
    // Component instructions to an existing BAA collided on …/source.pdf). Attachment keys also
    // carry a content-hash prefix so two different files sharing a filename cannot collide
    // (same-CONTENT re-uploads are already rejected earlier by the content_hash dedup).
    if (ext === 'pdf' && !firstPdfKey && !existingSolId) {
      storageKey = rfpPipelinePath({ opportunityId: oppRowId, kind: 'source', ext: 'pdf' });
      firstPdfKey = storageKey;
    } else {
      storageKey = rfpPipelinePath({
        opportunityId: oppRowId,
        kind: 'attachment',
        name: `${fb.hash.slice(0, 10)}-${safeName}`.slice(0, 63).replace(/-+$/, ''),
        ext,
      });
    }

    try {
      await putObject({
        key: storageKey,
        body: fb.buffer,
        contentType: fb.file.type || undefined,
        metadata: {
          'original-filename': fb.displayName,
          'uploaded-by': userId ?? 'unknown',
          'solicitation-id': solId,
        },
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[rfp-upload] S3 put failed', { key: storageKey, err: errMsg, stack: err instanceof Error ? err.stack : undefined });
      // B2: the opp + solicitation were committed BEFORE this upload. On a storage
      // failure for a NEW solicitation, roll them back (+ any doc rows already
      // written for earlier files in this batch) so we don't orphan a zero-document
      // solicitation. Attach-to-existing (existingSolId) must NOT delete the opp.
      if (!existingSolId) {
        try {
          await sql`DELETE FROM solicitation_documents WHERE solicitation_id = ${solId}::uuid`;
          await sql`DELETE FROM curated_solicitations WHERE id = ${solId}::uuid`;
          await sql`DELETE FROM opportunities WHERE id = ${oppRowId}::uuid`;
        } catch (cleanupErr) {
          console.error('[rfp-upload] orphan cleanup after S3 failure failed', cleanupErr);
        }
      }
      await emitEventEnd(eventId, { error: { message: `S3 put failed: ${errMsg}`, code: 'STORAGE_ERROR' } });
      return NextResponse.json(
        { error: 'Storage upload failed', code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    try {
      // Document type, in priority order:
      //   attach-to-existing → the PER-FILE type, else the request's documentType, else
      //                        'attachment' (NEVER 'source' — the original upload owns the
      //                        source role, and a second "source" skews the full_text
      //                        recombine ordering + the provenance story).
      //   new solicitation   → the PER-FILE type the admin chose on the form, else the first
      //                        PDF is the 'source' (umbrella) and the rest are 'attachment'.
      // The per-file choice matters: a solicitation states its rules across files, and a
      // supplementary PDF labelled 'instructions' is the one the umbrella BAA defers its page
      // limit TO. Labelling it correctly is what lets the provenance audit tell "the rule is
      // elsewhere and elsewhere is nowhere" from "the rule is elsewhere and here it is".
      // (Caught live by the mid-window drive: an attach sending documentTypes ['amendment']
      // was silently stored as 'source', so the amendment linked the wrong file.)
      const perFileType = fileTypes[fb.index];
      const perFileValid = !!perFileType && (VALID_DOCUMENT_TYPES as readonly string[]).includes(perFileType);
      const effectiveType = existingSolId
        ? (perFileValid ? perFileType : (requestedDocType ?? 'attachment'))
        : perFileValid
          ? perFileType
          : (firstPdfKey === storageKey ? 'source' : 'attachment');
      const isPrimary = requestedIsPrimary && firstPdfKey === storageKey;
      const docRows = await sql<{ id: string }[]>`
        INSERT INTO solicitation_documents
          (solicitation_id, document_type, original_filename, storage_key,
           file_size, content_type, content_hash, uploaded_by, is_primary)
        VALUES
          (${solId}::uuid,
           ${effectiveType},
           ${fb.displayName},
           ${storageKey},
           ${fb.file.size},
           ${fb.file.type || null},
           ${fb.hash},
           ${userId ?? null}::uuid,
           ${isPrimary})
        ON CONFLICT (solicitation_id, content_hash) WHERE content_hash IS NOT NULL DO NOTHING
        RETURNING id
      `;
      if (docRows.length === 0) {
        // Lost a concurrent dedup race — another upload inserted this exact file
        // between the batch pre-check above and here. Return the SAME clean 409
        // the pre-check returns, not a 500 from the partial-unique violation.
        // (ON CONFLICT must restate the index's partial predicate.)
        await emitEventEnd(eventId, { error: { message: 'duplicate content_hash', code: 'DUPLICATE_FILE' } });
        return NextResponse.json(
          {
            error: 'This file is already attached to this solicitation. Attaching it to a different solicitation is allowed — only a repeat upload into the same one is refused.',
            code: 'DUPLICATE_FILE',
          },
          { status: 409 },
        );
      }
      documentIds.push(docRows[0].id);
    } catch (err) {
      console.error('[rfp-upload] document insert failed', err);
      await emitEventEnd(eventId, { error: { message: err instanceof Error ? err.message : String(err), code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'Failed to record document', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  }

  // ── Extract text from EVERY uploaded PDF immediately ──────────────
  // We already hold the bytes, so extracting here removes the dependency on the pipeline
  // shredder fetching them back out of storage — which is also the only path that works when
  // the two services disagree about the storage driver.
  //
  // This used to extract only the FIRST pdf. That quietly capped every solicitation at one
  // readable document, and the one it dropped is the one that matters most: a federal
  // solicitation states its rules across files, and the DoW 2026 SBIR BAA defers its
  // technical-volume page limit to the Component-specific instructions, which upload as a second
  // PDF. Proven live — a 9-page instructions file stating "The Technical Volume is not to exceed
  // 10 pages" sat in solicitation_documents with extracted_text NULL, so the compliance matrix
  // showed a permanently unresolvable deferral while the answer was sitting in the row next to it.
  //
  // documentIds is index-aligned with fileBuffers (one push per file, early return on conflict).
  //
  // ALWAYS extract — including attach-to-existing. The old gate (`!existingSolId ||
  // requestedIsPrimary`) was single-document-era reasoning: it assumed a later attachment was
  // supporting material. It is usually the OPPOSITE — the document an admin attaches later is
  // the Component-specific instructions the umbrella defers its binding rules to, and skipping
  // extraction left it a text-less row the compliance pipeline could never read. We hold the
  // bytes right here; extracting now beats hoping a worker can fetch them back out of storage.
  const shouldExtract = documentIds.length > 0;
  let extractedText: string | null = null;   // the UMBRELLA text — what topic extraction reads
  if (shouldExtract && documentIds.length > 0) {
    try {
      const { loadPdfParse } = await import('@/lib/pdf-parse-quiet'); // pdf-parse loader with pdf.js Node setup warnings silenced
      const { PDFParse } = await loadPdfParse();

      for (let i = 0; i < fileBuffers.length && i < documentIds.length; i++) {
        const fb = fileBuffers[i];
        if (extFromFilename(fb.file.name) !== 'pdf') continue;
        try {
          const parser = new PDFParse({ data: new Uint8Array(fb.buffer) });
          const textResult = await parser.getText();
          // Cap AND record. A bare .slice() here discarded 50.7% of the DoW 2026 SBIR BAA and
          // 62.7% of the DoD 25.1 BAA without telling anyone, so every "not stated in the source"
          // downstream was really "not read from the source" (docs/INGEST_PROVENANCE.md).
          const capped = capSourceText(textResult.text);
          const rawText = capped.text;
          try { await parser.destroy(); } catch { /* ignore cleanup */ }
          if (rawText.length <= 100) continue;
          if (capped.truncated) {
            console.error('[rfp-upload] extraction TRUNCATED', fb.file.name,
              `${capped.chars}/${capped.originalChars} chars`);
          }

          await sql`
            UPDATE solicitation_documents
            SET extracted_text = ${rawText}, extracted_at = now(), updated_at = now(),
                metadata = COALESCE(metadata, '{}'::jsonb) || ${sql.json({
                  extraction: {
                    chars: capped.chars, truncated: capped.truncated,
                    originalChars: capped.originalChars, capChars: capped.capChars,
                  },
                })}
            WHERE id = ${documentIds[i]}::uuid
          `;
          // First readable PDF is the umbrella — topics are extracted from it, not from the
          // Component instructions (which describe how to respond, not what to respond to).
          if (extractedText === null) extractedText = rawText;
        } catch (perFileErr) {
          // One unreadable file (a scan, an encrypted PDF) must not cost us the others.
          console.error(`[rfp-upload] PDF text extraction failed for ${fb.displayName} (non-fatal):`, perFileErr);
        }
      }
    } catch (err) {
      console.error('[rfp-upload] PDF text extraction failed (non-fatal):', err);
    }

    // Attach-to-existing: recombine curated_solicitations.full_text from EVERY document's
    // extracted text, in the same order + separator the pipeline shredder uses, so the
    // readiness gate and Ingest Assist see the newly-attached rules immediately. (For a NEW
    // solicitation the OnRfpUploaded shred does this; an attach must not have to wait for it.)
    if (existingSolId) {
      try {
        await sql`
          UPDATE curated_solicitations SET full_text = (
            SELECT string_agg(d.extracted_text, E'\n\n---DOCUMENT---\n\n'
                     ORDER BY CASE d.document_type
                       WHEN 'source' THEN 0 WHEN 'rfp' THEN 0 WHEN 'nofo' THEN 0
                       WHEN 'instructions' THEN 1 WHEN 'amendment' THEN 1 WHEN 'qa' THEN 1
                       WHEN 'topic' THEN 2 ELSE 3 END, d.created_at)
            FROM solicitation_documents d
            WHERE d.solicitation_id = ${solId}::uuid AND d.extracted_text IS NOT NULL
          ), updated_at = now()
          WHERE id = ${solId}::uuid`;
      } catch (err) {
        console.error('[rfp-upload] full_text recombine failed (non-fatal):', err);
      }
    }
  }

  // ── Auto-extract topics from the text ──────────────────────────────
  // Run topic extraction synchronously so the admin sees topics
  // immediately in the curation workspace instead of clicking manually.
  let topicsExtracted = 0;
  if (extractedText && extractedText.length > 100) {
    try {
      const result = await extractTopicsForSolicitation(solId, extractedText);
      topicsExtracted = result.topics?.length ?? 0;
    } catch (err) {
      console.error('[rfp-upload] auto topic extraction failed (non-fatal):', err);
    }
  }

  // Shredding is triggered by the OnRfpUploaded workflow, which picks up
  // the finder:rfp.uploaded:end event emitted below. No direct pipeline_jobs
  // INSERT here — that would cause a double-shred (both the dispatcher
  // consumer and the workflow processor would shred the same document,
  // wasting Claude API tokens). The workflow path is preferred because it
  // has crash recovery via process_instances.

  await emitEventEnd(eventId, {
    result: {
      opportunityId: oppRowId,
      solicitationId: solId,
      documentIds,
      documentCount: documentIds?.length ?? 0,
      textExtracted: extractedText !== null,
      topicsExtracted: topicsExtracted,
    },
  });

  // Attach-to-existing on a PUSHED solicitation: bump the bridge so pinned mirror
  // cards flip pin_update_available — the tenant's resync then re-copies the doc
  // set, which is how a late attachment actually reaches a customer. No-op pre-push.
  let propagation: Awaited<ReturnType<typeof republishSolicitationCards>> | undefined;
  if (existingSolId) {
    propagation = await republishSolicitationCards({ solicitationId: solId, actorId: userId ?? null });
  }

  return NextResponse.json(
    {
      data: {
        opportunity_id: oppRowId,
        solicitation_id: solId,
        document_ids: documentIds,
        total_bytes: totalBytes,
        text_extracted: extractedText !== null,
        topics_found: topicsExtracted,
        ...(propagation ? { propagation } : {}),
      },
    },
    { status: 201 },
  );
  } catch (err) {
    console.error('[rfp-upload] unhandled error:', err);
    return NextResponse.json(
      { error: 'Upload failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

