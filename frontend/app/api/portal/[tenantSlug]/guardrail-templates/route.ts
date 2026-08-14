/**
 * GET  /api/portal/[tenantSlug]/guardrail-templates — the named guardrail-config templates a
 *      build can start from (the shared platform library + this tenant's saved templates).
 * POST /api/portal/[tenantSlug]/guardrail-templates — save a config as a named template.
 *
 * "The templates ARE the automation guardrails." A build's guardrail config (stages / nudge
 * cadence / managers / agent-first / RFP oversight) is a reusable, named template in
 * guardrail_templates. Instead of forcing a build into a misaligned generic default, the admin
 * (or tenant admin) picks a relevant prior template (e.g. "USAF CSO STTR") to seed the editor,
 * tweaks it, and saves the result — so the next matching build starts from the right shape.
 * Read = platform templates (tenant_id NULL) ∪ this tenant's; saves are tenant-scoped.
 * tenant_admin+ with tenant access (this is also the RFP-admin-in-shadow path).
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess, sql } from '@/lib/db';
import { withTenant } from '@/lib/rls';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import { getGuardrailLimits, validateGuardrailConfig, type GuardrailConfig } from '@/lib/portal-workflow';

interface RouteContext { params: Promise<{ tenantSlug: string }> }
type JsonArg = Parameters<typeof sql.json>[0];

async function resolveCtx(ctx: RouteContext): Promise<
  | { ok: true; tenantId: string; userId: string; email?: string }
  | { ok: false; res: NextResponse }
> {
  const session = await auth();
  if (!session?.user) return { ok: false, res: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const u = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(u.role) ? u.role : null;
  if (!role || !u.id || !hasRoleAtLeast(role, 'tenant_admin')) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant admin access required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  const { tenantSlug } = await ctx.params;
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { ok: false, res: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(u.id, role, tenantId))) {
    return { ok: false, res: NextResponse.json({ error: 'Tenant access denied', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { ok: true, tenantId, userId: u.id, email: u.email };
}

interface TemplateRow {
  id: string; name: string; description: string | null; config: unknown;
  isDefault: boolean; scope: 'platform' | 'tenant'; updatedAt: string;
}

export async function GET(_request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;
  try {
    // Startable, editor-shaped templates only: the platform library (tenant_id NULL) + this
    // tenant's saved ones, EXCLUDING the is_default row — that row is the framework
    // limits/defaults document ({limits,defaults}), not an editor guardrail config, so picking it
    // would wipe the editor (sweep D2/HIGH). Most-recent first — "extend the last".
    // Runs through withTenant so RLS scopes the platform∪tenant read under `govtech_app`
    // (the explicit tenant_id predicate is the app-layer belt / defense-in-depth).
    const templates = await withTenant(r.tenantId, async (tx) => tx<TemplateRow[]>`
      SELECT id, name, description, config, is_default AS "isDefault",
             CASE WHEN tenant_id IS NULL THEN 'platform' ELSE 'tenant' END AS scope,
             updated_at AS "updatedAt"
      FROM guardrail_templates
      WHERE (tenant_id IS NULL OR tenant_id = ${r.tenantId}::uuid)
        AND is_default = false
      ORDER BY updated_at DESC
    `);
    return NextResponse.json({ data: { templates } });
  } catch (e) {
    console.error('[guardrail-templates] GET failed:', e);
    return NextResponse.json({ error: 'Failed to load templates', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request, ctx: RouteContext) {
  const r = await resolveCtx(ctx);
  if (!r.ok) return r.res;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return NextResponse.json({ error: 'A template name is required', code: 'VALIDATION_ERROR' }, { status: 422 });
  if (name.length > 120) return NextResponse.json({ error: 'Template name too long (max 120)', code: 'VALIDATION_ERROR' }, { status: 422 });
  const config = body.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return NextResponse.json({ error: 'A guardrail config object is required', code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  // Validate against the framework caps so a saved template can never exceed them.
  const limits = await getGuardrailLimits();
  const v = validateGuardrailConfig(config as GuardrailConfig, limits);
  if (!v.ok) {
    return NextResponse.json({ error: `Invalid guardrail config: ${v.errors.join('; ')}`, code: 'VALIDATION_ERROR' }, { status: 422 });
  }
  const description = typeof body.description === 'string' ? body.description.trim() || null : null;

  try {
    // Tenant-scoped save (the tenant's own named library); platform templates are seeded separately.
    // Wrapped in withTenant so the INSERT satisfies the RLS WITH CHECK once govtech_app is NOBYPASSRLS.
    const row = await withTenant(r.tenantId, async (tx) => {
      const [r0] = await tx<TemplateRow[]>`
        INSERT INTO guardrail_templates (tenant_id, name, description, config, is_default, created_by)
        VALUES (${r.tenantId}::uuid, ${name}, ${description}, ${sql.json(config as JsonArg)}, false, ${r.userId}::uuid)
        RETURNING id, name, description, config, is_default AS "isDefault",
                  'tenant' AS scope, updated_at AS "updatedAt"
      `;
      return r0;
    });
    try {
      await emitEventSingle({
        namespace: 'capture', type: 'guardrail_template.saved',
        actor: userActor(r.userId, r.email ?? undefined),
        tenantId: r.tenantId,
        payload: { name },
      });
    } catch { /* best-effort */ }
    return NextResponse.json({ data: { template: row } });
  } catch (e) {
    console.error('[guardrail-templates] POST failed:', e);
    return NextResponse.json({ error: 'Failed to save template', code: 'DB_ERROR' }, { status: 500 });
  }
}
