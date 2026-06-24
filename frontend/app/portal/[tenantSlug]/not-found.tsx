/**
 * Portal route not-found boundary. `notFound()` calls in portal pages (e.g. a
 * proposal/section the user can't access) render here, inside the portal shell,
 * instead of the bare framework 404.
 */
import Link from 'next/link';

export default function PortalNotFound() {
  return (
    <div className="max-w-lg mx-auto mt-16 rounded-lg border border-gray-200 bg-white p-8 text-center">
      <h1 className="text-lg font-semibold text-gray-900">Not found</h1>
      <p className="mt-2 text-sm text-gray-600">
        This item doesn&apos;t exist, or you don&apos;t have access to it.
      </p>
      <Link
        href="/portal"
        className="mt-6 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
      >
        Go to dashboard
      </Link>
    </div>
  );
}
