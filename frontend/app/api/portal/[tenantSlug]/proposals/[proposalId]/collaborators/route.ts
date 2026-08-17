import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess, enterTenant } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { sendEmail } from '@/lib/email';
import { collaboratorInviteEmail } from '@/lib/email-templates';
import { isValidUUID } from '@/lib/validation';
import { coerceJsonb } from '@/lib/jsonb';
import bcrypt from 'bcryptjs';

interface RouteContext {
  params: Promise<{ tenantSlug: string; proposalId: string }>;
}

/**
 * GET /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators
 *
 * List all collaborators with their access levels and assigned sections.
 * Auth: tenant_user or higher with tenant access.
 */
export async function GET(_request: Request, ctx: RouteContext) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };

    const role = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // Partner-containment: the collaborator roster (names/emails/assigned sections — PII) is a
    // proposal-wide read for tenant members (tenant_user+). External collaborators (partner_user)
    // pass verifyTenantAccess on their own membership, so without this floor a partner could
    // enumerate every collaborator's PII across the tenant's proposals. (POST stays tenant_admin.)
    if (!hasRoleAtLeast(role, 'tenant_user')) {
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

    // Verify proposal belongs to tenant
    let proposal: { id: string } | undefined;
    try {
      [proposal] = await sql<{ id: string }[]>`
        SELECT id FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/collaborators] proposal query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    let collaborators: {
      id: string;
      userId: string | null;
      email: string;
      name: string | null;
      role: string;
      assignedSections: string[];
      dropboxEnabled: boolean;
      invitedAt: string;
      acceptedAt: string | null;
      revokedAt: string | null;
    }[];
    let accessRows: {
      collaboratorId: string;
      stage: string;
      permission: string;
      artifactTypes: string[];
    }[];
    try {
      collaborators = await sql<typeof collaborators>`
        SELECT
          pc.id,
          pc.user_id,
          pc.email,
          pc.name,
          pc.role,
          pc.assigned_sections,
          pc.dropbox_enabled,
          pc.invited_at,
          pc.accepted_at,
          pc.revoked_at
        FROM proposal_collaborators pc
        WHERE pc.proposal_id = ${proposalId}
        ORDER BY pc.invited_at ASC
      `;

      // Load stage access for each collaborator
      accessRows = await sql<typeof accessRows>`
        SELECT collaborator_id, stage, permission, artifact_types
        FROM collaborator_stage_access
        WHERE proposal_id = ${proposalId}
          AND access_revoked_at IS NULL
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/collaborators] collaborators query failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    type AccessRow = { collaboratorId: string; stage: string; permission: string; artifactTypes: string[] };
    const accessByCollaborator = new Map<string, AccessRow[]>();
    for (const row of accessRows) {
      const existing = accessByCollaborator.get(row.collaboratorId) || [];
      existing.push(row);
      accessByCollaborator.set(row.collaboratorId, existing);
    }

    const data = collaborators.map((c) => ({
      id: c.id,
      userId: c.userId,
      email: c.email,
      name: c.name,
      role: c.role,
      assignedSections: c.assignedSections || [],
      dropboxEnabled: c.dropboxEnabled,
      invitedAt: c.invitedAt,
      acceptedAt: c.acceptedAt,
      revokedAt: c.revokedAt,
      active: c.revokedAt == null,
      stageAccess: accessByCollaborator.get(c.id) || [],
    }));

    return NextResponse.json({ data });
  } catch (e) {
    console.error('[api/portal/proposals/collaborators] GET error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/portal/[tenantSlug]/proposals/[proposalId]/collaborators
 *
 * Invite a collaborator to the proposal.
 * Auth: tenant_admin only.
 *
 * Body: { email, name, role, assignedSections, permission }
 */
export async function POST(request: Request, ctx: RouteContext) {
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

    // Parse body
    let body: {
      email?: unknown;
      name?: unknown;
      role?: unknown;
      assignedSections?: unknown;
      permission?: unknown;
      stagePermissions?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const collabRole = typeof body.role === 'string' ? body.role : 'contributor';
    // assigned_sections is a uuid[] column — keep only valid UUIDs so the array casts
    // cleanly (a bad element would otherwise 500 the whole invite).
    const assignedSections = Array.isArray(body.assignedSections)
      ? body.assignedSections.filter((s): s is string => typeof s === 'string' && isValidUUID(s))
      : [];
    const permission = typeof body.permission === 'string' ? body.permission : 'view';
    // SPINE-T5: PER-STAGE grants. The access resolver + collaborator_stage_access already support a
    // distinct permission per gate (e.g. edit-in-draft, comment-in-final); the invite only ever wrote a
    // uniform one. An optional { stage: 'view'|'comment'|'edit' } map now overrides per stage; the flat
    // `permission` remains the default for any stage the map omits. Invalid entries are dropped.
    const stagePermissions: Record<string, string> = {};
    if (body.stagePermissions && typeof body.stagePermissions === 'object' && !Array.isArray(body.stagePermissions)) {
      for (const [stage, p] of Object.entries(body.stagePermissions as Record<string, unknown>)) {
        if (typeof p === 'string' && ['view', 'comment', 'edit'].includes(p)) stagePermissions[stage] = p;
      }
    }

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (name.length > 200) {
      return NextResponse.json({ error: 'Name exceeds maximum length (200 chars)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (email.length > 320) {
      return NextResponse.json({ error: 'Email exceeds maximum length (320 chars)', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!['contributor', 'external'].includes(collabRole)) {
      return NextResponse.json({ error: 'Role must be contributor or external', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (!['view', 'comment', 'edit'].includes(permission)) {
      return NextResponse.json({ error: 'Permission must be view, comment, or edit', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    // Verify proposal belongs to tenant
    let proposal: { id: string; title: string; stage: string; gateConfig: string[] } | undefined;
    try {
      [proposal] = await sql<{ id: string; title: string; stage: string; gateConfig: string[] }[]>`
        SELECT id, title, stage, gate_config FROM proposals
        WHERE id = ${proposalId} AND tenant_id = ${tenantId}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/collaborators] proposal lookup failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (!proposal) {
      return NextResponse.json({ error: 'Proposal not found', code: 'NOT_FOUND' }, { status: 404 });
    }

    // Check if collaborator already exists. An ACTIVE one is a real duplicate (409);
    // a REVOKED one is REACTIVATED (its row + history are preserved, never re-created).
    let existing: { id: string; revokedAt: Date | null } | undefined;
    try {
      [existing] = await sql<{ id: string; revokedAt: Date | null }[]>`
        SELECT id, revoked_at FROM proposal_collaborators
        WHERE proposal_id = ${proposalId} AND email = ${email}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/collaborators] duplicate check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (existing && !existing.revokedAt) {
      return NextResponse.json({ error: 'Collaborator already invited', code: 'VALIDATION_ERROR' }, { status: 409 });
    }
    const reactivateId: string | null = existing?.id ?? null;

    // ── Start event for collaborator invitation ──────────────────────
    const startId = await emitEventStart({
      namespace: 'proposal',
      type: 'collaborator.invited',
      actor: userActor(sessionUser.id, sessionUser.email),
      tenantId,
      payload: {
        proposalId,
        email: email.slice(0, 320),
        name: name.slice(0, 200),
        role: collabRole,
        permission,
        // Reconstitution of a previously-removed collaborator is distinct from a
        // fresh invite — the audit trail records which (never-delete + reactivate).
        reactivated: reactivateId != null,
      },
    });

    // Wrap user + collaborator + stage_access creation in transaction
    let isNewUser = false;
    let tempPassword: string | undefined;

    const { collaboratorId, finalUserId } = await withTenant(tenantId, async (tx: any) => {
      // Check if user exists, create if not
      let [existingUser] = await tx<{ id: string; tenantId: string | null }[]>`
        SELECT id, tenant_id FROM users WHERE email = ${email} LIMIT 1
      `;

      // The membership role this invite grants at THIS company (independent of any
      // role the person holds at other companies — see multi-membership identity).
      const membershipRole = collabRole === 'external' ? 'partner_user' : 'tenant_user';

      if (!existingUser) {
        isNewUser = true;
        tempPassword = randomUUID().slice(0, 12);
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        const [newUser] = await tx<{ id: string }[]>`
          INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password)
          VALUES (${email}, ${name || null}, ${membershipRole}, ${tenantId}, ${passwordHash}, true)
          RETURNING id
        `;
        existingUser = { id: newUser.id, tenantId: tenantId };
      }

      // Create (or REACTIVATE) the collaborator record. An EXISTING user is auto-accepted
      // (they already have an account — just set accepted_at so the access resolver grants
      // them immediately). A NEW user is left pending until they set a password via
      // /invite/<collaboratorId>. Re-inviting a REVOKED collaborator reactivates the same
      // row (revoked_at → NULL) so its history is never destroyed.
      const acceptedAt = isNewUser ? null : new Date().toISOString();
      let collaborator: { id: string };
      if (reactivateId) {
        const [reactivated] = await tx<{ id: string }[]>`
          UPDATE proposal_collaborators
          SET revoked_at = NULL,
              user_id = ${existingUser.id},
              name = ${name || null},
              role = ${collabRole},
              invited_by = ${sessionUser.id},
              invited_at = now(),
              assigned_sections = ${sql.array(assignedSections)}::uuid[],
              accepted_at = ${acceptedAt}::timestamptz
          WHERE id = ${reactivateId}::uuid
          RETURNING id
        `;
        collaborator = reactivated;
        // Clear the prior (revoked) stage-access rows; fresh grants are inserted below.
        await tx`DELETE FROM collaborator_stage_access WHERE collaborator_id = ${reactivateId}::uuid`;
      } else {
        const [inserted] = await tx<{ id: string }[]>`
          INSERT INTO proposal_collaborators (
            proposal_id, user_id, email, name, role, invited_by,
            assigned_sections, dropbox_enabled, accepted_at
          )
          VALUES (
            ${proposalId}, ${existingUser.id}, ${email}, ${name || null},
            ${collabRole}, ${sessionUser.id},
            ${sql.array(assignedSections)}::uuid[], true, ${acceptedAt}::timestamptz
          )
          RETURNING id
        `;
        collaborator = inserted;
      }

      // Create stage access — a per-stage permission when the invite supplied one, else the flat default.
      const gates = coerceJsonb<string[]>(proposal.gateConfig, ['draft', 'final']);
      for (const stage of gates) {
        const stagePerm = stagePermissions[stage] ?? permission;
        await tx`
          INSERT INTO collaborator_stage_access (
            collaborator_id, proposal_id, stage, permission, granted_by
          )
          VALUES (
            ${collaborator.id}, ${proposalId}, ${stage}, ${stagePerm}, ${sessionUser.id}
          )
        `;
      }

      // Materialize the login-selectable membership (multi-membership identity, P3).
      // This is what lets a CROSS-COMPANY collaborator reach this tenant's portal:
      // verifyTenantAccess gates on an active membership, and their users.tenant_id is
      // their OWN company, not this one. Bind it to this tenant as a 'collaborator'
      // membership WITHOUT touching users.tenant_id (their home is preserved). ON
      // CONFLICT DO NOTHING so an existing membership (e.g. they're really an admin
      // here) is never downgraded to partner_user. See MULTI_MEMBERSHIP_IDENTITY_DESIGN.
      await tx`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${existingUser.id}, ${tenantId}, ${membershipRole}, 'active', 'collaborator', ${sessionUser.id})
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET status = 'active', role = EXCLUDED.role
          WHERE user_memberships.source = 'collaborator' AND user_memberships.status <> 'active'
      `;
      // ON CONFLICT reactivates a previously-REVOKED collaborator membership (so
      // re-inviting a removed collaborator restores access) but the source guard leaves
      // a home/manual membership untouched — an admin here is never downgraded.

      return { collaboratorId: collaborator.id, finalUserId: existingUser.id };
    });

    // Send collaborator invite email (non-blocking — failure is logged, not fatal)
    const base = (process.env.NEXTAUTH_URL || process.env.AUTH_URL) || process.env.NEXT_PUBLIC_APP_URL || '';
    // NEW user → the acceptance page (sets their password + accepted_at, then lands
    // them in the proposal). EXISTING user → straight to the proposal (already accepted).
    // The old code pointed BOTH at /login, which never set accepted_at → the workspace
    // 404'd for the invitee (sweep finding).
    const acceptUrl = `${base}/invite/${collaboratorId}`;
    const proposalUrl = `${base}/portal/${tenantSlug}/proposals/${proposalId}`;
    const inviterName = (session.user as { name?: string }).name || sessionUser.email || 'A team member';
    let emailResult: { provider: string; error?: string } = { provider: 'skipped' };
    try {
      const emailContent = collaboratorInviteEmail({
        recipientName: name,
        recipientEmail: email,
        proposalTitle: proposal.title || proposalId,
        inviterName,
        role: collabRole,
        permission,
        isNewUser,
        acceptUrl,
        proposalUrl,
      });
      emailResult = await sendEmail({
        to: email,
        subject: emailContent.subject,
        html: emailContent.html,
      });
    } catch (emailErr) {
      console.error('[api/portal/proposals/collaborators] invite email failed', {
        email,
        err: emailErr instanceof Error ? emailErr.message : String(emailErr),
      });
      emailResult = { provider: 'skipped', error: emailErr instanceof Error ? emailErr.message : String(emailErr) };
    }

    // Emit email delivery completion event (closed-loop)
    try {
      await emitEventSingle({
        namespace: 'system',
        type: 'email.invite_delivered',
        actor: userActor(sessionUser.id, sessionUser.email),
        tenantId,
        payload: {
          recipientEmail: email,
          proposalId,
          status: emailResult.provider !== 'skipped' && !emailResult.error ? 'sent' : 'failed',
          provider: emailResult.provider,
          error: emailResult.error ?? null,
        },
      });
    } catch {
      // Best-effort — never break the main flow
    }

    // ── End event for collaborator invitation ──────────────────────
    await emitEventEnd(startId, {
      result: {
        correlationId: randomUUID(),
        tenantId,
        tenantSlug,
        proposalId,
        collaboratorId,
        email: email.slice(0, 320),
        name: name.slice(0, 200),
        role: collabRole,
        permission,
        isNewUser,
      },
    });

    // ── Activity log ────────────────────────────────────────────────
    try {
      await sql`
        INSERT INTO proposal_activity_log
          (proposal_id, tenant_id, actor_id, actor_email, actor_role,
           activity_type, details)
        VALUES (${proposalId}::uuid, ${tenantId}::uuid, ${sessionUser.id}::uuid,
                ${sessionUser.email ?? null}, ${role},
                'collaborator_invited',
                ${sql.json({ email, name, role: collabRole, permission, sections_assigned: assignedSections, is_new_user: isNewUser })})
      `;
    } catch (logErr) {
      console.error('[api/portal/proposals/collaborators] activity log failed', logErr);
    }

    return NextResponse.json({
      data: {
        id: collaboratorId,
        userId: finalUserId,
        email,
        name,
        role: collabRole,
        assignedSections,
        permission,
        isNewUser,
      },
    });
  } catch (e) {
    console.error('[api/portal/proposals/collaborators] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
