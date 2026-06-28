/**
 * Portal route loading boundary.
 *
 * Portal pages are `force-dynamic` and run several sequential `await sql`
 * queries server-side, so without this boundary a navigation freezes on the
 * previous screen until SSR completes. This skeleton renders inside the portal
 * layout (sidebar persists) the moment a transition starts.
 */
export default function PortalLoading() {
  return (
    <div className="animate-pulse max-w-5xl">
      <div className="h-8 w-64 rounded bg-gray-200" />
      <div className="mt-2 h-4 w-80 rounded bg-gray-100" />
      <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-lg border border-gray-200 bg-gray-50" />
        ))}
      </div>
      <div className="mt-8 space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-12 rounded-lg border border-gray-100 bg-gray-50" />
        ))}
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
