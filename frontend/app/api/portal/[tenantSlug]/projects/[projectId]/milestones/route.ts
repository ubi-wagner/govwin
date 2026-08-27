/**
 * Milestones on a project — the unit of project management.
 *
 *   GET   — milestones, their deliverables AND their task lists, so the workspace renders in one
 *           round trip. A milestone without its checklist is half the object.
 *   POST  — add a milestone. tenant_admin+.
 *   PATCH — three verbs, because they are three different acts on the same row:
 *             met         close it, with an optional completion note and metrics. Refuses while a
 *                         TASK is not done (the work) or a DELIVERABLE is unaccepted (the
 *                         customer's signature) — separate messages, separate next actions.
 *             reschedule  move the end date; by default everything later moves with it, which is
 *                         what makes the plan serial rather than a list of loose dates.
 *             resequence  fill in the serial starts (previous end + 1 day) without touching a
 *                         start someone pinned.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { createMilestone, listMilestones, listDeliverables, markMilestoneMet } from '@/lib/projects/milestones';
import { listMilestoneTasks, rescheduleMilestone, resequence } from '@/lib/projects/milestone-tasks';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const [milestones, deliverables, tasks] = await Promise.all([
        listMilestones(gate.actor.tenantId, projectId),
        listDeliverables(gate.actor.tenantId, projectId),
        listMilestoneTasks(gate.actor.tenantId, projectId),
      ]);
      return NextResponse.json({ data: { milestones, deliverables, tasks } });
    });
  } catch (err) {
    console.error('[api/portal/projects/milestones GET]', err);
    return NextResponse.json({ error: 'Failed to load milestones', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      let body: { title?: string; clinId?: string | null; wbsNodeId?: string | null; forecastDate?: string | null; sortIndex?: number };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await createMilestone(gate.actor, projectId, { title: body?.title ?? '', ...body });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { milestone: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/milestones POST]', err);
    return NextResponse.json({ error: 'Failed to add the milestone', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      let body: {
        milestoneId?: string; action?: string;
        note?: string | null; metrics?: Record<string, unknown> | null;
        forecastDate?: string; cascade?: boolean;
      };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action === 'resequence') {
        const seq = await resequence(gate.actor, projectId);
        if (!seq.ok) return NextResponse.json({ error: seq.error, code: seq.code }, { status: seq.status });
        return NextResponse.json({ data: seq.data });
      }

      if (!body?.milestoneId) {
        return NextResponse.json(
          { error: "Provide milestoneId and one of action:'met' | 'reschedule' | 'resequence'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      if (body.action === 'reschedule') {
        if (!body.forecastDate) {
          return NextResponse.json({ error: 'forecastDate is required to reschedule', code: 'VALIDATION_ERROR' }, { status: 400 });
        }
        const moved = await rescheduleMilestone(gate.actor, projectId, body.milestoneId, body.forecastDate, { cascade: body.cascade });
        if (!moved.ok) return NextResponse.json({ error: moved.error, code: moved.code }, { status: moved.status });
        return NextResponse.json({ data: moved.data });
      }

      if (body.action !== 'met') {
        return NextResponse.json(
          { error: "action must be 'met', 'reschedule' or 'resequence'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      const result = await markMilestoneMet(gate.actor, projectId, body.milestoneId,
        { note: body.note ?? null, metrics: body.metrics ?? null });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { milestone: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/milestones PATCH]', err);
    return NextResponse.json({ error: 'Failed to close the milestone', code: 'DB_ERROR' }, { status: 500 });
  }
}
