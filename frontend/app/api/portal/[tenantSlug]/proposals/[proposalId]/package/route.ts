/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/package
 *
 * Generate complete proposal package as ZIP. Exports each section's canvas
 * document to the appropriate format (DOCX, PPTX, XLSX) and bundles them
 * into a single downloadable ZIP file.
 *
 * Auth: tenant_user or above with tenant access. Proposal must be locked.
 *
 * V1 TODO (P2-15): Implement full proposal package export.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
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
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement proposal package export
    //
    // 1. Verify proposal belongs to tenant and is locked:
    //    SELECT id, title, is_locked, lock_count, stage
    //    FROM proposals WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
    //    Reject if not locked (same gate as single-section export)
    //
    // 2. Fetch all sections with content:
    //    SELECT id, section_number, title, content
    //    FROM proposal_sections WHERE proposal_id = ${proposalId}
    //    ORDER BY section_number
    //
    // 3. For each section with canvas JSON content:
    //    a. Parse canvas JSON
    //    b. Determine export format from volume_required_items.volume_format
    //       (default to docx)
    //    c. Export using existing exporters:
    //       - docx: exportToDocx(doc, vars)
    //       - pptx: exportToPptx(doc, vars)
    //       - xlsx: exportToXlsx(doc, vars)
    //
    // 4. Bundle into ZIP using archiver or JSZip:
    //    const JSZip = (await import('jszip')).default;
    //    const zip = new JSZip();
    //    for (const section of sections) {
    //      zip.file(`${section.number}_${section.title}.${format}`, buffer);
    //    }
    //    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    //
    // 5. Increment download_count on proposal
    //
    // 6. Emit proposal:package.exported event
    //
    // 7. Return ZIP as binary response:
    //    return new NextResponse(new Uint8Array(zipBuffer), {
    //      headers: {
    //        'Content-Type': 'application/zip',
    //        'Content-Disposition': `attachment; filename="${proposalTitle}.zip"`,
    //      },
    //    });

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-15',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/package] error:', err);
    return NextResponse.json(
      { error: 'Package export failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
