import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { sql } from '@/lib/db';
import { emitEventSingle, userActor } from '@/lib/events';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
    }
    const role = (session.user as { role?: string }).role;
    if (role !== 'master_admin' && role !== 'rfp_admin') {
      return NextResponse.json({ error: 'Admin role required', code: 'FORBIDDEN' }, { status: 403 });
    }

    try {
      const accounts = await sql`
        SELECT id, platform, account_name, platform_account_id, status,
               tenant_id, metadata, created_at, updated_at
        FROM social_accounts
        ORDER BY created_at DESC
      `;

      return NextResponse.json({ data: accounts });
    } catch (e) {
      console.error('[api/admin/crm/social/accounts] GET query failed:', e);
      return NextResponse.json({ error: 'Failed to fetch accounts', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/accounts] GET error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

    // Validate required fields
    if (!body.platform || typeof body.platform !== 'string') {
      return NextResponse.json({ error: 'platform is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }
    if (!body.account_name || typeof body.account_name !== 'string') {
      return NextResponse.json({ error: 'account_name is required', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    const validPlatforms = ['linkedin', 'twitter', 'facebook', 'instagram'];
    if (!validPlatforms.includes(body.platform as string)) {
      return NextResponse.json({ error: 'Invalid platform', code: 'VALIDATION_ERROR' }, { status: 422 });
    }

    try {
      const [account] = await sql<{ id: string }[]>`
        INSERT INTO social_accounts (
          platform, account_name, platform_account_id,
          access_token, refresh_token, token_expires_at,
          tenant_id, status, metadata
        ) VALUES (
          ${body.platform as string},
          ${(body.account_name as string).trim()},
          ${typeof body.platform_account_id === 'string' ? body.platform_account_id : null},
          ${typeof body.access_token === 'string' ? body.access_token : null},
          ${typeof body.refresh_token === 'string' ? body.refresh_token : null},
          ${typeof body.token_expires_at === 'string' ? body.token_expires_at : null},
          ${typeof body.tenant_id === 'string' ? body.tenant_id : null},
          'active',
          ${JSON.stringify(typeof body.metadata === 'object' && body.metadata ? body.metadata : {})}::jsonb
        )
        RETURNING id
      `;

      await emitEventSingle({
        namespace: 'system',
        type: 'social_account.created',
        actor: userActor(userId ?? 'unknown', (session.user as { email?: string }).email),
        tenantId: null,
        payload: { accountId: account.id, platform: body.platform },
      });

      return NextResponse.json({ data: { id: account.id } }, { status: 201 });
    } catch (e) {
      console.error('[api/admin/crm/social/accounts] POST insert failed:', e);
      return NextResponse.json({ error: 'Failed to create account', code: 'DB_ERROR' }, { status: 500 });
    }
  } catch (e) {
    console.error('[api/admin/crm/social/accounts] POST error:', e);
    return NextResponse.json({ error: 'Internal server error', code: 'DB_ERROR' }, { status: 500 });
  }
}
