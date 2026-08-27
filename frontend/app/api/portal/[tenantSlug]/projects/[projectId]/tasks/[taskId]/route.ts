/**
 * One task: tick it off, block it, or reopen it.
 *
 * **Open to any member who can reach the project**, not just a tenant_admin. Creating tasks and
 * closing the milestone are management acts; doing the work is not. A checklist only a manager can
 * tick is a status report they maintain on everyone else's behalf, which is the thing this feature
 * exists to replace.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { setTaskStatus } from '@/lib/projects/milestone-tasks';

export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ tenantSlug: string; projectId: string; taskId: string }> },
) {
  try {
    const { tenantSlug, projectId, taskId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { status?: string; blockedReason?: string | null };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const next = body?.status;
      if (next !== 'open' && next !== 'done' && next !== 'blocked') {
        return NextResponse.json(
          { error: "status must be 'open', 'done' or 'blocked'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }

      const result = await setTaskStatus(gate.actor, projectId, taskId, next, body.blockedReason ?? null);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { task: result.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks/[taskId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the task', code: 'DB_ERROR' }, { status: 500 });
  }
}
