/**
 * POST /api/admin/proposals/[proposalId]/sections/[sectionId]/export
 *
 * Exports a canvas document to .docx (or .pptx/.pdf in future).
 * Returns the file as a binary response for download.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { exportToDocx } from '@/lib/export/docx-exporter';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ proposalId: string; sectionId: string }>;
}

export async function POST(request: Request, _ctx: RouteContext) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }

  const body = await request.json();
  const doc = body?.document as CanvasDocument;
  const format = body?.format as string;

  if (!doc || !doc.nodes) {
    return NextResponse.json({ error: 'document (CanvasDocument JSON) required' }, { status: 400 });
  }

  if (format !== 'docx') {
    return NextResponse.json(
      { error: `Format "${format}" not yet supported. Available: docx` },
      { status: 422 },
    );
  }

  try {
    const buffer = await exportToDocx(doc, {
      company_name: 'Your Company',
      topic_number: doc.metadata.title ?? 'TBD',
    });

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${doc.metadata.title || 'document'}.docx"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[export] docx generation failed', err);
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
