/**
 * GET  /api/events — Server-Sent Events stream for real-time dashboard updates
 * POST /api/events — Emit a system event (admin only)
 *
 * SSE endpoint that streams new system_events to connected clients.
 * Used by admin dashboard and portal for live updates.
 *
 * Auth: any authenticated user. Events are filtered by role:
 *   - admin roles see all events
 *   - tenant roles see only their tenant's events
 *
 * V1 TODO (P2-27): Implement SSE stream.
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

    // ── Business logic ───────────────────────────────────────────
    // TODO: Implement SSE event stream
    //
    // Option A: Polling-based SSE (simpler, V1)
    //   const stream = new ReadableStream({
    //     async start(controller) {
    //       let lastId = 0;
    //       const interval = setInterval(async () => {
    //         const events = await sql`
    //           SELECT id, namespace, type, phase, payload, created_at
    //           FROM system_events
    //           WHERE id > ${lastId}
    //             [AND tenant_id = ${sessionUser.tenantId}::uuid] -- for tenant roles
    //           ORDER BY id ASC LIMIT 10
    //         `;
    //         for (const event of events) {
    //           controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
    //           lastId = event.id;
    //         }
    //       }, 2000);
    //       request.signal.addEventListener('abort', () => clearInterval(interval));
    //     },
    //   });
    //   return new Response(stream, {
    //     headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
    //   });
    //
    // Option B: pg_notify-based SSE (instant, V2)
    //   Use LISTEN on the system_events_notify channel

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-27',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
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

    // TODO: Implement manual event emission (for admin testing)
    // Parse body: { namespace, type, payload }
    // Insert into system_events
    // Return { data: { eventId } }

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-27',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[events/emit] error:', err);
    return NextResponse.json(
      { error: 'Event emission failed', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
