/**
 * POST /api/admin/upload-topic-files
 *
 * Ingest one or more individual topic files for a solicitation. Each file is
 * stored, its text extracted, recorded as solicitation_documents(document_type
 * ='topic'), and — the point of this route — turned into a TOPIC OPPORTUNITY
 * (an `opportunities` row under the umbrella, linked via origin_document_id).
 * Upload 20 topic files → 20 topic opportunities, ready for the existing
 * `solicitation.push` fan-out (umbrella + every topic → N+1 tenant cards).
 *
 * Returns: { data: { created:[{opportunityId,documentId,topicNumber,title,textExtracted}],
 *                     skipped:[{filename,reason}], failed:[{filename,error}], totalFiles } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import {
  ingestTopicFilesForSolicitation,
  SolicitationNotFoundError,
  type TopicFileInput,
} from '@/lib/ingest/ingest-topic-files';
import { isValidUUID } from '@/lib/validation';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'rfp_admin required', code: 'FORBIDDEN' }, { status: 403 });
  }
  const userId = (session.user as { id?: string }).id ?? null;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid multipart body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const solicitationId = String(formData.get('solicitationId') ?? '');
  if (!solicitationId || !isValidUUID(solicitationId)) {
    return NextResponse.json({ error: 'A valid solicitationId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const files: TopicFileInput[] = [];
  for (const entry of formData.getAll('files')) {
    if (entry instanceof File) {
      files.push({
        name: entry.name,
        type: entry.type,
        size: entry.size,
        buffer: Buffer.from(await entry.arrayBuffer()),
      });
    }
  }
  if (files.length === 0) {
    return NextResponse.json({ error: 'At least one file required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  try {
    const result = await ingestTopicFilesForSolicitation({ solicitationId, files, userId });
    return NextResponse.json({ data: { ...result, totalFiles: files.length } }, { status: 201 });
  } catch (err) {
    if (err instanceof SolicitationNotFoundError) {
      return NextResponse.json({ error: 'Solicitation not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    console.error('[upload-topic-files] ingest failed', err);
    return NextResponse.json({ error: 'Topic ingest failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
