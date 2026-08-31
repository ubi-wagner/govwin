/**
 * Ask the post-award manager to assess this project's milestone health (A1).
 *
 * POST — emits `project:health.assessment_requested`, which `OnProjectHealthRequested` picks up and
 * runs `project_manager` over. This route does not call the agent: it opens the bracket and returns.
 * The engine owns the run, its caps, and its safe-skip if the fabric is unavailable.
 *
 * ── IT PROMISES AN ASSESSMENT, NOT A CHANGE ──────────────────────────────────────────────────
 * The agent is advisory — it moves no date, closes no milestone, creates no ToDo. The response says
 * so in the field a UI will render, because a button that reads "Assess" and silently rebaselines
 * would be the single worst thing this capability could do.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { canAssign } from '@/lib/projects/access';
import { withEventBracket, userActor } from '@/lib/events';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!canAssign(gate.actor.role)) {
        return NextResponse.json(
          { error: 'Only a tenant admin can request a health assessment', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
      const project = await getProject(gate.actor, projectId);
      if (!project) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      // `withEventBracket` — a start AND an end on every exit path. B139 found 31 handlers whose
      // `catch` returned without closing the bracket, and a start with no end reads as a run that
      // never came back.
      return await withEventBracket(
        {
          namespace: 'project',
          type: 'health.assessment_requested',
          actor: userActor(gate.actor.userId),
          tenantId: gate.actor.tenantId,
          payload: { projectId, projectName: project.name },
        },
        async () => ({
          result: { projectId, requested: true },
          value: NextResponse.json({
            data: {
              projectId,
              requested: true,
              // Said plainly, in the field a UI renders. The agent reads and reports; a person
              // decides. Nothing on the project changes because this button was pressed.
              advisory: true,
              note: 'The assessment is advisory — nothing on the project will be changed by it.',
            },
          }, { status: 202 }),
        }),
      );
    });
  } catch (err) {
    console.error('[api/portal/projects/assess-health POST]', err);
    return NextResponse.json({ error: 'Failed to request the assessment', code: 'DB_ERROR' }, { status: 500 });
  }
}
