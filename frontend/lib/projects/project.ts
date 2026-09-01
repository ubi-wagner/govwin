/**
 * Projects and their anchor documents.
 *
 * ── THE ANCHOR ───────────────────────────────────────────────────────────────────────────────
 * A project workspace hangs off two UPLOADED files: the executed contract and the as-submitted
 * proposal. Not a pointer to `proposals`/`proposal_sections`, **even when we authored the
 * proposal**.
 *
 * What lives in the proposal spine is a working copy that stayed editable after submission. A
 * deliverable tracing to our canvas traces to something that can still change; one tracing to the
 * uploaded PDF traces to what was actually signed. `projects.contract_id` is a navigation
 * convenience and is explicitly not the source of truth.
 *
 * ── WHY A PROJECT CAN EXIST BEFORE ITS ARTIFACTS, BUT CANNOT BE BASELINED ────────────────────
 * Requiring both files at creation would mean a person cannot open the workspace to see what is
 * being asked of them, which turns the ToDo into a dead end. Requiring nothing would let a
 * workspace be anchored to nothing at all — the thing the whole provenance model forbids.
 *
 * The line is the BASELINE. A project freezes its contractual skeleton once, and freezing it
 * against documents that are not there is the failure worth preventing. `readiness()` is what the
 * baseline route checks, and it is the only place the two-artifact rule is enforced.
 */
import { randomUUID } from 'crypto';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject } from '@/lib/storage/s3-client';
import { customerProjectPath } from '@/lib/storage/paths';
import { canAccessProject, canAssign, type ProjectActor } from './access';

export type SourceKind = 'executed_contract' | 'submitted_proposal';

export interface Project {
  id: string;
  tenantId: string;
  contractId: string | null;
  name: string;
  status: string;
  baselinedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface SourceDocument {
  id: string;
  kind: SourceKind;
  storageKey: string;
  filename: string;
  contentType: string | null;
  byteSize: string | null;
  uploadedBy: string;
  uploadedAt: string;
}

export type Fail = { ok: false; status: number; error: string; code: string };
export type Ok<T> = { ok: true; data: T };

/**
 * Create a project workspace.
 *
 * `tenant_admin`+ only: opening a workspace is a company-level act, and an employee is granted
 * access to one by assignment rather than by creating it.
 */
export async function createProject(
  actor: ProjectActor,
  input: { name: string; contractId?: string | null },
): Promise<Ok<Project> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can open a project', code: 'FORBIDDEN' };
  }
  const name = (input.name ?? '').trim();
  if (!name || name.length > 300) {
    return { ok: false, status: 400, error: 'A project name of 1–300 characters is required', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-BEFORE-WRITE. `projects.contract_id` has a real FK, so a bad id would throw AFTER
    // the row was otherwise valid and 500 on the constraint. Validating first — and scoped to this
    // tenant, so a contract id from another tenant reads as "not found" rather than linking.
    let contractId: string | null = null;
    if (input.contractId) {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM contracts
         WHERE id = ${input.contractId}::uuid AND tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
      if (rows.length === 0) {
        return { ok: false, status: 404, error: 'Contract not found', code: 'NOT_FOUND' };
      }
      contractId = rows[0].id;
    }

    const [row] = await sql<Project[]>`
      INSERT INTO projects (tenant_id, contract_id, name, created_by)
      VALUES (${actor.tenantId}::uuid, ${contractId}, ${name}, ${actor.userId}::uuid)
      RETURNING id, tenant_id, contract_id, name, status, baselined_at, created_by, created_at`;

    // The creator is assigned, so the roster is never empty and the person who opened the workspace
    // does not have to assign themselves to see it after a role change.
    await sql`
      INSERT INTO project_assignments (tenant_id, project_id, user_id, assigned_by)
      VALUES (${actor.tenantId}::uuid, ${row.id}::uuid, ${actor.userId}::uuid, ${actor.userId}::uuid)
      ON CONFLICT (project_id, user_id) DO NOTHING`;

    await emitEventSingle({
      namespace: 'project',
      type: 'project.created',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId: row.id, name, contractId, correlationId: randomUUID() },
    });

    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/projects] createProject failed:', err);
    return { ok: false, status: 500, error: 'Failed to create the project', code: 'DB_ERROR' };
  }
}

