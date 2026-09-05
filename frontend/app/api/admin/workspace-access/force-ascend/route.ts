/**
 * POST /api/admin/workspace-access/force-ascend — end somebody else's presence in a customer's
 * workspace, now.
 *
 * ── THE ACT THE PAGE WAS MISSING ─────────────────────────────────────────────────────────────
 * `/admin/workspace-access` could see an open bracket and do nothing about it. Every other closer
 * is the actor or the clock; this is the only one a second person can cause, which is exactly what
 * an operator wants when they look at that page and see something that should not be open.
 *
 * ── IT IS A COOLDOWN, AND THE ROUTE SAYS SO ──────────────────────────────────────────────────
 * Closing the bracket alone evicts the RECORD, not the actor: `isShadowAdmin` is recomputed every
 * render, so their next page load opens a new one. `inForcedCooldown` in the portal layout is what
 * makes this button mean anything, and it holds for 30 minutes rather than forever — a permanent
 * block would need a real grant model and a way to lift it, and an operator silently holding one is
 * worse than a visible half hour.
 *
 * Auth: rfp_admin or master_admin, the same gate as the page that offers the button.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { sqlBypass } from '@/lib/db';
import { forceAscend, FORCED_ASCENT_COOLDOWN_MS } from '@/lib/space-presence';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(request: Request) {
  try {
    const session = await auth();
    const me = session?.user as { id?: string; email?: string | null; role?: Role } | undefined;
    if (!me?.id) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    if (me.role !== 'master_admin' && me.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { userId?: unknown; tenantId?: unknown };
    try {
      body = (await request.json()) as { userId?: unknown; tenantId?: unknown };
    } catch {
      return NextResponse.json({ error: 'A JSON body is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    const userId = typeof body.userId === 'string' ? body.userId : '';
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId : null;
    if (!/^[0-9a-f-]{36}$/i.test(userId)) {
      return NextResponse.json({ error: 'A valid userId is required', code: 'INVALID_INPUT' }, { status: 400 });
    }
    if (tenantId && !/^[0-9a-f-]{36}$/i.test(tenantId)) {
      return NextResponse.json({ error: 'tenantId must be a uuid', code: 'INVALID_INPUT' }, { status: 400 });
    }

    // Ending your OWN presence is what the exit control is for, and routing it through here would
    // write `forced` into a customer's trail for something the actor did themselves — a false fact
    // in the one record that most needs to be true.
    if (userId === me.id) {
      return NextResponse.json(
        { error: 'Use the exit control to leave a workspace yourself.', code: 'SELF_TARGET' },
        { status: 400 },
      );
    }

    // Cross-tenant by nature: the target is somebody else, in somebody else's workspace.
    const [target] = await sqlBypass<{ email: string | null; name: string | null }[]>`
      SELECT email, name FROM users WHERE id = ${userId}::uuid`;
    if (!target) {
      return NextResponse.json({ error: 'No such user', code: 'NOT_FOUND' }, { status: 404 });
    }

    const closed = await forceAscend({ id: userId, email: target.email }, { tenantId });

    // Audited against the OPERATOR, not the person ejected: "who ended this" is the question, and
    // `forceAscend` writes the closer as the actor's own exit event, which would name the wrong
    // person if this were the only record.
    await emitEventSingle({
      namespace: 'identity',
      type: 'presence.force_ended',
      actor: userActor(me.id, me.email ?? undefined),
      tenantId,
      payload: {
        targetUserId: userId,
        targetEmail: target.email,
        bracketsClosed: closed,
        cooldownMs: FORCED_ASCENT_COOLDOWN_MS,
      },
    }).catch(() => {});

    // 0 closed is not an error — they had already left. Reporting it lets the page say so instead
    // of implying an eviction that did not happen.
    return NextResponse.json({
      data: { closed, cooldownMinutes: Math.round(FORCED_ASCENT_COOLDOWN_MS / 60_000) },
    });
  } catch (err) {
    console.error('[admin/workspace-access/force-ascend] error', err);
    return NextResponse.json({ error: 'Could not end the session', code: 'DB_ERROR' }, { status: 500 });
  }
}
