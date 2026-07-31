import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { harvestProposalToAtomLibrary } from '@/lib/proposal-atom-harvest';
import { isValidUUID } from '@/lib/validation';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/lock
 *
 * Locks the proposal workspace with business rules:
 * - Can only lock at final stage
 * - lock_count 1: first lock, downloads enabled
 * - lock_count 2: second lock after self-service unlock
 * - lock_count > 2: rejected, requires master_admin
 */
export async function POST(_request: Request, ctx: RouteContext) {
  try {
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

    enterTenant(tenantId);

    let proposal: {
      id: string;
      isLocked: boolean;
      stage: string;
      lockCount: number;
      version: number;
      opportunityCloseDate: string | null;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        isLocked: boolean;
        stage: string;
        lockCount: number;
        version: number;
        opportunityCloseDate: string | null;
      }[]>`
        SELECT p.id, p.is_locked, p.stage, p.lock_count, p.version,
               o.close_date AS opportunity_close_date
        FROM proposals p
        LEFT JOIN opportunities o ON o.id = p.opportunity_id
        WHERE p.id = ${proposalId} AND p.tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/lock] proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is already locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Business rule: can only lock at final stage
    if (proposal.stage !== 'final') {
      return NextResponse.json(
        { error: 'Can only lock at final stage', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // Business rule: after second lock, only rfp_admin or master_admin can lock again
    if (proposal.lockCount >= 2 && role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json(
        { error: 'Further locks require admin approval. Please contact support.', code: 'ADMIN_UNLOCK_REQUIRED' },
        { status: 403 },
      );
    }

    // Lock the proposal and auto-advance to 'submitted' stage
    const newLockCount = proposal.lockCount + 1;
    const autoAdvanceToSubmitted = proposal.stage === 'final';
    const previousStage = proposal.stage;

    // ── Start event for proposal locking ─────────────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'proposal.locked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        lockCount: proposal.lockCount,
        stage: proposal.stage,
      },
    });

    let lockResult;
    try {
      lockResult = await sql`
        UPDATE proposals
        SET is_locked = true,
            lock_count = ${newLockCount},
            last_locked_at = now(),
            unlock_deadline = NULL,
            stage = ${autoAdvanceToSubmitted ? 'submitted' : proposal.stage},
            version = version + 1,
            last_modified_by = ${sessionUser.id}::uuid
        WHERE id = ${proposalId}
          AND is_locked = false
          AND version = ${proposal.version}
      `;
    } catch (e) {
      console.error('[portal/proposals/lock] lock update failed:', e);
      await emitEventEnd(startId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (lockResult.count === 0) {
      await emitEventEnd(startId, { error: { message: 'Lock state already changed', code: 'CONFLICT' } });
      return NextResponse.json({ error: 'Lock state already changed', code: 'CONFLICT' }, { status: 409 });
    }

    // Record stage history if auto-advanced to 'submitted'
    if (autoAdvanceToSubmitted) {
      try {
        await sql`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}::uuid, ${previousStage}, 'submitted', ${sessionUser.id}::uuid, 'Auto-advanced on lock')
        `;
      } catch (histErr) {
        console.error('[portal/proposals/lock] stage history insert failed (non-fatal)', histErr);
      }
    }

    await emitEventEnd(startId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        lockCount: newLockCount,
        autoAdvancedToSubmitted: autoAdvanceToSubmitted,
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
                'proposal_locked', ${proposal.version + 1},
                ${sql.json({ lock_count: newLockCount })})
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/lock] activity log failed', logErr);
    }

    // Harvest accepted content to the canonical atom library on first lock only.
    // This populates the tenant's library_atoms with derivative atoms from the
    // submitted proposal, enabling the learning loop for future drafts.
    let harvestResult: { atomsHarvested: number; atomsSkipped: number } | null = null;
    if (newLockCount === 1) {
      try {
        harvestResult = await harvestProposalToAtomLibrary(tenantId, proposalId, sessionUser.id);
      } catch (err) {
        console.error('[lock] harvest failed (non-fatal)', err);
      }
    }

    return NextResponse.json({
      data: {
        locked: true,
        lockCount: newLockCount,
        lockedAt: new Date().toISOString(),
        downloadAvailable: true,
        harvest: harvestResult,
        stage: autoAdvanceToSubmitted ? 'submitted' : proposal.stage,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/lock] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/portal/[tenantSlug]/proposals/[proposalId]/lock
 *
 * Unlocks the proposal workspace with business rules:
 * - lock_count 0: nothing to unlock
 * - lock_count 1: self-service unlock, sets 7-day deadline
 * - lock_count >= 2: only master_admin can unlock
 */
export async function DELETE(_request: Request, ctx: RouteContext) {
  try {
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
    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    const tenantId = tenant.id as string;
    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 });
    }

    enterTenant(tenantId);

    let proposal: {
      id: string;
      isLocked: boolean;
      stage: string;
      lockCount: number;
      version: number;
      opportunityCloseDate: string | null;
    } | undefined;
    try {
      [proposal] = await sql<{
        id: string;
        isLocked: boolean;
        stage: string;
        lockCount: number;
        version: number;
        opportunityCloseDate: string | null;
      }[]>`
        SELECT p.id, p.is_locked, p.stage, p.lock_count, p.version,
               o.close_date AS opportunity_close_date
        FROM proposals p
        LEFT JOIN opportunities o ON o.id = p.opportunity_id
        WHERE p.id = ${proposalId} AND p.tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[portal/proposals/lock] DELETE proposal query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (!proposal.isLocked) {
      return NextResponse.json({ error: 'Workspace is not locked', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    const userRole = isRole(sessionUser.role) ? sessionUser.role : role;
    const isAdminRole = userRole === 'master_admin' || userRole === 'rfp_admin';

    // lock_count === 0 means the proposal was provisioned LOCKED and never customer-
    // submitted — i.e. it is pending its INITIAL RELEASE to the customer. Releasing is
    // an RFP-admin action (unlock → the customer can now edit; they get notified below).
    // A tenant user genuinely has nothing to unlock at count 0. Without this an
    // admin-provisioned (is_locked=true) proposal could never be released — a deadlock,
    // since the only is_locked=false setter is here (the create-route email even
    // instructs the admin to "unlock the proposal to release it to the customer").
    if (proposal.lockCount === 0 && !isAdminRole) {
      return NextResponse.json({ error: 'Nothing to unlock', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Business rule: after RFP close date, only admins can unlock
    if (proposal.opportunityCloseDate) {
      const closeDate = new Date(proposal.opportunityCloseDate);
      if (closeDate < new Date() && !isAdminRole) {
        return NextResponse.json(
          { error: 'RFP close date has passed. Unlocks require admin approval. Please contact support.', code: 'ADMIN_UNLOCK_REQUIRED' },
          { status: 403 },
        );
      }
    }

    // Business rule: after first unlock, subsequent unlocks require rfp_admin or master_admin
    if (proposal.lockCount >= 2 && !isAdminRole) {
      return NextResponse.json(
        { error: 'Additional unlocks require admin approval. Please contact support.', code: 'ADMIN_UNLOCK_REQUIRED' },
        { status: 403 },
      );
    }

    // Self-service unlock: set 7-day edit window (AND is_locked = true + version prevents race condition)
    const unlockDeadline = new Date();
    unlockDeadline.setDate(unlockDeadline.getDate() + 7);

    // ── Start event for proposal unlocking ───────────────────────────
    const unlockStartId = await emitEventStart({
      namespace: 'proposal',
      type: 'proposal.unlocked',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        lockCount: proposal.lockCount,
        stage: proposal.stage,
      },
    });

    // Revert stage from 'submitted' back to 'final' on unlock so the proposal can be edited
    let unlockResult;
    try {
      unlockResult = await sql`
        UPDATE proposals
        SET is_locked = false,
            last_unlocked_at = now(),
            stage = CASE WHEN stage = 'submitted' THEN 'final' ELSE stage END,
            unlock_deadline = ${proposal.lockCount === 1 ? unlockDeadline.toISOString() : null},
            version = version + 1,
            last_modified_by = ${sessionUser.id}::uuid
        WHERE id = ${proposalId}
          AND is_locked = true
          AND version = ${proposal.version}
      `;
    } catch (e) {
      console.error('[portal/proposals/lock] unlock update failed:', e);
      await emitEventEnd(unlockStartId, { error: { message: String(e), code: 'DB_ERROR' } });
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (unlockResult.count === 0) {
      await emitEventEnd(unlockStartId, { error: { message: 'Lock state already changed', code: 'CONFLICT' } });
      return NextResponse.json({ error: 'Lock state already changed', code: 'CONFLICT' }, { status: 409 });
    }

    // Record stage history if reverted from 'submitted' to 'final'
    if (proposal.stage === 'submitted') {
      try {
        await sql`
          INSERT INTO proposal_stage_history (proposal_id, from_stage, to_stage, changed_by, notes)
          VALUES (${proposalId}::uuid, 'submitted', 'final', ${sessionUser.id}::uuid, 'Reverted on unlock')
        `;
      } catch (histErr) {
        console.error('[portal/proposals/lock] unlock stage history failed (non-fatal)', histErr);
      }
    }

    await emitEventEnd(unlockStartId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        lockCount: proposal.lockCount,
        revertedFromSubmitted: proposal.stage === 'submitted',
        unlockDeadline: proposal.lockCount === 1 ? unlockDeadline.toISOString() : null,
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
                'proposal_unlocked', ${proposal.version + 1},
                ${sql.json({ lock_count: proposal.lockCount, unlock_deadline: proposal.lockCount === 1 ? unlockDeadline.toISOString() : null })})
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/lock] unlock activity log failed', logErr);
    }

    // ── Notify tenant members that proposal is ready for editing ────
    try {
      // Membership is users.tenant_id (there is no tenant_memberships table).
      const tenantMembers = await sql<{ email: string; name: string | null }[]>`
        SELECT email, name
        FROM users
        WHERE tenant_id = ${tenantId}::uuid
          AND role IN ('tenant_admin', 'tenant_user')
          AND is_active = true
        LIMIT 20
      `;

      if (tenantMembers.length > 0) {
        const { sendEmail } = await import('@/lib/email');
        const [tenantRow] = await sql<{ name: string }[]>`
          SELECT name FROM tenants WHERE id = ${tenantId}::uuid
        `;
        const tName = tenantRow?.name || tenantSlug;
        const [proposalRow] = await sql<{ title: string }[]>`
          SELECT title FROM proposals WHERE id = ${proposalId}
        `;
        const pTitle = proposalRow?.title || 'your proposal';
        const proposalUrl = `${process.env.NEXT_PUBLIC_URL || ''}/portal/${tenantSlug}/proposals/${proposalId}`;

        for (const member of tenantMembers) {
          try {
            await sendEmail({
              to: member.email,
              subject: `Your proposal is ready — ${pTitle}`,
              html: `
                <p>Hi ${member.name || 'there'},</p>
                <p>Your proposal workspace has been reviewed by our team and is now <strong>unlocked and ready for your input</strong>.</p>
                <ul>
                  <li><strong>Proposal:</strong> ${pTitle}</li>
                  <li><strong>Organization:</strong> ${tName}</li>
                </ul>
                <p>Please log in to review the draft sections, collaborate with your team, and complete the proposal before the deadline.</p>
                <p><a href="${proposalUrl}" style="display:inline-block;padding:10px 20px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;font-weight:bold;">Open Your Proposal</a></p>
                <p>— RFP Pipeline System</p>
              `,
            });
          } catch (emailErr) {
            console.error('[portal/proposals/lock] customer notification email failed:', emailErr);
          }
        }
      }
    } catch (notifyErr) {
      console.error('[portal/proposals/lock] customer notification setup failed:', notifyErr);
    }

    // NOTE: the old `AdminProposalSetup` process_instance completer was removed
    // (R3.3). That workflow_name never existed (the phantom — gap-sweep C1), so the
    // UPDATE matched zero rows on every unlock. The real admin-review gate is now a
    // ProjectCollaboration HITL task launched at proposal creation; an admin resolves
    // it by completing the task (or it auto-resolves on review), not via this route.

    // ── Emit proposal.ready_for_customer event ───────────────────────
    try {
      await emitEventSingle({
        namespace: 'proposal',
        type: 'proposal.ready_for_customer',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: { proposalId, tenantSlug },
      });
    } catch {
      // Best-effort
    }

    return NextResponse.json({
      data: {
        locked: false,
        lockCount: proposal.lockCount,
        stage: proposal.stage === 'submitted' ? 'final' : proposal.stage,
        unlockDeadline: proposal.lockCount === 1 ? unlockDeadline.toISOString() : null,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/lock] DELETE error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
