/**
 * One delivery project — the workspace header, its anchor documents, its CLINs, and whether its
 * skeleton can be frozen.
 *
 * A single GET rather than four, because every one of these is needed to render the page and four
 * round trips would each repeat the same access check.
 */
import { NextResponse } from 'next/server';
import { withDelivery } from '@/lib/delivery/gate';
import { getProject, listSourceDocuments, readiness } from '@/lib/delivery/projects';
import { listClins } from '@/lib/delivery/clins';
import { listAssignees } from '@/lib/delivery/access';
import { provenanceFor } from '@/lib/delivery/provenance';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withDelivery(tenantSlug, async (gate) => {

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
        provenance[clin.id] = await provenanceFor(gate.actor.tenantId, 'delivery_clins', clin.id);
      }

      return NextResponse.json({ data: { project, documents, clins, assignees, readiness: ready, provenance } });
    });
  } catch (err) {
    console.error('[api/portal/delivery/projects/[projectId] GET]', err);
    return NextResponse.json({ error: 'Failed to load the delivery project', code: 'DB_ERROR' }, { status: 500 });
  }
}
