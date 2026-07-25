/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/artifacts/[artifactId]/layout
 *
 * Read-only page-budget metrics for one volume: assembles the artifact's molds
 * (the same v2 flow assembly the export uses) and measures the layout with
 * paginate() — so the workspace can show "8 / 15 pages" and per-section spans
 * WHILE the proposal is being built, not only at download.
 *
 * Documents → paginate() page count; slides → one page per section; a
 * spreadsheet reports its tab count (it doesn't paginate). No lock gate: this is
 * read-only guidance, useful before anything is locked.
 *
 * Auth: proposal access (tenant member or accepted collaborator).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyProposalAccess, enterTenant } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { assembleArtifactCanvas } from '@/lib/export/artifact-export';
import { paginate } from '@/lib/export/paginate';
import { sectionsToNodes } from '@/lib/types/canvas-document';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string; artifactId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId, artifactId } = await ctx.params;
    if (!isValidUUID(proposalId) || !isValidUUID(artifactId)) {
      return NextResponse.json({ error: 'Invalid id format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(su.role) ? su.role : null;
    if (!role || !su.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyProposalAccess(su.id, role, su.tenantId, tenantId, proposalId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    enterTenant(tenantId);

    // ── Artifact + its sections ────────────────────────────────────────
    let artifact: { id: string; artifactType: string | null; volumeName: string | null } | undefined;
    let sections: { title: string | null; content: string | null }[] = [];
    try {
      [artifact] = await sql<{ id: string; artifactType: string | null; volumeName: string | null }[]>`
        SELECT id, artifact_type AS "artifactType", volume_name AS "volumeName" FROM proposal_artifacts
        WHERE id = ${artifactId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1
      `;
      if (artifact) {
        sections = await sql<{ title: string | null; content: string | null }[]>`
          SELECT title, content FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid AND artifact_id = ${artifactId}::uuid
          ORDER BY section_number
        `;
      }
    } catch (e) {
      console.error('[artifacts/layout] query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!artifact) {
      return NextResponse.json({ error: 'Artifact not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // ── Assemble (v2 flow) + measure ───────────────────────────────────
    const assembled = assembleArtifactCanvas(sections, artifact.artifactType, artifact.volumeName || 'artifact');
    const fmt = assembled.canvas?.format ?? 'letter';

    if (fmt === 'spreadsheet') {
      const tabs = (assembled.sections ?? []).reduce(
        (n, s) => n + sectionsToNodes([s]).filter((nd) => nd.type === 'table').length,
        0,
      );
      return NextResponse.json({ data: { unit: 'tabs', format: fmt, tabs } });
    }

    if (fmt.startsWith('slide')) {
      const slides = assembled.sections?.length ?? 0;
      const max = assembled.canvas?.max_slides ?? null;
      return NextResponse.json({
        data: {
          unit: 'slides', format: fmt, totalPages: slides, maxPages: max,
          over: max != null && slides > max,
          perSection: (assembled.sections ?? []).map((s, i) => ({ title: s.title ?? null, startPage: i + 1, endPage: i + 1, pagesUsed: 1 })),
        },
      });
    }

    const layout = paginate(assembled);
    return NextResponse.json({
      data: {
        unit: 'pages', format: fmt,
        totalPages: layout.totalPages,
        maxPages: layout.vsMaxPages.max,
        over: layout.vsMaxPages.over,
        perSection: layout.perSection.map((s) => ({ title: s.title ?? null, startPage: s.startPage, endPage: s.endPage, pagesUsed: s.pagesUsed })),
      },
    });
  } catch (e) {
    console.error('[artifacts/layout] unexpected error:', e);
    return NextResponse.json({ error: 'Internal error', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
