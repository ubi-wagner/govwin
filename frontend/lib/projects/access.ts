/**
 * Who may see a project — the layer RLS cannot express.
 *
 * ── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────────────────────────
 * Row-level security scopes by TENANT, because the per-request context carries exactly one value:
 * `app.tenant_id`. Projects need a second, narrower scope — *which employees of that tenant*
 * — and a policy cannot consult the requesting user without putting the user id into the request
 * context too, which would change the RLS model for every table in the database to serve one
 * feature.
 *
 * So assignment is app-enforced, and CLAUDE.md is blunt about what that means:
 *
 *   "Treat that belt as load-bearing — a new platform-row reader that omits it leaks, and RLS
 *    will not catch it."
 *
 * That is the whole reason this is ONE module with ONE predicate rather than a `WHERE` clause
 * copied into each query, and the reason it has a boundary test of its own
 * (`__tests__/projects-assignment-boundary.test.ts`) rather than relying on migration 216's policy.
 *
 * ── THE THREE WAYS IN ────────────────────────────────────────────────────────────────────────
 *   1. `tenant_admin` and above — implicit access to every project at their tenant. They can see
 *      the whole company's contracts by definition; requiring them to assign themselves would be
 *      ceremony.
 *   2. A `tenant_user` with a `project_assignments` row for that project. Assignment is the whole
 *      access mechanism for an employee.
 *   3. A descended admin (`rfp_admin` / `master_admin`), already carried by `verifyTenantAccess`
 *      and already audited as `shadow.descended`.
 *
 * ── AND THE ONE DELIBERATE EXCLUSION ─────────────────────────────────────────────────────────
 * **`partner_user` is refused outright, even with a valid membership.** `verifyTenantAccess` admits
 * a cross-company collaborator on a `source='collaborator'` membership — correct for the proposal
 * spine, where collaboration is the point. Projects v1 has no collaborator surface at all, and that
 * decision is what removes cross-tenant from this capability entirely. Relying on "nobody will
 * assign one" would make the exclusion a convention; refusing the role makes it a rule.
 */
import { sql, auditLog } from '@/lib/db';
import { hasRoleAtLeast, isRole, type Role } from '@/lib/rbac';

export interface ProjectActor {
  userId: string;
  role: string;
  tenantId: string;
}

/** What the actor can reach, before any project is named. */
export type ProjectScope =
  | { kind: 'none' }                      // no project access at this tenant, for any project
  | { kind: 'all' }                       // tenant_admin+ or a descended admin
  | { kind: 'assigned'; userId: string }; // a tenant_user: exactly their assigned projects

/**
 * Resolve the actor's scope. Does NOT check tenant membership — the caller runs
 * `verifyTenantAccess` first, exactly as every other portal route does. This answers the second
 * question: given that they belong here, how much of Projects do they see?
 */
export function projectScope(actor: { role: string; userId: string }): ProjectScope {
  if (!isRole(actor.role)) return { kind: 'none' };

  // partner_user: refused before anything else, membership or not. See the module header.
  if (actor.role === 'partner_user') return { kind: 'none' };

  // partner_admin ranks BELOW tenant_admin (50 vs 60) and reaches a tenant only through a
  // membership it holds. When it descends it pins to tenant_admin and arrives here as one, so the
  // bare partner_admin role has no project reach of its own — which is the fail-closed reading.
  if (hasRoleAtLeast(actor.role as Role, 'tenant_admin')) return { kind: 'all' };

  if (actor.role === 'tenant_user') return { kind: 'assigned', userId: actor.userId };

  return { kind: 'none' };
}

/**
 * May this actor reach this specific project?
 *
 * The tenant predicate is stated EXPLICITLY as well as being enforced by RLS. Two layers, and the
 * house calls it defense-in-depth: RLS is the guarantee, and the `WHERE tenant_id` is what makes
 * the query still correct if it is ever run on a connection whose context was not set.
 */
