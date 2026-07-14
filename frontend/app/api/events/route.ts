/**
 * GET  /api/events — Recent events for the authenticated user (polling-based V1)
 * POST /api/events — Emit a system event (admin only)
 *
 * GET returns recent system_events (last 5 minutes) filtered by role:
 *   - admin roles see all events
 *   - tenant roles see only their tenant's events
 *
 * POST allows admin to manually emit events for testing/tooling.
 *
 * Auth: any authenticated user for GET, rfp_admin+ for POST.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

export async function GET(request: Request) {
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
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const rawMinutes = parseInt(url.searchParams.get('minutes') ?? '5', 10);
    const minutes = Math.min(Math.max(1, isNaN(rawMinutes) ? 5 : rawMinutes), 60);
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);

    // ── Business logic ───────────────────────────────────────────
    try {
      const isAdmin = hasRoleAtLeast(role, 'rfp_admin');

      let events;
      if (isAdmin) {
        // Admin sees all events
        events = await sql`
          SELECT id, namespace, type, phase, actor_type, actor_id,
                 tenant_id, payload, error, duration_ms, created_at
          FROM system_events
          WHERE created_at > now() - make_interval(mins => ${minutes})
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      } else {
        // Tenant users see only their tenant's events
        const tenantId = sessionUser.tenantId;
        if (!tenantId) {
          return NextResponse.json({ data: { events: [] } });
        }
        events = await sql`
          SELECT id, namespace, type, phase, actor_type, actor_id,
                 tenant_id, payload, error, duration_ms, created_at
          FROM system_events
          WHERE tenant_id = ${tenantId}::uuid
            AND created_at > now() - make_interval(mins => ${minutes})
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;
      }

      return NextResponse.json({ data: { events } });
    } catch (dbErr) {
      console.error('[events/stream] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Event query failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[events/stream] error:', err);
    return NextResponse.json(
      { error: 'Event stream failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    // ── Auth (admin only) ────────────────────────────────────────
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
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json(
        { error: 'Admin access required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse body ───────────────────────────────────────────────
    let body: {
      namespace?: string;
      type?: string;
      payload?: Record<string, unknown>;
      tenantId?: string | null;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    if (!body.namespace || typeof body.namespace !== 'string') {
      return NextResponse.json(
        { error: 'namespace (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    if (!body.type || typeof body.type !== 'string') {
      return NextResponse.json(
        { error: 'type (string) is required', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    // Namespace must be one of the 7 canonical values (enforced at the DB by the
    // system_events_namespace_chk CHECK from migration 069). Validate here so a bad
    // value returns a clean 422 instead of a raw CHECK violation surfacing as a 500.
    const ALLOWED_NAMESPACES = ['finder', 'capture', 'identity', 'proposal', 'library', 'system', 'tool'];
    if (!ALLOWED_NAMESPACES.includes(body.namespace)) {
      return NextResponse.json(
        { error: 'Invalid namespace', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // ── Insert event ─────────────────────────────────────────────
    try {
      const [event] = await sql<{ id: string }[]>`
        INSERT INTO system_events (
          namespace, type, phase, actor_type, actor_id,
          tenant_id, payload
        ) VALUES (
          ${body.namespace},
          ${body.type},
          'single',
          'user',
          ${sessionUser.id ?? 'unknown'},
          ${body.tenantId ?? null},
          ${sql.json((body.payload ?? {}) as Parameters<typeof sql.json>[0])}
        )
        RETURNING id
      `;

      return NextResponse.json(
        { data: { eventId: event.id } },
        { status: 201 },
      );
    } catch (dbErr) {
      console.error('[events/emit] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Event emission failed', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[events/emit] error:', err);
    return NextResponse.json(
      { error: 'Event emission failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
