'use client';

/**
 * PresenceHeartbeat — reports that an outside actor's tab is still open.
 *
 * Mounted ONLY for an rfp_admin shadowing, or a partner-manager descended into a client company.
 * Everyone else renders nothing and pings nothing, so this costs a normal customer session zero
 * requests.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────────────────────
 * The sweep closes a bracket whose actor has not been seen for the idle window, which is the only
 * way to close a tab that was shut. `last_seen_at` used to advance only on a portal LAYOUT render —
 * and in the App Router a shared layout is not re-executed on a soft navigation between sibling
 * pages, so an actor could work in here for the whole window without being seen once. The sweep
 * would then write a departure into that customer's audit trail while they were still present.
 *
 * ── WHY THE CLOCK IS NOT READ DURING RENDER ──────────────────────────────────────────────────
 * There is no `Date.now()` in the returned markup, and the component renders `null`. A client
 * component that reads the clock while rendering makes its output a function of WHEN it rendered:
 * the server writes one value, the client hydrates a beat later and writes another, React throws
 * #418 and hydration fails for the whole subtree while the route still answers 200. Eight
 * occurrences in this repo. Everything here happens in an effect, after mount.
 *
 * ── AND WHY IT IS NOT LOAD-BEARING ───────────────────────────────────────────────────────────
 * If the ping never arrives — JS disabled, a sleeping laptop, a failed request, this component
 * removed — the sweep closes the bracket exactly as it did before. The failure mode is the OLD
 * behaviour, never something worse. It cannot open a bracket or reopen a closed one; the endpoint
 * only touches rows that are still open.
 */
import { useEffect } from 'react';

/** Comfortably inside the sweep's 45-minute floor: ~22 chances to be seen before eviction. */
const INTERVAL_MS = 2 * 60 * 1000;

export function PresenceHeartbeat() {
  useEffect(() => {
    let stopped = false;
    const ping = () => {
      if (stopped || typeof document === 'undefined') return;
      // A hidden tab is not somebody working in a customer's workspace. Skipping it means a
      // backgrounded tab eventually times out, which is the honest outcome.
      if (document.visibilityState !== 'visible') return;
      // Best-effort: never surface a failure, never retry aggressively. The next tick tries again
      // and the sweep is the backstop.
      fetch('/api/presence/heartbeat', { method: 'POST', keepalive: true }).catch(() => {});
    };

    ping();                                     // on mount — the actor is here now
    const timer = setInterval(ping, INTERVAL_MS);
    // Coming back to the tab is exactly when the last ping is most likely to be stale.
    document.addEventListener('visibilitychange', ping);

    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', ping);
    };
  }, []);

  return null;
}
