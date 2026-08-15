/**
 * Section-editing ToDo spine (SPINE-T1) — the missing per-section layer of the nervous system.
 *
 * The data model already carries a section owner (`proposal_sections.assigned_to`) and per-section
 * edit access for all three collaborator levels (view/comment/edit, `resolveUserAccess`), but nothing
 * ever created a section-scoped ToDo or routed one to the person actually editing a section. This wires
 * that: assign a section → the assignee (a tenant editor OR a proposal collaborator with edit on that
 * section) gets an `entity_type='section'` `edit_section` ToDo that deep-links straight to the section
 * editor (`taskHref` 'section' case), and the ToDo auto-completes when the section is locked.
 *
 * Advisory + RLS-faithful: every write runs inside the tenant context (`runInTenant`); the assignee is
 * validated against the CANONICAL membership/collaborator model, and against the section's editable set.
 */
import { sql } from '@/lib/db';
import { runInTenant } from '@/lib/tenant-context';
import { createTask } from '@/lib/tasks/tasks';
import { resolveUserAccess } from '@/lib/proposal-access';
import { emitEventSingle, userActor } from '@/lib/events';
import type { Role } from '@/lib/rbac';

const jsonParam = (v: unknown) => sql.json(v as Parameters<typeof sql.json>[0]);

export interface SectionAssignee {
  id: string;
  name: string | null;
  email: string;
  kind: 'member' | 'collaborator';
  role: string | null;
}

type Actor = { id: string; email: string | null; role: Role; tenantId: string };

/** Who can be assigned a section on this proposal: the tenant's own staff (editors) + this proposal's
 *  active collaborators (the external view/comment/edit levels). Deduped, staff first. */
export async function listSectionAssignees(tenantId: string, proposalId: string): Promise<SectionAssignee[]> {
  try {
    return await runInTenant(tenantId, async () => {
      const members = await sql<Array<{ id: string; name: string | null; email: string; role: string }>>`
        SELECT u.id, u.name, u.email, m.role
        FROM user_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = ${tenantId}::uuid AND m.status = 'active'
          AND m.source IN ('home', 'manual', 'partner_manager') AND u.is_active = true
        ORDER BY u.name NULLS LAST, u.email`;
      const collabs = await sql<Array<{ id: string; name: string | null; email: string; role: string | null }>>`
        SELECT u.id, u.name, u.email, pc.role
        FROM proposal_collaborators pc JOIN users u ON u.id = pc.user_id
        WHERE pc.proposal_id = ${proposalId}::uuid AND pc.revoked_at IS NULL AND u.is_active = true`;
      const seen = new Set(members.map((m) => m.id));
      const out: SectionAssignee[] = members.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, kind: 'member' as const }));
      for (const c of collabs) {
        if (!seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, name: c.name, email: c.email, role: c.role, kind: 'collaborator' as const }); }
      }
      return out;
    });
  } catch (e) {
    console.error('[listSectionAssignees] failed', e);
    return [];
  }
}

/**
 * Assign a section to a user (or clear with a null assignee). Sets `proposal_sections.assigned_to`, cancels
 * any prior open section ToDo, and (when assigning) raises a fresh `edit_section` ToDo deep-linked to the
 * section editor. The actor must be able to manage the proposal (admin) or be a delegated portal manager;
 * the assignee must have EDIT access to that specific section (so we never route work to someone the save
 * route will 403). Emits `proposal:section.assigned`.
 */
