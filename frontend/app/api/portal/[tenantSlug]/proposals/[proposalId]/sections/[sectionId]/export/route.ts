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
import { isRole } from '@/lib/rbac';
import { exportToDocx } from '@/lib/export/docx-exporter';
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

    if (format !== 'docx' && format !== 'pptx' && format !== 'xlsx') {
      return NextResponse.json(
        { error: `Format "${format}" not supported. Available: docx, pptx, xlsx`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Verify proposal belongs to tenant + download gate ──────────
    const [proposal] = await sql<{ id: string; lockCount: number; isLocked: boolean; stage: string }[]>`
      SELECT id, lock_count, is_locked, stage FROM proposals
      WHERE id = ${proposalId}
        AND tenant_id = ${tenantId}
      LIMIT 1
    `;

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Download gate: must be locked at final stage with at least one lock
    if (!(proposal.lockCount >= 1 && proposal.isLocked)) {
      return NextResponse.json(
        { error: 'Downloads available after final review and lock', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Verify section belongs to this proposal ──────────────────────
    const [section] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM proposal_sections
      WHERE id = ${sectionId}
        AND proposal_id = ${proposalId}
      LIMIT 1
    `;

    if (!section) {
      return NextResponse.json(
        { error: 'Section not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    const title = doc.metadata?.title || section.title || 'document';
    const vars: Record<string, string> = {
      company_name: (tenant as { name?: string }).name ?? 'Your Company',
      topic_number: doc.metadata?.title ?? 'TBD',
    };

    // ── Increment download count ────────────────────────────────────
    try {
      await sql`UPDATE proposals SET download_count = download_count + 1 WHERE id = ${proposalId}`;
    } catch (countErr) {
      console.error('[api/portal/proposals/sections/export] download_count increment error:', countErr);
    }

    // ── Generate export ──────────────────────────────────────────────
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
    console.error('[api/portal/proposals/sections/export] error:', err);
    return NextResponse.json(
      { error: `Export failed: ${err instanceof Error ? err.message : String(err)}`, code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
