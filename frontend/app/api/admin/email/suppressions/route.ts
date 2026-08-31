import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { hasRoleAtLeast, type Role } from '@/lib/rbac';
import { lift, listSuppressions } from '@/lib/email';
import { emitEventSingle, userActor } from '@/lib/events';

export const dynamic = 'force-dynamic';

/**
 * The suppression list, and the only way off it.
 *
 * ── WHY THIS IS A WRITE VERB AND NOT A READ-ONLY PANEL ───────────────────────────────────────
 * Suppression is correct: mailing a dead address damages the sending domain's reputation for every
 * other customer on it. But `suppress()` shipped with nothing that undid it, in code or in any UI,
 * so a single hard bounce or spam complaint stopped a person's mail permanently — a mailbox full
 * for a day, an address mistyped once and corrected, a colleague who hit "spam" on a notification.
 * The customer sees no error. They simply stop receiving things.
 *
 * A correct guard with no release is a trap. This is the release.
 *
 * ── PLATFORM SCOPE ───────────────────────────────────────────────────────────────────────────
 * A suppression is keyed by ADDRESS, not by tenant — the same person may hold memberships in
 * several companies, and the provider's verdict is about the mailbox, not about who was writing to
 * it. So this is rfp_admin+ and reads through the owner connection, and the audit event carries
 * `tenantId: null` because it belongs to the platform rather than to any one customer.
 */

function gate(role: Role | undefined) {
  return !!role && hasRoleAtLeast(role, 'rfp_admin');
}

export async function GET() {
  try {
    const session = await auth();
    const role = (session?.user as { role?: string } | undefined)?.role as Role | undefined;
    if (!gate(role)) {
      return NextResponse.json({ error: 'Not authorised', code: 'FORBIDDEN' }, { status: 403 });
    }
    return NextResponse.json({ data: { suppressions: await listSuppressions() } });
  } catch (e) {
    console.error('[api/admin/email/suppressions GET] error:', e);
    return NextResponse.json({ error: 'Could not read the suppression list', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await auth();
    const user = session?.user as { id?: string; role?: string } | undefined;
    const role = user?.role as Role | undefined;
    if (!gate(role)) {
      return NextResponse.json({ error: 'Not authorised', code: 'FORBIDDEN' }, { status: 403 });
    }

    let email: unknown;
    try { ({ email } = await request.json()); } catch { email = undefined; }
    if (typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Provide the email address to un-suppress', code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const removed = await lift(email);
    if (!removed) {
      // NOT an error, and not a silent success either. "That address was not on the list" is a
      // real answer an operator needs — it means the reason mail is not arriving is somewhere else,
      // and reporting a cheerful "lifted" would send them looking in the wrong place.
      return NextResponse.json(
        { error: 'That address is not suppressed — its mail is not being blocked here', code: 'NOT_SUPPRESSED' },
        { status: 404 },
      );
    }

    await emitEventSingle({
      namespace: 'system',
      type: 'email.suppression_lifted',
      actor: userActor(user?.id ?? 'unknown'),
      tenantId: null,
      payload: { email },
    });

    return NextResponse.json({ data: { email, lifted: true } });
  } catch (e) {
    console.error('[api/admin/email/suppressions DELETE] error:', e);
    return NextResponse.json({ error: 'Could not lift the suppression', code: 'DB_ERROR' }, { status: 500 });
  }
}
