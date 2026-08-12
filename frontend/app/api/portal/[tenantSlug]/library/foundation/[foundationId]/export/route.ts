/**
 * POST /api/portal/[tenantSlug]/library/foundation/[foundationId]/export — P2.2/P3.3.
 * Render a foundation's canvas to its native format via renderCanvas. Exports the
 * client-sent live document (same contract as the document export route).
 * Body: { document: CanvasDocument, format: 'docx'|'pptx'|'xlsx'|'pdf' }.
 * Auth: tenant_user+ with tenant access.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { renderCanvas, type ExportFormat } from '@/lib/export/artifact-export';
import { validateStandaloneCanvas, type CanvasDocument } from '@/lib/types/canvas-document';

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};
const FORMATS = new Set(['docx', 'pptx', 'xlsx', 'pdf']);

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; foundationId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    const su = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    if (!hasRoleAtLeast(role, 'tenant_user')) return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });

    const { tenantSlug, foundationId } = await ctx.params;
    if (!isValidUUID(foundationId)) return NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(su.id, role, tenantId))) return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });

    let body: { document?: unknown; format?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const format = body.format as string | undefined;
    if (!format || !FORMATS.has(format)) return NextResponse.json({ error: 'format must be docx|pptx|xlsx|pdf', code: 'VALIDATION_ERROR' }, { status: 400 });
    if (!body.document || typeof body.document !== 'object') return NextResponse.json({ error: 'document (CanvasDocument) is required', code: 'VALIDATION_ERROR' }, { status: 400 });

    const doc = body.document as CanvasDocument;
    // Advisory size/format compliance floor — same ruler as proposals, against the
    // foundation's own declared limits. Surfaced via header; never blocks.
    let violationCodes = 'none';
    try {
      const v = validateStandaloneCanvas(doc).map((x) => x.code);
      if (v.length) violationCodes = v.join(',');
    } catch (e) { console.error('[library/foundation export] compliance check failed (non-fatal):', e); }

    const buf = await renderCanvas(format as ExportFormat, doc, { company_name: 'Your Company', topic_number: 'TBD' });
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: { 'Content-Type': MIME[format], 'Content-Disposition': `attachment; filename="canvas.${format}"`, 'X-Compliance-Violations': violationCodes },
    });
  } catch (e) {
    console.error('[library/foundation export]', e);
    return NextResponse.json({ error: 'Failed to export canvas', code: 'EXPORT_ERROR' }, { status: 500 });
  }
}
