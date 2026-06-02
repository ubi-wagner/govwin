/**
 * Launch a process TEMPLATE by name with an OVERLAY — the explicit, GUI-facing
 * entry point for starting a workflow on demand (vs. reactive event triggers).
 *
 * The template definition is code (a pipeline Workflow subclass discovered at
 * boot); the process_templates row is its activation switch + the trigger_key the
 * launcher needs. Launching = emit that trigger event with the overlay as payload.
 * The pipeline processor then matches it, RE-CHECKS the catalog gate, creates the
 * process_instance with this overlay FROZEN as its payload, and runs it. So this
 * reuses the entire existing engine path — no parallel launch machinery.
 *
 * SHARED core (mirrors the force-advance.ts pattern):
 *   - admin route (rfp_admin) at POST /api/admin/workflows (now)
 *   - a tenant_admin portal launch (later) calls this same function with the
 *     operator's tenant; own-tenant scoping would gate which templates a customer
 *     may launch, exactly as canForceAdvanceInstance scopes advancing.
 *
 * The instance is created ASYNCHRONOUSLY by the pipeline on its next poll (~10s),
 * so this returns the trigger event id for correlation, not an instance id.
 */
import { sql } from '@/lib/db';
import { type Role } from '@/lib/rbac';

export interface LaunchActor {
  id: string;
  email: string | null;
  role: Role;
  /** The operator's tenant (null for system admins). Reserved for tenant scoping. */
  tenantId: string | null;
}

export type LaunchResult =
  | { ok: true; data: { eventId: string; workflowName: string; trigger: string } }
  | { ok: false; status: number; error: string; code: string };

export async function launchTemplate(opts: {
  workflowName: string;
  overlay: Record<string, unknown>;
  actor: LaunchActor;
  /** Tenant the launched process belongs to (null = platform/admin process). */
  tenantId?: string | null;
}): Promise<LaunchResult> {
  const { workflowName, overlay, actor } = opts;
  const tenantId = opts.tenantId ?? null;

  // ── Resolve the template from the catalog (active + trigger_key) ────
  let rows: { active: boolean; triggerKey: string | null; source: string }[];
  try {
    rows = await sql<{ active: boolean; triggerKey: string | null; source: string }[]>`
      SELECT active, trigger_key, source
      FROM process_templates
      WHERE workflow_name = ${workflowName}
    `;
  } catch (err) {
    console.error('[launchTemplate] catalog lookup failed:', err);
    return { ok: false, status: 500, error: 'Template lookup failed', code: 'DB_ERROR' };
  }

  if (rows.length === 0) {
    return {
      ok: false,
      status: 404,
      error: `Unknown template '${workflowName}'`,
      code: 'TEMPLATE_NOT_FOUND',
    };
  }
  const tpl = rows[0];

  if (!tpl.active) {
    return {
      ok: false,
      status: 409,
      error: `Template '${workflowName}' is inactive`,
      code: 'TEMPLATE_INACTIVE',
    };
  }
  if (!tpl.triggerKey) {
    return {
      ok: false,
      status: 409,
      error: `Template '${workflowName}' has no registered trigger`,
      code: 'TEMPLATE_NO_TRIGGER',
    };
  }

  // ── Parse "namespace:type:phase" ───────────────────────────────────
  // A launch is a single fire and the emitter writes phase='single', so only
  // single-phase templates are launchable this way. (A paired start/end template
  // is reactive-only — it's driven by an operation, not an overlay launch.)
  const parts = tpl.triggerKey.split(':');
  if (parts.length !== 3) {
    return { ok: false, status: 500, error: 'Malformed trigger key', code: 'BAD_TRIGGER' };
  }
  const [namespace, type, phase] = parts;
  if (phase !== 'single') {
    return {
      ok: false,
      status: 409,
      error: `Template '${workflowName}' triggers on phase '${phase}', not 'single' — not launchable by overlay`,
      code: 'NOT_LAUNCHABLE',
    };
  }

  // ── Emit the trigger event with the overlay as payload ─────────────
  // The launch IS this event (not instrumentation), so a failed insert fails the
  // launch — we do not swallow it the way emitEventSingle does. actor_type='user'
  // + actor_id record who launched it; the payload becomes the frozen instance
  // overlay when the pipeline picks it up.
  let eventId: string;
  try {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO system_events (
        namespace, type, phase, actor_type, actor_id, actor_email, tenant_id, payload
      ) VALUES (
        ${namespace}, ${type}, 'single', 'user', ${actor.id}, ${actor.email ?? null},
        ${tenantId}, ${JSON.stringify(overlay ?? {})}::jsonb
      )
      RETURNING id
    `;
    eventId = row.id;
  } catch (err) {
    console.error('[launchTemplate] trigger emit failed:', err);
    return { ok: false, status: 500, error: 'Failed to emit launch event', code: 'EMIT_FAILED' };
  }

  return { ok: true, data: { eventId, workflowName, trigger: tpl.triggerKey } };
}
