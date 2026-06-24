'use client';

/**
 * Portal route error boundary. Renders INSIDE the portal layout (the sidebar
 * persists), so a failed SSR query no longer blows away the whole shell and
 * strands the user. Offers a retry plus a guaranteed way back to the workspace.
 */
import { useEffect } from 'react';
import Link from 'next/link';

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[portal] route error boundary:', error);
  }, [error]);

  return (
    <div className="max-w-lg mx-auto mt-16 rounded-lg border border-red-200 bg-red-50 p-8 text-center">
      <h1 className="text-lg font-semibold text-red-800">Something went wrong</h1>
      <p className="mt-2 text-sm text-red-700">
        This page failed to load. You can retry, or head back to your dashboard.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Try again
        </button>
        <Link
          href="/portal"
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
