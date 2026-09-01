/**
 * Reference files on a project task.
 *
 * ── A REFERENCE, NOT EVIDENCE OF COMPLETION ──────────────────────────────────────────────────
 * Nothing in this file touches task `status`. That is the same separation `uploadDeliverable` keeps
 * from `accepted_at`, and it exists for the same reason: a file appearing is not work finishing. If
 * attaching a drawing could tick a task off, a checklist would close itself the moment somebody
 * shared context — and "done" would stop meaning anyone decided it was done.
 *
 * ── OPEN TO ANY MEMBER ON THE PROJECT ────────────────────────────────────────────────────────
 * Attaching the spec you were asked about is the work, not a management act. `canAccessProject` is
 * the whole gate — the same one `setTaskStatus` uses.
 *
 * ── AND WHY DELETION IS NARROW ───────────────────────────────────────────────────────────────
 * Only whoever uploaded a file may remove it (a tenant_admin may remove any). Someone else's
 * reference disappearing from a task, with no trace, is indistinguishable from it never having been
 * there — and the object itself is left in storage, so the row is what goes, not the bytes.
 */
import { randomUUID } from 'crypto';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject } from '@/lib/storage/s3-client';
import { customerProjectPath } from '@/lib/storage/paths';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import type { Fail, Ok } from './project';

export interface TaskAttachment {
  id: string;
  taskId: string;
  filename: string;
  storageKey: string;
  contentType: string | null;
  byteSize: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  uploadedByEmail?: string | null;
}

// The same vocabulary and ceiling as a deliverable upload. Deliberately identical rather than
// imported: these are two different policies that happen to agree today, and coupling them would
// mean a change made for contract deliverables silently re-scoping what a person may attach to a
// task. (If they diverge, they diverge here, visibly.)
const ALLOWED_EXT = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'txt', 'md', 'csv', 'zip', 'png', 'jpg', 'jpeg']);
const MAX_BYTES = 100 * 1024 * 1024;

export async function listTaskAttachments(
  tenantId: string,
  projectId: string,
  taskId?: string,
): Promise<TaskAttachment[]> {
  try {
    // One query for the whole project by default: the workspace renders every task at once, and a
    // request per task is what turns a twenty-task milestone into twenty round trips.
    return taskId
      ? await sql<TaskAttachment[]>`
          SELECT a.id, a.task_id, a.filename, a.storage_key, a.content_type, a.byte_size,
                 a.uploaded_by, a.uploaded_at, u.email AS uploaded_by_email
            FROM project_task_attachments a
            LEFT JOIN users u ON u.id = a.uploaded_by
           WHERE a.task_id = ${taskId}::uuid AND a.project_id = ${projectId}::uuid
             AND a.tenant_id = ${tenantId}::uuid
           ORDER BY a.uploaded_at DESC`
      : await sql<TaskAttachment[]>`
          SELECT a.id, a.task_id, a.filename, a.storage_key, a.content_type, a.byte_size,
                 a.uploaded_by, a.uploaded_at, u.email AS uploaded_by_email
            FROM project_task_attachments a
            LEFT JOIN users u ON u.id = a.uploaded_by
           WHERE a.project_id = ${projectId}::uuid AND a.tenant_id = ${tenantId}::uuid
           ORDER BY a.uploaded_at DESC`;
  } catch (err) {
    console.error('[projects/task-attachments] listTaskAttachments failed:', err);
    return [];
  }
}

export async function attachToTask(
  actor: ProjectActor,
  projectId: string,
  taskId: string,
  input: { filename: string; body: Buffer; contentType?: string | null },
): Promise<Ok<TaskAttachment> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };
  }

  const filename = (input.filename ?? '').trim();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (!filename || filename.includes('/') || filename.includes('..') || !ALLOWED_EXT.has(ext)) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `A filename ending in one of ${[...ALLOWED_EXT].join(', ')} is required`,
    };
  }
  if (!input.body?.length) {
    return { ok: false, status: 400, error: 'The uploaded file is empty', code: 'VALIDATION_ERROR' };
  }
  if (input.body.length > MAX_BYTES) {
    return { ok: false, status: 413, error: 'That file exceeds the 100 MB limit', code: 'PAYLOAD_TOO_LARGE' };
  }

  try {
    // FK-before-write, scoped to THIS project: a task id from another project satisfies the FK and
    // would file one contract's reference under another's.
    const [task] = await sql<{ id: string; title: string }[]>`
      SELECT id, title FROM project_milestone_tasks
       WHERE id = ${taskId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!task) return { ok: false, status: 404, error: 'Task not found', code: 'NOT_FOUND' };

    const [tenant] = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants WHERE id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!tenant) return { ok: false, status: 404, error: 'Tenant not found', code: 'NOT_FOUND' };

    // Id-derived key; the user's filename is display only and never reaches the object key.
    const key = customerProjectPath(tenant.slug, projectId, `tasks/${taskId}/${randomUUID()}.${ext}`);
    await putObject({ key, body: input.body, contentType: input.contentType ?? undefined });

    const [row] = await sql<TaskAttachment[]>`
      INSERT INTO project_task_attachments
        (tenant_id, project_id, task_id, filename, storage_key, content_type, byte_size, uploaded_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${taskId}::uuid, ${filename}, ${key},
         ${input.contentType ?? null}, ${input.body.length}, ${actor.userId}::uuid)
      RETURNING id, task_id, filename, storage_key, content_type, byte_size, uploaded_by, uploaded_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to attach the file', code: 'DB_ERROR' };

    await emitEventSingle({
      namespace: 'project',
      type: 'task.reference_attached',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, taskId, attachmentId: row.id, filename, title: task.title },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/task-attachments] attachToTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to attach the file', code: 'STORAGE_ERROR' };
  }
}

export async function detachFromTask(
  actor: ProjectActor,
  projectId: string,
  attachmentId: string,
): Promise<Ok<{ attachmentId: string }> | Fail> {
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Attachment not found', code: 'NOT_FOUND' };
  }
  try {
    const [row] = await sql<{ id: string; uploadedBy: string | null; taskId: string; filename: string }[]>`
      SELECT id, uploaded_by, task_id, filename FROM project_task_attachments
       WHERE id = ${attachmentId}::uuid AND project_id = ${projectId}::uuid
         AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!row) return { ok: false, status: 404, error: 'Attachment not found', code: 'NOT_FOUND' };

    if (row.uploadedBy !== actor.userId && !canAssign(actor.role)) {
      return {
        ok: false, status: 403, code: 'FORBIDDEN',
        error: 'Only whoever attached that file, or a tenant admin, can remove it.',
      };
    }

    await sql`
      DELETE FROM project_task_attachments
       WHERE id = ${attachmentId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;

    // The object is LEFT in storage. Deleting the row removes it from the task; deleting the bytes
    // would make the audit event point at nothing, and nothing in this product hard-deletes content
    // (docs/ARCHIVABLE_CONTRACT.md).
    await emitEventSingle({
      namespace: 'project',
      type: 'task.reference_removed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, taskId: row.taskId, attachmentId, filename: row.filename },
    });
    return { ok: true, data: { attachmentId } };
  } catch (err) {
    console.error('[projects/task-attachments] detachFromTask failed:', err);
    return { ok: false, status: 500, error: 'Failed to remove the attachment', code: 'DB_ERROR' };
  }
}
