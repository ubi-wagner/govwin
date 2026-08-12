/**
 * /api/admin/documents/[documentId]/export — export a document to file format.
 *
 * POST → export to docx, pptx, or xlsx
 *
 * Auth: master_admin or rfp_admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { validateStandaloneCanvas, type CanvasDocument } from '@/lib/types/canvas-document';

export const dynamic = 'force-dynamic';

// ─── POST — export a document ──────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { documentId } = await params;
    if (!documentId) {
      return NextResponse.json(
        { error: 'documentId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let body: { document?: CanvasDocument; format?: string; variables?: Record<string, string> };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'BAD_REQUEST' },
        { status: 400 },
      );
    }

    const { document, format, variables } = body;

    if (!document || typeof document !== 'object') {
      return NextResponse.json(
        { error: 'document object is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!format || !['docx', 'pptx', 'xlsx', 'pdf'].includes(format)) {
      return NextResponse.json(
        { error: 'format must be one of: docx, pptx, xlsx, pdf', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let buffer: Buffer;
    let contentType: string;
    let extension: string;

    if (format === 'docx') {
      const { exportToDocx } = await import('@/lib/export/docx-exporter');
      buffer = await exportToDocx(document, variables ?? {});
      contentType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      extension = 'docx';
    } else if (format === 'pptx') {
      const { exportToPptx } = await import('@/lib/export/pptx-exporter');
      buffer = await exportToPptx(document, variables ?? {});
      contentType = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
      extension = 'pptx';
    } else if (format === 'pdf') {
      // PDF needs Chromium (infra dep) — surface a clear 503 when unavailable, not a 500.
      try {
        const { exportToPdf } = await import('@/lib/export/pdf-exporter');
        buffer = await exportToPdf(document, variables ?? {});
      } catch (pdfErr) {
        console.error('[admin/documents/[id]/export] PDF render failed (Chromium unavailable?):', pdfErr);
        return NextResponse.json({ error: 'PDF export is temporarily unavailable. Use .docx.', code: 'EXPORT_ERROR' }, { status: 503 });
      }
      contentType = 'application/pdf';
      extension = 'pdf';
    } else {
      const { exportToXlsx } = await import('@/lib/export/xlsx-exporter');
      buffer = await exportToXlsx(document, variables ?? {});
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      extension = 'xlsx';
    }

    const filename = `${document.metadata?.title || 'document'}.${extension}`.replace(/[^\w\s.-]/g, '_');

    // Advisory size/format compliance floor — the SAME ruler proposals use, against
    // the document's own declared limits. Surfaced via header; never blocks.
    let violationCodes = 'none';
    try {
      const v = validateStandaloneCanvas(document).map((x) => x.code);
      if (v.length) violationCodes = v.join(',');
    } catch (e) { console.error('[admin/documents/[id]/export] compliance check failed (non-fatal):', e); }

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(buffer.length),
        'X-Compliance-Violations': violationCodes,
      },
    });
  } catch (err) {
    console.error('[admin/documents/[id]/export] POST error', err);
    return NextResponse.json(
      { error: 'Failed to export document', code: 'INTERNAL_ERROR' },
      { status: 500 },
    );
  }
}
