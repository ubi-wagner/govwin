/**
 * SPACE PRESENCE — one writer owns both ends of "somebody from outside is in your workspace".
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────────────────────
 * Every ENTER has an EXIT, both scoped to the tenant whose space it was, and neither is emitted by
 * anything except this module. That is the whole point: before this, the enter and the exit were
 * emitted by different code in different places — a route for one, a client component's button for
 * the other — so nothing could guarantee they came in pairs, and they did not.
 *
 *   partner   `partner.exited` carried `tenantId: null`, so the company that was entered never saw
 *             the departure in its own trail. And it only fired from the "Exit to partner console"
 *             link; navigating away emitted nothing at all.
 *   shadow    `shadow.ascended` fired only from a "Return to platform" button, and the once-per-
 *             entry guard was `sessionStorage` — per TAB, so a second tab opened a bracket that
 *             nothing would ever close.
 *
 * ── WHY THE BRACKET IS DB STATE AND NOT A SESSION FLAG ───────────────────────────────────────
 * A session flag dies with the session, which is exactly the case that most needs closing: the tab
 * that was shut, the cookie that lapsed. `space_presence` (mig 246) survives it, so the sweep can
 * close what the person never did — and `last_seen_at` is what distinguishes an abandoned bracket
 * from a long one, because a read-only browsing session emits no events to infer presence from.
 *
 * ── FOUR WAYS OUT, AND THEY ARE DIFFERENT FACTS ──────────────────────────────────────────────
 *   explicit    they pressed the exit control
 *   left_space  they were next seen on a surface outside any tenant space (traversed up and out)
 *   moved       they turned up inside a DIFFERENT tenant
 *   timeout     they were never seen again and the sweep closed it
 * Only the last is uncertain, and a customer reading their trail deserves to know which one it was.
 *
 * ── EVERY CALL HERE IS BEST-EFFORT ───────────────────────────────────────────────────────────
 * These run inside layouts, on the render path of a page a person is waiting for. An audit record
 * that can take the page down with it is a worse trade than a missed record, so every entry point
 * swallows its own errors and logs. The sweep is the backstop for whatever is missed.
 */
import { sql } from '@/lib/db';
import { runInTenant, runInBypass } from '@/lib/tenant-context';
import { emitEventSingle, userActor } from '@/lib/events';

export type PresenceKind = 'shadow' | 'partner';
export type CloseReason =
  | 'explicit' | 'left_space' | 'moved' | 'timeout' | 'signed_out'
  /** Another operator ended it from /admin/workspace-access (mig 250). The only closer that is not
   *  the actor or the clock — which is exactly why the customer's trail needs it distinct from
   *  `timeout`: "the clock ended it" and "a named person ended it" are different facts. */
  | 'forced';

/** The event pair per door. Kept together so a new door cannot add one half. */
const EVENTS: Record<PresenceKind, { enter: string; exit: string }> = {
  shadow: { enter: 'shadow.descended', exit: 'shadow.ascended' },
  partner: { enter: 'partner.entered', exit: 'partner.exited' },
};
/**
 * `shadow.*` is `identity` and `partner.*` is `finder` — both PRE-EXISTING choices, kept exactly.
 * Changing a namespace would orphan every historical row from the label that renders it, and the
 * registry lives in three runtimes (docs: EVENT_NAMESPACES · pipeline/src/events.py · the DB CHECK).
 */
const NAMESPACE: Record<PresenceKind, 'identity' | 'finder'> = {
  shadow: 'identity',
  partner: 'finder',
};

interface Actor { id: string; email?: string | null }

/**
 * Record that `actor` is inside `tenantId`, and emit the ENTER **only if this actually opens a
 * bracket**.
 *
 * Idempotent by the partial unique index, not by a flag the caller keeps: re-entering while already
 * inside refreshes `last_seen_at` and emits nothing. That is what makes it safe to call from a
 * layout on every render, and it is also what fixes the two-tabs bug — the second tab finds the
 * bracket already open instead of opening a second one.
 */
