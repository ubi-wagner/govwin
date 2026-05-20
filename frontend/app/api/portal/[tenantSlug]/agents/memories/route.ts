/**
 * GET /api/portal/[tenantSlug]/agents/memories — View tenant agent memories
 *
 * Returns agent_memories for this tenant, filtered by agent_role.
 * RLS enforced via tenant_id on the agent_memories table.
 *
 * Auth: tenant_admin or above with tenant access.
 *
 * V1 TODO (P2-16): Implement agent memory viewer.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql, getTenantBySlug, verifyTenantAccess } from '@/lib/db';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';

interface RouteContext {
  params: Promise<{ tenantSlug: string }>;
}

export async function GET(request: Request, ctx: RouteContext) {
  try {
    const { tenantSlug } = await ctx.params;

    // ── Auth ──────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const sessionUser = session.user as {
      id?: string;
      role?: unknown;
      tenantId?: string | null;
    };
    const role: Role | null = isRole(sessionUser.role) ? sessionUser.role : null;
    if (!role || !sessionUser.id) {
      return NextResponse.json(
        { error: 'Invalid session', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    if (!hasRoleAtLeast(role, 'tenant_admin')) {
      return NextResponse.json(
        { error: 'Insufficient permissions', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const tenant = await getTenantBySlug(tenantSlug);
    if (!tenant) {
      return NextResponse.json(
        { error: 'Tenant not found', code: 'NOT_FOUND' },
        { status: 404 },
      );
    }
    const tenantId = tenant.id as string;

    const hasAccess = await verifyTenantAccess(sessionUser.id, role, tenantId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'Forbidden', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    // ── Parse query params ───────────────────────────────────────
    const url = new URL(request.url);
    const agentRole = url.searchParams.get('agent_role');
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 200);

    // TODO: Implement agent memory query
    //
    // SELECT am.id, am.agent_role, am.memory_type, am.content,
    //        am.confidence, am.created_at, am.last_accessed_at
    // FROM agent_memories am
    // WHERE am.tenant_id = ${tenantId}::uuid
    //   [AND am.agent_role = ${agentRole}]
    // ORDER BY am.created_at DESC
    // LIMIT ${limit}

    return NextResponse.json({
      error: 'Not implemented — see V1_TODO.md P2-16',
      code: 'NOT_IMPLEMENTED',
    }, { status: 501 });
  } catch (err) {
    console.error('[portal/agents/memories] error:', err);
    return NextResponse.json(
      { error: 'Failed to query agent memories', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
