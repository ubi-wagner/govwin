/**
 * POST /api/admin/workflows/launch-collaboration — start a ProjectCollaboration
 * HITL gate BY HAND (M3). The generic POST /api/admin/workflows can launch any
 * template by raw overlay, but it bypasses the launchProjectCollaboration guards
 * (required fields + UUID shape) — a malformed overlay then parks a corrupt task
 * (mis-typed, unassigned, or pointing at nothing). This route is the operator
 * surface for a manual review gate: it routes through the GUARDED helper so a
 * hand-launched gate is always well-formed, exactly like the code bridges.
 *
 * Body: { scope, opportunityId, entityType, entityRef, taskType, taskTitle,
 *         assigneeRole, assigneeUser?, proposalId?, stage?, dueMinutes?,
 *         tenantId?, completeTemplate? }
 * Auth: master_admin or rfp_admin.
 *
 * Returns: { data: { eventId, workflowName, trigger } } | { error, code }.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import {
  launchProjectCollaboration,
  type SpineScope,
} from '@/lib/process/project-collaboration';

const SCOPES: readonly SpineScope[] = ['opp', 'spotlight', 'project', 'contract'];
// Roles an operator may target with a manual gate. Admin review gates assign to
// rfp_admin/master_admin; a tenant-scoped gate may target the tenant's roles.
const ASSIGNABLE_ROLES = new Set([
  'master_admin',
  'rfp_admin',
  'tenant_admin',
  'tenant_user',
  'partner_user',
]);

export async function POST(request: Request) {
  try {
    // ── auth: rfp_admin+ ──
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }
    const u = session.user as { id?: string; email?: string | null; role?: unknown; tenantId?: string | null };
    const role: Role | null = isRole(u.role) ? u.role : null;
    if (!role || !hasRoleAtLeast(role, 'rfp_admin')) {
      return NextResponse.json({ error: 'Admin access required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!u.id) {
      return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    }

    // ── body ──
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

    const scope = str(body.scope);
    if (!scope || !(SCOPES as readonly string[]).includes(scope)) {
      return NextResponse.json(
        { error: `scope must be one of: ${SCOPES.join(', ')}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const assigneeRole = str(body.assigneeRole);
    if (!assigneeRole || !ASSIGNABLE_ROLES.has(assigneeRole)) {
      return NextResponse.json(
        { error: 'assigneeRole is required and must be a valid role', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }
    const dueMinutes = typeof body.dueMinutes === 'number' && Number.isFinite(body.dueMinutes) && body.dueMinutes > 0
      ? Math.floor(body.dueMinutes)
      : undefined;
    // A tenant-scoped gate carries the tenant; an admin/platform gate is null.
    const tenantId = str(body.tenantId);

    // launchProjectCollaboration enforces the remaining invariants (required
    // fields present + UUID shape on entityRef/opportunityId/assigneeUser) and
    // returns 400 INCOMPLETE_OVERLAY / INVALID_OVERLAY on a bad gate.
    const result = await launchProjectCollaboration({
      actor: { id: u.id, email: u.email ?? null, role, tenantId: u.tenantId ?? null },
      actorType: 'user',
      tenantId,
      scope: scope as SpineScope,
      opportunityId: str(body.opportunityId) ?? '',
      proposalId: str(body.proposalId),
      stage: str(body.stage),
      taskType: str(body.taskType) ?? '',
      taskTitle: str(body.taskTitle) ?? '',
      assigneeRole,
      assigneeUser: str(body.assigneeUser),
      entityType: str(body.entityType) ?? '',
      entityRef: str(body.entityRef) ?? '',
      dueMinutes,
      completeTemplate: str(body.completeTemplate),
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }
    return NextResponse.json({ data: result.data });
  } catch (err) {
    console.error('[admin/workflows/launch-collaboration POST] error:', err);
    return NextResponse.json({ error: 'Launch failed', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
