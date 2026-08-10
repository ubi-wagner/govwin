/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/document
 *
 * Assemble the whole proposal into ONE continuous CanvasDocument for the fluid
 * "Document view" (fluid-canvas F1). Reads every section's canvas (ordered by
 * volume → sort_index → section_number, matching the workspace + package export)
 * and delegates to assembleProposalDocument, which concatenates them into a single
 * section-tagged document + an outline. Read-only aggregate; the per-span atomize
 * action is separately gated by the atomize-node route (per-section edit access).
 *
 * Returns: { data: AssembledProposal }
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { assembleProposalDocument, type ProposalSectionInput } from '@/lib/canvas/assemble-proposal';

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
    let rows: Array<{ id: string; title: string | null; content: unknown; volume_name: string | null }> = [];
    try {
      rows = await sql<typeof rows>`
        SELECT ps.id, ps.title, ps.content, ps.volume_name
        FROM proposal_sections ps
        WHERE ps.proposal_id = ${proposalId}::uuid
        ORDER BY ps.volume_number ASC NULLS LAST, ps.sort_index ASC NULLS LAST, ps.section_number ASC
      `;
    } catch (e) {
      console.error('[proposal/document] sections query failed', e);
      return NextResponse.json({ error: 'Failed to load sections', code: 'DB_ERROR' }, { status: 500 });
    }

    const inputs: ProposalSectionInput[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      content: (r.content as ProposalSectionInput['content']) ?? null,
      volumeName: r.volume_name,
    }));

    const assembled = assembleProposalDocument(inputs);
    return NextResponse.json({ data: assembled });
  } catch (err) {
    console.error('[proposal/document] error', err);
    return NextResponse.json({ error: 'Failed to assemble document', code: 'DB_ERROR' }, { status: 500 });
  }
}
