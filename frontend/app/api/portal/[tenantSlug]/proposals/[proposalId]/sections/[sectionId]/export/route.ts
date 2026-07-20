/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/export
 *
 * Exports a proposal section's canvas document to .docx, .pptx, or .xlsx format.
 * Returns the file as a binary response for download.
 *
 * Auth: tenant_admin, tenant_user, or partner_user with access to the proposal.
 * Admin roles (master_admin, rfp_admin) also work for cross-tenant support.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { exportToDocx } from '@/lib/export/docx-exporter';
import { emitEventSingle, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import type { CanvasDocument } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const { tenantSlug, proposalId, sectionId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json(
        { error: 'Invalid ID format', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Tenant access denied', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { document?: unknown; format?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const doc = body?.document as CanvasDocument | undefined;
    const format = body?.format as string | undefined;

    if (!doc || !doc.nodes) {
      return NextResponse.json(
        { error: 'document (CanvasDocument JSON) required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx' && format !== 'pdf') {
      return NextResponse.json(
        { error: `Format "${format}" not supported. Available: docx, pptx, xlsx, pdf`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Verify proposal belongs to tenant + download gate ──────────
    let proposal: { id: string; lockCount: number; isLocked: boolean; stage: string } | undefined;
    try {
      [proposal] = await sql<{ id: string; lockCount: number; isLocked: boolean; stage: string }[]>`
        SELECT id, lock_count, is_locked, stage FROM proposals
        WHERE id = ${proposalId}
          AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/sections/export] proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Download gate: must have completed at least one stage (lock_count >= 1)
    // OR proposal is in submitted/archived stage
    // Downloads are allowed on locked proposals — that's the whole point of locking.
    // They are also allowed on unlocked proposals that have been previously locked.
    if (proposal.lockCount < 1 && proposal.stage !== 'submitted' && proposal.stage !== 'archived') {
      return NextResponse.json(
        { error: 'Downloads available after final review and lock', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Verify section belongs to this proposal ──────────────────────
    let section: { id: string; title: string } | undefined;
    try {
      [section] = await sql<{ id: string; title: string }[]>`
        SELECT id, title FROM proposal_sections
        WHERE id = ${sectionId}
          AND proposal_id = ${proposalId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/sections/export] section query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!section) {
      return NextResponse.json(
        { error: 'Section not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Section-level access — a collaborator scoped to one section can't export
    //    another's content. (admin/tenant-wide member ⇒ all sections.)
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
      const canView = access.viewableSections.includes(sectionId)
        || access.commentableSections.includes(sectionId)
        || access.editableSections.includes(sectionId);
      if (!canView) {
        return NextResponse.json({ error: 'You do not have access to this section', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    const title = doc.metadata?.title || section.title || 'document';
    const vars: Record<string, string> = {
      company_name: (tenant as { name?: string }).name ?? 'Your Company',
      topic_number: doc.metadata?.title ?? 'TBD',
    };

    // ── Increment download count ────────────────────────────────────
    try {
      await sql`UPDATE proposals SET download_count = download_count + 1 WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid`;
    } catch (countErr) {
      console.error('[api/portal/proposals/sections/export] download_count increment error:', countErr);
    }

    // ── Generate export ──────────────────────────────────────────────
    let buffer: Buffer;

    if (format === 'pptx') {
      const { exportToPptx } = await import('@/lib/export/pptx-exporter');
      buffer = await exportToPptx(doc, vars);
    } else if (format === 'xlsx') {
      const { exportToXlsx } = await import('@/lib/export/xlsx-exporter');
      buffer = await exportToXlsx(doc, vars);
    } else if (format === 'pdf') {
      // PDF needs Chromium (infra dep) — return a clear 503 when unavailable
      // rather than a 500, so the UI can point the user at .docx.
      try {
        const { exportToPdf } = await import('@/lib/export/pdf-exporter');
        buffer = await exportToPdf(doc, vars);
      } catch (pdfErr) {
        console.error('[api/portal/proposals/sections/export] PDF render failed (Chromium unavailable?):', pdfErr);
        return NextResponse.json({ error: 'PDF export is temporarily unavailable. Use .docx, or download the PDF from the volume once locked.', code: 'EXPORT_ERROR' }, { status: 503 });
      }
    } else {
      buffer = await exportToDocx(doc, vars);
    }

    // ── Emit event ──────────────────────────────────────────────────
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'section.exported',
        actor: userActor(sessionUser.id, sessionUser.email ?? undefined),
        tenantId,
        payload: { proposalId, sectionId, format, title },
      });
    } catch (evtErr) {
      console.error('[api/portal/proposals/sections/export] event emission failed:', evtErr);
    }

    const contentTypes: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pdf: 'application/pdf',
    };

    // Sanitize the title before it enters the header — a raw quote or CR/LF
    // would corrupt or reject the Content-Disposition value.
    const safe = title.replace(/[^a-z0-9._-]+/gi, '_') || 'document';
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentTypes[format],
        'Content-Disposition': `attachment; filename="${safe}.${format}"`,
        'Content-Length': String(buffer.length),
      },
    });
  } catch (err) {
    console.error('[api/portal/proposals/sections/export] error:', err);
    return NextResponse.json(
      { error: 'Export failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
