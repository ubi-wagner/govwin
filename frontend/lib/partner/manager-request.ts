/**
 * Manager-access handshake (docs/PARTNER_MANAGER_DESIGN.md §4 Branch B / §5).
 *
 * A partner requests manager access to an EXISTING company → a ToDo lands on that company's admin
 * → the admin approves (granting a partner_manager membership) or declines. The grant is the SAME
 * terminal membership a company writes when it adds a manager directly, so the company always
 * consents. Reads/writes on the bypass pool (cross-tenant tasks + memberships).
 */
import { sqlBypass } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';
import { createTask } from '@/lib/tasks/tasks';
import { sendEmail } from '@/lib/email';
import { managerRequestEmail } from '@/lib/email-templates';

export type MRError = { ok: false; status: number; error: string; code: string };

/**
 * Create a manager-access request: a ToDo to the target company's admin (or rfp_admin if the
 * company has no active admin). Guarded against already-a-member and a duplicate open request.
 */
export async function createManagerRequest(opts: {
  partner: { id: string; email: string | null; name?: string | null };
  tenantId: string;
}): Promise<{ ok: true; taskId: string; assignedTo: 'admin' | 'rfp_admin' } | MRError> {
  const { partner, tenantId } = opts;
  if (!tenantId) return { ok: false, status: 400, error: 'A company is required', code: 'VALIDATION_ERROR' };

  const [t] = await sqlBypass<{ id: string; name: string; kind: string; slug: string }[]>`
    SELECT id, name, kind, slug FROM tenants WHERE id = ${tenantId}::uuid AND archived_at IS NULL LIMIT 1`;
  if (!t) return { ok: false, status: 404, error: 'Company not found', code: 'NOT_FOUND' };
  if (t.kind !== 'standard') return { ok: false, status: 400, error: 'Cannot request manager access on this organization', code: 'VALIDATION_ERROR' };

  const [member] = await sqlBypass<{ id: string }[]>`
    SELECT id FROM user_memberships
    WHERE user_id = ${partner.id}::uuid AND tenant_id = ${tenantId}::uuid AND status = 'active' LIMIT 1`;
  if (member) return { ok: false, status: 409, error: 'You already have access to this company', code: 'ALREADY_MEMBER' };

  const [dup] = await sqlBypass<{ id: string }[]>`
    SELECT id FROM tasks
    WHERE task_type = 'manager_request' AND entity_id = ${tenantId}
      AND status IN ('open', 'in_progress') AND (params->>'partnerId') = ${partner.id} LIMIT 1`;
  if (dup) return { ok: false, status: 409, error: 'You already have a pending request for this company', code: 'DUPLICATE_REQUEST' };

  const [admin] = await sqlBypass<{ id: string; email: string | null; name: string | null }[]>`
    SELECT u.id, u.email, u.name FROM user_memberships m JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'active'
      AND m.role = 'tenant_admin' AND m.source = 'home'
    ORDER BY m.created_at ASC LIMIT 1`;

  const partnerOrg = partner.name ?? partner.email ?? 'A partner';
  const common = {
    actor: { id: partner.id, email: partner.email, role: 'partner_admin' as const, tenantId: null },
    taskType: 'manager_request', entityType: 'tenant', entityId: tenantId, nudgeDays: [2, 5],
    params: { partnerId: partner.id, partnerEmail: partner.email, partnerOrg, companyName: t.name },
  };
  const res = admin
    ? await createTask({ ...common, tenantId, assigneeUserId: admin.id,
        title: `Manager access request for ${t.name}`,
        description: `${partnerOrg} is requesting manager access to ${t.name}.` })
    : await createTask({ ...common, tenantId: null, assigneeRole: 'rfp_admin',
        title: `Manager access request for ${t.name} (no company admin)`,
        description: `${partnerOrg} requests manager access to ${t.name}, which has no active admin — platform mediation needed.` });
  if (!res.ok) return { ok: false, status: 500, error: res.error, code: res.code };

  try {
    await emitEventSingle({
      namespace: 'finder', type: 'partner.manager_requested',
      actor: userActor(partner.id, partner.email ?? undefined),
      tenantId, payload: { tenantId, partnerId: partner.id, taskId: res.data.taskId, assignedTo: admin ? 'admin' : 'rfp_admin' },
    });
  } catch (e) { console.error('[partner/manager-request] event emit failed:', e); }

  // Nudge the company admin by email too (not just the in-app ToDo). Best-effort.
  if (admin?.email) {
    try {
      const base = (process.env.NEXTAUTH_URL || process.env.AUTH_URL) || process.env.NEXT_PUBLIC_APP_URL || '';
      const reviewUrl = `${base}/api/enter?slug=${encodeURIComponent(t.slug)}&next=${encodeURIComponent(`/portal/${t.slug}/team`)}`;
      const content = managerRequestEmail({ adminName: admin.name, companyName: t.name, partnerOrg, reviewUrl });
      await sendEmail({ to: admin.email, subject: content.subject, html: content.html });
    } catch (e) { console.error('[partner/manager-request] admin email failed:', e); }
  }

  return { ok: true, taskId: res.data.taskId, assignedTo: admin ? 'admin' : 'rfp_admin' };
}

