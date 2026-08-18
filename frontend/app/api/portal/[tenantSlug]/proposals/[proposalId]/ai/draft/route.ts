/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/ai/draft
 *
 * Queue AI draft jobs for proposal sections. For each section that is empty
 * or has status='empty', search library for relevant units, then emit a
 * system event that the pipeline can pick up to draft via Claude.
 *
 * Body: { sectionId?: string, instructions?: string }
 *   - If sectionId provided, only draft that one section
 *   - If omitted, queue drafting for all empty sections
 *
 * Auth: tenant_user or above with tenant access to this proposal.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';

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
    enterTenant(tenantId);

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

    // ── Start event for AI draft ──────────────────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'proposal.draft_requested',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: { proposalId, sectionId: body.sectionId ?? null, instructions: body.instructions ?? null },
    });

    // ── Business logic ───────────────────────────────────────────
    try {
      // Verify proposal belongs to this tenant
      const [proposal] = await sql<{
        id: string;
        title: string;
        solicitationId: string | null;
      }[]>`
        SELECT id, title, solicitation_id
        FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}::uuid
      `;

      if (!proposal) {
        await emitEventEnd(startId, { error: { message: 'proposal not found', code: 'NOT_FOUND' } });
        return NextResponse.json(
          { error: 'Proposal not found', code: 'NOT_FOUND' },
          { status: 404 },
        );
      }

      // Fetch sections to draft
      let sections: { id: string; title: string; status: string }[];
      if (body.sectionId) {
        sections = await sql<{ id: string; title: string; status: string }[]>`
          SELECT id, title, status
          FROM proposal_sections
          WHERE id = ${body.sectionId} AND proposal_id = ${proposalId}
        `;
        if (sections.length === 0) {
          await emitEventEnd(startId, { error: { message: 'section not found', code: 'NOT_FOUND' } });
          return NextResponse.json(
            { error: 'Section not found', code: 'NOT_FOUND' },
            { status: 404 },
          );
        }
      } else {
        // All empty sections
        sections = await sql<{ id: string; title: string; status: string }[]>`
          SELECT id, title, status
          FROM proposal_sections
          WHERE proposal_id = ${proposalId}
            AND (status = 'empty' OR content IS NULL)
          ORDER BY section_number ASC
        `;
      }

      if (sections.length === 0) {
        return NextResponse.json({
          data: { sections_queued: 0, message: 'No empty sections to draft' },
        });
      }

      // Count sections that will be drafted via the tool-invoke path.
      // The actual drafting happens client-side via invoke('proposal.draft_section')
      // in draft-all-sections.tsx — this route only validates and records the request.
      const sectionsQueued = sections.length;

      // ── End event for AI draft ──────────────────────────────────
      await emitEventEnd(startId, {
        result: {
          proposalId,
          sectionsQueued,
          instructions: body.instructions ?? null,
        },
      });

      // ── Activity log ──────────────────────────────────────────────
      try {
        await sql`
          INSERT INTO proposal_activity_log
            (proposal_id, tenant_id, actor_id, actor_email, actor_role,
             activity_type, details)
          VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                  ${sessionUser.email ?? null}, ${role},
                  'ai_draft_requested',
                  ${sql.json({ sections_queued: sectionsQueued, instructions: body.instructions ?? null })})
        `;
      } catch (logErr) {
        console.error('[portal/proposals/ai/draft] activity log failed', logErr);
      }

      return NextResponse.json({
        data: { sections_queued: sectionsQueued },
      });
    } catch (dbErr) {
      console.error('[portal/proposals/ai/draft] DB error:', dbErr);
      await emitEventEnd(startId, { error: { message: String(dbErr), code: 'DB_ERROR' } });
      return NextResponse.json(
        { error: 'AI draft queuing failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/proposals/ai/draft] error:', err);
    return NextResponse.json(
      { error: 'AI draft failed', code: 'AI_ERROR' },
      { status: 500 },
    );
  }
}
