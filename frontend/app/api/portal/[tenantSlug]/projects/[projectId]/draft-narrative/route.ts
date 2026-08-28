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
import { sql } from '@/lib/db';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { canAssign } from '@/lib/projects/access';
import { withEventBracket, userActor } from '@/lib/events';
import { statusReportInput } from '@/lib/projects/status-report-data';
import { checkNarrativeFidelity, allowedFigures } from '@/lib/projects/narrative-fidelity';
import { coerceJsonb } from '@/lib/jsonb';

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

      // ── WHERE THE AGENT'S OUTPUT ACTUALLY IS ───────────────────────────────────────────────
      // NOT `system_events` `agent.invoked` — that is a TELEMETRY record (rounds, cost, guardrail
      // verdict, token counts) and carries neither the output nor a projectId. Reading it returned
      // "no draft" forever, on a route whose four honest states made the failure look like one of
      // them. The output lands in the workflow's own `step_results`.
      //
      // Correlated by the INSTANCE's payload and tenant, so one project's narrative cannot be
      // handed to another.
      const [row] = await sql<{ steps: unknown; createdAt: string }[]>`
        SELECT step_results AS steps, created_at FROM process_instances
         WHERE workflow_name = 'OnStatusNarrativeRequested'
           AND payload->>'projectId' = ${projectId}
           AND tenant_id = ${gate.actor.tenantId}::uuid
         ORDER BY created_at DESC LIMIT 1`;

      if (!row) {
        // Not an error: the draft may still be running, or none has ever been asked for. Saying
        // which is the difference between a person waiting and a person retrying.
        return NextResponse.json({ data: { narrative: null, status: 'none' } });
      }

      // The tool-loop shape: step → result → result → tool_results[] → the `emit_narrative` call's
      // output. Walked defensively — a shape this deep must degrade to "empty" rather than throw
      // on a run that ended differently.
      const steps = coerceJsonb<Record<string, unknown>>(row.steps, {});
      const step = coerceJsonb<Record<string, unknown>>(steps.ai_status_narrator, {});
      const inner = coerceJsonb<Record<string, unknown>>(
        coerceJsonb<Record<string, unknown>>(step.result, {}).result, {},
      );
      const calls = Array.isArray(inner.tool_results) ? inner.tool_results : [];
      const emitted = calls.find(
        (c) => (c as Record<string, unknown>)?.tool === 'emit_narrative',
      ) as Record<string, unknown> | undefined;
      const narrative = coerceJsonb<{ paragraphs?: string[] }>(
        (emitted?.output as Record<string, unknown> | undefined)?.narrative, {},
      );
      const paragraphs = Array.isArray(narrative.paragraphs) ? narrative.paragraphs.map(String) : [];
      if (paragraphs.length === 0) {
        return NextResponse.json({ data: { narrative: null, status: 'empty' } });
      }

      // ── THE GATE ────────────────────────────────────────────────────────────────────────────
      // Recompute what the report is entitled to say, from the same source the deterministic
      // builder uses, and check the prose against it. This is the guarantee; the prompt is not.
      const facts = await statusReportInput(gate.actor.tenantId, projectId, {
        title: '', projectName: '', periodStart: null, periodEnd: null,
        asAt: new Date().toISOString().slice(0, 10),
      });
      const allowed = allowedFigures(facts.rollup, facts.billing, facts.risks, facts.upcoming, {
        done: facts.tasksDone, open: facts.tasksOpen, blocked: facts.tasksBlocked,
      });
      const check = checkNarrativeFidelity(paragraphs.join('\n\n'), allowed);

      if (!check.ok) {
        return NextResponse.json({
          data: {
            narrative: null,
            status: 'rejected',
            invented: check.invented,
            // Named, not hidden. A person who asked for a draft and got nothing deserves to know
            // it was refused and why — otherwise they retry into the same wall.
            note: `The draft was not offered: it states ${check.invented.join(', ')}, which the `
              + 'system did not compute. Ask again, or write the paragraph yourself.',
          },
        });
      }

      return NextResponse.json({
        data: {
          narrative: { paragraphs },
          status: 'ready',
          // How many figures were actually verified — a clean result over zero numbers is a
          // different statement from a clean result over eleven.
          figuresChecked: check.checked,
          draftedAt: row.createdAt,
        },
      });
    });
  } catch (err) {
    console.error('[api/portal/projects/draft-narrative GET]', err);
    return NextResponse.json({ error: 'Failed to read the draft', code: 'DB_ERROR' }, { status: 500 });
  }
}