/**
 * Resolve a manager request (the company admin's decision). Approve grants the partner a
 * partner_manager membership (idempotent) + closes the task; decline just closes it. The task
 * is closed with a compare-and-swap so a double-click can't grant twice.
 */
export async function resolveManagerRequest(opts: {
  taskId: string;
  tenantId: string;
  approver: { id: string; email: string | null };
  decision: 'approve' | 'decline';
}): Promise<{ ok: true; partnerId: string | null; granted: boolean } | MRError> {
  const { taskId, tenantId, approver, decision } = opts;
  if (!taskId) return { ok: false, status: 400, error: 'A request is required', code: 'VALIDATION_ERROR' };

  const [task] = await sqlBypass<{ id: string; params: Record<string, unknown> | null; status: string; entityId: string | null }[]>`
    SELECT id, params, status, entity_id FROM tasks
    WHERE id = ${taskId}::uuid AND task_type = 'manager_request' LIMIT 1`;
  if (!task) return { ok: false, status: 404, error: 'Request not found', code: 'NOT_FOUND' };
  if (task.entityId !== tenantId) return { ok: false, status: 403, error: 'Request does not belong to this company', code: 'FORBIDDEN' };
  if (task.status !== 'open' && task.status !== 'in_progress') {
    return { ok: false, status: 409, error: 'Request already resolved', code: 'ALREADY_RESOLVED' };
  }
  const partnerId = task.params && typeof task.params.partnerId === 'string' ? (task.params.partnerId as string) : null;

  if (decision === 'approve') {
    if (!partnerId) return { ok: false, status: 400, error: 'Request is missing its partner', code: 'VALIDATION_ERROR' };
    const [p] = await sqlBypass<{ id: string }[]>`SELECT id FROM users WHERE id = ${partnerId}::uuid AND role = 'partner_admin' LIMIT 1`;
    if (!p) return { ok: false, status: 404, error: 'Requesting partner not found', code: 'NOT_FOUND' };
    let closed = false;
    await sqlBypass.begin(async (tx: any) => {
      const done = await tx`UPDATE tasks SET status = 'completed' WHERE id = ${taskId}::uuid AND status IN ('open','in_progress') RETURNING id`;
      if (done.length === 0) return; // lost the CAS race — someone else resolved it
      closed = true;
      await tx`
        INSERT INTO user_memberships (user_id, tenant_id, role, status, source, created_by)
        VALUES (${partnerId}::uuid, ${tenantId}::uuid, 'tenant_admin', 'active', 'partner_manager', ${approver.id}::uuid)
        ON CONFLICT (user_id, tenant_id) DO UPDATE
          SET status = 'active', role = 'tenant_admin', source = 'partner_manager'`;
    });
    if (!closed) return { ok: false, status: 409, error: 'Request already resolved', code: 'ALREADY_RESOLVED' };
  } else {
    const done = await sqlBypass`UPDATE tasks SET status = 'completed' WHERE id = ${taskId}::uuid AND status IN ('open','in_progress') RETURNING id`;
    if (done.length === 0) return { ok: false, status: 409, error: 'Request already resolved', code: 'ALREADY_RESOLVED' };
  }

  try {
    await emitEventSingle({
      namespace: 'finder',
      type: decision === 'approve' ? 'partner.manager_granted' : 'partner.manager_declined',
      actor: userActor(approver.id, approver.email ?? undefined),
      tenantId, payload: { tenantId, partnerId, taskId, decision },
    });
  } catch (e) { console.error('[partner/manager-request] resolve event failed:', e); }

  return { ok: true, partnerId, granted: decision === 'approve' };
}
