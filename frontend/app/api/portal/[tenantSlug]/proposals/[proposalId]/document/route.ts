/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/document
 *
 * Assemble the whole proposal into ONE continuous CanvasDocument for the fluid
 * "Document view" (fluid-canvas F1) — now the editable one-canvas surface (F2). Reads
 * every section's canvas (ordered by volume → sort_index → section_number, matching the
 * workspace + package export) and delegates to assembleProposalDocument, which
 * concatenates them into a single section-tagged document + an outline.
 *
 * F2 additions: alongside the assembled `doc`, returns a per-section `sections[]` carrying
 * everything the editable fluid surface needs to save each edit back to its OWNING section
 * through the SAME per-section save route (no new save path): `version` (the CAS baseVersion),
 * `isLocked`/`editable` (write gating — `editable` = resolveUserAccess.editableSections), the
 * section's own `canvas` frame + `metadata` (so a reconstructed per-section save-doc keeps its
 * own margins/format), plus `status`/`completedStage` for the readiness rollup. Reconstruction
 * happens at save time on the client from the (edited) assembled doc + these frames — so the
 * payload stays lean and the fragile canvas_versions CAS lives only in the section save route.
 *
 * Returns: { data: AssembledProposal & { sections: FluidSectionMeta[]; canManage: boolean } }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { resolveUserAccess, hasProposalVisibility } from '@/lib/proposal-access';
import { assembleProposalDocument, type ProposalSectionInput } from '@/lib/canvas/assemble-proposal';
import type { CanvasDocument } from '@/lib/types/canvas-document';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string }> },
) {
  try {
    const { tenantSlug, proposalId } = await params;

    // ---------- Auth ----------
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // ---------- Tenant + proposal ownership ----------
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point

    try {
      const [owned] = await sql<Array<{ id: string }>>`
        SELECT id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
      `;
      if (!owned) {
        return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
      }
    } catch (e) {
      console.error('[proposal/document] proposal ownership check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ---------- Sections (whole proposal, in reading order) ----------
    // NOTE: lib/db.ts applies a global `postgres.toCamel` column transform, so `ps.volume_name`
    // comes back as `volumeName`, `ps.is_locked` as `isLocked`, `ps.completed_stage` as
    // `completedStage`. The row type + reads MUST be camelCase — snake_case here silently yields
    // undefined (tsc can't see through the `sql<typeof rows>` assertion), which dropped every
    // section's volume grouping from the assembled document.
    let rows: Array<{
      id: string; title: string | null; content: unknown; volumeName: string | null;
      version: number; isLocked: boolean; completedStage: string | null; status: string | null;
    }> = [];
    try {
      rows = await sql<typeof rows>`
        SELECT ps.id, ps.title, ps.content, ps.volume_name,
               ps.version, ps.is_locked, ps.completed_stage, ps.status
        FROM proposal_sections ps
        WHERE ps.proposal_id = ${proposalId}::uuid
        ORDER BY ps.volume_number ASC NULLS LAST, ps.sort_index ASC NULLS LAST, ps.section_number ASC
      `;
    } catch (e) {
      console.error('[proposal/document] sections query failed', e);
      return NextResponse.json({ error: 'Failed to load sections', code: 'DB_ERROR' }, { status: 500 });
    }

    // ---------- Per-section access: write allowlist + VIEW gate ----------
    // resolveUserAccess is THE per-section allowlist (locked proposal → empty editable, current-
    // stage sections, collaborator scope). We use it for BOTH: `editable` (the write allowlist the
    // section save route re-enforces) AND a view gate. A CAP-3 proposal-scoped tenant_user or a
    // non-collaborator resolves to ZERO viewable sections — the workspace hides the Document tab
    // from them, and this route MUST refuse too rather than return the whole assembled proposal.
    // resolveUserAccess returns NO_ACCESS on its own internal error, so this fails CLOSED.
    const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
    const viewable = new Set(access.viewableSections);
    const editableSections = new Set(access.editableSections);
    const canManage = access.role === 'admin';
    if (!hasProposalVisibility(access)) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }

    // Restrict the assembled document to sections the caller may VIEW (tenant-wide → all sections;
    // a collaborator → only their granted sections). Strictly RESTRICTING — never widens.
    const visibleRows = rows.filter((r) => viewable.has(r.id));

    const inputs: ProposalSectionInput[] = visibleRows.map((r) => ({
      id: r.id,
      title: r.title,
      content: (r.content as ProposalSectionInput['content']) ?? null,
      volumeName: r.volumeName,
    }));

    const assembled = assembleProposalDocument(inputs);

    const sections = visibleRows.map((r) => {
      // The section's OWN canvas frame + metadata (margins/format/title) — a reconstructed
      // per-section save-doc must carry these, not the assembled doc's adopted single frame. For a
      // v2 (section-layer) doc we ALSO hand back the full `sourceDoc` so the fluid save can rebuild
      // its `sections[]`/layout/section_type/atom lineage instead of flattening it to v1.
      const parsed = coerceJsonb<CanvasDocument | null>(r.content, null);
      const isV2 = Array.isArray(parsed?.sections) && (parsed?.sections?.length ?? 0) > 0;
      return {
        id: r.id,
        title: r.title,
        volumeName: r.volumeName,
        version: Number(r.version ?? 0),
        isLocked: r.isLocked === true,
        editable: editableSections.has(r.id),
        status: r.status ?? 'empty',
        completedStage: r.completedStage ?? null,
        canvas: parsed?.canvas ?? null,
        metadata: parsed?.metadata ?? null,
        sourceDoc: isV2 ? parsed : null,
      };
    });

    return NextResponse.json({ data: { ...assembled, sections, canManage } });
  } catch (err) {
    console.error('[proposal/document] error', err);
    return NextResponse.json({ error: 'Failed to assemble document', code: 'DB_ERROR' }, { status: 500 });
  }
}
