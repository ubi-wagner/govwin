/**
 * POST /api/admin/upload-topic-files
 *
 * Accepts one or more individual topic PDFs for a solicitation.
 * Each file is stored in the bucket under the solicitation's path,
 * a solicitation_documents row is created with document_type='topic',
 * and best-effort metadata is extracted from the filename.
 *
 * Returns: { data: { uploaded: [{ documentId, topicNumber, title, filename }] } }
 *
 * Does NOT create opportunity rows — the admin confirms each topic
 * via the staged-review UI, which calls opportunity.add_topic per
 * confirmed file.
 */

import { randomUUID, createHash } from 'crypto';
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { putObject } from '@/lib/storage/s3-client';

// Common topic-number patterns in filenames
const TOPIC_RE = /([A-Z]{1,5}\d{2,3}[._-]\w{1,10})/i;

function parseTopicFromFilename(filename: string): { topicNumber: string | null; title: string } {
  const base = filename.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/-/g, ' ');
  const m = filename.match(TOPIC_RE);
  const topicNumber = m ? m[1].replace(/_/g, '-') : null;
  const title = topicNumber
    ? base.replace(m![0], '').replace(/^\s*[-_:]\s*/, '').trim() || topicNumber
    : base.trim();
  return { topicNumber, title };
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'rfp_admin required' }, { status: 403 });
  }
  const userId = (session.user as { id?: string }).id;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body' }, { status: 400 });
  }

  const solicitationId = String(formData.get('solicitationId') ?? '');
  if (!solicitationId) {
    return NextResponse.json({ error: 'solicitationId required' }, { status: 400 });
  }

  // Verify solicitation exists + get its primary opportunity for path generation
  const solRows = await sql<{ id: string; opportunityId: string | null }[]>`
    SELECT id, opportunity_id FROM curated_solicitations WHERE id = ${solicitationId}::uuid
  `;
  if (solRows.length === 0) {
    return NextResponse.json({ error: 'Solicitation not found' }, { status: 404 });
  }
  const oppId = solRows[0].opportunityId ?? solicitationId;

  const files: File[] = [];
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File) files.push(entry);
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'At least one file required' }, { status: 422 });
  }

  const uploaded: Array<{ documentId: string; topicNumber: string | null; title: string; filename: string }> = [];

  for (const file of files) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const hash = createHash('sha256').update(buffer).digest('hex');
    const displayName = (file.name.replace(/\\/g, '/').split('/').pop() ?? file.name).slice(0, 255);

    // Check for global duplicate
    const dupeCheck = await sql<{ id: string }[]>`
      SELECT id FROM solicitation_documents WHERE content_hash = ${hash}
    `;
    if (dupeCheck.length > 0) {
      // Skip silently — already uploaded
      continue;
    }

    // Parse topic info from filename
    const { topicNumber, title } = parseTopicFromFilename(displayName);

    // Storage key: rfp-pipeline/{oppId}/topics/{slug}.pdf
    const slug = displayName
      .replace(/\.[^.]+$/, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'topic';
    const ext = (displayName.match(/\.([a-zA-Z0-9]+)$/) ?? [])[1]?.toLowerCase() ?? 'pdf';
    const storageKey = `rfp-pipeline/${oppId}/topics/${slug}.${ext}`;

    try {
      await putObject({
        key: storageKey,
        body: buffer,
        contentType: file.type || 'application/pdf',
        metadata: { 'original-filename': displayName, 'topic-number': topicNumber ?? '' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json(
        { error: `Storage failed for ${displayName}: ${msg}`, code: 'STORAGE_ERROR' },
        { status: 500 },
      );
    }

    const docRows = await sql<{ id: string }[]>`
      INSERT INTO solicitation_documents
        (solicitation_id, document_type, original_filename, storage_key,
         file_size, content_type, content_hash, uploaded_by,
         metadata)
      VALUES
        (${solicitationId}::uuid, 'topic', ${displayName}, ${storageKey},
         ${file.size}, ${file.type || null}, ${hash}, ${userId ?? null}::uuid,
         ${JSON.stringify({ parsed_topic_number: topicNumber, parsed_title: title })}::jsonb)
      RETURNING id
    `;
    uploaded.push({
      documentId: docRows[0].id,
      topicNumber,
      title,
      filename: displayName,
    });
  }

  return NextResponse.json({ data: { uploaded, totalFiles: files.length } }, { status: 201 });
}
