/**
 * The backing for an acceptance — filed by a tenant_admin, about the customer.
 *
 * ── IT REPLACES A COR PORTAL, AND THAT IS THE POINT ──────────────────────────────────────────
 * The alternative was a read-only login for the customer's contracting officer. That reopens a
 * boundary this product closed deliberately: `partner_user` is refused the project capability
 * outright, which is what removes cross-tenant from it entirely. A COR portal means an external
 * session, a new audience for every project surface, and a scoping question on each one.
 *
 * Filing the evidence costs none of that. The customer's act reaches the system as a file the
 * tenant_admin already has.
 *
 * ── EVIDENCING IS NOT ACCEPTING ──────────────────────────────────────────────────────────────
 * The fourth time this module draws the same line. Uploading is not accepting; authoring is not
 * accepting; approving is not accepting; and evidence of the customer's act is not the customer's
 * act. Nothing here writes `accepted_at`.
 *
 * The rule underneath it is the ingest-provenance one, applied to acceptance: **a value the product
 * did not read from the source must never look like one it did.** So `customer_name` is a name
 * TYPED INTO A FORM by our user, never a verified identity — the product has no record of that
 * person, and inventing a user row for a COR would manufacture an identity nothing checked. The
 * record reads "accepted by <the admin>, evidence: COR email 2026-04-02", which is what happened.
 */
import { randomUUID } from 'crypto';
import { sql, auditLog } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { putObject } from '@/lib/storage/s3-client';
import { customerProjectPath } from '@/lib/storage/paths';
import { canAccessProject, canAssign, type ProjectActor } from './access';
import type { Fail, Ok } from './project';

export const EVIDENCE_KINDS = ['dd250', 'cor_email', 'signed_receipt', 'transmittal', 'other'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** What each kind IS, in the words a person filing it would use. */
export const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  dd250: 'Signed DD-250 / material inspection & receiving report',
  cor_email: 'Email from the COR or CO',
  signed_receipt: 'Signed receipt or acknowledgement',
  transmittal: 'Transmittal record',
  other: 'Other evidence',
};

export function isEvidenceKind(v: unknown): v is EvidenceKind {
  return typeof v === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(v);
}

export interface AcceptanceEvidence {
  id: string;
  deliverableId: string;
  kind: EvidenceKind;
  customerName: string | null;
  customerRole: string | null;
  occurredOn: string | null;
  filename: string;
  storageKey: string;
  note: string | null;
  uploadedBy: string | null;
  uploadedAt: string | null;
  uploadedByEmail?: string | null;
}

// Same allowlist and ceiling as every other project upload. Deliberately restated rather than
// imported: these are separate policies that happen to agree, and coupling them would mean a
// change made for task references silently re-scoping what counts as contractual evidence.
const ALLOWED_EXT = new Set(['pdf', 'docx', 'doc', 'msg', 'eml', 'txt', 'png', 'jpg', 'jpeg', 'zip']);
const MAX_BYTES = 100 * 1024 * 1024;

export async function listAcceptanceEvidence(
  tenantId: string,
  projectId: string,
): Promise<AcceptanceEvidence[]> {
  try {
    return await sql<AcceptanceEvidence[]>`
      SELECT e.id, e.deliverable_id, e.kind, e.customer_name, e.customer_role, e.occurred_on,
             e.filename, e.storage_key, e.note, e.uploaded_by, e.uploaded_at,
             u.email AS uploaded_by_email
        FROM project_acceptance_evidence e
        LEFT JOIN users u ON u.id = e.uploaded_by
       WHERE e.project_id = ${projectId}::uuid AND e.tenant_id = ${tenantId}::uuid
       ORDER BY e.uploaded_at DESC`;
  } catch (err) {
    console.error('[projects/evidence] listAcceptanceEvidence failed:', err);
    return [];
  }
}

/**
 * File the customer's act.
 *
 * `tenant_admin`+ — this is the record a dispute turns on, and unlike attaching a working file it
 * is a claim about somebody outside the company. Anyone on the project may upload a deliverable;
 * saying the government signed for it is a narrower thing.
 */
