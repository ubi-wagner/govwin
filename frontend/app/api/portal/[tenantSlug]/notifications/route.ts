/**
 * GET /api/portal/[tenantSlug]/notifications — Notification feed for tenant user
 *
 * Returns notifications derived from system_events where the tenant_id matches
 * and namespace is in the customer-visible set. Supports pagination.
 *
 * Auth: tenant_user or above with tenant access.
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

    if (!hasRoleAtLeast(role, 'tenant_user')) {
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
    const rawLimit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 50 : rawLimit), 100);
    const rawOffset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const offset = Math.max(0, isNaN(rawOffset) ? 0 : rawOffset);

    // ── Business logic ───────────────────────────────────────────
    try {
      const notifications = await sql<{
        id: string;
        type: string;
        namespace: string;
        payload: Record<string, unknown>;
        createdAt: string;
        actorType: string | null;
      }[]>`
        SELECT id, type, namespace, payload, created_at, actor_type
        FROM system_events
        WHERE tenant_id = ${tenantId}::uuid
          AND namespace IN ('proposal', 'capture', 'library', 'system')
        ORDER BY created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;

      const items = notifications.map((n) => {
        const p = (n.payload ?? {}) as Record<string, unknown>;
        let title: string = (p.title as string) ?? n.type;
        let summary: string | null = (p.summary as string) ?? null;

        // Human-readable titles for closed-loop completion events
        if (n.type === 'email.delivery_completed' || n.type === 'email.invite_delivered' || n.type === 'email.team_invite_delivered') {
          const status = p.status === 'sent' ? 'sent' : 'failed';
          title = `Email ${status} to ${(p.recipientEmail as string) ?? 'recipient'}`;
          summary = p.error ? `Error: ${p.error as string}` : null;
        } else if (n.type === 'email.admin_alert_delivered') {
          title = `Admin alert sent (${(p.adminsNotified as number) ?? 0} admins notified)`;
        } else if (n.type === 'notification.delivered') {
          title = `Notification delivered to ${(p.recipientEmail as string) ?? 'recipient'}`;
        } else if (n.type === 'notification.delivery_failed') {
          title = `Notification failed for ${(p.recipientEmail as string) ?? 'recipient'}`;
          summary = p.error ? `Error: ${p.error as string}` : null;
        } else if (n.type === 'content_pipeline.post.publish_completed') {
          title = `Blog post "${(p.title as string) ?? (p.slug as string) ?? ''}" published`;
        } else if (n.type === 'content_pipeline.post.unpublish_completed') {
          title = `Blog post "${(p.slug as string) ?? ''}" unpublished`;
        } else if (n.type.endsWith('.failed') && n.namespace === 'system') {
          title = `Action failed: ${(p.actionType as string) ?? n.type}`;
          summary = p.error ? `${p.error as string}` : null;
        }

        return {
          id: n.id,
          type: n.type,
          namespace: n.namespace,
          title,
          summary,
          created_at: n.createdAt,
          is_read: false, // V1: no per-user read tracking; all shown as unread
        };
      });

      return NextResponse.json({ data: { notifications: items } });
    } catch (dbErr) {
      console.error('[portal/notifications] DB error:', dbErr);
      return NextResponse.json(
        { error: 'Failed to query notifications', code: 'DB_ERROR' },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error('[portal/notifications] error:', err);
    return NextResponse.json(
      { error: 'Failed to query notifications', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
