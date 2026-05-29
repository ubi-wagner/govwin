import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/** The 5 stages enforced by the DB CHECK constraint on proposals.stage */
const DB_STAGES = ['draft', 'review', 'final', 'submitted', 'archived'] as const;

const VALID_REQUIREMENT_TYPES = [
  'all_sections_complete', 'compliance_check_passed',
  'min_sections_approved', 'admin_review_complete',
  'collaborator_signoff', 'custom',
] as const;

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/gates
 *
 * Returns stage gate requirements and their completion status.
 * Optionally filter by ?stage=<stage_name>.
 * Auth: any tenant member with access.
 */
export async function GET(request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthenticated', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
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

    // Verify proposal belongs to tenant
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/gates] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // ── Proposal-level access check for non-admin users ─────────────
    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      try {
        const [collab] = await sql<{ userId: string }[]>`
          SELECT user_id FROM proposal_collaborators
          WHERE proposal_id = ${proposalId}::uuid AND user_id = ${sessionUser.id}::uuid
          LIMIT 1
        `;
        if (!collab) {
          return NextResponse.json(
            { error: 'You are not a collaborator on this proposal', code: 'FORBIDDEN' },
            { status: 403 },
          );
        }
      } catch (e) {
        console.error('[portal/proposals/gates] collaborator check failed:', e);
        return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
      }
    }

    const url = new URL(request.url);
    const stageFilter = url.searchParams.get('stage');

    type RequirementRow = {
      id: string;
      proposalId: string;
      stage: string;
      requirementType: string;
      label: string;
      description: string | null;
      isMet: boolean;
      metBy: string | null;
      metAt: Date | null;
      evidence: Record<string, unknown>;
      createdAt: Date;
      updatedAt: Date;
    };

    let requirements: RequirementRow[];
    try {
      if (stageFilter) {
        requirements = await sql<RequirementRow[]>`
          SELECT id, proposal_id, stage, requirement_type, label, description,
                 is_met, met_by, met_at, evidence, created_at, updated_at
          FROM stage_gate_requirements
          WHERE proposal_id = ${proposalId}::uuid
            AND stage = ${stageFilter}
          ORDER BY created_at ASC
        `;
      } else {
        requirements = await sql<RequirementRow[]>`
          SELECT id, proposal_id, stage, requirement_type, label, description,
                 is_met, met_by, met_at, evidence, created_at, updated_at
          FROM stage_gate_requirements
          WHERE proposal_id = ${proposalId}::uuid
          ORDER BY stage ASC, created_at ASC
        `;
      }
    } catch (e) {
      console.error('[portal/proposals/gates] requirements query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        requirements: requirements.map((r) => ({
          id: r.id,
          proposalId: r.proposalId,
          stage: r.stage,
          requirementType: r.requirementType,
          label: r.label,
          description: r.description,
          isMet: r.isMet,
          metBy: r.metBy,
          metAt: r.metAt,
          evidence: r.evidence,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        })),
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/gates] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/gates
 *
 * Create a stage gate requirement.
 * Auth: tenant_admin or higher.
 *
 * Body: { stage, requirementType, label, description? }
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
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

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
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

    // Verify proposal belongs to tenant and fetch its gate_config
    let proposal: { id: string; gateConfig: string[] | null; isLocked: boolean } | undefined;
    try {
      [proposal] = await sql<{ id: string; gateConfig: string[] | null; isLocked: boolean }[]>`
        SELECT id, gate_config, is_locked FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/gates] POST proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (proposal.isLocked) {
      return NextResponse.json(
        { error: 'Cannot modify gates on a locked proposal', code: 'PROPOSAL_LOCKED' },
        { status: 423 },
      );
    }

    // Parse body
    let body: {
      stage?: unknown;
      requirementType?: unknown;
      label?: unknown;
      description?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const stage = typeof body.stage === 'string' ? body.stage.trim() : '';
    const requirementType = typeof body.requirementType === 'string' ? body.requirementType : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : null;

    if (!stage) {
      return NextResponse.json(
        { error: 'stage is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Stage must be a valid DB value AND in this proposal's gate_config
    const proposalGates = (proposal.gateConfig && proposal.gateConfig.length > 0)
      ? proposal.gateConfig
      : ['draft', 'final'];
    if (!(DB_STAGES as readonly string[]).includes(stage) || !proposalGates.includes(stage)) {
      return NextResponse.json(
        { error: `stage must be one of: ${proposalGates.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    if (stage.length > 100) {
      return NextResponse.json(
        { error: 'stage exceeds maximum length (100 chars)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!(VALID_REQUIREMENT_TYPES as readonly string[]).includes(requirementType)) {
      return NextResponse.json(
        { error: `requirementType must be one of: ${VALID_REQUIREMENT_TYPES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!label) {
      return NextResponse.json(
        { error: 'label is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (label.length > 500) {
      return NextResponse.json(
        { error: 'label exceeds maximum length (500 chars)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (description && description.length > 2000) {
      return NextResponse.json(
        { error: 'description exceeds maximum length (2000 chars)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Start event for gate requirement creation ──────────────────
    const gateStartId = await emitEventStart({
      namespace: 'proposal',
      type: 'gate_requirement.created',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, stage, label, requirementType },
    });

    let requirement: { id: string; createdAt: Date };
    try {
      [requirement] = await sql<{ id: string; createdAt: Date }[]>`
        INSERT INTO stage_gate_requirements
          (proposal_id, stage, requirement_type, label, description)
        VALUES (${proposalId}::uuid, ${stage}, ${requirementType}, ${label}, ${description})
        RETURNING id, created_at
      `;
    } catch (e) {
      console.error('[portal/proposals/gates] requirement insert failed:', e);
      await emitEventEnd(gateStartId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    await emitEventEnd(gateStartId, {
      result: { proposalId, requirementId: requirement.id, stage, label, requirementType },
    });

    return NextResponse.json({
      data: {
        id: requirement.id,
        proposalId,
        stage,
        requirementType,
        label,
        description,
        isMet: false,
        createdAt: requirement.createdAt,
      },
    }, { status: 201 });
  } catch (e) {
    console.error('[api/portal/proposals/gates] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/portal/[tenantSlug]/proposals/[proposalId]/gates
 *
 * Mark a stage gate requirement as met or unmet.
 * Auth: tenant_admin or higher.
 *
 * Body: { requirementId, isMet, evidence? }
 */
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
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

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json(
        { error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' },
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

    // Verify proposal belongs to tenant
    let proposal: { id: string; isLocked: boolean } | undefined;
    try {
      [proposal] = await sql<{ id: string; isLocked: boolean }[]>`
        SELECT id, is_locked FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/gates] PATCH proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    if (proposal.isLocked) {
      return NextResponse.json(
        { error: 'Cannot modify gates on a locked proposal', code: 'PROPOSAL_LOCKED' },
        { status: 423 },
      );
    }

    // Parse body
    let body: {
      requirementId?: unknown;
      isMet?: unknown;
      evidence?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const requirementId = typeof body.requirementId === 'string' ? body.requirementId : '';
    if (!requirementId || !isValidUUID(requirementId)) {
      return NextResponse.json(
        { error: 'Valid requirementId is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (typeof body.isMet !== 'boolean') {
      return NextResponse.json(
        { error: 'isMet must be a boolean', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const isMet = body.isMet;
    const evidence = typeof body.evidence === 'object' && body.evidence !== null
      ? body.evidence
      : {};

    // Evidence size limit (10KB)
    if (JSON.stringify(evidence).length > 10_240) {
      return NextResponse.json(
        { error: 'evidence exceeds maximum size (10KB)', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Start event for gate requirement toggle ──────────────────
    const toggleStartId = await emitEventStart({
      namespace: 'proposal',
      type: 'gate_requirement.toggled',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, requirementId, isMet },
    });

    let updateResult;
    try {
      if (isMet) {
        updateResult = await sql`
          UPDATE stage_gate_requirements
          SET is_met = true,
              met_by = ${sessionUser.id}::uuid,
              met_at = now(),
              evidence = ${JSON.stringify(evidence)}::jsonb,
              updated_at = now()
          WHERE id = ${requirementId}::uuid
            AND proposal_id = ${proposalId}::uuid
        `;
      } else {
        updateResult = await sql`
          UPDATE stage_gate_requirements
          SET is_met = false,
              met_by = NULL,
              met_at = NULL,
              evidence = '{}'::jsonb,
              updated_at = now()
          WHERE id = ${requirementId}::uuid
            AND proposal_id = ${proposalId}::uuid
        `;
      }
    } catch (e) {
      console.error('[portal/proposals/gates] requirement update failed:', e);
      await emitEventEnd(toggleStartId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (updateResult.count === 0) {
      await emitEventEnd(toggleStartId, { error: { message: 'Requirement not found', code: 'NOT_FOUND' } });
      return NextResponse.json(
        { error: 'Requirement not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }

    // Fetch stage for event payload
    let reqStage: string | undefined;
    try {
      const [reqRow] = await sql<{ stage: string }[]>`
        SELECT stage FROM stage_gate_requirements
        WHERE id = ${requirementId}::uuid
        LIMIT 1
      `;
      reqStage = reqRow?.stage;
    } catch {
      // Non-fatal — stage is just for the event payload
    }

    await emitEventEnd(toggleStartId, {
      result: { proposalId, requirementId, isMet, stage: reqStage ?? null },
    });

    return NextResponse.json({
      data: {
        id: requirementId,
        isMet,
        metBy: isMet ? sessionUser.id : null,
        metAt: isMet ? new Date().toISOString() : null,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/gates] PATCH error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