export async function fileAcceptanceEvidence(
  actor: ProjectActor,
  projectId: string,
  deliverableId: string,
  input: {
    kind?: string; customerName?: string | null; customerRole?: string | null;
    occurredOn?: string | null; note?: string | null;
    filename: string; body: Buffer; contentType?: string | null;
  },
): Promise<Ok<AcceptanceEvidence> | Fail> {
  if (!canAssign(actor.role)) {
    return {
      ok: false, status: 403, code: 'FORBIDDEN',
      error: 'Only a tenant admin can file acceptance evidence.',
    };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };
  }
  if (!isEvidenceKind(input.kind)) {
    return {
      ok: false, status: 400, code: 'VALIDATION_ERROR',
      error: `kind must be one of: ${EVIDENCE_KINDS.join(', ')}`,
    };
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
  const occurredOn = input.occurredOn ?? null;
  if (occurredOn !== null && !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return { ok: false, status: 400, error: 'occurredOn must be YYYY-MM-DD', code: 'VALIDATION_ERROR' };
  }

  try {
    // FK-before-write, scoped through the milestone: a deliverable id from another project
    // satisfies the FK and would file one customer's signature under another's contract.
    const [deliverable] = await sql<{ id: string; title: string }[]>`
      SELECT d.id, d.title FROM project_deliverables d
        JOIN project_milestones m ON m.id = d.milestone_id
       WHERE d.id = ${deliverableId}::uuid AND m.project_id = ${projectId}::uuid
         AND d.tenant_id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!deliverable) return { ok: false, status: 404, error: 'Deliverable not found', code: 'NOT_FOUND' };

    const [tenant] = await sql<{ slug: string }[]>`
      SELECT slug FROM tenants WHERE id = ${actor.tenantId}::uuid LIMIT 1`;
    if (!tenant) return { ok: false, status: 404, error: 'Tenant not found', code: 'NOT_FOUND' };

    const key = customerProjectPath(tenant.slug, projectId, `evidence/${deliverableId}/${randomUUID()}.${ext}`);
    await putObject({ key, body: input.body, contentType: input.contentType ?? undefined });

    const [row] = await sql<AcceptanceEvidence[]>`
      INSERT INTO project_acceptance_evidence
        (tenant_id, project_id, deliverable_id, kind, customer_name, customer_role, occurred_on,
         filename, storage_key, content_type, byte_size, note, uploaded_by)
      VALUES
        (${actor.tenantId}::uuid, ${projectId}::uuid, ${deliverableId}::uuid, ${input.kind},
         ${(input.customerName ?? '').trim() || null}, ${(input.customerRole ?? '').trim() || null},
         ${occurredOn}::date, ${filename}, ${key}, ${input.contentType ?? null},
         ${input.body.length}, ${(input.note ?? '').trim() || null}, ${actor.userId}::uuid)
      RETURNING id, deliverable_id, kind, customer_name, customer_role, occurred_on, filename,
                storage_key, note, uploaded_by, uploaded_at`;
    if (!row) return { ok: false, status: 500, error: 'Failed to file the evidence', code: 'DB_ERROR' };

    // NOTE the payload: `filedBy` is a user id, `customerName` is a string somebody typed. They are
    // never merged into one "acceptedBy", because a reader of this event must be able to tell the
    // verified actor from the reported one.
    await emitEventSingle({
      namespace: 'project',
      type: 'acceptance_evidence.filed',
      actor: userActor(actor.userId),
      tenantId: actor.tenantId,
      payload: {
        projectId, deliverableId, evidenceId: row.id, kind: input.kind,
        title: deliverable.title, filedBy: actor.userId,
        customerName: row.customerName, occurredOn,
      },
    });
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.acceptance_evidence_filed',
      entityType: 'project_deliverable', entityId: deliverableId,
      metadata: { projectId, evidenceId: row.id, kind: input.kind, customerName: row.customerName },
    });
    return { ok: true, data: row };
  } catch (err) {
    console.error('[projects/evidence] fileAcceptanceEvidence failed:', err);
    return { ok: false, status: 500, error: 'Failed to file the evidence', code: 'STORAGE_ERROR' };
  }
}
