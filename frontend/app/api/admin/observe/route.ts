/**
 * POST /api/admin/observe — ask the ops companion to read the window.
 *
 * Emits `system:observation_requested`, which `ops_companion` handles. This route does NOT wait
 * for the agent: the fabric picks the event up, runs the archetype under its own spend caps and
 * kill switch, and the advisory lands where agent output lands. The button is a doorbell.
 *
 * ── WHY A DOORBELL AND NOT A CALL ────────────────────────────────────────────────────────────
 * Being an archetype rather than a bespoke integration is what buys the spend caps, the rate
 * limits, `tool_invocation_metrics`, the /admin/agents roster and the guardrail gate. A direct
 * fetch to Anthropic from this route would have to re-earn every one of them, and would be the
 * one AI call on the platform that no cap could stop.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { withEventBracket, userActor } from '@/lib/events';
import { clampWindow, observe } from '@/lib/observe';

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Not signed in', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const su = session.user as { id?: string; email?: string; role?: string };
    const role = su.role as Role | undefined;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 });
    }

    let body: { minutes?: unknown; doing?: unknown } = {};
    try { body = await request.json(); } catch { /* an empty body is fine — defaults apply */ }
    const minutes = clampWindow(body.minutes);
    // What the admin believes they were doing. Optional, and the single most useful input: the gap
    // between stated intent and actual telemetry is where the defects live. Bounded, and treated
    // by the agent as a CLAIM to check rather than a description to accept.
    const doing = typeof body.doing === 'string' ? body.doing.trim().slice(0, 500) : null;

    /**
     * HAND THE AGENT THE FINDINGS — do not make it re-derive them.
     *
     * The arithmetic that spots an unclosed event bracket, a mail row reserved and never
     * confirmed, a workflow that never advanced, a task raised into a role no queue reads, lives
     * in `lib/observe.ts` and runs HERE, in TypeScript, once. It travels in the payload.
     *
     * The earlier version told the agent to ignore all of that and notice something else. That was
     * the wrong division: the arithmetic is good at finding THAT something is wrong and has
     * nothing to say about WHY or WHAT TO CHANGE — which is the whole of the work. Recomputing it
     * on the Python side would have given the platform two implementations of one judgement that
     * can disagree with the admin's own screen; passing it means there is exactly one.
     *
     * Failure here is non-fatal on purpose: a companion asked for a read should still get one, and
     * a null `findings` is a smaller loss than no read at all. It is said out loud either way.
     */
    let findings: unknown[] = [];
    let findingsError: string | null = null;
    try {
      findings = (await observe(minutes)).discrepancies;
    } catch (e) {
      console.error('[admin/observe] could not compute findings for the companion:', e);
      findingsError = 'the deterministic findings could not be computed for this request';
    }

    // withEventBracket, not a hand-rolled start/end pair. The event-contract test caught the
    // hand-rolled version here: its catch returned without closing the bracket, so a throw would
    // have left the start row unterminated forever. That is B139 — 31 handlers shipped with
    // exactly this shape, every one of them closing correctly on the SUCCESS path.
    await withEventBracket(
      {
        namespace: 'system',
        type: 'observation.requested',
        actor: userActor(su.id!, su.email),
        payload: { minutes, doing, findings, findingsError },
      },
      async () => ({ result: { minutes, requested: true, findingCount: findings.length }, value: null }),
    );

    return NextResponse.json({ data: { minutes, requested: true, findingCount: findings.length } });
  } catch (error) {
    console.error('[admin/observe] error:', error);
    return NextResponse.json({ error: 'Failed to request the read', code: 'DB_ERROR' }, { status: 500 });
  }
}
