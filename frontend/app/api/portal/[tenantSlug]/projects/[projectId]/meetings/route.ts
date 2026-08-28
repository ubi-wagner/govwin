/**
 * Meetings on a project.
 *
 *   GET   — every meeting, newest first, with how many action items came out of it and how many
 *           are done. "What did we agree, and did it happen?" is the question a register of
 *           meetings exists to answer, and a list of titles cannot.
 *   POST  — record one. Open to anyone on the project: whoever took the notes.
 *
 * The notes are a canvas document, created in the same write — the same editor, compliance floor
 * and exporters every other project artifact uses. Minutes that cannot be exported are minutes
 * nobody can send.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listProjectMeetings, recordMeeting } from '@/lib/projects/meetings';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { meetings: await listProjectMeetings(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/meetings GET]', err);
    return NextResponse.json({ error: 'Failed to load the meetings', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { title?: string; heldOn?: string; attendees?: unknown };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await recordMeeting(gate.actor, projectId, body ?? {});
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { meeting: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/meetings POST]', err);
    return NextResponse.json({ error: 'Failed to record the meeting', code: 'DB_ERROR' }, { status: 500 });
  }
}
