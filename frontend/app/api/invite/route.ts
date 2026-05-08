import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { emitEventSingle, systemActor } from '@/lib/events';

/**
 * POST /api/invite
 *
 * Accept an invite and set password.
 * Body: { token, password }
 *
 * The token is the collaborator ID used as a simple invite token.
 * In a production system this would be a signed JWT or unique token.
 */
export async function POST(request: Request) {
  try {
    let body: { token?: unknown; password?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const token = typeof body.token === 'string' ? body.token.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';

    if (!token) {
      return NextResponse.json({ error: 'Invite token is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Look up the collaborator by invite token (collaborator ID)
    const [collaborator] = await sql<{
      id: string;
      userId: string | null;
      email: string;
      proposalId: string;
      acceptedAt: string | null;
    }[]>`
      SELECT id, user_id, email, proposal_id, accepted_at
      FROM proposal_collaborators
      WHERE id = ${token}
      LIMIT 1
    `;

    if (!collaborator) {
      return NextResponse.json({ error: 'Invalid invite token', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (collaborator.acceptedAt) {
      return NextResponse.json({ error: 'Invite already accepted', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Set the password on the user and mark temp_password as false
    const passwordHash = await bcrypt.hash(password, 10);

    if (collaborator.userId) {
      await sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            temp_password = false
        WHERE id = ${collaborator.userId}
      `;
    }

    // Mark collaborator as accepted
    await sql`
      UPDATE proposal_collaborators
      SET accepted_at = now()
      WHERE id = ${token}
    `;

    await emitEventSingle({
      namespace: 'identity',
      type: 'identity.invite_accepted',
      actor: systemActor(),
      payload: {
        correlationId: randomUUID(),
        collaboratorId: collaborator.id,
        email: collaborator.email,
        proposalId: collaborator.proposalId,
      },
    });

    // Get the proposal's tenant slug for redirect
    const [proposalTenant] = await sql<{ tenantSlug: string }[]>`
      SELECT t.slug AS tenant_slug
      FROM proposals p
      JOIN tenants t ON t.id = p.tenant_id
      WHERE p.id = ${collaborator.proposalId}
      LIMIT 1
    `;

    return NextResponse.json({
      data: {
        accepted: true,
        redirectTo: proposalTenant
          ? `/portal/${proposalTenant.tenantSlug}/proposals/${collaborator.proposalId}`
          : '/portal',
      },
    });
  } catch (e) {
    console.error('[api/invite] POST error:', e);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
