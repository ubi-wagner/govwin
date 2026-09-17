/**
 * THE SEAM THAT MAKES "RETURN A CODE" AND "EMIT WHEN IT DID NOT HAPPEN" INSEPARABLE.
 *
 * ── WHAT THE DRIVE MEASURED (B162) ─────────────────────────────────────────────────────────────
 * `scripts/drive-failure-observability.mts` induced fourteen real failures against a running box
 * and joined what the caller got back against what the system recorded:
 *
 *     14 of 14 returned a textbook `{error, code}` envelope
 *     11 of 11 requests that asked for an EFFECT emitted NOTHING
 *
 * Including the two that matter most, because they are real work on a real project refused
 * mid-flight rather than turned away at the gate: re-baselining a frozen baseline (409) and closing
 * a project with milestones outstanding (409). Both answered perfectly. Neither left a trace.
 *
 * ── WHY THE HALVES DRIFTED ─────────────────────────────────────────────────────────────────────
 * There was never a seam. 2,026 sites build the envelope inline in a route and 515 domain functions
 * return `{ ok: false, code }`; the two halves were joined only by everyone remembering. The
 * envelope half is graded by two lenses, so it held everywhere. The emit half is graded by nothing,
 * so it held nowhere. **A rule enforced on one side of a pair is a rule that will come apart, and
 * the side with a test is the side that survives.**
 *
 * `withEventBracket` does not close this: it emits on a THROW, and the SOP asks handlers to catch
 * and RETURN. Following the SOP is precisely what routes around it.
 *
 * ── THE RULE THIS ENCODES ──────────────────────────────────────────────────────────────────────
 * Not every refusal wants an event. Turning away a request that was never valid — a bad uuid, a
 * missing field, a caller without the role — is information, and emitting it would bury the signal
 * in noise the system cannot act on.
 *
 * What must be visible is work the system LOOKED AT AND DECIDED NOT TO DO: a conflict, a gate, a
 * precondition, a constraint. Those are states of the business, not of the request. So `refuse()`
 * emits for 409 and 5xx by default and stays quiet for 4xx-of-the-caller's-making, with an explicit
 * override either way — and the decision is recorded HERE, once, instead of being re-taken at every
 * one of five hundred call sites.
 */
import { NextResponse } from 'next/server';
import { emitEventSingle, type EventNamespace } from '@/lib/events';

/**
 * What a domain function returns when it declines to do the work.
 *
 * DELIBERATELY DOES NOT REQUIRE `ok: false`. `refuse` reads status, error and code and nothing
 * else, and insisting on the discriminant only excludes result types that spell it `ok: boolean`
 * rather than as a union — `ClaimResult` among them. Requiring a field the function never touches
 * would have meant either rewriting those domain types or leaving their refusals silent, and
 * neither is a good reason.
 */
export type Refusal = {
  status: number;
  /**
   * OPTIONAL, because some domain result types declare it so (`ClaimResult` again). The response
   * still carries a string either way — see the fallback in `refuse` — because the SOP envelope
   * requires BOTH fields and a refusal that answers `{"error": undefined}` would fail the contract
   * these lenses grade while looking fine to a casual read.
   */
  error?: string;
  code: string;
};

export type RefuseContext = {
  /** The namespace the refused work belongs to — `project`, `proposal`, `capture`, … */
  namespace: EventNamespace;
  /** What was being attempted, past tense, e.g. `project.close`. `.refused` is appended. */
  action: string;
  tenantId?: string | null;
  actor?: { id?: string; email?: string | null; role?: string } | null;
  entityId?: string | null;
  /** Force the decision rather than take the default below. */
  emit?: boolean;
  /** Anything that helps someone reading the trail six months from now. */
  payload?: Record<string, unknown>;
};

/**
 * Emit for a refusal the SYSTEM made, stay quiet for one the REQUEST earned.
 *
 * 409 is the clearest signal of the first kind — a conflict is a fact about stored state, not about
 * the caller's typing — and 5xx is the second: something broke and the caller's response is the
 * only place it currently exists. 400/401/403/404 are the caller's, and are noise here.
 */
export function shouldEmit(status: number): boolean {
  return status === 409 || status >= 500;
}

/**
 * Turn a domain refusal into the HTTP response, emitting when the work was refused rather than the
 * request rejected. Never throws: an emit failure must not turn a clean 409 into a 500, because
 * that would make the observability fix WORSE than the gap it closes.
 */
export async function refuse(r: Refusal, ctx: RefuseContext): Promise<NextResponse> {
  const emit = ctx.emit ?? shouldEmit(r.status);
  if (emit) {
    try {
      await emitEventSingle({
        namespace: ctx.namespace,
        type: `${ctx.action}.refused`,
        actor: ctx.actor?.id
          ? { type: 'user', id: ctx.actor.id, email: ctx.actor.email ?? undefined }
          : { type: 'system', id: 'api' },
        tenantId: ctx.tenantId ?? null,
        payload: {
          code: r.code,
          status: r.status,
          reason: r.error ?? null,
          entityId: ctx.entityId ?? null,
          ...(ctx.payload ?? {}),
        },
      });
    } catch (e) {
      // Reported, never fatal — see the contract above.
      console.error('[api-refusal] emit failed for', ctx.action, r.code, e);
    }
  }
  // The code is the fallback message, and only when there is no message at all — never a
  // substitution for one. A refusal with a code and no prose is still better than an empty string.
  return NextResponse.json({ error: r.error ?? r.code, code: r.code }, { status: r.status });
}
