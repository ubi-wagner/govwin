/**
 * POST /api/admin/provisioning/[portalId]/release
 *
 * The provisioning cockpit's "Complete & Release" — the TWO-OUTCOME landing of the 72h SLA
 * (docs/PROVISIONING_WORKSPACE_DESIGN.md, PV-3). rfp_admin/master_admin only. In one auditable action:
 *
 *   1. completeBuildOut(solId) — marks the MASTER OPP fully built out (mig 182) and BROADCASTS the
 *      completion as an 'updated' fan-out to EVERY tenant's mirror card (segregation: the shared master).
 *   2. provisionAndReleasePortal(...) — provisions the PURCHASER's private portal, links it, flips
 *      curation_pending → launched, and kicks off their build workflow (continuity: the private portal).
 *
 * Owner decision — ADVISORY + confirm: if the build is below the readiness bar and the caller did NOT
 * pass { confirm: true }, this returns 409 NOT_READY with the readiness so the cockpit can prompt
 * "release anyway". The portal MUST be awaiting curation (curation_pending) — otherwise 409 CONFLICT
 * BEFORE any broadcast, so an already-released portal never re-broadcasts by accident.
 *
 * Cross-tenant admin action: the portal / tenant / master solicitation are read via sqlBypass; the
 * per-tenant writes self-scope to the purchaser's RLS context inside the shared helpers.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import type { Role } from '@/lib/rbac';
import { sqlBypass } from '@/lib/db';
import { getBuildReadiness } from '@/lib/provisioning/readiness';
import { completeBuildOut } from '@/lib/provisioning/complete';
import { provisionAndReleasePortal } from '@/lib/provisioning/release-portal';
import type { GuardrailConfig } from '@/lib/portal-workflow';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ portalId: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    const user = session.user as { id?: string; email?: string | null; role?: Role };
    if (user.role !== 'master_admin' && user.role !== 'rfp_admin') {
      return NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    if (!user.id) return NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 });
    const { portalId } = await params;
    if (!UUID_RE.test(portalId)) return NextResponse.json({ error: 'Invalid portal ID', code: 'VALIDATION_ERROR' }, { status: 400 });

    let body: { confirm?: unknown; guardrailConfig?: GuardrailConfig; guardrailTemplateId?: unknown } = {};
    try { body = await request.json(); } catch { /* body optional */ }

    // Resolve the portal + its buyer tenant (admin cross-tenant → sqlBypass).
    const [portal] = await sqlBypass<Array<{
      tenantId: string; opportunityId: string; status: string; label: string;
      tenantName: string; tenantSlug: string;
    }>>`
      SELECT pp.tenant_id AS "tenantId", pp.opportunity_id AS "opportunityId", pp.status, pp.label,
             t.name AS "tenantName", t.slug AS "tenantSlug"
      FROM proposal_portals pp
      JOIN tenants t ON t.id = pp.tenant_id
      WHERE pp.id = ${portalId}::uuid
      LIMIT 1`;
    if (!portal) return NextResponse.json({ error: 'Portal not found', code: 'NOT_FOUND' }, { status: 404 });

    // The action is only valid on a workspace still awaiting curation — reject BEFORE broadcasting so
    // an already-released portal can never re-fan-out. (The standalone complete-buildout route handles
    // the "broadcast without a specific buyer" case.)
    if (portal.status !== 'curation_pending') {
      return NextResponse.json({ error: 'Portal is not awaiting curation (already released?)', code: 'CONFLICT' }, { status: 409 });
    }

    // Resolve the master solicitation for the portal's opportunity (inverse of completeBuildOut's join:
    // a topic opp points at cs via solicitation_id; an umbrella opp is cs.opportunity_id). May be absent
    // for a manually-created opp with no master — then there is nothing to build-out/broadcast.
    const [solRow] = await sqlBypass<Array<{ solId: string }>>`
      SELECT cs.id AS "solId"
      FROM curated_solicitations cs
      JOIN opportunities o ON (o.solicitation_id = cs.id OR cs.opportunity_id = o.id)
      WHERE o.id = ${portal.opportunityId}::uuid
      LIMIT 1`;
    const solId = solRow?.solId ?? null;

    // Advisory + confirm on the master build-out readiness (only meaningful when there IS a master).
    const readiness = solId ? await getBuildReadiness(solId) : null;
    if (readiness && !readiness.ready && body.confirm !== true) {
      return NextResponse.json({ error: 'Build-out is below the readiness bar', code: 'NOT_READY', data: { readiness } }, { status: 409 });
    }

    // OUTCOME 1 — complete the master build-out + broadcast to every tenant's mirror card (idempotent).
    let buildOut = null as null | Awaited<ReturnType<typeof completeBuildOut>>;
    if (solId) {
      buildOut = await completeBuildOut(solId, { id: user.id, email: user.email });
    }

    // Resolve the chosen overlay (guardrail template) to its config, scoped to the buyer tenant ∪ global.
    // The config lives server-side — the cockpit sends only a template id. An explicit guardrailConfig
    // in the body (programmatic callers) still wins; absent both, the helper defaults.
    let overlayConfig = body.guardrailConfig as GuardrailConfig | undefined;
    if (!overlayConfig && typeof body.guardrailTemplateId === 'string' && UUID_RE.test(body.guardrailTemplateId)) {
      const [tpl] = await sqlBypass<Array<{ config: GuardrailConfig }>>`
        SELECT config FROM guardrail_templates
        WHERE id = ${body.guardrailTemplateId}::uuid
          AND (tenant_id IS NULL OR tenant_id = ${portal.tenantId}::uuid)
        LIMIT 1`;
      if (tpl) overlayConfig = tpl.config;
    }

    // OUTCOME 2 — provision + release the PURCHASER's private portal + kick off their workflow.
    const released = await provisionAndReleasePortal({
      tenantId: portal.tenantId, tenantName: portal.tenantName, tenantSlug: portal.tenantSlug, portalId,
      actor: { id: user.id, email: user.email ?? null, role: user.role },
      guardrailConfig: overlayConfig,
    });
    if (!released.ok) {
      // The broadcast (outcome 1) is idempotent and legitimately stands; surface the release failure so
      // the admin can retry (the portal is still curation_pending — provisionAndReleasePortal flips it
      // only AFTER a successful provision).
      return NextResponse.json({ error: released.error, code: released.code, data: { buildOut } }, { status: released.status });
    }

    return NextResponse.json({
      data: {
        released: true,
        proposalId: released.proposalId,
        tasksCreated: released.tasksCreated,
        buildOut: buildOut ? { opportunitiesRepublished: buildOut.opportunitiesRepublished, readiness: buildOut.readiness } : null,
      },
    });
  } catch (err) {
    console.error('[admin/provisioning/release] error', err);
    return NextResponse.json({ error: 'Failed to complete & release', code: 'DB_ERROR' }, { status: 500 });
  }
}
