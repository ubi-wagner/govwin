/**
 * Who closes a milestone's gate, and the AI manager's attempt at it (A4).
 *
 *   PATCH `action: 'set'`   — assign a milestone to a person or the AI manager.
 *   PATCH `action: 'sweep'` — let the AI manager try every milestone assigned to it.
 *
 * The sweep can only ever close what a tenant_admin could have closed at that moment: it calls
 * `markMilestoneMet`, refusals and all. What the agent adds is a reason to STOP — an open
 * high-scoring risk, or a deliverable accepted internally but never sent — so its judgement can
 * block a close and can never permit one.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { canAssign } from '@/lib/projects/access';
import { setGateCloser, sweepAutoCloses, type GateCloser } from '@/lib/projects/gate-closer';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!canAssign(gate.actor.role)) {
        return NextResponse.json(
          { error: 'Only a tenant admin can change who closes a gate', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action === 'sweep') {
        const outcomes = await sweepAutoCloses(gate.actor, projectId);
        return NextResponse.json({
          data: {
            outcomes,
            closed: outcomes.filter((o) => o.closed).length,
            // Reported, not hidden. A sweep that returned only its successes would make "nothing
            // happened" and "three phases were blocked" look identical.
            declined: outcomes.filter((o) => !o.closed).length,
          },
        });
      }

      if (body?.action !== 'set') {
        return NextResponse.json(
          { error: "action must be 'set' or 'sweep'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const milestoneId = String(body.milestoneId ?? '');
      if (!isValidUUID(milestoneId)) {
        return NextResponse.json({ error: 'milestoneId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await setGateCloser(
        gate.actor, projectId, milestoneId, body.gateCloser as GateCloser,
      );
      return result.ok
        ? NextResponse.json({ data: result.data })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/gate-closer PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the gate closer', code: 'DB_ERROR' }, { status: 500 });
  }
}
