/**
 * Who is on this project — the roster, and the way people get onto it.
 *
 * ── THIS ROUTE DID NOT EXIST, AND THAT WAS THE BUG ───────────────────────────────────────────
 * `lib/projects/access.ts` says assignment is the whole access mechanism for an employee. The only
 * `project_assignments` row anyone got was the one `createProject` writes for its creator, so no
 * employee could ever be let in — while the empty state on `/projects` told them to *"ask a tenant
 * admin to add you"*.
 *
 * No lens could see it: `reconcile-capability` joins routes to callers, and a route nobody wrote has
 * no row on either side. It surfaced the first time a drive acted as the EMPLOYEE instead of as the
 * manager, and could not tick a task off that had been assigned to them.
 *
 *   GET   — the roster. Anyone who can reach the project: an assignee needs to know who else is on.
 *   POST  — add a member. tenant_admin+.
 *   DELETE — remove one, except the last (an unstaffed project is one nobody can reopen).
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { assignMember, unassignMember, listAssignees } from '@/lib/projects/access';

export async function GET(_request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { assignees: await listAssignees(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/assignees GET]', err);
    return NextResponse.json({ error: 'Failed to load the roster', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { userId?: string };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }
      if (!body?.userId) {
        return NextResponse.json({ error: 'userId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const r = await assignMember(gate.actor, projectId, body.userId);
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      return NextResponse.json({ data: { assignee: r.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/assignees POST]', err);
    return NextResponse.json({ error: 'Failed to staff the project', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: { params: Promise<{ tenantSlug: string; projectId: string }> }) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const userId = new URL(request.url).searchParams.get('userId');
      if (!userId) {
        return NextResponse.json({ error: 'userId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const r = await unassignMember(gate.actor, projectId, userId);
      if (!r.ok) return NextResponse.json({ error: r.error, code: r.code }, { status: r.status });
      return NextResponse.json({ data: r.data });
    });
  } catch (err) {
    console.error('[api/portal/projects/assignees DELETE]', err);
    return NextResponse.json({ error: 'Failed to change the roster', code: 'DB_ERROR' }, { status: 500 });
  }
}
