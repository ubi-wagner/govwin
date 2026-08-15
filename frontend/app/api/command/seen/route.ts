/**
 * POST /api/command/seen — stamp "I just looked at this Command Center tab".
 *
 * Body: { scope, tab }. Records a per-(user, scope, tab) last_seen_at watermark (mig 179) for the
 * signed-in user, so the CC can flag which tabs have NEW items on the next render. Personal data —
 * always keyed to the session user; scope/tab are validated to keep junk out of the table.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { markCommandSeen, isValidScope, KNOWN_TABS } from '@/lib/command/seen';

export async function POST(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated', code: 'unauthenticated' }, { status: 401 });
  }

  let body: { scope?: unknown; tab?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'bad_request' }, { status: 400 });
  }

  const scope = typeof body.scope === 'string' ? body.scope : '';
  const tab = typeof body.tab === 'string' ? body.tab : '';
  if (!isValidScope(scope) || !KNOWN_TABS.has(tab)) {
    return NextResponse.json({ error: 'Invalid scope or tab', code: 'bad_request' }, { status: 400 });
  }

  try {
    await markCommandSeen(userId, scope, tab);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    console.error('[api/command/seen] failed', e);
    return NextResponse.json({ error: 'Could not record', code: 'server_error' }, { status: 500 });
  }
}
