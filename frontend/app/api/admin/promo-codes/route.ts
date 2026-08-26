/**
 * Comp-code issuance — the admin side of the free-purchase path.
 *
 *   GET    /api/admin/promo-codes           → every code, newest first, with its state
 *   POST   /api/admin/promo-codes           → mint one or more codes  { count?, maxUses?, expiresInDays?, issuedTo?, note? }
 *   PATCH  /api/admin/promo-codes           → revoke one              { id, action: 'revoke' }
 *
 * A comp code IS the payment: redeeming one opens a proposal portal and starts the 72h curation
 * SLA without a card. So issuing is rfp_admin+, every mint and revoke is audited, and the codes are
 * bearer + single-use by default (see lib/promo-codes.ts).
 *
 * promo_codes is PLATFORM state — a code is minted before we know which company will redeem it — so
 * the library reads and writes it through sqlBypass. That is the sanctioned cross-tenant path
 * (docs/RLS_CUTOVER.md), and this route is the authority check in front of it.
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { isRole, hasRoleAtLeast, type Role } from '@/lib/rbac';
import { emitEventSingle, userActor } from '@/lib/events';
import {
  issuePromoCodes, listPromoCodes, revokePromoCode, codeState,
  MAX_BATCH, DEFAULT_MAX_USES, DEFAULT_EXPIRY_DAYS,
} from '@/lib/promo-codes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate() {
  const session = await auth();
  const u = session?.user as { id?: string; role?: unknown; email?: string } | undefined;
  const role: Role | null = isRole(u?.role) ? (u!.role as Role) : null;
  if (!u?.id || !role) {
    return { error: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }) };
  }
  if (!hasRoleAtLeast(role, 'rfp_admin')) {
    return { error: NextResponse.json({ error: 'rfp_admin or master_admin role required', code: 'FORBIDDEN' }, { status: 403 }) };
  }
  return { userId: u.id, email: u.email ?? null };
}

export async function GET() {
  try {
    const g = await gate();
    if ('error' in g) return g.error;
    const codes = await listPromoCodes();
    return NextResponse.json({ data: { codes: codes.map((c) => ({ ...c, state: codeState(c) })) } });
  } catch (err) {
    console.error('[admin/promo-codes] GET error', err);
    return NextResponse.json({ error: 'Could not load codes', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const g = await gate();
    if ('error' in g) return g.error;

    let body: { count?: unknown; maxUses?: unknown; expiresInDays?: unknown; issuedTo?: unknown; note?: unknown };
    try { body = await request.json(); } catch { body = {}; }

    const num = (v: unknown, fallback: number | null): number | null => {
      if (v === null) return null;                 // explicit null = unlimited / never expires
      if (v === undefined || v === '') return fallback;
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };
    const count = Math.trunc(Number(body.count ?? 1));
    if (!Number.isFinite(count) || count < 1 || count > MAX_BATCH) {
      return NextResponse.json(
        { error: `count must be between 1 and ${MAX_BATCH}`, code: 'VALIDATION_ERROR' },
        { status: 400 },
      );
    }

    const codes = await issuePromoCodes({
      count,
      maxUses: num(body.maxUses, DEFAULT_MAX_USES),
      expiresInDays: num(body.expiresInDays, DEFAULT_EXPIRY_DAYS),
      issuedTo: typeof body.issuedTo === 'string' ? body.issuedTo : null,
      note: typeof body.note === 'string' ? body.note : null,
      issuedBy: g.userId,
    });

    if (codes.length === 0) {
      return NextResponse.json({ error: 'Could not mint a code', code: 'DB_ERROR' }, { status: 500 });
    }

    // Audit the ISSUE, not the code. The codes themselves are payment instruments; the event records
    // that N were minted, by whom, for whom, and on what terms.
    await emitEventSingle({
      namespace: 'finder',
      type: 'promo_codes.issued',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: null,
      payload: {
        count: codes.length,
        maxUses: codes[0].maxUses,
        expiresAt: codes[0].expiresAt,
        issuedTo: codes[0].issuedTo,
        codeIds: codes.map((c) => c.id),
      },
    });

    return NextResponse.json({ data: { codes } }, { status: 201 });
  } catch (err) {
    console.error('[admin/promo-codes] POST error', err);
    return NextResponse.json({ error: 'Could not issue codes', code: 'DB_ERROR' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const g = await gate();
    if ('error' in g) return g.error;

    let body: { id?: unknown; action?: unknown };
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON', code: 'VALIDATION_ERROR' }, { status: 400 }); }

    const id = typeof body.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'A valid code id is required', code: 'VALIDATION_ERROR' }, { status: 400 });
    }
    if (body.action !== 'revoke') {
      return NextResponse.json({ error: "action must be 'revoke'", code: 'VALIDATION_ERROR' }, { status: 400 });
    }

    const revoked = await revokePromoCode(id, g.userId);
    if (!revoked) {
      // Not an error the admin needs to fix — the code was already dead. Say which.
      return NextResponse.json({ error: 'That code was already revoked', code: 'ALREADY_REVOKED' }, { status: 409 });
    }

    await emitEventSingle({
      namespace: 'finder',
      type: 'promo_code.revoked',
      actor: userActor(g.userId, g.email ?? undefined),
      tenantId: null,
      payload: { codeId: id },
    });

    return NextResponse.json({ data: { revoked: true } });
  } catch (err) {
    console.error('[admin/promo-codes] PATCH error', err);
    return NextResponse.json({ error: 'Could not revoke the code', code: 'DB_ERROR' }, { status: 500 });
  }
}
