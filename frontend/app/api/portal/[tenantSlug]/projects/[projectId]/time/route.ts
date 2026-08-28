/**
 * Labour actuals.
 *
 *   GET    — every entry on the project, newest first.
 *   POST   — log hours against a MILESTONE (required) and optionally a task. Anyone on the project
 *            logs their own; logging on somebody else's behalf is `tenant_admin`, because a
 *            timesheet anybody can write in another person's name is not a timesheet.
 *   PATCH  { action: 'approve', entryIds } — `tenant_admin`. Approving is what turns hours into
 *            cost, and only approved hours reach the roll-up.
 *   DELETE ?entryId= — your own, while it is unapproved. Approved hours are a billing record.
 *
 * The milestone is required because it IS the WBS element (mig 228) — the level the plan is costed
 * at and the level the CLIN grouping lives at: twelve monthly milestones all roll up to CLIN 0002
 * without anybody re-tagging an entry.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import { listTimeEntries, logTime, approveTime, deleteTimeEntry } from '@/lib/projects/time';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      return NextResponse.json({ data: { entries: await listTimeEntries(gate.actor.tenantId, projectId) } });
    });
  } catch (err) {
    console.error('[api/portal/projects/time GET]', err);
    return NextResponse.json({ error: 'Failed to load the time entries', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await logTime(gate.actor, projectId, {
        milestoneId: body.milestoneId as string,
        taskId: (body.taskId as string) ?? null,
        workedOn: body.workedOn as string,
        hours: body.hours as number,
        hourlyRate: (body.hourlyRate as number) ?? null,
        note: (body.note as string) ?? null,
        userId: (body.userId as string) ?? null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { entry: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/time POST]', err);
    return NextResponse.json({ error: 'Failed to log the time', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: { action?: string; entryIds?: unknown };
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action !== 'approve') {
        return NextResponse.json(
          { error: "action must be 'approve', with an entryIds array", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const ids = Array.isArray(body.entryIds) ? (body.entryIds as string[]).filter(isValidUUID) : [];
      const result = await approveTime(gate.actor, projectId, ids);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: result.data });
    });
  } catch (err) {
    console.error('[api/portal/projects/time PATCH]', err);
    return NextResponse.json({ error: 'Failed to approve the time', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const entryId = new URL(request.url).searchParams.get('entryId') ?? '';
      if (!isValidUUID(entryId)) {
        return NextResponse.json({ error: 'entryId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await deleteTimeEntry(gate.actor, projectId, entryId);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: result.data });
    });
  } catch (err) {
    console.error('[api/portal/projects/time DELETE]', err);
    return NextResponse.json({ error: 'Failed to remove the entry', code: 'DB_ERROR' }, { status: 500 });
  }
}