export async function assignSection(
  actor: Actor,
  tenantId: string,
  proposalId: string,
  sectionId: string,
  assigneeUserId: string | null,
  opts: { isManager?: boolean } = {},
): Promise<{ ok: true; assigned: boolean; taskId?: string } | { ok: false; error: string; code: string; status: number }> {
  return runInTenant(tenantId, async () => {
    const actorAccess = await resolveUserAccess(actor.id, proposalId, tenantId);
    if (!actorAccess.canManageTeam && !opts.isManager) {
      return { ok: false, error: 'Only an admin or a portal manager can assign sections', code: 'FORBIDDEN', status: 403 };
    }
    const [sec] = await sql<Array<{ id: string; title: string | null; volumeName: string | null }>>`
      SELECT id, title, volume_name AS "volumeName" FROM proposal_sections
      WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid LIMIT 1`;
    if (!sec) return { ok: false, error: 'Section not found', code: 'NOT_FOUND', status: 404 };

    // Re-assigning or clearing cancels the previous open section ToDo (no duplicate queue items).
    await sql`
      UPDATE tasks SET status = 'cancelled'
      WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'section' AND entity_id = ${sectionId}::uuid
        AND status IN ('open', 'in_progress')`;

    if (!assigneeUserId) {
      await sql`UPDATE proposal_sections SET assigned_to = NULL WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid`;
      await emitEventSingle({
        namespace: 'proposal', type: 'section.assigned', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
        payload: { proposalId, sectionId, assigneeUserId: null },
      });
      return { ok: true, assigned: false };
    }

    // The assignee must actually be able to EDIT this section (editor, or a collaborator granted edit here).
    const assigneeAccess = await resolveUserAccess(assigneeUserId, proposalId, tenantId);
    if (!assigneeAccess.editableSections.includes(sectionId)) {
      return { ok: false, error: 'That person does not have edit access to this section', code: 'VALIDATION_ERROR', status: 422 };
    }

    await sql`UPDATE proposal_sections SET assigned_to = ${assigneeUserId}::uuid WHERE id = ${sectionId}::uuid AND proposal_id = ${proposalId}::uuid`;

    const res = await createTask({
      actor, tenantId, assigneeUserId,
      taskType: 'edit_section',
      title: `Edit section: ${sec.title ?? 'Untitled'}${sec.volumeName ? ` (${sec.volumeName})` : ''}`,
      entityType: 'section', entityId: sectionId,
      // kind:'review' renders the deep-link ("Open →") + a "Done" completion in the queue; the section
      // editor is the real workspace. proposalId rides in params so taskHref can build the section URL.
      params: { kind: 'review', proposalId, sectionId, sectionTitle: sec.title ?? null, volumeName: sec.volumeName ?? null },
    });
    if (!res.ok) return { ok: false, error: res.error, code: res.code, status: res.status ?? 500 };

    await emitEventSingle({
      namespace: 'proposal', type: 'section.assigned', actor: userActor(actor.id, actor.email ?? undefined), tenantId,
      payload: { proposalId, sectionId, sectionTitle: sec.title ?? null, assigneeUserId, taskId: res.data?.taskId ?? null },
    });
    return { ok: true, assigned: true, taskId: res.data?.taskId };
  });
}

/**
 * Auto-complete a section's open ToDos because the work is done — the section was locked (or otherwise
 * completed). This is an AUTOMATION closing the ToDo (the lock IS the completion signal), not a human
 * ticking their own item, so it writes the ledger directly (RLS-scoped) rather than going through the
 * human-assignee completeTask path. Best-effort: never blocks the lock. Returns rows closed.
 */
export async function completeSectionTodos(
  tenantId: string,
  sectionId: string,
  actorId: string,
  disposition: 'locked' | 'completed' = 'locked',
): Promise<number> {
  try {
    return await runInTenant(tenantId, async () => {
      const rows = await sql<Array<{ id: string }>>`
        UPDATE tasks SET status = 'completed', completed_at = now(),
          result = ${jsonParam({ approved: true, auto: true, reason: disposition, by: actorId })}
        WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'section' AND entity_id = ${sectionId}::uuid
          AND status IN ('open', 'in_progress')
        RETURNING id`;
      return rows.length;
    });
  } catch (e) {
    console.error('[completeSectionTodos] failed (non-fatal)', e);
    return 0;
  }
}
