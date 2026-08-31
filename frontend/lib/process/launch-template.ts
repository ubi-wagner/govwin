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
import { emitEventSingleStrict } from '@/lib/events';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface LaunchActor {
  id: string;
  email: string | null;
  /** The operator's role (reserved for tenant scoping). Omitted for a system bridge. */
  role?: Role;
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
  /**
   * Who the launch is attributed to. Default 'user' (a GUI/operator launch).
   * A system bridge (e.g. the Stripe webhook) launches with 'system' — actor.id
   * is then a label, e.g. 'stripe-webhook' (actor_id is TEXT, not a user FK).
   */
  actorType?: 'user' | 'system';
  /** Tenant the launched process belongs to (null = platform/admin process). */
  tenantId?: string | null;
}): Promise<LaunchResult> {
  const { workflowName, overlay, actor } = opts;
  const actorType = opts.actorType ?? 'user';
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

  /**
   * ── The overlay must name entities that belong to the tenant it is scoped to ──
   *
   * `launchProjectCollaboration` already refuses an INCOMPLETE overlay and a NON-UUID one, with the
   * reasoning that "a presence-only check would let an operator-influenceable value pass, then
   * SILENTLY null the entity". Nothing refused an INCONSISTENT one — real ids that exist, pass every
   * format and existence check, and belong to a different tenant.
   *
   * That is the harder case, not the easier one: a fabricated uuid fails the first lookup, while a
   * real id from the wrong tenant scopes an instance to A and points its agents at B's work. Found
   * exactly that way — a drive paired `tenantId` from one tenant with `proposalId` from another and
   * put 18 rows into `agent_task_log` that crossed the boundary, which the copy-inward invariant
   * checker then reported after the fact.
   *
   * Only checked when a tenant is named. A platform launch (`tenantId = null`) is scoped to no
   * tenant by design and has nothing to be inconsistent with.
   */
  if (tenantId) {
    const OVERLAY_ENTITIES: Array<[string, string]> = [
      ['proposalId', 'proposals'],
      ['sectionId', 'proposal_sections'],
    ];
    for (const [key, table] of OVERLAY_ENTITIES) {
      const id = overlay?.[key];
      if (typeof id !== 'string' || !UUID_RE.test(id)) continue;
      try {
        const [row] = table === 'proposals'
          ? await sql<{ tenantId: string | null }[]>`
              SELECT tenant_id FROM proposals WHERE id = ${id}::uuid LIMIT 1`
          : await sql<{ tenantId: string | null }[]>`
              SELECT p.tenant_id FROM proposal_sections s
              JOIN proposals p ON p.id = s.proposal_id WHERE s.id = ${id}::uuid LIMIT 1`;
        if (row && row.tenantId && row.tenantId !== tenantId) {
          return {
            ok: false,
            status: 400,
            error: `overlay.${key} belongs to a different tenant than the launch is scoped to`,
            code: 'OVERLAY_TENANT_MISMATCH',
          };
        }
      } catch (err) {
        // A lookup failure must not become a silent pass — refuse rather than launch unchecked.
        console.error('[launchTemplate] overlay tenant check failed:', err);
        return { ok: false, status: 500, error: 'Could not verify overlay scope', code: 'DB_ERROR' };
      }
    }
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
  // The launch IS this event (not instrumentation), so a failed insert fails the launch — which
  // is why this uses the STRICT emit rather than the fire-and-forget one. actor_type='user' +
  // actor_id record who launched it; the payload becomes the frozen instance overlay when the
  // pipeline picks it up.
  //
  // It used to be a hand-written `INSERT INTO system_events` here, for exactly that reason. The
  // throw was the justification and the divergence was elsewhere: the copy also skipped
  // `evaluateAutomationRules`, so a manually launched workflow's trigger event was invisible to
  // the tenant automation-rule layer while the identical event from any other source was not.
  // Through the seam, an event means the same thing wherever it came from.
  let eventId: string;
  try {
    eventId = await emitEventSingleStrict({
      namespace,
      type,
      actor: { type: actorType, id: actor.id, email: actor.email ?? undefined },
      tenantId,
      payload: (overlay ?? {}) as Record<string, unknown>,
    });
  } catch (err) {
    console.error('[launchTemplate] trigger emit failed:', err);
    return { ok: false, status: 500, error: 'Failed to emit launch event', code: 'EMIT_FAILED' };
  }

  return { ok: true, data: { eventId, workflowName, trigger: tpl.triggerKey } };
}
