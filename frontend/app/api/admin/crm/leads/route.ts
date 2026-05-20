import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    const url = new URL(request.url);
    const stage = url.searchParams.get('stage');
    const validStages = ['lead', 'target', 'customer', 'at_risk', 'churned'];

    if (stage && !validStages.includes(stage)) {
      return NextResponse.json({ error: 'Invalid lifecycle stage', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const leads = stage
        ? await sql`
            SELECT t.id, t.name, t.lifecycle_stage, t.subscription_status, t.status, t.created_at,
                   u.email AS contact_email, u.name AS contact_name,
                   a.status AS application_status, a.created_at AS applied_at
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
            LEFT JOIN applications a ON a.company_name = t.name
            WHERE t.lifecycle_stage = ${stage}
            ORDER BY t.created_at DESC
            LIMIT 100
          `
        : await sql`
            SELECT t.id, t.name, t.lifecycle_stage, t.subscription_status, t.status, t.created_at,
                   u.email AS contact_email, u.name AS contact_name,
                   a.status AS application_status, a.created_at AS applied_at
            FROM tenants t
            LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'tenant_admin'
            LEFT JOIN applications a ON a.company_name = t.name
            ORDER BY t.created_at DESC
            LIMIT 100
          `;

      return NextResponse.json({ data: leads });
    } catch (e) {
      console.error('[api/admin/crm/leads] GET query failed:', e);
      return NextResponse.json({ error: 'Failed to fetch leads', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/leads] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }
    const userId = (session.user as { id?: string }).id;

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body', code: 'INVALID_BODY' }, { status: 400 });
    }

    if (!body.tenant_id || typeof body.tenant_id !== 'string') {
      return NextResponse.json({ error: 'tenant_id is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (!body.lifecycle_stage || typeof body.lifecycle_stage !== 'string') {
      return NextResponse.json({ error: 'lifecycle_stage is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const validStages = ['lead', 'target', 'customer', 'at_risk', 'churned'];
    if (!validStages.includes(body.lifecycle_stage as string)) {
      return NextResponse.json({ error: 'Invalid lifecycle_stage', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const [tenant] = await sql<{ id: string; lifecycleStage: string | null }[]>`
        SELECT id, lifecycle_stage FROM tenants WHERE id = ${body.tenant_id as string} LIMIT 1
      `;
      if (!tenant) {
        return NextResponse.json({ error: 'Tenant not found', code: 'NOT_FOUND' }, { status: 404 });
      }

      const previousStage = tenant.lifecycleStage;

      await sql`
        UPDATE tenants SET lifecycle_stage = ${body.lifecycle_stage as string}
        WHERE id = ${body.tenant_id as string}
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'tenant.lifecycle_changed',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: body.tenant_id as string,
        payload: {
          previousStage,
          newStage: body.lifecycle_stage,
        },
      });

      return NextResponse.json({
        data: {
          tenantId: body.tenant_id,
          lifecycleStage: body.lifecycle_stage,
          previousStage,
        },
      });
    } catch (e) {
      console.error('[api/admin/crm/leads] PATCH query failed:', e);
      return NextResponse.json({ error: 'Failed to update lifecycle stage', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/leads] PATCH error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