export async function canAccessProject(
  actor: ProjectActor,
  projectId: string,
): Promise<boolean> {
  const scope = projectScope(actor);
  if (scope.kind === 'none') return false;

  try {
    if (scope.kind === 'all') {
      const rows = await sql<{ id: string }[]>`
        SELECT id FROM projects
         WHERE id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         LIMIT 1`;
      return rows.length > 0;
    }

    const rows = await sql<{ id: string }[]>`
      SELECT p.id
        FROM projects p
        JOIN project_assignments a
          ON a.project_id = p.id AND a.user_id = ${scope.userId}::uuid
       WHERE p.id = ${projectId}::uuid AND p.tenant_id = ${actor.tenantId}::uuid
       LIMIT 1`;
    return rows.length > 0;
  } catch (err) {
    // Fail CLOSED. An access check that cannot reach the database has not established access, and
    // treating an outage as permission is how a read of somebody else's contract gets through.
    console.error('[projects/access] canAccessProject failed:', err);
    return false;
  }
}

export interface ProjectRow {
  id: string;
  name: string;
  status: string;
  contractId: string | null;
  baselinedAt: string | null;
  createdAt: string;
}

/**
 * Every project this actor may see, in one query with the scope applied.
 *
 * A single function rather than a `listAll` plus a filter at each call site: the filter is the
 * security boundary, and a boundary applied by convention at N call sites is applied at N−1 of
 * them the first time someone is in a hurry.
 *
 * ⚠️ Row fields are declared camelCase to match the runtime. `lib/db.ts` applies
 * `transform: { column: { from: postgres.toCamel } }`, so a snake_case declaration COMPILES — tsc
 * trusts the assertion — and reads `undefined` at run time. That has shipped twice in this repo.
 */
export async function listProjectsForActor(actor: ProjectActor): Promise<ProjectRow[]> {
  const scope = projectScope(actor);
  if (scope.kind === 'none') return [];

  try {
    if (scope.kind === 'all') {
      return await sql<ProjectRow[]>`
        SELECT id, name, status, contract_id, baselined_at, created_at
          FROM projects
         WHERE tenant_id = ${actor.tenantId}::uuid
         ORDER BY created_at DESC`;
    }

    return await sql<ProjectRow[]>`
      SELECT p.id, p.name, p.status, p.contract_id, p.baselined_at, p.created_at
        FROM projects p
        JOIN project_assignments a
          ON a.project_id = p.id AND a.user_id = ${scope.userId}::uuid
       WHERE p.tenant_id = ${actor.tenantId}::uuid
       ORDER BY p.created_at DESC`;
  } catch (err) {
    console.error('[projects/access] listProjectsForActor failed:', err);
    return [];
  }
}

/**
 * Who is assigned to a project. Reading the roster is available to anyone who can reach the
 * project — an assignee needs to know who else is on it — but CHANGING it is `tenant_admin`+
 * (`canAssign` below).
 */
export async function listAssignees(tenantId: string, projectId: string): Promise<Array<{
  userId: string; email: string | null; name: string | null; assignedAt: string;
}>> {
  try {
    return await sql<Array<{ userId: string; email: string | null; name: string | null; assignedAt: string }>>`
      SELECT a.user_id, u.email, u.name, a.created_at AS assigned_at
        FROM project_assignments a
        JOIN users u ON u.id = a.user_id
       WHERE a.project_id = ${projectId}::uuid AND a.tenant_id = ${tenantId}::uuid
       ORDER BY u.email`;
  } catch (err) {
    console.error('[projects/access] listAssignees failed:', err);
    return [];
  }
}

/** Only a tenant_admin (or a descended admin) may change who is on a project. */
export function canAssign(role: string): boolean {
  return isRole(role) && role !== 'partner_user' && hasRoleAtLeast(role as Role, 'tenant_admin');
}

/**
 * ── STAFFING A PROJECT — the half of the access model that had no way in ─────────────────────
 * `deliveryScope`/`canAccessProject` above say assignment is the whole access mechanism for an
 * employee, and until now the ONLY `project_assignments` row anyone got was the one
 * `createProject` writes for its creator. There was no route, no button, and no other insert: an
 * employee could never be let into a project, and the empty state on `/projects` told them to *"ask
 * a tenant admin to add you"* — describing a capability that did not exist.
 *
 * It survived every lens because it is a MISSING route, not an unsurfaced one: `reconcile-
 * capability` joins routes to callers, and a route that was never written has no row on either
 * side. It surfaced the first time a drive tried to act as the employee rather than as the manager.
 */