export async function openPresence(
  actor: Actor,
  tenantId: string,
  kind: PresenceKind,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    // Scoped to the tenant whose space this is: the row is theirs, and the RLS policy is
    // tenant-equality, so the write has to happen inside their context.
    const opened = await runInTenant(tenantId, async () => {
      // `xmax = 0` is true only for a row this statement INSERTED, so one round trip distinguishes
      // "opened" from "refreshed" — and the ENTER event hangs entirely on that distinction.
      // (Kept out of the SQL text: a backtick inside a tagged template TERMINATES it, and a `--`
      //  comment there is invisible to every JS tool that might have caught it.)
      const rows = await sql<{ id: string }[]>`
        INSERT INTO space_presence (user_id, tenant_id, kind)
        VALUES (${actor.id}::uuid, ${tenantId}::uuid, ${kind})
        -- Restating the index predicate is mandatory against a PARTIAL unique index; without it
        -- this throws on every re-entry instead of refreshing.
        ON CONFLICT (user_id, tenant_id) WHERE closed_at IS NULL
          DO UPDATE SET last_seen_at = now()
        RETURNING id, (xmax = 0) AS inserted`;
      const r = rows[0] as unknown as { id: string; inserted: boolean } | undefined;
      return r?.inserted ? r.id : null;
    });
    if (!opened) return;

    await emitEventSingle({
      namespace: NAMESPACE[kind],
      type: EVENTS[kind].enter,
      actor: userActor(actor.id, actor.email ?? undefined),
      tenantId,
      payload: { ...meta, presenceId: opened, kind },
    });
  } catch (e) {
    console.error('[space-presence] openPresence failed:', e);
  }
}

/**
 * Close every open bracket this actor holds, except optionally the tenant they are in right now,
 * and emit one tenant-scoped EXIT per bracket closed.
 *
 * The `except` argument is the whole "moved" case: a manager who descends from company A straight
 * into company B never passes through an exit control, and A is owed a departure.
 *
 * Reads across tenants (that is the question being asked — "where else is this person open?"), so
 * the scan runs in bypass. Each CLOSE is then written back inside its own tenant's context, so no
 * row is written outside the tenant it belongs to.
 */
export async function closePresence(
  actor: Actor,
  reason: CloseReason,
  opts: { exceptTenantId?: string | null } = {},
): Promise<number> {
  try {
    // A NULLABLE PARAMETER, never a composed fragment: `${c ? sql`x` : sql``}` reads as fragment
    // composition, but lib/db.ts's `sql` is a Proxy routing only the tagged-template CALL, so a
    // nested sql`` used as a VALUE is a Promise and postgres.js throws serialising it (the third
    // Proxy trap, CLAUDE.md). One statement, one plan, no branch.
    const open = await runInBypass(async () => sql<{
      id: string; tenantId: string; kind: PresenceKind;
    }[]>`
      SELECT id, tenant_id AS "tenantId", kind
      FROM space_presence
      WHERE user_id = ${actor.id}::uuid
        AND closed_at IS NULL
        AND (${opts.exceptTenantId ?? null}::uuid IS NULL
             OR tenant_id <> ${opts.exceptTenantId ?? null}::uuid)`);
    if (!open.length) return 0;

    let closed = 0;
    for (const p of open) {
      try {
        const won = await runInTenant(p.tenantId, async () => {
          // CAS on `closed_at IS NULL`: two tabs racing to close one bracket must produce ONE
          // exit event. The loser updates nothing and emits nothing.
          const rows = await sql<{ id: string }[]>`
            UPDATE space_presence
               SET closed_at = now(), close_reason = ${reason}
             WHERE id = ${p.id}::uuid AND closed_at IS NULL
             RETURNING id`;
          return rows.length > 0;
        });
        if (!won) continue;

        await emitEventSingle({
          namespace: NAMESPACE[p.kind],
          type: EVENTS[p.kind].exit,
          actor: userActor(actor.id, actor.email ?? undefined),
          tenantId: p.tenantId,
          payload: { reason, kind: p.kind, presenceId: p.id },
        });
        closed += 1;
      } catch (e) {
        console.error('[space-presence] close failed for', p.id, e);
      }
    }
    return closed;
  } catch (e) {
    console.error('[space-presence] closePresence failed:', e);
    return 0;
  }
}

