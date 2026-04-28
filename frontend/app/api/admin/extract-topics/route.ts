/**
 * POST /api/admin/extract-topics
 *
 * Takes a solicitation_id, reads its source document's extracted_text
 * (or full_text from the curated_solicitations row), scans for a TOC
 * section with topic-number patterns, then extracts structured topic data.
 *
 * Returns: { data: { topics: [{ topicNumber, title, branch, description }], source: 'toc'|'fullscan'|'none' } }
 *
 * Admin-only. Called by the "Extract Topics" button on the workspace.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { extractTopicsForSolicitation } from '@/lib/extract-topics';

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  const role = (session.user as { role?: string }).role;
  if (role !== 'rfp_admin' && role !== 'master_admin') {
    return NextResponse.json({ error: 'rfp_admin required', code: 'FORBIDDEN' }, { status: 403 });
  }

  const body = await request.json();
  const solicitationId = body?.solicitationId;
  if (!solicitationId) {
    return NextResponse.json({ error: 'solicitationId required', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const result = await extractTopicsForSolicitation(solicitationId);

  return NextResponse.json({ data: result });
}
