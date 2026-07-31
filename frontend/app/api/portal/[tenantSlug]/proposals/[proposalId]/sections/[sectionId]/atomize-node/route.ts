/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/sections/[sectionId]/atomize-node
 *
 * Accept a SINGLE canvas node into the tenant library — the manual, node-level
 * "atomize this into my library" action from the canvas rail (the on-demand
 * complement to the lock-triggered harvest). Delegates to harvestNodeToLibrary,
 * which crystallizes an immutable, context-bound atom with author + lineage.
 *
 * Body: { nodeId, heading?, text, sectionType?, tags?[], parentUnitId? }
 * Returns: { data: { unitId, deduped } }
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { resolveUserAccess } from '@/lib/proposal-access';
import { isValidUUID } from '@/lib/validation';
import { createAtom, type AtomTagInput } from '@/lib/atoms';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tenantSlug: string; proposalId: string; sectionId: string }> },
) {
  try {
    const { tenantSlug, proposalId, sectionId } = await params;

    // ---------- Auth ----------
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const sessionUser = session.user as { id?: string; role?: unknown; email?: string };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!isValidUUID(proposalId) || !isValidUUID(sectionId)) {
      return NextResponse.json({ error: 'Invalid proposal or section ID', code: 'VALIDATION_ERROR' }, { status: 400 });
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
    enterTenant(tenantId); // RLS choke point: pin tenant context in the handler's own frame

    // Confirm the proposal belongs to this tenant (never trust the id alone).
    try {
      const [owned] = await sql<Array<{ id: string }>>`
        SELECT id FROM proposals WHERE id = ${proposalId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
      `;
      if (!owned) {
        return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
      }
    } catch (e) {
      console.error('[atomize-node] proposal ownership check failed', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ---------- Section-level EDIT access ----------
    // Harvesting a node into the library is a curation action — a collaborator
    // must hold EDIT access to THIS section (admin/tenant-wide member ⇒ all).
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      const access = await resolveUserAccess(sessionUser.id, proposalId, tenantId);
      if (!access.editableSections.includes(sectionId)) {
        return NextResponse.json({ error: 'You do not have edit access to this section', code: 'FORBIDDEN' }, { status: 403 });
      }
    }

    // ---------- Body ----------
    let body: {
      nodeId?: string;
      heading?: string | null;
      text?: string;
      sectionType?: string | null;
      tags?: string[];
      parentUnitId?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!body.nodeId || typeof body.nodeId !== 'string') {
      return NextResponse.json({ error: 'nodeId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (!body.text || typeof body.text !== 'string' || body.text.trim().length < 20) {
      return NextResponse.json({ error: 'text is required (min 20 chars of content)', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    // ---------- Create an atom from the accepted node ----------
    // Node-level accept crystallizes ONE primitive atom in the canonical library
    // (library_atoms), tagged so it is immediately selectable for the next mold.
    let result: { unitId: string | null; deduped: boolean };
    try {
      const nodeTags: AtomTagInput[] = [
        { dimension: 'kind', value: 'narrative', source: 'auto', confirmed: true },
        ...(body.sectionType
          ? [{ dimension: 'vol', value: body.sectionType, source: 'auto', confirmed: true } as AtomTagInput]
          : []),
      ];
      const { atomId } = await createAtom(
        tenantId,
        {
          grain: 'primitive',
          title: body.heading ?? null,
          content: body.text,
          source: 'harvest',
          creatorKind: 'collaborator',
          status: 'approved',
          originProposalId: proposalId,
          originSectionId: sectionId,
          tags: nodeTags,
        },
        { id: sessionUser.id, kind: 'collaborator' },
      );
      result = { unitId: atomId, deduped: false };
    } catch (e) {
      console.error('[atomize-node] atom creation failed', e);
      return NextResponse.json({ error: 'Failed to accept node into library', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!result.unitId) {
      return NextResponse.json({ error: 'Node could not be atomized', code: 'NO_ATOM' }, { status: 422 });
    }
    try {
      await emitEventSingle({
        namespace: 'library',
        type: 'atom.created',
        actor: userActor(sessionUser.id!, sessionUser.email ?? undefined),
        tenantId,
        payload: { atomId: result.unitId, grain: 'primitive', source: 'harvest', originProposalId: proposalId, originSectionId: sectionId },
      });
    } catch (evtErr) {
      console.error('[atomize-node] atom.created emit failed (non-fatal)', evtErr);
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[atomize-node] error', err);
    return NextResponse.json({ error: 'Failed to accept node', code: 'DB_ERROR' }, { status: 500 });
  }
}