/**
 * The two doors, as one call, for a layout that has just decided which (if either) applies.
 *
 * A layout rendering a tenant portal knows three things at once: whether this actor is an outside
 * actor, which tenant they are in, and — implicitly — that they are no longer in any OTHER tenant.
 * Doing both halves here is what closes the "moved" case without every caller remembering to.
 */
export async function syncPortalPresence(
  actor: Actor,
  tenantId: string,
  kind: PresenceKind | null,
  meta: Record<string, unknown> = {},
): Promise<void> {
  /**
   * ONLY AN OUTSIDE-ACTOR RENDER CLOSES OTHER BRACKETS. Measured, not assumed.
   *
   * The first version also closed from the `kind === null` branch — reasoning that being inside a
   * tenant you belong to means you have left the one you were shadowing. Driven, it closed the
   * bracket THE SAME PAGE LOAD had just opened. The server log shows why:
   *
   *   syncPortalPresence tenant=<foundation>    kind=shadow    ← opens foundation
   *   syncPortalPresence tenant=<rfp-pipeline>  kind=null      ← a SECOND, concurrent render
   *   closePresence reason=moved except=<rfp-pipeline>         ← closes foundation
   *
   * One navigation to a customer's portal also rendered the admin's OWN home portal, and that
   * render's "everything except me" close took out the customer bracket. The `except` was correct
   * and useless: it protected the tenant of the render that fired it, which was a different one.
   *
   * So a render in a space the actor BELONGS to is not evidence they left a space they were
   * shadowing — it can happen incidentally, from a prefetch or a dispatcher, while they are still
   * sitting in the customer's workspace. The evidence has to come from a render that is itself a
   * presence, or from a surface outside every tenant (the admin/partner consoles, which close with
   * `left_space`), or from signing out, or from the sweep. Four honest witnesses instead of one
   * unreliable one.
   *
   * What this gives up: an actor who leaves a customer's portal for their own and stays there is
   * closed by the SWEEP rather than instantly. That is `timeout` — "we stopped seeing them" — which
   * is exactly what happened, and a late true record beats a prompt false one.
   */
  if (!kind) return;
  await openPresence(actor, tenantId, kind, meta);
  await closePresence(actor, 'moved', { exceptTenantId: tenantId });
}

/**
 * "I am still here" — refresh every open bracket this actor holds. Never opens one.
 *
 * ── WHY THIS IS NEEDED, AND WHY IT IS CLIENT-DRIVEN ──────────────────────────────────────────
 * `last_seen_at` was only advanced by `openPresence`, i.e. by a portal LAYOUT render. In the App
 * Router a shared layout is NOT re-executed on a soft navigation between sibling pages, so an
 * actor could work inside a customer's workspace for the whole idle window without the layout
 * running once — and the sweep would close their bracket as `timeout` while they were still
 * sitting in it.
 *
 * That is a FALSE DEPARTURE written into a customer's audit trail, followed by a fresh arrival on
 * their next hard load: a left-and-re-entered pair that never happened. It is the same class of
 * defect as the missing exit — a confident wrong record — pointing the other way, and it was
 * introduced by the fix for the first one.
 *
 * The ping comes from the browser because "the tab is still open" is not knowable anywhere else.
 * This is NOT the client-owned emission that was removed from the shadow banner: that was a state
 * TRANSITION the server must own, and it still does — the server owns the bracket, both events and
 * every close. The client only reports liveness, which is the one fact it alone has.
 *
 * Degrades safely in every direction: if the ping never arrives (JS off, sleeping laptop, a failed
 * request) the sweep closes the bracket exactly as it does today — never worse than before. If it
 * arrives for a bracket that is already closed it matches no row, because this only ever touches
 * `closed_at IS NULL`. It cannot resurrect a closed bracket and it cannot create one, so a
 * heartbeat from a stale tab is inert rather than a way to reopen a customer's workspace.
 *
 * Throttled in SQL, not in JS: the `last_seen_at <` predicate makes a too-frequent ping a no-op at
 * the index rather than a write, so the endpoint cannot be used to hammer the row.
 */
