/**
 * Section assignment (SPINE-T1).
 *   GET   → the pickable assignees for this proposal (tenant editors + proposal collaborators).
 *   PATCH → assign the section to a user (or clear): { assigneeUserId: string | null }.
 *
 * Sets `proposal_sections.assigned_to` and raises/repoints the assignee's `edit_section` ToDo, which
 * deep-links to the section editor and auto-completes when the section is locked. Assigner = tenant_admin+
 * (canManageTeam) OR a delegated portal manager; assignee must have edit access to the section.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyProposalAccess, enterTenant, sql } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { assignSection, listSectionAssignees } from '@/lib/proposal/section-todo';
import { isPortalManager } from '@/lib/portal-workflow';

async function gate(tenantSlug: string, proposalId: string, sectionId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string | null; role?: unknown; tenantId?: string | null };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) return { error: NextResponse.json({ error: 'Invalid ID format', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyProposalAccess(u.id, role, u.tenantId, tenantId, proposalId))) {
    return { error: NextResponse.json({ error: 'Proposal access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  enterTenant(tenantId);
  return { tenantId, userId: u.id, email: u.email ?? null, role };
}

export async function GET(_request: Request, { params }: { params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }> }) {
  try {
    const { tenantSlug, proposalId, sectionId } = await params;
    const g = await gate(tenantSlug, proposalId, sectionId);
    if ('error' in g) return g.error;
    const assignees = await listSectionAssignees(g.tenantId, proposalId);
    return NextResponse.json({ data: { assignees } });
  } catch (err) {
    console.error('[sections/assign] GET error', err);
    return NextResponse.json({ error: 'Failed to load assignees', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }> }) {
  try {
    const { tenantSlug, proposalId, sectionId } = await params;
    const g = await gate(tenantSlug, proposalId, sectionId);
    if ('error' in g) return g.error;

    let body: { assigneeUserId?: string | null };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }
    const assigneeUserId = typeof body.assigneeUserId === 'string' && body.assigneeUserId ? body.assigneeUserId : null;
    if (assigneeUserId && !isValidUUID(assigneeUserId)) {
      return NextResponse.json({ error: 'Invalid assignee id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // A delegated portal MANAGER (non-admin) may also assign — resolve the section's owning portal.
    let isManager = false;
    try {
      const [p] = await sql<Array<{ portalId: string | null }>>`
        SELECT id AS "portalId" FROM proposal_portals WHERE tenant_id = ${g.tenantId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1`;
      if (p?.portalId) isManager = await isPortalManager(g.tenantId, p.portalId, g.email);
    } catch { /* best-effort — the lib still gates on canManageTeam */ }

    const actor = { id: g.userId, email: g.email, role: g.role, tenantId: g.tenantId };
    const result = await assignSection(actor, g.tenantId, proposalId, sectionId, assigneeUserId, { isManager });
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[sections/assign] PATCH error', err);
    return NextResponse.json({ error: 'Failed to assign section', code: 'DB_ERROR' }, { status: 500 });
  }
}
