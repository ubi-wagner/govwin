import { auth } from '@/auth';
import { redirect } from 'next/navigation';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

/**
 * /admin/architecture — RFP-admin landing for the Architecture Explorer.
 *
 * Embeds the self-contained, regenerable explorer (served as the static asset
 * /architecture/explorer.html; built by frontend/scripts/architecture). The explorer is the
 * live govtech_intel schema + the data-flow traces + the UI→table map. Gated to rfp_admin+
 * (middleware already enforces the /admin prefix; this is the belt-and-suspenders page gate).
 */
export default async function ArchitecturePage() {
  const session = await auth();
  if (!session?.user) redirect('/login');
  const role = (session.user as { role?: string }).role;
  if (role !== 'master_admin' && role !== 'rfp_admin') redirect('/admin');

  return (
    // `-m-4 sm:-m-8`: the negative margin exists to cancel the admin shell's padding and go
    // edge-to-edge, but that padding is `p-4` below `sm` and `p-8` above it. A flat `-m-8`
    // therefore overshot by 2rem on a phone — the container ended at 406px in a 390px viewport,
    // and MAIN clips, so the overhang was unreachable rather than scrollable.
    <div className="-m-4 flex h-[calc(100vh-3.5rem)] flex-col bg-white sm:-m-8">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">System Architecture</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-gray-500">
            The live <span className="font-mono text-gray-700">govtech_intel</span> schema and its data
            flows, straight from the migrated database. Click any table for its fields and a navigable
            foreign-key neighborhood, or open the Data&nbsp;flows and UI&nbsp;surfaces tabs.{' '}
            <span className="text-gray-600">
              <b className="font-medium">Live</b> adds the layer the other three cannot: which tables
              anything is actually writing and reading — so a table with nothing on either end stops
              looking like a load-bearing one. It is also where you ask the companion.
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link
            href="/admin/workflows"
            className="rounded-full border border-gray-200 px-3 py-1.5 text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            Workflow Map →
          </Link>
          <a
            href="/architecture/explorer.html"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-gray-200 px-3 py-1.5 text-gray-600 transition-colors hover:border-gray-400 hover:text-gray-900"
          >
            Open full ↗
          </a>
        </div>
      </header>
      <iframe
        src="/architecture/explorer.html"
        title="Architecture Explorer — govtech_intel schema and data flows"
        className="w-full flex-1 border-0"
      />
    </div>
  );
}