export async function touchPresence(actor: Actor, minIntervalSeconds = 60): Promise<number> {
  try {
    // `last_seen_at` ONLY. Advancing `last_interaction_at` here is the whole bug this split
    // removes: the heartbeat is a timer on a visible tab, not evidence that a person is working,
    // and a column that both signals write cannot tell an administrator at their desk from a lit
    // monitor in an empty room. See `noteInteraction` for the other half.
    const rows = await runInBypass(async () => sql<{ id: string }[]>`
      UPDATE space_presence
         SET last_seen_at = now()
       WHERE user_id = ${actor.id}::uuid
         AND closed_at IS NULL
         AND last_seen_at < now() - make_interval(secs => ${minIntervalSeconds})
       RETURNING id`);
    return rows.length;
  } catch (e) {
    console.error('[space-presence] touchPresence failed:', e);
    return 0;
  }
}

/**
 * A PERSON did something inside this space — advance BOTH clocks.
 *
 * Called from the portal layout, which renders on a real navigation. It is deliberately not called
 * from the heartbeat: `last_interaction_at` is the one signal the descent gate trusts, and the
 * moment a timer can advance it the gate can never fire.
 *
 * Throttled in SQL like `touchPresence`, for the same reason — a person clicking quickly should not
 * turn every render into a write.
 */
export async function noteInteraction(actor: Actor, minIntervalSeconds = 30): Promise<number> {
  try {
    const rows = await runInBypass(async () => sql<{ id: string }[]>`
      UPDATE space_presence
         SET last_seen_at = now(), last_interaction_at = now()
       WHERE user_id = ${actor.id}::uuid
         AND closed_at IS NULL
         AND last_interaction_at < now() - make_interval(secs => ${minIntervalSeconds})
       RETURNING id`);
    return rows.length;
  } catch (e) {
    console.error('[space-presence] noteInteraction failed:', e);
    return 0;
  }
}

/**
 * Has this actor's DESCENT gone idle — has a person stopped working in this customer's space?
 *
 * Distinct from the sweep in both its question and its consequence. The sweep asks whether the TAB
 * is gone and closes the bracket so the customer's audit trail stops asserting a presence that
 * ended. This asks whether the PERSON is gone and is used to REFUSE the descent, which is the thing
 * that actually removes the access.
 *
 * Returns the bracket that has gone idle, or null. Null on error is deliberate and is the opposite
 * choice from `blockingReview`: a gate that cannot read its own state must not fail open, but this
 * one's failure mode is ejecting a working administrator out of a customer's workspace on a
 * transient database blip, which is a worse and much more likely outcome than one extra idle
 * minute. The sweep remains the backstop, and it fails the safe way.
 */
export async function idleDescent(
  userId: string,
  tenantId: string,
  idleMinutes: number,
): Promise<{ id: string; lastInteractionAt: Date } | null> {
  try {
    const [row] = await runInBypass(async () => sql<{
      id: string; lastInteractionAt: Date;
    }[]>`
      SELECT id, last_interaction_at AS "lastInteractionAt"
        FROM space_presence
       WHERE user_id = ${userId}::uuid
         AND tenant_id = ${tenantId}::uuid
         AND closed_at IS NULL
         AND last_interaction_at < now() - make_interval(mins => ${idleMinutes})
       LIMIT 1`);
    return row ?? null;
  } catch (e) {
    console.error('[space-presence] idleDescent failed:', e);
    return null;
  }
}

/**
 * The backstop: close brackets whose actor has not been seen for `idleMinutes`.
 *
 * This is the case the old code could not handle at all — the tab that was closed, the session that
 * lapsed, the laptop that was shut. Those are not rare, and every one of them left a customer's
 * trail asserting somebody was still in their workspace.
 *
 * The threshold has to stay comfortably ABOVE the heartbeat interval, or the sweep starts evicting
 * live actors between pings — which is the false-departure defect `touchPresence` exists to remove.
 * At a 2-minute ping and a 45-minute floor there are ~22 chances to be seen before eviction.
 *
 * Runs in bypass because it sweeps every tenant by definition; each close is written in its own
 * tenant's context via `closePresence`.
 */
