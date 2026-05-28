/**
 * GET /api/admin/email-outbox — Proxy to CMS service outbox API
 *
 * The email_outbox and email_sends tables live in the CMS database,
 * not the main database. This route proxies requests to the CMS
 * service's /email/outbox and /email/outbox/stats endpoints.
 *
 * Auth: master_admin or rfp_admin.
 */

import { NextResponse } from 'next/server';
import { auth } from '@/auth';

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

export async function GET(request: Request) {
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

    const { searchParams } = new URL(request.url);
    const includeStats = searchParams.get('stats') === 'true';

    const headers = cmsHeaders();

    // Build the CMS query params (forward status, limit, offset)
    const cmsParams = new URLSearchParams();
    const status = searchParams.get('status');
    const limit = searchParams.get('limit');
    const offset = searchParams.get('offset');
    if (status && status !== 'all') cmsParams.set('status', status);
    if (limit) cmsParams.set('limit', limit);
    if (offset) cmsParams.set('offset', offset);

    if (includeStats) {
      const [outboxRes, statsRes] = await Promise.all([
        fetch(
          `${CMS_BASE}/email/outbox?${cmsParams.toString()}`,
          { headers, next: { revalidate: 0 } },
        ),
        fetch(`${CMS_BASE}/email/outbox/stats`, {
          headers,
          next: { revalidate: 0 },
        }),
      ]);

      if (!outboxRes.ok) {
        const text = await outboxRes.text().catch(() => 'Unknown error');
        console.error('[api/admin/email-outbox] CMS outbox error:', outboxRes.status, text);
        return NextResponse.json(
          { error: 'Failed to fetch outbox from CMS', code: 'UPSTREAM_ERROR' },
          { status: 502 },
        );
      }

      const outboxData = await outboxRes.json();
      let statsData = { data: { pending: 0, claimed: 0, approved_today: 0, rejected_today: 0 } };
      if (statsRes.ok) {
        statsData = await statsRes.json();
      }

      return NextResponse.json({
        data: {
          items: outboxData.data ?? [],
          stats: statsData.data ?? {},
          count: outboxData.count ?? 0,
        },
      });
    }

    // Just list outbox items
    const outboxRes = await fetch(
      `${CMS_BASE}/email/outbox?${cmsParams.toString()}`,
      { headers, next: { revalidate: 0 } },
    );

    if (!outboxRes.ok) {
      const text = await outboxRes.text().catch(() => 'Unknown error');
      console.error('[api/admin/email-outbox] CMS outbox error:', outboxRes.status, text);
      return NextResponse.json(
        { error: 'Failed to fetch outbox from CMS', code: 'UPSTREAM_ERROR' },
        { status: 502 },
      );
    }

    const outboxData = await outboxRes.json();
    return NextResponse.json({
      data: {
        items: outboxData.data ?? [],
        count: outboxData.count ?? 0,
      },
    });
  } catch (err) {
    console.error('[api/admin/email-outbox GET] error:', err);
    return NextResponse.json(
      { error: 'Internal server error', code: 'DB_ERROR' },
      { status: 500 },
    );
  }
}
