import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast } from '@/lib/rbac';
import { randomUUID } from 'crypto';
import { emitEventStart, emitEventEnd, emitEventSingle, userActor } from '@/lib/events';
import { sendEmail } from '@/lib/email';
import { collaboratorInviteEmail } from '@/lib/email-templates';
import { isValidUUID } from '@/lib/validation';
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
          pc.accepted_at
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

    // Parse body
    let body: {
      email?: unknown;
      name?: unknown;
      role?: unknown;
      assignedSections?: unknown;
      permission?: unknown;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const collabRole = typeof body.role === 'string' ? body.role : 'contributor';
    const assignedSections = Array.isArray(body.assignedSections) ? body.assignedSections : [];
    const permission = typeof body.permission === 'string' ? body.permission : 'view';

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

    // Check if collaborator already exists
    let existing: { id: string } | undefined;
    try {
      [existing] = await sql<{ id: string }[]>`
        SELECT id FROM proposal_collaborators
        WHERE proposal_id = ${proposalId} AND email = ${email}
        LIMIT 1
      `;
    } catch (dbErr) {
      console.error('[api/portal/proposals/collaborators] duplicate check failed:', dbErr);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }
    if (existing) {
      return NextResponse.json({ error: 'Collaborator already invited', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

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
      },
    });

    // Wrap user + collaborator + stage_access creation in transaction
    let isNewUser = false;
    let tempPassword: string | undefined;

    const { collaboratorId, finalUserId } = await sql.begin(async (tx: any) => {
      // Check if user exists, create if not
      let [existingUser] = await tx<{ id: string; tenantId: string | null }[]>`
        SELECT id, tenant_id FROM users WHERE email = ${email} LIMIT 1
      `;

      if (!existingUser) {
        isNewUser = true;
        tempPassword = randomUUID().slice(0, 12);
        const passwordHash = await bcrypt.hash(tempPassword, 12);
        const userRole = collabRole === 'external' ? 'partner_user' : 'tenant_user';

        const [newUser] = await tx<{ id: string }[]>`
          INSERT INTO users (email, name, role, tenant_id, password_hash, temp_password)
          VALUES (${email}, ${name || null}, ${userRole}, ${tenantId}, ${passwordHash}, true)
          RETURNING id
        `;
        existingUser = { id: newUser.id, tenantId: tenantId };
      }

      // Create collaborator record
      const [collaborator] = await tx<{ id: string }[]>`
        INSERT INTO proposal_collaborators (
          proposal_id, user_id, email, name, role, invited_by,
          assigned_sections, dropbox_enabled
        )
        VALUES (
          ${proposalId}, ${existingUser.id}, ${email}, ${name || null},
          ${collabRole}, ${sessionUser.id},
          ${sql.array(assignedSections)}, true
        )
        RETURNING id
      `;

      // Create stage access for current stage
      const gates = (proposal.gateConfig || ['draft', 'final']) as string[];
      for (const stage of gates) {
        await tx`
          INSERT INTO collaborator_stage_access (
            collaborator_id, proposal_id, stage, permission, granted_by
          )
          VALUES (
            ${collaborator.id}, ${proposalId}, ${stage}, ${permission}, ${sessionUser.id}
          )
        `;
      }

      return { collaboratorId: collaborator.id, finalUserId: existingUser.id };
    });

    // Send collaborator invite email (non-blocking — failure is logged, not fatal)
    const loginUrl = `${process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || ''}/login`;
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
        tempPassword,
        loginUrl,
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
                ${JSON.stringify({ email, name, role: collabRole, permission, sections_assigned: assignedSections, is_new_user: isNewUser })}::jsonb)
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
