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

      // For each section, find relevant library context and queue a job
      let sectionsQueued = 0;
      for (const section of sections) {
        // Search library for relevant units by section title
        const escaped = section.title.replace(/[%_\\]/g, '\\$&');
        const pattern = `%${escaped}%`;
        const libraryContext = await sql<{ id: string; content: string; category: string }[]>`
          SELECT id, content, category
          FROM library_units
          WHERE tenant_id = ${tenantId}::uuid
            AND status = 'approved'
            AND (content ILIKE ${pattern} OR category ILIKE ${pattern})
          ORDER BY outcome_score DESC NULLS LAST
          LIMIT 5
        `;

        // Queue via pipeline_jobs
        const jobPayload = JSON.stringify({
          kind: 'draft_section',
          section_id: section.id,
          proposal_id: proposalId,
          tenant_id: tenantId,
          section_title: section.title,
          solicitation_id: proposal.solicitationId,
          library_context: libraryContext.map((u) => ({
            id: u.id,
            content: u.content.substring(0, 2000),
            category: u.category,
          })),
          instructions: body.instructions ?? null,
        });

        await sql`
          INSERT INTO pipeline_jobs (source, kind, status, priority, metadata)
          VALUES ('portal', 'draft_section', 'pending', 5, ${jobPayload}::jsonb)
        `;

        sectionsQueued++;
      }

      // Emit event for pipeline to pick up
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.draft_requested',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
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
                  ${JSON.stringify({ sections_queued: sectionsQueued, instructions: body.instructions ?? null })}::jsonb)
        `;
      } catch (logErr) {
        console.error('[portal/proposals/ai/draft] activity log failed', logErr);
      }

      return NextResponse.json({
        data: { sections_queued: sectionsQueued },
      });
    } catch (dbErr) {
      console.error('[portal/proposals/ai/draft] DB error:', dbErr);
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
