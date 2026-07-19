/**
 * POST   /api/portal/[tenantSlug]/cards/[opportunityId]/pin           — pin = full copy
 * POST   /api/portal/[tenantSlug]/cards/[opportunityId]/pin?action=resync — re-copy after an update
 * DELETE /api/portal/[tenantSlug]/cards/[opportunityId]/pin           — unpin (forward-looking)
 *
 * Pinning copies the global read-only opp folder into the tenant's space and records
 * the manifest on the card (mig 095). RLS-scoped throughout.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { isValidUUID } from '@/lib/validation';
import { pinCard, unpinCard, resyncPinnedCard } from '@/lib/opportunity-pin';
import { emitEventSingle, userActor } from '@/lib/events';
import { requestAgentTask } from '@/lib/agent-client';
import { sql } from '@/lib/db';

async function resolve(tenantSlug: string, opportunityId: string) {
  const session = await auth();
  if (!session?.user) return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  const sessionUser = session.user as { id?: string; email?: string; role?: unknown };
  const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
  if (!role || !sessionUser.id) return { error: NextResponse.json({ error: 'Invalid session', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  if (!hasRoleAtLeast(role, 'tenant_user')) return { error: NextResponse.json({ error: 'Insufficient permissions', code: 'FORBIDDEN' }, { status: 403 }) };
  if (!isValidUUID(opportunityId)) return { error: NextResponse.json({ error: 'Invalid opportunity id', code: 'VALIDATION_ERROR' }, { status: 400 }) };
  const tenant = await getTenantBySlug(tenantSlug);
  if (!tenant) return { error: NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 }) };
  const tenantId = tenant.id as string;
  if (!(await verifyTenantAccess(sessionUser.id, role, tenantId))) return { error: NextResponse.json({ error: 'Forbidden', code: 'FORBIDDEN' }, { status: 403 }) };
  return { tenantId, tenantSlug: tenant.slug as string, userId: sessionUser.id, email: sessionUser.email ?? null };
}

export async function POST(request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const r = await resolve(tenantSlug, opportunityId);
    if ('error' in r) return r.error;
    const action = new URL(request.url).searchParams.get('action');
    if (action === 'resync') {
      const { docs } = await resyncPinnedCard(r.tenantId, r.tenantSlug, opportunityId);
      return NextResponse.json({ data: { resynced: true, docCount: docs.length } });
    }
    const result = await pinCard(r.tenantId, r.tenantSlug, opportunityId);
    if (!result.pinned) return NextResponse.json({ error: 'Card not found for this tenant', code: 'NOT_FOUND' }, { status: 404 });
    // Audit + trigger: a customer pinning a topic is a first-class event (the
    // `capture:topic.pinned` automation rule + admin activity feed both read it).
    await emitEventSingle({
      namespace: 'capture',
      type: 'topic.pinned',
      actor: userActor(r.userId, r.email ?? undefined),
      tenantId: r.tenantId,
      payload: { opportunityId, docCount: result.docs.length },
    });
    // Producer (#117): a pin is the tenant showing interest — enqueue the scoring_strategist
    // agent (tenant-bound) to add an advisory ±15 fit adjustment ALONGSIDE the algorithmic
    // score for this one (tenant, opportunity). Bounded (only pinned cards → no fan-out
    // runaway); the pipeline runs it live (deploy key). Best-effort — never fail the pin.
    try {
      // Enrich the task so it's self-contained (the agent's prompt reads opportunity +
      // base_score). Scoped to THIS tenant's top algorithmic score for the opp.
      const [opp] = await sql<Array<Record<string, unknown>>>`
        SELECT title, agency, office, program_type, naics_codes, set_aside_type, description
        FROM opportunities WHERE id = ${opportunityId}::uuid LIMIT 1`;
      const [bs] = await sql<Array<{ base: number | null }>>`
        SELECT MAX(score) AS base FROM tenant_bucket_scores
        WHERE tenant_id = ${r.tenantId}::uuid AND opportunity_id = ${opportunityId}::uuid`;
      const input = { opportunityId, opportunity: opp ?? {}, base_score: bs?.base ?? 0 };
      // Two fan-out agents fire on a pin, both tenant-bound: scoring_strategist (±15 fit
      // adjustment) + opportunity_analyst (fit/pursue-evaluate-skip analysis). Bounded to
      // pinned cards. Best-effort — never fail the pin.
      await requestAgentTask({ tenantId: r.tenantId, agentRole: 'scoring_strategist', taskType: 'score_adjustment', input });
      await requestAgentTask({ tenantId: r.tenantId, agentRole: 'opportunity_analyst', taskType: 'analyze_fit', input });
    } catch (e) { console.error('[portal/cards/pin] agent enqueue failed (non-fatal)', e); }
    return NextResponse.json({ data: { pinned: true, docCount: result.docs.length, docs: result.docs } });
  } catch (err) {
    console.error('[portal/cards/pin] error', err);
    return NextResponse.json({ error: 'Pin failed', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tenantSlug: string; opportunityId: string }> }) {
  try {
    const { tenantSlug, opportunityId } = await params;
    const r = await resolve(tenantSlug, opportunityId);
    if ('error' in r) return r.error;
    await unpinCard(r.tenantId, opportunityId);
    await emitEventSingle({
      namespace: 'capture',
      type: 'topic.unpinned',
      actor: userActor(r.userId, r.email ?? undefined),
      tenantId: r.tenantId,
      payload: { opportunityId },
    });
    return NextResponse.json({ data: { pinned: false } });
  } catch (err) {
    console.error('[portal/cards/unpin] error', err);
    return NextResponse.json({ error: 'Unpin failed', code: 'DB_ERROR' }, { status: 500 });
  }
}
