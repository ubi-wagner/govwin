/**
 * Partner cross-stable to-do feed (#16).
 *
 * The partner console already shows a per-company open-ToDo COUNT (the rollup's `openTodos`), so a
 * manager sees WHICH companies need attention — but not WHAT the to-dos are without descending into
 * each one. This aggregates the actual open to-do ITEMS across the manager's stable into one feed,
 * each carrying the company + an in-portal deep-link (the console wraps it in the descend URL, since
 * completion still happens inside the company — the notify-up / descend-to-complete bridge).
 *
 * Cross-tenant read scoped to the manager's OWN stable (the tenant ids the caller already resolved
 * via partnerScopeTenants) → sqlBypass, mirroring lib/partner/rollup. camelCase off toCamel.
 */
import { sqlBypass } from '@/lib/db';
import { taskHref } from '@/lib/tasks/completers';

export interface PartnerStableTodo {
  id: string;
  title: string;
  taskType: string;
  companySlug: string;
  companyName: string;
  dueAt: string | null;
  /** The in-portal target (section editor / proposal / etc.); the console prefixes the descend URL. */
  inPortalHref: string;
}

/**
 * Open to-dos across the given stable tenant ids (soonest-due first). Bounded; best-effort — a query
 * failure returns an empty feed rather than breaking the console. Returns [] for an empty stable.
 */
export async function getPartnerStableTodos(tenantIds: string[]): Promise<PartnerStableTodo[]> {
  const ids = tenantIds.filter(Boolean);
  if (ids.length === 0) return [];
  try {
    const rows = await sqlBypass<Array<{
      id: string; title: string | null; taskType: string; companySlug: string; companyName: string;
      entityType: string | null; entityId: string | null; dueAt: string | null; params: Record<string, unknown> | null;
    }>>`
      SELECT tk.id, tk.title, tk.task_type AS "taskType",
             ten.slug AS "companySlug", ten.name AS "companyName",
             tk.entity_type AS "entityType", tk.entity_id AS "entityId", tk.due_at AS "dueAt", tk.params
      FROM tasks tk
      JOIN tenants ten ON ten.id = tk.tenant_id
      WHERE tk.tenant_id = ANY(${ids}::uuid[])
        AND (tk.assignee_role IN ('tenant_admin','tenant_user','partner_user') OR tk.assignee_user_id IS NOT NULL)
        AND tk.status IN ('open','in_progress')
        AND ten.archived_at IS NULL
      ORDER BY tk.due_at ASC NULLS LAST, tk.created_at ASC
      LIMIT 100
    `;
    return rows.map((r) => ({
      id: r.id,
      title: r.title || 'Untitled to-do',
      taskType: r.taskType,
      companySlug: r.companySlug,
      companyName: r.companyName,
      dueAt: r.dueAt,
      inPortalHref:
        taskHref({ tenantSlug: r.companySlug, entityType: r.entityType, entityId: r.entityId, params: r.params })
        ?? `/portal/${r.companySlug}/todos`,
    }));
  } catch (e) {
    console.error('[getPartnerStableTodos] failed', e);
    return [];
  }
}