export async function sweepStalePresence(idleMinutes = 45): Promise<number> {
  try {
    const stale = await runInBypass(async () => sql<{
      userId: string; email: string | null;
    }[]>`
      SELECT DISTINCT p.user_id AS "userId", u.email
      FROM space_presence p
      JOIN users u ON u.id = p.user_id
      WHERE p.closed_at IS NULL
        AND p.last_seen_at < now() - make_interval(mins => ${idleMinutes})`);
    let n = 0;
    for (const s of stale) {
      n += await closePresence({ id: s.userId, email: s.email }, 'timeout');
    }
    return n;
  } catch (e) {
    console.error('[space-presence] sweepStalePresence failed:', e);
    return 0;
  }
}


/**
 * How long a forced ascent keeps somebody out.
 *
 * A COOLDOWN, not a ban. An rfp_admin has no descent flag to clear — being on the portal URL *is*
 * the descent — so closing the bracket evicts the record and not the actor; their next render just
 * opens a new one. Time is the only mechanism that holds without inventing a grant model.
 *
 * Thirty minutes matches the descent idle window, so an operator ejecting somebody and the clock
 * ejecting them produce the same shape of interruption rather than two rules to remember.
 */
export const FORCED_ASCENT_COOLDOWN_MS = 30 * 60_000;

/**
 * End somebody else's presence in a customer's workspace, now.
 *
 * `/admin/workspace-access` could see an open bracket and do nothing about it. This is the act that
 * page was missing. Returns how many brackets closed — 0 means they were not in there, which is a
 * legitimate outcome and not an error.
 */
export async function forceAscend(
  target: Actor,
  opts: { tenantId?: string | null } = {},
): Promise<number> {
  try {
    const rows = await runInBypass(async () => (opts.tenantId
      ? sql<{ id: string }[]>`
          UPDATE space_presence SET closed_at = now(), close_reason = 'forced'
           WHERE user_id = ${target.id}::uuid AND tenant_id = ${opts.tenantId}::uuid
             AND closed_at IS NULL
           RETURNING id`
      : sql<{ id: string }[]>`
          UPDATE space_presence SET closed_at = now(), close_reason = 'forced'
           WHERE user_id = ${target.id}::uuid AND closed_at IS NULL
           RETURNING id`));
    return rows.length;
  } catch (e) {
    console.error('[space-presence] forceAscend failed:', e);
    return 0;
  }
}

/**
 * Is this actor inside a forced-ascent cooldown for this tenant?
 *
 * Reads only the MOST RECENT bracket: an old `forced` from last month must not keep somebody out,
 * and a later legitimate visit means the cooldown was already served.
 *
 * Returns false on error — deliberately, and for the same reason `idleDescent` does. This gate's
 * failure mode is ejecting a working administrator from a customer's workspace on a transient
 * database blip, which is worse and far likelier than one person getting back in a few minutes
 * early. The operator can force them out again; a page that cannot be opened has no such recovery.
 */
export async function inForcedCooldown(
  userId: string,
  tenantId: string,
  cooldownMs = FORCED_ASCENT_COOLDOWN_MS,
): Promise<boolean> {
  try {
    const [row] = await runInBypass(async () => sql<{ reason: string | null; closedAt: Date | null }[]>`
      SELECT close_reason AS "reason", closed_at AS "closedAt"
        FROM space_presence
       WHERE user_id = ${userId}::uuid AND tenant_id = ${tenantId}::uuid
       ORDER BY entered_at DESC LIMIT 1`);
    if (!row || row.reason !== 'forced' || !row.closedAt) return false;
    // `closed_at` is a timestamptz and arrives as a JS Date. `.getTime()`, never a string slice —
    // slicing the string form yields NaN, and NaN survives every comparison by picking a branch.
    return Date.now() - row.closedAt.getTime() < cooldownMs;
  } catch (e) {
    console.error('[space-presence] inForcedCooldown failed:', e);
    return false;
  }
}
