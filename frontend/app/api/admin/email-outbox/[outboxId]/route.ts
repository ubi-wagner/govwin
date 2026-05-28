/**
 * POST /api/admin/email-outbox/[outboxId] — Approve or reject an outbox item
 *
 * Proxies to the CMS service's outbox approve/reject/claim endpoints.
 * Emits system events for closed-loop observability.
 *
 * Body: { action: 'approve' | 'reject' | 'claim', reason?: string }
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { emitEventSingle, userActor } from '@/lib/events';
import { randomUUID } from 'crypto';

const CMS_BASE =
  process.env.CMS_SERVICE_URL ||
  process.env.CMS_PUBLIC_URL ||
  'https://rfp-crm-production.up.railway.app';

function cmsHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const user = process.env.CMS_BASIC_USER;
  const pass = process.env.CMS_BASIC_PASS;
  if (user && pass) {
    headers['Authorization'] = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
  }
  return headers;
}

interface RouteContext {
  params: Promise<{ outboxId: string }>;
}

export async function POST(request: Request, ctx: RouteContext) {
  try {
    // 1. AUTH CHECK
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

    const userId = (session.user as { id?: string }).id ?? 'unknown';
    const userEmail = (session.user as { email?: string }).email ?? 'unknown';

    // 2. PARSE PARAMS + BODY
    const { outboxId } = await ctx.params;
    if (!outboxId) {
      return NextResponse.json(
        { error: 'Missing outboxId', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body', code: 'INVALID_BODY' },
        { status: 400 },
      );
    }

    const action = typeof body.action === 'string' ? body.action : '';
    if (!['approve', 'reject', 'claim'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be one of: approve, reject, claim', code: 'VALIDATION_ERROR' },
        { status: 422 },
      );
    }

    // 3. PROXY TO CMS
    const headers = cmsHeaders();
    let cmsUrl: string;
    let cmsBody: Record<string, unknown>;

    if (action === 'approve') {
      cmsUrl = `${CMS_BASE}/email/outbox/${outboxId}/approve`;
      cmsBody = {
        approved_by: userEmail,
        review_notes: typeof body.reason === 'string' ? body.reason : null,
      };
    } else if (action === 'reject') {
      cmsUrl = `${CMS_BASE}/email/outbox/${outboxId}/reject`;
      cmsBody = {
        rejected_by: userEmail,
        reason: typeof body.reason === 'string' ? body.reason : 'Rejected by admin',
      };
    } else {
      cmsUrl = `${CMS_BASE}/email/outbox/${outboxId}/claim`;
      cmsBody = {
        claimed_by: userEmail,
        claimed_by_name: (session.user as { name?: string }).name ?? userEmail,
      };
    }

    const cmsRes = await fetch(cmsUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(cmsBody),
    });

    if (!cmsRes.ok) {
      const text = await cmsRes.text().catch(() => 'Unknown error');
      console.error(`[api/admin/email-outbox/${action}] CMS error:`, cmsRes.status, text);
      return NextResponse.json(
        { error: `Failed to ${action} outbox item`, code: 'UPSTREAM_ERROR' },
        { status: cmsRes.status >= 400 && cmsRes.status < 500 ? cmsRes.status : 502 },
      );
    }

    const cmsData = await cmsRes.json();

    // 4. EMIT EVENT
    const eventTypeMap: Record<string, string> = {
      approve: 'email.approved',
      reject: 'email.rejected',
      claim: 'email.claimed',
    };

    await emitEventSingle({
      namespace: 'system',
      type: eventTypeMap[action],
      actor: userActor(userId, userEmail),
      tenantId: null,
      payload: {
        correlationId: randomUUID(),
        outboxId,
        action,
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      },
    });

    return NextResponse.json({ data: cmsData.data ?? { status: action } });
  } catch (err) {
    console.error('[api/admin/email-outbox/[outboxId]] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
