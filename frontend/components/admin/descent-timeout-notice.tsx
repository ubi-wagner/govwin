/**
 * "You were moved out of a customer's workspace."
 *
 * ── WHY THIS COMPONENT EXISTS ────────────────────────────────────────────────────────────────
 * The descent idle gate (portal layout, mig 248) redirects an outside actor out of a customer's
 * workspace when they stop working in it. Without a notice, that is indistinguishable from a
 * misclick or a broken link: the person taps a bookmark, lands on their own dashboard, and tries
 * again — which re-enters the workspace and re-opens a bracket in the customer's audit trail.
 *
 * `drive-descent-timeout.mts` caught the first version doing exactly this. The gate redirected to
 * `/admin?descent=timeout`, `/admin` is a bare `redirect('/admin/dashboard')`, and a redirect drops
 * the query string — so the reason never reached a page that could show it. A control that ejects
 * someone silently teaches them to work around it.
 *
 * ── A SERVER COMPONENT, AND NO CLOCK ─────────────────────────────────────────────────────────
 * Nothing here reads `Date.now()`. A `'use client'` component that reads the clock during render
 * makes its output a function of when it rendered, React throws #418, and hydration fails for the
 * whole subtree while the route still answers 200 — eight occurrences in this repo. There is no
 * time in this message on purpose: "30 minutes" is the policy, not a countdown.
 */

export function DescentTimeoutNotice({ where }: { where: 'admin' | 'partner' }) {
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm
                 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">You were returned to your own console.</p>
      <p className="mt-1">
        Your access to that customer&rsquo;s workspace timed out after 30 minutes without activity,
        and their record shows you left at that moment rather than staying open.{' '}
        {where === 'admin'
          ? 'Open the company again from Tenants to continue.'
          : 'Open the company again from your console to continue.'}
      </p>
    </div>
  );
}
