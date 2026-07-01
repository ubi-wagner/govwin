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
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { harvestNodeToLibrary } from '@/lib/proposal-harvest';

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
    const sessionUser = session.user as { id?: string; role?: unknown };
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
    const tags = Array.isArray(body.tags) ? body.tags.filter((t) => typeof t === 'string') : [];

    // ---------- Harvest the node ----------
    let result: { unitId: string | null; deduped: boolean };
    try {
      result = await harvestNodeToLibrary(
        tenantId,
        proposalId,
        sectionId,
        {
          nodeId: body.nodeId,
          heading: body.heading ?? null,
          text: body.text,
          sectionType: body.sectionType ?? null,
          tags,
          parentUnitId: body.parentUnitId && isValidUUID(body.parentUnitId) ? body.parentUnitId : null,
        },
        sessionUser.id,
      );
    } catch (e) {
      console.error('[atomize-node] harvest failed', e);
      return NextResponse.json({ error: 'Failed to accept node into library', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!result.unitId) {
      return NextResponse.json({ error: 'Node could not be atomized', code: 'NO_ATOM' }, { status: 422 });
    }
    return NextResponse.json({ data: result });
  } catch (err) {
    console.error('[atomize-node] error', err);
    return NextResponse.json({ error: 'Failed to accept node', code: 'DB_ERROR' }, { status: 500 });
  }
}
