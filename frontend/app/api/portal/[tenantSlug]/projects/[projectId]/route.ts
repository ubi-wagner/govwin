/**
 * One project — the workspace header, its anchor documents, its CLINs, and whether its
 * skeleton can be frozen.
 *
 * A single GET rather than four, because every one of these is needed to render the page and four
 * round trips would each repeat the same access check.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { closeProject, reopenProject } from '@/lib/projects/closeout';
import { getProject, listSourceDocuments, readiness } from '@/lib/projects/project';
import { listClins } from '@/lib/projects/clins';
import { listAssignees } from '@/lib/projects/access';
import { provenanceFor } from '@/lib/projects/provenance';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {

      // `getProject` runs the assignment check. A project the actor cannot reach answers 404 rather
      // than 403 — a 403 would confirm the project exists to someone who has no business knowing.
      const project = await getProject(gate.actor, projectId);
      if (!project) return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });

      const [documents, clins, assignees, ready] = await Promise.all([
        listSourceDocuments(gate.actor.tenantId, projectId),
        listClins(gate.actor.tenantId, projectId),
        listAssignees(gate.actor.tenantId, projectId),
        readiness(gate.actor.tenantId, projectId),
      ]);

      // Provenance per CLIN, so the page can badge each field rather than the row.
      const provenance: Record<string, Awaited<ReturnType<typeof provenanceFor>>> = {};
      for (const clin of clins) {
        provenance[clin.id] = await provenanceFor(gate.actor.tenantId, 'project_clins', clin.id);
      }

      return NextResponse.json({ data: { project, documents, clins, assignees, readiness: ready, provenance } });
    });
  } catch (err) {
    console.error('[api/portal/projects/projects/[projectId] GET]', err);
    return NextResponse.json({ error: 'Failed to load the project', code: 'DB_ERROR' }, { status: 500 });
  }
}

/**
 * Close the project out, or reopen it.
 *
 *   { action: 'close', note?, metrics? }   refuses while a milestone is running, a task is open, or
 *                                          a deliverable is unaccepted — three separate messages,
 *                                          because they are three different next actions
 *   { action: 'reopen', reason? }          close-out reopens in the real world; the event pair is
 *                                          the history, and the close-out note is kept
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { action?: string; note?: string | null; metrics?: Record<string, unknown> | null; reason?: string | null };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action === 'reopen') {
        const r = await reopenProject(gate.actor, projectId, body.reason ?? null);
        if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
        return NextResponse.json({ data: { project: r.data } });
      }
      if (body?.action !== 'close') {
        return NextResponse.json(
          { error: "action must be 'close' or 'reopen'", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const r = await closeProject(gate.actor, projectId, { note: body.note ?? null, metrics: body.metrics ?? null });
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      return NextResponse.json({ data: { project: r.data } });
    });
  } catch (err) {
    console.error('[api/portal/projects/[projectId] PATCH]', err);
    return NextResponse.json({ error: 'Failed to update the project', code: 'DB_ERROR' }, { status: 500 });
  }
}
