/**
 * Contract modifications — the only write path to a CLIN.
 *
 *   GET    — the amendment history, executed first, each with the changes it applied.
 *   POST   — draft one. Nothing moves until it is executed.
 *   PATCH  — `action: 'execute'`, which applies every change row in one transaction and freezes it.
 *   DELETE — discard a DRAFT. An executed mod is refused: it is the record of what was agreed.
 *
 * `withProject` scopes the handler with `runInTenant`. It does NOT `enterTenant` on the handler's
 * behalf — that store does not survive an `await` back to the caller, and an unscoped handler
 * answers a textbook `{data:{...}}` envelope over rows RLS matched none of.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { getProject } from '@/lib/projects/project';
import {
  listModifications, draftModification, executeModification, deleteModification,
  type ChangeInput,
} from '@/lib/projects/modifications';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      if (!(await getProject(gate.actor, projectId))) {
        return NextResponse.json({ error: 'Project not found', code: 'NOT_FOUND' }, { status: 404 });
      }
      const modifications = await listModifications(gate.actor.tenantId, projectId);
      return NextResponse.json({ data: { modifications } });
    });
  } catch (err) {
    console.error('[api/portal/projects/modifications GET]', err);
    return NextResponse.json({ error: 'Failed to load the modifications', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const result = await draftModification(gate.actor, projectId, {
        modNumber: body.modNumber as string,
        title: body.title as string,
        description: (body.description as string) ?? null,
        kind: body.kind as string,
        sourceDocId: (body.sourceDocId as string) ?? null,
        changes: Array.isArray(body.changes) ? (body.changes as ChangeInput[]) : [],
      });
      return result.ok
        ? NextResponse.json({ data: { modification: result.data } }, { status: 201 })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/modifications POST]', err);
    return NextResponse.json({ error: 'Failed to record the modification', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let body: Record<string, unknown>;
      try { body = await request.json(); }
      catch { return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      if (body?.action !== 'execute') {
        return NextResponse.json(
          { error: "action must be 'execute', with a modificationId and an executedOn date", code: 'VALIDATION_ERROR' },
          { status: 400 },
        );
      }
      const modificationId = String(body.modificationId ?? '');
      if (!isValidUUID(modificationId)) {
        return NextResponse.json({ error: 'modificationId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await executeModification(gate.actor, projectId, modificationId, {
        executedOn: body.executedOn as string,
        sourceDocId: (body.sourceDocId as string) ?? null,
      });
      return result.ok
        ? NextResponse.json({ data: result.data })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/modifications PATCH]', err);
    return NextResponse.json({ error: 'Failed to execute the modification', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const modificationId = new URL(request.url).searchParams.get('modificationId') ?? '';
      if (!isValidUUID(modificationId)) {
        return NextResponse.json({ error: 'modificationId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await deleteModification(gate.actor, projectId, modificationId);
      return result.ok
        ? NextResponse.json({ data: result.data })
        : NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    });
  } catch (err) {
    console.error('[api/portal/projects/modifications DELETE]', err);
    return NextResponse.json({ error: 'Failed to discard the modification', code: 'DB_ERROR' }, { status: 500 });
  }
}
