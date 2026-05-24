/**
 * POST /api/consent — Record user consent acceptance
 *
 * Inserts into consent_records table. Requires authentication.
 * consent_records schema: id, user_id, document_type, document_version,
 *   accepted_at, ip_address
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(request: Request) {
  try {
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
      role?: unknown;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    // ── Parse body ───────────────────────────────────────────────
    let body: {
      document_type?: string;
      document_version?: string;
      accepted?: boolean;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    // ── Input validation ─────────────────────────────────────────
    if (!body.document_type || typeof body.document_type !== 'string') {
      return NextResponse.json(
        { error: 'document_type (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!body.document_version || typeof body.document_version !== 'string') {
      return NextResponse.json(
        { error: 'document_version (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (body.accepted !== true) {
      return NextResponse.json(
        { error: 'accepted must be true to record consent', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // ── Extract IP for audit trail ───────────────────────────────
    const forwarded = request.headers.get('x-forwarded-for');
    const ipAddress = forwarded ? forwarded.split(',')[0].trim() : null;

    // ── Insert consent record ────────────────────────────────────
    try {
      const [record] = await sql<{ id: string; acceptedAt: string }[]>`
        INSERT INTO consent_records (user_id, document_type, document_version, ip_address)
        VALUES (${sessionUser.id}::uuid, ${body.document_type}, ${body.document_version}, ${ipAddress})
        RETURNING id, accepted_at
      `;

      // Also update user's terms_accepted_at if this is a TOS acceptance
      if (body.document_type === 'terms_of_service') {
        await sql`
          UPDATE users SET terms_accepted_at = now() WHERE id = ${sessionUser.id}::uuid
        `;
      }

      try {
        await emitEventSingle({
          namespace: 'identity',
          type: 'consent.recorded',
          actor: userActor(sessionUser.id),
          tenantId: null,
          payload: { userId: sessionUser.id, documentType: body.document_type },
        });
      } catch (e) {
        console.error('[consent] event emission failed:', e);
      }

      return NextResponse.json(
        { data: { id: record.id, accepted_at: record.acceptedAt } },
        { status: 201 },
      );
    } catch (dbErr) {
      console.error('[consent] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to record consent', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[consent] error:', err);
    return NextResponse.json(
      { error: 'Failed to process consent', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