export async function getProject(actor: ProjectActor, projectId: string): Promise<Project | null> {
  if (!(await canAccessProject(actor, projectId))) return null;
  try {
    const rows = await sql<Project[]>`
      SELECT id, tenant_id, contract_id, name, status, baselined_at, created_by, created_at
        FROM projects
       WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    return rows[0] ?? null;
  } catch (err) {
    console.error('[projects/projects] getProject failed:', err);
    return null;
  }
}

export async function listSourceDocuments(tenantId: string, projectId: string): Promise<SourceDocument[]> {
  try {
    return await sql<SourceDocument[]>`
      SELECT id, kind, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at
        FROM project_source_documents
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY uploaded_at`;
  } catch (err) {
    console.error('[projects/projects] listSourceDocuments failed:', err);
    return [];
  }
}

export interface Readiness {
  hasExecutedContract: boolean;
  hasSubmittedProposal: boolean;
  canBaseline: boolean;
  missing: string[];
}

/**
 * Can this project's skeleton be frozen?
 *
 * The one place the two-artifact rule is enforced. A baseline is the promise you measure variance
 * against, and freezing one against documents that are not there makes every later number a claim
 * about nothing.
 */
export async function readiness(tenantId: string, projectId: string): Promise<Readiness> {
  const docs = await listSourceDocuments(tenantId, projectId);
  const hasExecutedContract = docs.some((d) => d.kind === 'executed_contract');
  const hasSubmittedProposal = docs.some((d) => d.kind === 'submitted_proposal');
  const missing: string[] = [];
  if (!hasExecutedContract) missing.push('the executed contract');
  if (!hasSubmittedProposal) missing.push('the as-submitted proposal');
  return {
    hasExecutedContract,
    hasSubmittedProposal,
    canBaseline: hasExecutedContract && hasSubmittedProposal,
    missing,
  };
}

/** Extensions accepted as a contract or proposal artifact. */
const ALLOWED_EXT = new Set(['pdf', 'docx', 'doc', 'txt', 'md']);

export async function addSourceDocument(
  actor: ProjectActor,
  projectId: string,
  input: { kind: SourceKind; filename: string; body: Buffer; contentType?: string | null },
): Promise<Ok<SourceDocument> | Fail> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can upload contract artifacts', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  if (input.kind !== 'executed_contract' && input.kind !== 'submitted_proposal') {
    return { ok: false, status: 400, error: 'kind must be executed_contract or submitted_proposal', code: 'VALIDATION_ERROR' };
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

  try {
    const [tenant] = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants WHERE id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!tenant) return { ok: false, status: 404, error: 'Tenant not found', code: 'NOT_FOUND' };

    // A stored key derived from the id, not from the user's filename: the original name is kept in
    // the row for display, and nothing user-supplied reaches the object key.
    const docId = randomUUID();
    const key = customerProjectPath(tenant.slug, projectId, `source/${docId}.${ext}`);
    await putObject({ key, body: input.body, contentType: input.contentType ?? undefined });

    const [row] = await sql<SourceDocument[]>`
      INSERT INTO project_source_documents
        (id, tenant_id, project_id, kind, storage_key, filename, content_type, byte_size, uploaded_by)
      VALUES
        (${docId}::uuid, ${actor.tenantId}::uuid, ${projectId}::uuid, ${input.kind}, ${key},
         ${filename}, ${input.contentType ?? null}, ${input.body.length}, ${actor.userId}::uuid)
      RETURNING id, kind, storage_key, filename, content_type, byte_size, uploaded_by, uploaded_at`;

    await emitEventSingle({
      namespace: 'project',
      type: 'source_document.uploaded',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: { projectId, documentId: row.id, kind: input.kind, filename },
    });

    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/projects] addSourceDocument failed:', err);
    return { ok: false, status: 500, error: 'Failed to store the document', code: 'STORAGE_ERROR' };
  }
}
