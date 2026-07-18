/**
 * POST /api/portal/[tenantSlug]/documents/[documentId]/export
 *
 * Export a standalone document's canvas to .docx / .pptx / .xlsx / .pdf (Tier 2,
 * #3). Reuses the same real Office exporters as proposal sections. Unlike a
 * proposal volume there is no lock/stage download-gate — it's the tenant's own
 * document, exportable whenever they like.
 *
 * Body: { document: CanvasDocument, format: 'docx'|'pptx'|'xlsx'|'pdf' }
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; documentId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, documentId } = await ctx.params;
    if (!isValidUUID(documentId)) {
      return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { document?: unknown; format?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const doc = body?.document as CanvasDocument | undefined;
    const format = body?.format as string | undefined;
    if (!doc || (!doc.nodes && !doc.sections)) {
      return NextResponse.json({ error: 'document (CanvasDocument JSON) required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx' && format !== 'pdf') {
      return NextResponse.json({ error: `Format "${format}" not supported. Available: docx, pptx, xlsx, pdf`, code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    // ── Verify the document belongs to this tenant ──────────────────────
    let row: { id: string; title: string } | undefined;
    try {
      [row] = await sql<{ id: string; title: string }[]>`
        SELECT id, title FROM tenant_documents
        WHERE id = ${documentId}::uuid AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/documents/export] load failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!row) {
      return NextResponse.json({ error: 'Document not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const title = doc.metadata?.title || row.title || 'document';
    const vars: Record<string, string> = {
      company_name: (tenant as { name?: string }).name ?? 'Your Company',
      topic_number: doc.metadata?.title ?? 'TBD',
    };

    let buffer: Buffer;
    if (format === 'pptx') {
      const { exportToPptx } = await import('@/lib/export/pptx-exporter');
      buffer = await exportToPptx(doc, vars);
    } else if (format === 'xlsx') {
      const { exportToXlsx } = await import('@/lib/export/xlsx-exporter');
      buffer = await exportToXlsx(doc, vars);
    } else if (format === 'pdf') {
      try {
        const { exportToPdf } = await import('@/lib/export/pdf-exporter');
        buffer = await exportToPdf(doc, vars);
      } catch (pdfErr) {
        console.error('[portal/documents/export] PDF render failed (Chromium unavailable?):', pdfErr);
        return NextResponse.json({ error: 'PDF export is temporarily unavailable. Use .docx.', code: 'EXPORT_ERROR' }, { status: 503 });
      }
    } else {
      buffer = await exportToDocx(doc, vars);
    }

    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'document.exported',
        actor: userActor(su.id, su.email ?? undefined),
        tenantId,
        payload: { documentId, format, title },
      });
    } catch (e) { console.error('[portal/documents/export] event emit failed (non-fatal):', e); }

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
  } catch (e) {
    console.error('[portal/documents/export] error:', e);
    return NextResponse.json({ error: 'Export failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
