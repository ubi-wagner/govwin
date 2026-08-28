/**
 * One meeting.
 *
 *   GET   — its action items: what was agreed, who owes it, and whether it happened.
 *   PATCH { action: 'raise_actions', items: [...] } — turn what was agreed into work.
 *
 * The items become ORDINARY project tasks carrying `meeting_id`, so each arrives with a ToDo, an
 * email and nudges, lands in the same list as everything else that person owes, and still knows
 * where it came from. Raising them inherits `createMilestoneTask`'s authority — adding work to the
 * plan is a management act wherever it starts.
 *
 * ONE call, many items: that is how a meeting ends, and raising them one at a time is six chances
 * to stop halfway, leaving notes that claim five agreements beside a plan holding two.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { listMeetingActions, raiseActionItems } from '@/lib/projects/meetings';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; meetingId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, meetingId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const actions = await listMeetingActions(gate.actor.tenantId, meetingId);
      return NextResponse.json({ data: { actions } });
    });
  } catch (err) {
    console.error('[api/portal/projects/meetings/[meetingId] GET]', err);
    return NextResponse.json({ error: 'Failed to load the action items', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, meetingId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { action?: string; items?: unknown };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action !== 'raise_actions') {
        return NextResponse.json(
          { error: "action must be 'raise_actions', with an items array", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const items = Array.isArray(body.items)
        ? (body.items as Array<{ title?: string; assigneeUserId?: string | null; dueDate?: string | null }>)
        : [];

      const result = await raiseActionItems(gate.actor, projectId, meetingId, items);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      // `refused` comes back so the UI can name what did not land — silently dropping one would
      // leave the notes and the plan disagreeing about what was agreed.
      return NextResponse.json({ data: result.data }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/meetings/[meetingId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to raise the action items', code: 'DB_ERROR' }, { status: 500 });
  }
}
