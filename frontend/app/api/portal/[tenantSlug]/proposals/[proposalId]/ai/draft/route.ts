/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft
 *
 * Trigger AI draft for a specific proposal section. Reads the section's
 * requirement_ids, fetches matching compliance items and library atoms,
 * calls Claude to generate draft content, saves to proposal_sections.content.
 *
 * Body: { sectionId: string, instructions?: string }
 *
 * Auth: tenant_user or above with tenant access to this proposal.
 *
 * V1 TODO (P2-11): Implement AI drafting with Claude.
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

    // ── Tenant lookup + access ───────────────────────────────────
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

    // ── Input validation ─────────────────────────────────────────
    let body: { sectionId?: string; instructions?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    if (!body.sectionId || typeof body.sectionId !== 'string') {
      return NextResponse.json(
        { error: 'sectionId (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement AI section drafting
    //
    // 1. Verify proposal belongs to tenant:
    //    SELECT id, title, solicitation_id FROM proposals
    //    WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
    //
    // 2. Fetch section:
    //    SELECT id, title, requirement_ids, content FROM proposal_sections
    //    WHERE id = ${body.sectionId} AND proposal_id = ${proposalId}
    //
    // 3. Fetch compliance items matching requirement_ids:
    //    SELECT * FROM solicitation_compliance
    //    WHERE solicitation_id = <proposal.solicitation_id>
    //
    // 4. Fetch relevant library atoms for this tenant:
    //    SELECT content, category FROM library_units
    //    WHERE tenant_id = ${tenantId}::uuid AND status = 'approved'
    //    ORDER BY outcome_score DESC LIMIT 10
    //
    // 5. Build prompt with: RFP requirements + compliance matrix + library context
    //    + user instructions (if provided)
    //
    // 6. Call Claude (Sonnet for drafting):
    //    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    //    const client = new Anthropic();
    //    const response = await client.messages.create({...})
    //
    // 7. Save draft to proposal_sections.content:
    //    UPDATE proposal_sections SET content = ${draft}, version = version + 1,
    //    status = 'ai_drafted', updated_at = now()
    //    WHERE id = ${body.sectionId}
    //
    // 8. Emit event:
    //    await emitEventSingle({ namespace: 'proposal', type: 'section.drafted', ... })
    //
    // 9. Return { data: { sectionId, draftLength, model, tokensUsed } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-11',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/proposals/ai/draft] error:', err);
    return NextResponse.json(
      { error: 'AI draft failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
