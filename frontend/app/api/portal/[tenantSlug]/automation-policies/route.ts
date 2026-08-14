/**
 * GET   /api/portal/[tenantSlug]/automation-policies — the tenant's automation grammar.
 * PATCH /api/portal/[tenantSlug]/automation-policies — upsert one policy row.
 *
 * The tenant (#190) surface: recipients × trigger × timing × escalation per
 * (scope, trigger_key), over the fixed TRIGGER_CATALOG. Framework-hard gates (the
 * curation SLA) are NOT tunable here (decision ⑦). tenant_admin+ with tenant access;
 * reads/writes run through withTenant() so they are correct under the NOBYPASSRLS cutover.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { emitEventSingle, userActor } from '@/lib/events';
import {
  TRIGGER_CATALOG, isCatalogTrigger, VALID_CHANNELS,
  VALID_RECIPIENT_ROLES, VALID_RECIPIENT_FLAGS,
} from '@/lib/automation/catalog';

interface RouteContext { params: Promise<{ tenantSlug: string }> }

interface PolicyRow {
  scope: string;
  triggerKey: string;
  enabled: boolean;
  recipientRoles: string[];
  recipientUsers: string[];
  recipientFlags: string[];
  dueInMinutes: number | null;
  nudgeDays: number[];
  channel: string;
  cooldownMinutes: number;
  maxFiresPerHour: number;
  configuredAt: string | null;
}

async function resolveCtx(ctx: RouteContext): Promise<
  | { ok: true; tenantId: string; userId: string; email?: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const { tenantSlug } = await ctx.params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  }
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, tenantId, userId: u.id, email: u.email };
}

export async function GET(_request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;
  try {
    // Explicit tenant predicate (the BELT) + withTenant RLS (the suspenders — the app runs
    // as govtech_app, so RLS scopes the read). The explicit WHERE is the belt /
    // defense-in-depth — keep it: without it a bypass-context read would span tenants
    // (adversarial-sweep HIGH-1).
    const rows: PolicyRow[] = await withTenant(r.tenantId, async (tx) => tx<PolicyRow[]>`
      SELECT scope, trigger_key AS "triggerKey", enabled,
             recipient_roles AS "recipientRoles", recipient_users AS "recipientUsers",
             recipient_flags AS "recipientFlags", due_in_minutes AS "dueInMinutes",
             nudge_days AS "nudgeDays", channel, cooldown_minutes AS "cooldownMinutes",
             max_fires_per_hour AS "maxFiresPerHour", configured_at AS "configuredAt"
      FROM tenant_automation_policies
      WHERE tenant_id = ${r.tenantId}::uuid
    `);
    const byKey = new Map(rows.map((p) => [`${p.scope}:${p.triggerKey}`, p]));
    // Merge the catalog with the tenant's configured rows so the editor renders every
    // governable trigger (configured or not).
    const policies = TRIGGER_CATALOG.map((t) => ({
      ...t,
      configured: byKey.has(`${t.scope}:${t.triggerKey}`),
      row: byKey.get(`${t.scope}:${t.triggerKey}`) ?? null,
    }));
    return NextResponse.json({ data: { policies } });
  } catch (e) {
    console.error('[automation-policies] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load automation policies', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }

  const scope = String(body.scope ?? '');
  const triggerKey = String(body.triggerKey ?? '');
  if (!isCatalogTrigger(scope, triggerKey)) {
    return NextResponse.json({ error: 'Unknown or non-tunable trigger', code: 'VALIDATION_ERROR' }, { status: 422 });
  }

  // Validate the tunable fields (all optional; only what's provided is written).
  const enabled = typeof body.enabled === 'boolean' ? body.enabled : true;
  const recipientRoles = Array.isArray(body.recipientRoles) ? body.recipientRoles.map(String) : [];
  const recipientFlags = Array.isArray(body.recipientFlags) ? body.recipientFlags.map(String) : [];
  const recipientUsers = Array.isArray(body.recipientUsers) ? body.recipientUsers.map(String) : [];
  if (recipientRoles.some((x) => !VALID_RECIPIENT_ROLES.has(x))) {
    return NextResponse.json({ error: 'Invalid recipient role', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  if (recipientFlags.some((x) => !VALID_RECIPIENT_FLAGS.has(x))) {
    return NextResponse.json({ error: 'Invalid recipient flag', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  // Validate UUID format up front so a bad id is a 422, not a 500 on the uuid[] bind.
  if (recipientUsers.some((x) => !isValidUUID(x))) {
    return NextResponse.json({ error: 'Invalid recipient user id (must be a UUID)', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const channel = body.channel === undefined ? 'email' : String(body.channel);
  if (!VALID_CHANNELS.has(channel)) {
    return NextResponse.json({ error: 'Invalid channel', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const nudgeDays = Array.isArray(body.nudgeDays)
    ? body.nudgeDays.map(Number).filter((n) => Number.isFinite(n) && n >= 0).slice(0, 5)
    : [];
  const dueInMinutes = typeof body.dueInMinutes === 'number' && Number.isFinite(body.dueInMinutes) && body.dueInMinutes > 0
    ? Math.floor(body.dueInMinutes) : null;
  const cooldownMinutes = typeof body.cooldownMinutes === 'number' && body.cooldownMinutes >= 0 ? Math.floor(body.cooldownMinutes) : 0;
  const maxFiresPerHour = typeof body.maxFiresPerHour === 'number' && body.maxFiresPerHour >= 0 ? Math.floor(body.maxFiresPerHour) : 0;

  try {
    const [saved] = await withTenant(r.tenantId, async (tx) => tx<PolicyRow[]>`
      INSERT INTO tenant_automation_policies
        (tenant_id, scope, trigger_key, enabled, recipient_roles, recipient_users, recipient_flags,
         due_in_minutes, nudge_days, channel, cooldown_minutes, max_fires_per_hour, configured_at)
      VALUES (
        ${r.tenantId}::uuid, ${scope}, ${triggerKey}, ${enabled},
        ${tx.array(recipientRoles)}, ${tx.array(recipientUsers)}::uuid[], ${tx.array(recipientFlags)},
        ${dueInMinutes}, ${tx.array(nudgeDays)}::int[], ${channel}, ${cooldownMinutes}, ${maxFiresPerHour}, now()
      )
      ON CONFLICT (tenant_id, scope, trigger_key) DO UPDATE SET
        enabled = EXCLUDED.enabled, recipient_roles = EXCLUDED.recipient_roles,
        recipient_users = EXCLUDED.recipient_users, recipient_flags = EXCLUDED.recipient_flags,
        due_in_minutes = EXCLUDED.due_in_minutes, nudge_days = EXCLUDED.nudge_days,
        channel = EXCLUDED.channel, cooldown_minutes = EXCLUDED.cooldown_minutes,
        max_fires_per_hour = EXCLUDED.max_fires_per_hour, configured_at = now(), updated_at = now()
      RETURNING scope, trigger_key AS "triggerKey", enabled, recipient_roles AS "recipientRoles",
                recipient_users AS "recipientUsers", recipient_flags AS "recipientFlags",
                due_in_minutes AS "dueInMinutes", nudge_days AS "nudgeDays", channel,
                cooldown_minutes AS "cooldownMinutes", max_fires_per_hour AS "maxFiresPerHour",
                configured_at AS "configuredAt"
    `);
    try {
      await emitEventSingle({
        namespace: 'capture', type: 'automation_preferences.updated',
        actor: userActor(r.userId, r.email), tenantId: r.tenantId,
        payload: { scope, triggerKey, enabled },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: { policy: saved } });
  } catch (e) {
    console.error('[automation-policies] PATCH failed:', e);
    return NextResponse.json({ error: 'Failed to save automation policy', code: 'DB_ERROR' }, { status: 500 });
  }
}
