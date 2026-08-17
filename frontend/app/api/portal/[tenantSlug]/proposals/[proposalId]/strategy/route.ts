/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/strategy
 *
 * The read-on-review surface for the OnProposalCreated advisory AI actors (#1): capture
 * strategy, market research, past-performance matches, and cost-realism guidance. These run
 * when a proposal is created and their output lands in the workflow instance's step_results,
 * but nothing rendered it. This reads the LATEST OnProposalCreated instance for the proposal
 * and returns the extracted text per section (see lib/proposal/strategy.ts). Read-only;
 * advisory — it never advances anything.
 *
 * Auth: tenant_user+ WITH tenant access (partner_user viewers pass the role floor via their
 * membership, same as the compliance matrix read). NOTE: OnProposalCreated keys its payload
 * on `proposalId` (camelCase), unlike the OnFullDraftRequested `proposal_id` — match exactly.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import { buildProposalStrategy } from '@/lib/proposal/strategy';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal id', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const u = session.user as { id?: string; role?: unknown };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (!hasRoleAtLeast(role, 'tenant_user')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }
    const tenantId = tenant.id as string;
    if (!(await verifyTenantAccess(u.id, role, tenantId))) {
      return NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 });
    }
    enterTenant(tenantId); // RLS choke point

    // Latest OnProposalCreated instance for this proposal (camelCase proposalId key).
    let inst: { stepResults: unknown; startedAt: Date | string | null } | undefined;
    try {
      [inst] = await sql<Array<{ stepResults: unknown; startedAt: Date | string | null }>>`
        SELECT step_results, started_at
        FROM process_instances
        WHERE tenant_id = ${tenantId}::uuid
          AND workflow_name LIKE 'OnProposalCreated%'
          AND payload->>'proposalId' = ${proposalId}
        ORDER BY started_at DESC NULLS LAST
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/strategy] query failed:', dbErr);
      return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!inst) {
      return NextResponse.json({ data: { sections: [], generatedAt: null, hasAny: false } });
    }

    const generatedAt = inst.startedAt
      ? (inst.startedAt instanceof Date ? inst.startedAt : new Date(inst.startedAt))
      : null;
    const generatedIso = generatedAt && !Number.isNaN(generatedAt.getTime()) ? generatedAt.toISOString() : null;

    const strategy = buildProposalStrategy(
      coerceJsonb<Record<string, unknown>>(inst.stepResults, {}),
      generatedIso,
    );
    return NextResponse.json({ data: strategy });
  } catch (e) {
    console.error('[api/portal/proposals/strategy] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
