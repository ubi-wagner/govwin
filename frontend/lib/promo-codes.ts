/**
 * Comp-code issuance — mint a one-time code that opens a proposal portal without a card.
 *
 * The redemption half lives in app/api/portal/[tenantSlug]/purchase/route.ts and already enforces
 * everything a one-time code needs (active · not expired · used_count < max_uses, under FOR UPDATE).
 * This module is the other half: generating codes, recording who issued them and to whom, listing
 * what is outstanding, and revoking. Nothing here is on the redemption path.
 *
 * PLATFORM SCOPE. promo_codes belongs to no tenant — a bearer code is minted before we know which
 * company will redeem it — so every read and write here goes through sqlBypass, the sanctioned
 * cross-tenant path for platform state (docs/RLS_CUTOVER.md). Callers must gate on rfp_admin+
 * themselves; this module does not check authority.
 */
import { sqlBypass } from '@/lib/db';
import { randomInt } from 'crypto';

/** Default life of an issued code: one purchase, or 30 days, whichever comes first. */
export const DEFAULT_MAX_USES = 1;
export const DEFAULT_EXPIRY_DAYS = 30;

/** Hard ceiling on one issue request, so a fat finger cannot mint ten thousand live codes. */
export const MAX_BATCH = 50;

/**
 * No 0/O, 1/I/L, 5/S, 8/B. Codes get read off a screen, written on a card, and dictated over the
 * phone, and every one of those confusions turns into "your code doesn't work". 28 symbols over 10
 * characters is ~48 bits — far past guessing, which matters because a bearer code IS the payment.
 */
const ALPHABET = 'ACDEFGHJKMNPQRTUVWXYZ234679';
const CODE_LEN = 10;

/** Grouped as XXXXX-XXXXX so a human can hold half of it in their head while typing the other. */
export function generateCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LEN; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

export interface IssuedCode {
  id: string;
  code: string;
  maxUses: number | null;
  usedCount: number;
  expiresAt: string | null;
  issuedTo: string | null;
  note: string | null;
  createdAt: string;
  firstRedeemedAt: string | null;
  revokedAt: string | null;
  active: boolean;
  redeemedByTenant: string | null;
  issuedByEmail: string | null;
}

/** Outstanding · redeemed · revoked · expired — one word for the state a row is actually in. */
export type CodeState = 'outstanding' | 'redeemed' | 'revoked' | 'expired' | 'exhausted';

export function codeState(c: Pick<IssuedCode, 'revokedAt' | 'expiresAt' | 'usedCount' | 'maxUses' | 'firstRedeemedAt'>): CodeState {
  if (c.revokedAt) return 'revoked';
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return 'exhausted';
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now()) return 'expired';
  if (c.firstRedeemedAt) return 'redeemed';
  return 'outstanding';
}

export interface IssueOptions {
  count?: number;
  maxUses?: number | null;
  expiresInDays?: number | null;
  issuedTo?: string | null;
  note?: string | null;
  issuedBy: string;
}

/**
 * Mint `count` comp codes. Retries once per code on the (vanishingly unlikely) unique collision
 * rather than failing the batch — the caller asked for N codes and should get N codes.
 */
export async function issuePromoCodes(opts: IssueOptions): Promise<IssuedCode[]> {
  const count = Math.min(Math.max(1, Math.trunc(opts.count ?? 1)), MAX_BATCH);
  // maxUses null = unlimited, which is a deliberate and unusual choice; anything else is clamped
  // to a positive integer so `0` cannot mint a code that is dead on arrival.
  const maxUses = opts.maxUses === null ? null : Math.max(1, Math.trunc(opts.maxUses ?? DEFAULT_MAX_USES));
  const days = opts.expiresInDays === null ? null : Math.max(1, Math.trunc(opts.expiresInDays ?? DEFAULT_EXPIRY_DAYS));
  const issuedTo = (opts.issuedTo ?? '').trim().slice(0, 200) || null;
  const note = (opts.note ?? '').trim().slice(0, 500) || null;

  // Compute the expiry as a plain timestamp rather than interpolating a `now() + interval` FRAGMENT
  // into the VALUES list. A conditional that yields either null or a sql fragment is the kind of
  // thing that type-checks, mostly works, and then binds the fragment as a literal on the one path
  // nobody exercised. A Date is unambiguous, and the caller sees exactly the instant that was stored.
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86_400_000);

  const made: IssuedCode[] = [];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      const rows = await sqlBypass<Array<{ id: string; createdAt: string; expiresAt: string | null }>>`
        INSERT INTO promo_codes (code, kind, value, active, max_uses, expires_at, note, issued_by, issued_to)
        VALUES (
          ${code}, 'comp', 0, true, ${maxUses}, ${expiresAt},
          ${note}, ${opts.issuedBy}::uuid, ${issuedTo}
        )
        ON CONFLICT DO NOTHING
        RETURNING id, created_at AS "createdAt", expires_at AS "expiresAt"`;
      if (rows.length > 0) {
        made.push({
          id: rows[0].id, code, maxUses, usedCount: 0,
          expiresAt: rows[0].expiresAt, issuedTo, note, createdAt: rows[0].createdAt,
          firstRedeemedAt: null, revokedAt: null, active: true,
          redeemedByTenant: null, issuedByEmail: null,
        });
        break;
      }
    }
  }
  return made;
}

/** The admin list: newest first, with the redeeming company resolved for the ones that landed. */
export async function listPromoCodes(limit = 200): Promise<IssuedCode[]> {
  return sqlBypass<IssuedCode[]>`
    SELECT p.id, p.code, p.max_uses AS "maxUses", p.used_count AS "usedCount",
           p.expires_at AS "expiresAt", p.issued_to AS "issuedTo", p.note,
           p.created_at AS "createdAt", p.first_redeemed_at AS "firstRedeemedAt",
           p.revoked_at AS "revokedAt", p.active,
           t.name AS "redeemedByTenant", u.email AS "issuedByEmail"
    FROM promo_codes p
    LEFT JOIN tenants t ON t.id = p.redeemed_by_tenant_id
    LEFT JOIN users u ON u.id = p.issued_by
    ORDER BY p.created_at DESC
    LIMIT ${Math.min(Math.max(1, Math.trunc(limit)), 500)}`;
}

/**
 * Kill a code. Sets active=false AND revoked_at together — the redemption lookup reads only
 * `active`, and mig 200's CHECK keeps the two from drifting apart. Already-revoked → false, so a
 * caller can tell "I revoked it" from "it was already dead".
 */
export async function revokePromoCode(id: string, revokedBy: string): Promise<boolean> {
  const rows = await sqlBypass<Array<{ id: string }>>`
    UPDATE promo_codes
       SET active = false, revoked_at = now(), revoked_by = ${revokedBy}::uuid
     WHERE id = ${id}::uuid AND revoked_at IS NULL
     RETURNING id`;
  return rows.length > 0;
}