export interface AssignmentResult { userId: string; email: string | null }

export async function assignMember(
  actor: ProjectActor,
  projectId: string,
  userId: string,
): Promise<{ ok: true; data: AssignmentResult } | { ok: false; status: number; error: string; code: string }> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can staff a project', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  try {
    // The member must belong to THIS tenant. The FK to `users` is global, so without this a user id
    // from another company would satisfy it and be granted access to this project's contract.
    const [member] = await sql<{ id: string; email: string | null }[]>`
      SELECT u.id, u.email FROM users u
        JOIN user_memberships m ON m.user_id = u.id AND m.tenant_id = ${actor.tenantId}::uuid
       WHERE u.id = ${userId}::uuid AND m.status = 'active' AND u.is_active = true LIMIT 1`;
    if (!member) {
      return { ok: false, status: 400, error: 'That person is not an active member of this company', code: 'VALIDATION_ERROR' };
    }
    // A `partner_user` is refused the capability outright (see the module header); staffing one
    // onto a project would be the back door around that.
    const [role] = await sql<{ role: string }[]>`SELECT role FROM users WHERE id = ${userId}::uuid`;
    if (role?.role === 'partner_user') {
      return {
        ok: false, status: 403, code: 'FORBIDDEN',
        error: 'Projects have no collaborator surface — a partner user cannot be staffed onto one.',
      };
    }

    await sql`
      INSERT INTO project_assignments (tenant_id, project_id, user_id, assigned_by)
      VALUES (${actor.tenantId}::uuid, ${projectId}::uuid, ${userId}::uuid, ${actor.userId}::uuid)
      ON CONFLICT (project_id, user_id) DO NOTHING`;

    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.member_assigned',
      entityType: 'project', entityId: projectId, metadata: { assigned: userId, email: member.email },
    });
    return { ok: true, data: { userId, email: member.email } };
  } catch (err) {
    console.error('[projects/access] assignMember failed:', err);
    return { ok: false, status: 500, error: 'Failed to staff the project', code: 'DB_ERROR' };
  }
}

/**
 * Take someone off a project.
 *
 * **The last person cannot be removed.** An unstaffed project is one nobody can open — not even to
 * re-staff it, because reaching the roster requires reaching the project. The refusal is the cheap
 * way to make that unreachable state unreachable.
 */
export async function unassignMember(
  actor: ProjectActor,
  projectId: string,
  userId: string,
): Promise<{ ok: true; data: { removed: string } } | { ok: false; status: number; error: string; code: string }> {
  if (!canAssign(actor.role)) {
    return { ok: false, status: 403, error: 'Only a tenant admin can change who is on a project', code: 'FORBIDDEN' };
  }
  if (!(await canAccessProject(actor, projectId))) {
    return { ok: false, status: 404, error: 'Project not found', code: 'NOT_FOUND' };
  }
  try {
    const [{ n }] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM project_assignments
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid`;
    if (n <= 1) {
      return {
        ok: false, status: 409, code: 'LAST_ASSIGNEE',
        error: 'That is the only person on this project. Add someone else before removing them — '
          + 'an unstaffed project is one nobody can open, including to re-staff it.',
      };
    }
    const rows = await sql<{ userId: string }[]>`
      DELETE FROM project_assignments
       WHERE project_id = ${projectId}::uuid AND tenant_id = ${actor.tenantId}::uuid
         AND user_id = ${userId}::uuid
      RETURNING user_id`;
    if (!rows.length) {
      return { ok: false, status: 404, error: 'That person is not on this project', code: 'NOT_FOUND' };
    }
    await auditLog({
      tenantId: actor.tenantId, userId: actor.userId, action: 'project.member_unassigned',
      entityType: 'project', entityId: projectId, metadata: { removed: userId },
    });
    return { ok: true, data: { removed: userId } };
  } catch (err) {
    console.error('[projects/access] unassignMember failed:', err);
    return { ok: false, status: 500, error: 'Failed to change the roster', code: 'DB_ERROR' };
  }
}
