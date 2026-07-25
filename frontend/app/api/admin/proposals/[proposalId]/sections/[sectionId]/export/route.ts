/**
 * POST /api/admin/proposals/[proposalId]/sections/[sectionId]/export
 *
 * Exports a canvas document to .docx (or .pptx/.pdf in future).
 * Returns the file as a binary response for download.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
// Admin cross-tenant route — reads/writes span tenants, so use the owner (BYPASSRLS) pool. (docs/RLS_CUTOVER.md)
import { sqlBypass as sql } from '@/lib/db';
import { isRole } from '@/lib/rbac';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { emitEventSingle } from '@/lib/events';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ proposalId: string; sectionId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { proposalId, sectionId } = await ctx.params;

    // Download gate: check lock status
    let proposal: { lockCount: number; isLocked: boolean } | undefined;
    try {
      const rows = await sql<{ lockCount: number; isLocked: boolean }[]>`
        SELECT lock_count, is_locked FROM proposals WHERE id = ${proposalId} LIMIT 1
      `;
      proposal = rows[0];
    } catch (e) {
      console.error('[admin/export] lock status query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (proposal && !(proposal.lockCount >= 1 && proposal.isLocked)) {
      return NextResponse.json(
        { error: 'Downloads available after final review and lock', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }
    if (proposal) {
      try {
        await sql`UPDATE proposals SET download_count = download_count + 1 WHERE id = ${proposalId}`;
      } catch (e) {
        console.error('[admin/export] download count update failed:', e);
        // non-fatal, continue
      }
    }

    const body = await request.json();
    const doc = body?.document as CanvasDocument;
    const format = body?.format as string;

    if (!doc || !doc.nodes) {
      return NextResponse.json({ error: 'document (CanvasDocument JSON) required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const title = doc.metadata.title || 'document';
    const vars = {
      company_name: 'Your Company',
      topic_number: doc.metadata.title ?? 'TBD',
    };

    if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx' && format !== 'pdf') {
      return NextResponse.json(
        { error: `Format "${format}" not supported. Available: docx, pptx, xlsx, pdf`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    let buffer: Buffer;

    if (format === 'pptx') {
      const { exportToPptx } = await import('@/lib/export/pptx-exporter');
      buffer = await exportToPptx(doc, vars);
    } else if (format === 'xlsx') {
      const { exportToXlsx } = await import('@/lib/export/xlsx-exporter');
      buffer = await exportToXlsx(doc, vars);
    } else if (format === 'pdf') {
      // PDF needs Chromium (infra dep) — clear 503 when unavailable, not a 500.
      try {
        const { exportToPdf } = await import('@/lib/export/pdf-exporter');
        buffer = await exportToPdf(doc, vars);
      } catch (pdfErr) {
        console.error('[admin/export] PDF render failed (Chromium unavailable?):', pdfErr);
        return NextResponse.json({ error: 'PDF export is temporarily unavailable. Use .docx.', code: 'EXPORT_ERROR' }, { status: 503 });
      }
    } else {
      buffer = await exportToDocx(doc, vars);
    }

    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'section.exported',
        actor: { type: 'user', id: sessionUser.id ?? 'unknown', email: sessionUser.email ?? undefined },
        payload: { proposalId, sectionId, format, title },
      });
    } catch (e) {
      console.error('[admin/export] event emission failed:', e);
      // non-fatal, continue
    }

    const contentTypes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    };

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentTypes[format],
        'Content-Disposition': `attachment; filename="${title}.${format}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[admin/export] generation failed', err);
    return NextResponse.json(
      { error: 'Export failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
