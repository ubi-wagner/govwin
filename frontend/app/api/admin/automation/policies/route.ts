/**
 * GET /api/admin/automation/policies
 *
 * Returns all platform framework rows (tenant_id IS NULL) from
 * tenant_automation_policies. These are the rfp-admin-tunable defaults
 * that every tenant rides until they configure a tenant-specific override.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Authentication required', code: 'UNAUTHENTICATED' },
        { status: 401 },
      );
    }

    const role = (session.user as { role?: string }).role;
    if (role !== 'rfp_admin' && role !== 'master_admin') {
      return NextResponse.json(
        { error: 'Admin role required', code: 'FORBIDDEN' },
        { status: 403 },
      );
    }

    const policies = await sql<{
      id: string;
      scope: string;
      triggerKey: string;
      enabled: boolean;
      recipientRoles: string[];
      nudgeDays: number[];
      dueInMinutes: number | null;
      channel: string;
      configuredAt: string | null;
      updatedAt: string;
    }[]>`
      SELECT
        id,
        scope,
        trigger_key,
        enabled,
        recipient_roles,
        nudge_days,
        due_in_minutes,
        channel,
        configured_at,
        updated_at
      FROM tenant_automation_policies
      WHERE tenant_id IS NULL
      ORDER BY scope, trigger_key
    `;

    return NextResponse.json({ data: { policies } });
  } catch (err) {
    console.error('[api/admin/automation/policies GET] error:', err);
    return NextResponse.json(
      { error: 'Failed to fetch policies', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
