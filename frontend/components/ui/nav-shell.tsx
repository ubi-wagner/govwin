'use client';

/**
 * NavShell — the responsive app shell. The nav rail is an inline 256px column
 * at ≥lg and a left slide-out drawer below (with a hamburger top bar), via the
 * shared <Drawer>. On a Chrome split-screen half the rail collapses so the
 * content column gets the full pane width. The drawer auto-closes on navigation.
 *
 * Both app/admin/layout.tsx and app/portal/[tenantSlug]/layout.tsx pass their
 * existing aside content as `rail` and their page content as `children`.
 */

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Drawer } from './drawer';

export function NavShell({
  brand,
  rail,
  children,
  mainClassName,
}: {
  brand?: React.ReactNode;
  rail: React.ReactNode;
  children: React.ReactNode;
  mainClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // Close the drawer whenever the route changes (i.e. a nav link was tapped).
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <div className="min-h-screen flex">
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="left"
        inlineAt="lg"
        width="w-64"
        className="bg-navy-900 text-white p-6 flex flex-col"
        ariaLabel="Navigation"
      >
        {rail}
      </Drawer>
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile/split top bar — hidden at lg where the rail is inline. */}
        <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 bg-navy-900 text-white px-4 h-12 shrink-0">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open navigation"
            className="-ml-2 min-h-11 min-w-11 inline-flex items-center justify-center text-xl leading-none hover:text-gray-300"
          >
            ☰
          </button>
          {brand && <span className="text-sm font-semibold truncate">{brand}</span>}
        </div>
        {/* overflow-x-clip is the systemic guard: the page body can never scroll sideways, while
            inner overflow-x-auto scrollers (tables, tab bars) and position:sticky still work (clip
            does not create a scroll container). Per-row wrapping handles the large overflows so this
            only catches tiny decorative residuals. */}
        <main className={mainClassName ?? 'flex-1 min-w-0 overflow-x-clip'}>{children}</main>
      </div>
    </div>
  );
}
