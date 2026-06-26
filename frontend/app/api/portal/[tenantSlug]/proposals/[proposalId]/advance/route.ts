import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, userActor } from '@/lib/events';
import { isValidUUID } from '@/lib/validation';
import { requestAgentTask } from '@/lib/agent-client';
import { getNodeText, type CanvasNode } from '@/lib/types/canvas-document';

/** Extract plain prose from a section's canvas JSON for AI review (not raw JSON). */
function extractCanvasText(content: string | null): string {
  if (!content) return '';
  try {
    const doc = JSON.parse(content) as { nodes?: unknown[] };
    if (!Array.isArray(doc.nodes)) return '';
    return doc.nodes
      .map((n) => getNodeText(n as CanvasNode))
      .filter(Boolean)
      .join('\n\n')
      .trim();
  } catch {
    return '';
  }
}

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/advance
 *
 * Advances a proposal to the next gate in its configurable gate_config.
 * Replaces the old 7-stage Color Team pipeline.
 * Auth: tenant_admin or higher.
 *
 * Body: { targetStage?: string, notes?: string }
 * If targetStage is omitted, advances to the next gate automatically.
 */
export async function POST(request: Request, ctx: RouteContext) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      email?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    const { tenantSlug, proposalId } = await ctx.params;
    if (!isValidUUID(proposalId)) {
      return NextResponse.json({ error: 'Invalid proposal ID format', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    // ── Input validation ─────────────────────────────────────────────
    let body: { targetStage?: unknown; notes?: unknown; force?: boolean } = {};
    try {
      body = await request.json();
    } catch {
      // No body is acceptable — will auto-advance to next gate
    }

    const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null;

    // ── Load current proposal ────────────────────────────────────────
    let proposal: {
      id: string;
      stage: string;
      title: string;
      gateConfig: string[];
      lockCount: number;
      isLocked: boolean;
      version: number;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        stage: string;
        title: string;
        gateConfig: string[];
        lockCount: number;
        isLocked: boolean;
        version: number;
      }[]>`
        SELECT id, stage, title, gate_config, lock_count, is_locked, version FROM proposals
        WHERE id = ${proposalId}::uuid
          AND tenant_id = ${tenantId}::uuid
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/advance] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Proposal is locked', code: 'LOCKED' }, { status: 409 });
    }

    // ── Determine next stage from gate_config ────────────────────────
    const gates = (proposal.gateConfig || ['draft', 'final']) as string[];
    const currentIndex = gates.indexOf(proposal.stage);

    if (currentIndex === -1) {
      return NextResponse.json(
        { error: `Current stage '${proposal.stage}' is not in gate config`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    if (currentIndex >= gates.length - 1) {
      return NextResponse.json(
        { error: 'Already at the final gate, cannot advance further', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const targetStage = typeof body.targetStage === 'string'
      ? body.targetStage
      : gates[currentIndex + 1];

    // Validate the target is the next gate
    const expectedNext = gates[currentIndex + 1];
    if (targetStage !== expectedNext) {
      return NextResponse.json(
        { error: `Cannot advance from '${proposal.stage}' to '${targetStage}'. Next gate is '${expectedNext}'.`, code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Verify proposal has at least one section ─────────────────────
    let sectionCountCheck: { count: string }[];
    try {
      sectionCountCheck = await sql<{ count: string }[]>`
        SELECT count(*)::text FROM proposal_sections
        WHERE proposal_id = ${proposalId}::uuid
      `;
    } catch (e) {
      console.error('[portal/proposals/advance] section count query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (parseInt(sectionCountCheck[0]?.count ?? '0', 10) === 0) {
      return NextResponse.json(
        { error: 'Cannot advance a proposal with no sections', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    const previousStage = proposal.stage;
    const shouldLock = targetStage === 'final';
    // When advancing to 'final' AND auto-locking, also advance to 'submitted'
    const finalStageValue = shouldLock ? 'submitted' : targetStage;

    // ── Start event for stage advancement ────────────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'proposal.advanced',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        proposalTitle: proposal.title,
        previousStage,
        targetStage,
      },
    });

    // ── Update proposal stage + record history (transactional) ──────
    // Gate check is inside the transaction to prevent TOCTOU races.
    let sectionsSnapshot: { section_id: string; title: string; version: number; status: string; char_count: number; locked: boolean }[] = [];
    let completeSections = 0;
    let approvedSections = 0;
    let lockedSections = 0;
    let forcedOpenSections: { sectionId: string; title: string; volumeName: string | null }[] = [];
    try {
      await sql.begin(async (tx: any) => {
        // ── Gate: every section must be accepted + locked (all documents
        //    closed) before the proposal advances as one unit. force=true
        //    overrides but records the still-open sections as the audit trail
        //    ("forced to advance and marking open sections").
        const openSections = await tx<{ id: string; title: string; volumeName: string | null }[]>`
          SELECT id, title, volume_name
          FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid AND is_locked = false
          ORDER BY volume_number NULLS LAST, section_number
        `;
        if (openSections.length > 0 && !body.force) {
          throw new Error('SECTIONS_NOT_LOCKED:' + JSON.stringify(
            openSections.map((s: { id: string; title: string; volumeName: string | null }) =>
              ({ sectionId: s.id, title: s.title, volumeName: s.volumeName })),
          ));
        }
        forcedOpenSections = openSections.map((s: { id: string; title: string; volumeName: string | null }) =>
          ({ sectionId: s.id, title: s.title, volumeName: s.volumeName }));

        // ── Check legacy manual gate requirements inside transaction ──
        try {
          const unmetGates = await tx`
            SELECT label FROM stage_gate_requirements
            WHERE proposal_id = ${proposalId}::uuid AND stage = ${previousStage} AND is_met = false
          `;
          if (unmetGates.length > 0 && !body.force) {
            throw new Error('GATE_REQUIREMENTS_NOT_MET:' + JSON.stringify(unmetGates.map((g: Record<string, unknown>) => g.label)));
          }
        } catch (gateErr) {
          if (gateErr instanceof Error && gateErr.message.startsWith('GATE_REQUIREMENTS_NOT_MET:')) {
            throw gateErr;
          }
          // Check for "relation does not exist" (PostgreSQL error code 42P01)
          const pgErr = gateErr as { code?: string };
          if (pgErr.code === '42P01') {
            // Table doesn't exist yet — gate system not deployed, proceed
          } else {
            // Real DB error — do NOT silently skip
            throw gateErr;
          }
        }

        // ── 1. Snapshot all sections at their current state ────────
        const sections = await tx<{
          id: string;
          title: string;
          version: number;
          status: string;
          content: string | null;
          isLocked: boolean;
        }[]>`
          SELECT id, title, version, status, content, is_locked
          FROM proposal_sections WHERE proposal_id = ${proposalId}::uuid
          ORDER BY section_number
        `;

        sectionsSnapshot = sections.map((s: { id: string; title: string; version: number; status: string; content: string | null; isLocked: boolean }) => ({
          section_id: s.id,
          title: s.title,
          version: s.version,
          status: s.status,
          char_count: s.content ? s.content.length : 0,
          locked: s.isLocked,
        }));

        completeSections = sections.filter((s: { status: string }) => s.status === 'complete' || s.status === 'approved').length;
        approvedSections = sections.filter((s: { status: string }) => s.status === 'approved').length;
        lockedSections = sections.filter((s: { isLocked: boolean }) => s.isLocked).length;

        // ── 2. Insert stage completion snapshot ────────────────────
        await tx`
          INSERT INTO stage_completion_snapshots
            (proposal_id, stage, completed_by, sections_snapshot, total_sections,
             sections_complete, sections_approved, notes)
          VALUES (
            ${proposalId}::uuid, ${previousStage}, ${sessionUser.id}::uuid,
            ${JSON.stringify(sectionsSnapshot)}::jsonb,
            ${sections.length},
            ${completeSections},
            ${approvedSections},
            ${notes}
          )
        `;

        // ── 3. Mark all sections as having passed through this stage ──────
        // Only stamp completed_stage/completed_at here. accepted_by/accepted_at
        // are owned exclusively by the section lock route — a force-advanced
        // (still-unlocked) section must NOT be recorded as "accepted", and a
        // genuinely locked section keeps the accepter from its lock, not the
        // advancing admin. Open sections are captured in forcedOpenSections.
        await tx`
          UPDATE proposal_sections
          SET completed_stage = ${previousStage},
              completed_at = now()
          WHERE proposal_id = ${proposalId}::uuid
            AND (completed_stage IS NULL OR completed_stage = ${previousStage})
        `;

        // ── 4. Create canvas version snapshots for each section ───
        for (const s of sections) {
          if (s.content) {
            await tx`
              INSERT INTO canvas_versions (section_id, version_number, content, snapshot_reason, source, created_by)
              VALUES (${s.id}::uuid, ${s.version}, ${s.content}::jsonb, ${'stage_completed:' + previousStage}, 'system', ${sessionUser.id}::uuid)
              ON CONFLICT (section_id, version_number) DO NOTHING
            `;
          }
        }

        if (shouldLock) {
          // Advance to 'submitted' (not just 'final') and auto-lock
          const advanceResult = await tx`
            UPDATE proposals
            SET stage = 'submitted',
                is_locked = true,
                lock_count = lock_count + 1,
                last_locked_at = now(),
                version = version + 1,
                last_modified_by = ${sessionUser.id}::uuid
            WHERE id = ${proposalId}::uuid
              AND stage = ${previousStage}
              AND version = ${proposal.version}
          `;
          if (advanceResult.count === 0) {
            throw new Error('CONFLICT');
          }
        } else {
          const advanceResult = await tx`
            UPDATE proposals
            SET stage = ${targetStage},
                version = version + 1,
                last_modified_by = ${sessionUser.id}::uuid
            WHERE id = ${proposalId}::uuid
              AND stage = ${previousStage}
              AND version = ${proposal.version}
          `;
          if (advanceResult.count === 0) {
            throw new Error('CONFLICT');
          }
        }

        // Record the advance to the target gate
        await tx`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}::uuid, ${previousStage}, ${targetStage}, ${sessionUser.id}::uuid, ${notes})
        `;

        // If auto-locked at final, also record the auto-advance to 'submitted'
        if (shouldLock) {
          await tx`
            INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
            VALUES (${proposalId}::uuid, ${targetStage}, 'submitted', ${sessionUser.id}::uuid, 'Auto-advanced on lock')
          `;
        }
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'CONFLICT') {
        await emitEventEnd(startId, { error: { message: 'Stage already changed', code: 'CONFLICT' } });
        return NextResponse.json({ error: 'Stage already changed', code: 'CONFLICT' }, { status: 409 });
      }
      if (e instanceof Error && e.message.startsWith('GATE_REQUIREMENTS_NOT_MET:')) {
        const unmetLabels = JSON.parse(e.message.replace('GATE_REQUIREMENTS_NOT_MET:', ''));
        await emitEventEnd(startId, { error: { message: 'Unmet gate requirements', code: 'GATE_REQUIREMENTS_NOT_MET' } });
        return NextResponse.json({
          error: 'Unmet gate requirements',
          code: 'GATE_REQUIREMENTS_NOT_MET',
          details: { unmet: unmetLabels }
        }, { status: 422 });
      }
      if (e instanceof Error && e.message.startsWith('SECTIONS_NOT_LOCKED:')) {
        const openSections = JSON.parse(e.message.replace('SECTIONS_NOT_LOCKED:', ''));
        await emitEventEnd(startId, { error: { message: 'Sections not locked', code: 'SECTIONS_NOT_LOCKED' } });
        return NextResponse.json({
          error: 'Every section must be accepted & locked before advancing (use force to override)',
          code: 'SECTIONS_NOT_LOCKED',
          details: { openSections },
        }, { status: 422 });
      }
      console.error('[portal/proposals/advance] stage update failed:', e);
      await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    // ── End event ────────────────────────────────────────────────────
    await emitEventEnd(startId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        proposalTitle: proposal.title,
        previousStage,
        targetStage,
        forced: !!body.force,
        forcedOpenSections,
        sectionsLocked: lockedSections,
        ...(shouldLock ? { effectiveStage: 'submitted' } : {}),
        locked: shouldLock,
        lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
        notes: notes ?? undefined,
      },
    });

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, entity_version, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'stage_advanced', ${proposal.version + 1},
                ${JSON.stringify({
                  from_stage: previousStage,
                  to_stage: finalStageValue,
                  notes: notes ?? undefined,
                  sections_accepted: sectionsSnapshot.length,
                  sections_complete: completeSections,
                  sections_approved: approvedSections,
                  sections_locked: lockedSections,
                  forced: !!body.force,
                  forced_open: forcedOpenSections.length,
                })}::jsonb)
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/advance] activity log failed', logErr);
    }

    // ── AI review on advance (customer opt-in) ───────────────────────
    // If the tenant enabled ai_review_on_advance, enqueue a per-section review
    // of the accepted (locked) content. The agent workforce reviews grammar /
    // flow / compliance and posts recommendations into each section's context
    // box (proposal_comments, recommendation_type='ai_review'). Best-effort +
    // cost-guarded downstream — never blocks the advance.
    try {
      const [pref] = await sql<{ aiReviewOnAdvance: boolean }[]>`
        SELECT ai_review_on_advance FROM tenant_automation_preferences
        WHERE tenant_id = ${tenantId}::uuid
      `;
      const aiReviewEnabled = pref ? pref.aiReviewOnAdvance : true; // default on
      if (aiReviewEnabled) {
        const reviewSections = await sql<{ id: string; title: string | null; content: string | null; sectionType: string | null }[]>`
          SELECT id, title, content, section_type
          FROM proposal_sections
          WHERE proposal_id = ${proposalId}::uuid AND is_locked = true AND content IS NOT NULL
        `;
        for (const s of reviewSections) {
          const sectionText = extractCanvasText(s.content);
          if (!sectionText) continue;
          await requestAgentTask({
            tenantId,
            agentRole: 'color_team_reviewer',
            taskType: 'review_section',
            proposalId,
            sectionId: s.id,
            input: {
              requestedBy: sessionUser.id,
              sectionTitle: s.title ?? '',
              sectionText: sectionText.slice(0, 20000),
              category: s.sectionType ?? 'review',
              reviewType: 'red_team',
            },
          });
        }
      }
    } catch (reviewErr) {
      console.error('[api/portal/proposals/advance] AI review enqueue failed (non-fatal):', reviewErr);
    }

    return NextResponse.json({
      data: {
        stage: finalStageValue,
        previousStage,
        locked: shouldLock,
        lockCount: shouldLock ? proposal.lockCount + 1 : proposal.lockCount,
        ...(shouldLock ? { lockedAt: new Date().toISOString() } : {}),
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/advance] error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
