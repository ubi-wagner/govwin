import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { emitEventSingle, systemActor } from '@/lib/events';

/**
 * GET /api/invite?token=<id>
 *
 * Fetch invite details (who invited, which proposal, company name).
 * No auth required — the token itself is the credential.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get('token')?.trim() ?? '';

    if (!token) {
      return NextResponse.json({ error: 'Token is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    let row: {
      email: string;
      acceptedAt: string | null;
      inviterName: string | null;
      inviterEmail: string | null;
      proposalTitle: string | null;
      companyName: string | null;
    } | undefined;
    try {
      [row] = await sql<{
        email: string;
        acceptedAt: string | null;
        inviterName: string | null;
        inviterEmail: string | null;
        proposalTitle: string | null;
        companyName: string | null;
      }[]>`
        SELECT
          pc.email,
          pc.accepted_at,
          inv.name AS inviter_name,
          inv.email AS inviter_email,
          p.title AS proposal_title,
          t.name AS company_name
        FROM proposal_collaborators pc
        LEFT JOIN users inv ON inv.id = pc.invited_by
        LEFT JOIN proposals p ON p.id = pc.proposal_id
        LEFT JOIN tenants t ON t.id = p.tenant_id
        WHERE pc.id = ${token}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[api/invite] GET invite query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!row) {
      return NextResponse.json({ error: 'Invalid invite token', code: 'NOT_FOUND' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        email: row.email,
        inviterName: row.inviterName,
        inviterEmail: row.inviterEmail,
        proposalTitle: row.proposalTitle,
        companyName: row.companyName,
        alreadyAccepted: !!row.acceptedAt,
      },
    });
  } catch (e) {
    console.error('[api/invite] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

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

    if (password.length < 12) {
      return NextResponse.json(
        { error: 'Password must be at least 12 characters', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Look up the collaborator by invite token (collaborator ID)
    let collaborator: {
      id: string;
      userId: string | null;
      email: string;
      proposalId: string;
      acceptedAt: string | null;
    } | undefined;
    try {
      [collaborator] = await sql<{
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
    } catch (e) {
      console.error('[api/invite] collaborator query failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    if (!collaborator) {
      return NextResponse.json({ error: 'Invalid invite token', code: 'NOT_FOUND' }, { status: 404 });
    }

    if (collaborator.acceptedAt) {
      return NextResponse.json({ error: 'Invite already accepted', code: 'VALIDATION_ERROR' }, { status: 409 });
    }

    // Set the password on the user and mark temp_password as false
    const passwordHash = await bcrypt.hash(password, 12);

    // Wrap user update + collaborator accept in a single atomic transaction
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await sql.begin(async (txSql: any) => {
        if (collaborator!.userId) {
          await txSql`
            UPDATE users
            SET password_hash = ${passwordHash},
                temp_password = false
            WHERE id = ${collaborator!.userId}
          `;
        }

        await txSql`
          UPDATE proposal_collaborators
          SET accepted_at = now()
          WHERE id = ${token}
        `;
      });
    } catch (e) {
      console.error('[api/invite] transaction failed:', e);
      return NextResponse.json({ error: 'Internal error', code: 'DB_ERROR' }, { status: 500 });
    }

    try {
      await emitEventSingle({
        namespace: 'identity',
        type: 'invite.accepted',
        actor: systemActor(),
        payload: {
          correlationId: randomUUID(),
          collaboratorId: collaborator.id,
          email: collaborator.email,
          proposalId: collaborator.proposalId,
        },
      });
    } catch (evtErr) {
      console.error('[api/invite] event emission failed:', evtErr);
    }

    // Get the proposal's tenant slug for redirect
    let proposalTenant: { tenantSlug: string } | undefined;
    try {
      [proposalTenant] = await sql<{ tenantSlug: string }[]>`
        SELECT t.slug AS tenant_slug
        FROM proposals p
        JOIN tenants t ON t.id = p.tenant_id
        WHERE p.id = ${collaborator.proposalId}
        LIMIT 1
      `;
    } catch (e) {
      console.error('[api/invite] tenant slug query failed:', e);
    }

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
