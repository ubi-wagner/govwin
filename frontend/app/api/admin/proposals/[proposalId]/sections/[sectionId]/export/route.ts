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

  const title = doc.metadata.title || 'document';
  const vars = {
    company_name: 'Your Company',
    topic_number: doc.metadata.title ?? 'TBD',
  };

  if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx') {
    return NextResponse.json(
      { error: `Format "${format}" not supported. Available: docx, pptx, xlsx` },
      { status: 422 },
    );
  }

  try {
    if (format === 'pptx') {
      const { exportToPptx } = await import('@/lib/export/pptx-exporter');
      const buffer = await exportToPptx(doc, vars);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'Content-Disposition': `attachment; filename="${title}.pptx"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    if (format === 'xlsx') {
      const { exportToXlsx } = await import('@/lib/export/xlsx-exporter');
      const buffer = await exportToXlsx(doc, vars);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${title}.xlsx"`,
          'Content-Length': String(buffer.length),
        },
      });
    }

    // Default: docx
    const buffer = await exportToDocx(doc, vars);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${title}.docx"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[export] generation failed', err);
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
