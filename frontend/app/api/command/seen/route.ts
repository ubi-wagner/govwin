/**
 * POST /api/command/seen — stamp "I just looked at this Command Center tab".
 *
 * Body: { scope, tab, hadNew? }. Records a per-(user, scope, tab) last_seen_at watermark (mig 179) for
 * the signed-in user, so the CC can flag which tabs have NEW items on the next render. Personal data —
 * always keyed to the session user; scope/tab are validated to keep junk out of the table.
 *
 * READ RECEIPT: when `hadNew` is true — a lane that was actually flagged NEW is being cleared — this
 * also emits ONE `command.acknowledged` audit event (the compliance "who cleared what, when" trail that
 * also feeds the Activity lane). Re-viewing a quiet lane sets hadNew=false → watermark only, no event,
 * so the receipt is signal, not per-view noise. Namespace follows the scope: admin CC → finder (tenantId
 * null); tenant/partner CC → capture (the tenant/partner is the tenantId). See docs/COMMAND_CENTER_DESIGN.md.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { markCommandSeen, isValidScope, KNOWN_TABS } from '@/lib/command/seen';
import { emitEventSingle, userActor } from '@/lib/events';

export async function POST(req: Request) {
  const session = await auth();
  const su = session?.user as { id?: string; email?: string } | undefined;
  const userId = su?.id;
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated', code: 'UNAUTHENTICATED' }, { status: 401 });
  }

  let body: { scope?: unknown; tab?: unknown; hadNew?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  const scope = typeof body.scope === 'string' ? body.scope : '';
  const tab = typeof body.tab === 'string' ? body.tab : '';
  if (!isValidScope(scope) || !KNOWN_TABS.has(tab)) {
    return NextResponse.json({ error: 'Invalid scope or tab', code: 'VALIDATION_ERROR' }, { status: 400 });
  }

  try {
    await markCommandSeen(userId, scope, tab);
    // Genuine acknowledgement only (the client sends hadNew iff the lane's new-dot was showing and it
    // hasn't been cleared this session). system_events is not RLS-forced, so this emits from the app pool.
    if (body.hadNew === true) {
      const m = /^(tenant|partner):([0-9a-fA-F-]{36})$/.exec(scope);
      const tenantId = m ? m[2] : null; // admin scope → null (finder); tenant/partner → the tenant (capture)
      await emitEventSingle({
        namespace: tenantId ? 'capture' : 'finder',
        type: 'command.acknowledged',
        actor: userActor(userId, su?.email ?? undefined),
        tenantId,
        payload: { scope, tab },
      });
    }
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    console.error('[api/command/seen] failed', e);
    return NextResponse.json({ error: 'Could not record', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
