/**
 * Draft the narrative paragraphs of a status report (A2).
 *
 *   POST — ask for a draft. Emits `project:status_narrative.requested`, which
 *          `OnStatusNarrativeRequested` runs `status_narrator` over.
 *   GET  — read back the most recent draft, **after checking every figure in it**.
 *
 * ── THE CHECK IS HERE, NOT IN THE PROMPT ─────────────────────────────────────────────────────
 * The report's tables are correct by construction — every figure read off a row. One sentence of
 * generated prose can undo that: "approximately 65% through the period" reads perfectly beside a
 * table saying 40%, and the reader believes whichever they saw first.
 *
 * So the GET does not hand back what the agent wrote. It recomputes the figures the report is
 * entitled to state, checks the prose against them, and REFUSES a draft containing a number the
 * system never produced — naming the number, so a person can see what was rejected rather than
 * wondering why nothing appeared.
 *
 * A prompt asking the model not to invent figures is also in place, and is the weaker of the two on
 * purpose: an instruction is not an invariant.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { canAssign } from '@/lib/projects/access';
import { withEventBracket, userActor } from '@/lib/events';
import { readDraftedNarrative } from '@/lib/projects/narrative-read';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function POST(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!canAssign(gate.actor.role)) {
        return NextResponse.json(
          { error: 'Only a tenant admin can request a drafted narrative', code: 'FORBIDDEN' },
          { status: 403 },
        );
      }
      const project = await getProject(gate.actor, projectId);
      if (!project) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      return await withEventBracket(
        {
          namespace: 'project',
          type: 'status_narrative.requested',
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
              advisory: true,
              note: 'A draft is being written. Every figure in it is checked against what the '
                + 'system computed before you are offered it, and nothing is added to the report '
                + 'until you accept it.',
            },
          }, { status: 202 }),
        }),
      );
    });
  } catch (err) {
    console.error('[api/portal/projects/draft-narrative POST]', err);
    return NextResponse.json({ error: 'Failed to request the draft', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      // ONE implementation, shared with the server-rendered workspace. A copy here would
      // eventually disagree with the page about which figures are permitted, and the disagreement
      // would surface as a draft the page offered and this route refused.
      return NextResponse.json({ data: await readDraftedNarrative(gate.actor.tenantId, projectId) });
    });
  } catch (err) {
    console.error('[api/portal/projects/draft-narrative GET]', err);
    return NextResponse.json({ error: 'Failed to read the draft', code: 'DB_ERROR' }, { status: 500 });
  }
}
