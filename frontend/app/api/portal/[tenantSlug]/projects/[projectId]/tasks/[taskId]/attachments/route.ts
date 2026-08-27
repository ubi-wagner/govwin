/**
 * Reference files on a task.
 *
 * POST attaches, GET lists, DELETE removes one (`?attachmentId=`). Open to any member who can reach
 * the project — attaching the drawing you were asked about is the work.
 *
 * An attachment is a REFERENCE, never evidence of completion: nothing here touches task status, the
 * same separation that keeps uploading a deliverable from accepting it.
 */
import { NextResponse } from 'next/server';
import { withProject } from '@/lib/projects/gate';
import { attachToTask, detachFromTask, listTaskAttachments } from '@/lib/projects/task-attachments';
import { isValidUUID } from '@/lib/validation';

type Ctx = { params: Promise<{ tenantSlug: string; projectId: string; taskId: string }> };

export async function GET(_request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, taskId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const attachments = await listTaskAttachments(gate.actor.tenantId, projectId, taskId);
      return NextResponse.json({ data: { attachments } });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks/attachments GET]', err);
    return NextResponse.json({ error: 'Failed to list attachments', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId, taskId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      let form: FormData;
      try { form = await request.formData(); }
      catch { return NextResponse.json({ error: 'A multipart upload is required', code: 'VALIDATION_ERROR' }, { status: 400 }); }

      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json({ error: 'A file is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }

      const result = await attachToTask(gate.actor, projectId, taskId, {
        filename: file.name, body: Buffer.from(await file.arrayBuffer()), contentType: file.type || null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: { attachment: result.data } }, { status: 201 });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks/attachments POST]', err);
    return NextResponse.json({ error: 'Failed to attach the file', code: 'STORAGE_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const { tenantSlug, projectId } = await ctx.params;
    return await withProject(tenantSlug, async (gate) => {
      const attachmentId = new URL(request.url).searchParams.get('attachmentId') ?? '';
      if (!isValidUUID(attachmentId)) {
        return NextResponse.json({ error: 'attachmentId is required', code: 'VALIDATION_ERROR' }, { status: 400 });
      }
      const result = await detachFromTask(gate.actor, projectId, attachmentId);
      if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
      return NextResponse.json({ data: result.data });
    });
  } catch (err) {
    console.error('[api/portal/projects/tasks/attachments DELETE]', err);
    return NextResponse.json({ error: 'Failed to remove the attachment', code: 'DB_ERROR' }, { status: 500 });
  }
}
