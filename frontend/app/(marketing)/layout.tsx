import Link from 'next/link';
import { Wordmark } from '@/components/marketing/wordmark';
import { MobileMenu } from '@/components/marketing/mobile-menu';
import Tracker from '@/components/analytics/tracker';
import { getSiteChrome, mobileNavFromChrome } from '@/lib/site-chrome';

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Migrations run automatically on deploy via entrypoint.sh → migrate.mjs
  // Header/footer content is editable via the 'site-chrome' page; falls back to
  // the in-code defaults so a missing/partial override still renders cleanly.
  const chrome = await getSiteChrome();
  const mobileNavLinks = mobileNavFromChrome(chrome.nav);

  return (
    <div className="min-h-screen flex flex-col">
      <Tracker />
      {/* Top bar — launch notice */}
      <div className="bg-navy-900 text-center py-2 px-4">
        <p className="text-xs text-cream-200 tracking-wide">
          <span className="text-citrus font-semibold uppercase tracking-widest">{chrome.banner.tag}</span>
          <span className="mx-2 text-navy-500">&middot;</span>
          {chrome.banner.text}
          <Link href={chrome.banner.ctaHref} className="ml-3 text-citrus hover:text-citrus-300 underline">
            {chrome.banner.ctaLabel}
          </Link>
        </p>
      </div>

      <header className="border-b border-cream-200 bg-cream-50/90 backdrop-blur-sm sticky top-0 z-50 px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <Wordmark variant="light" size="sm" />
          <MobileMenu links={mobileNavLinks} />
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-navy-600">
            {/* Platform dropdown(s) */}
            {chrome.nav.groups.map((group) => (
              <div key={group.label} className="group relative">
                <button
                  type="button"
                  className="flex items-center gap-1 hover:text-brand-600 transition-colors"
                >
                  {group.label}
                  <svg
                    className="w-3.5 h-3.5 text-navy-400 group-hover:text-brand-600 group-hover:rotate-180 transition-all"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="invisible opacity-0 group-hover:visible group-hover:opacity-100 transition-all duration-150 absolute top-full left-0 pt-2 z-50">
                  <div className="w-48 bg-white rounded-lg shadow-lg border border-cream-200 py-2">
                    {group.items.map((item) => (
                      <Link key={item.href} href={item.href} className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                        {item.label}
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            {chrome.nav.links.map((link) => (
              <Link key={link.href} href={link.href} className="hover:text-brand-600 transition-colors">{link.label}</Link>
            ))}
            <Link
              href={chrome.nav.applyHref}
              className="ml-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg shadow-sm transition-colors font-semibold"
            >
              {chrome.nav.applyLabel}
            </Link>
            <Link
              href={chrome.nav.loginHref}
              className="px-4 py-2.5 border border-navy-200 hover:border-brand-400 text-navy-700 rounded-lg transition-colors"
            >
              {chrome.nav.loginLabel}
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-navy-900 text-navy-400 px-6 py-16">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-10">
          {chrome.footer.columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">{col.title}</h4>
              <ul className="space-y-2.5 text-sm">
                {col.links.map((link) => (
                  <li key={link.href}><Link href={link.href} className="hover:text-cream transition-colors">{link.label}</Link></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-navy-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href={chrome.footer.ctaPrimary.href}
              className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg shadow-sm transition-colors text-sm font-semibold"
            >
              {chrome.footer.ctaPrimary.label}
            </Link>
            <Link
              href={chrome.footer.ctaSecondary.href}
              className="px-4 py-2.5 border border-navy-600 hover:border-brand-400 text-navy-300 hover:text-cream rounded-lg transition-colors text-sm"
            >
              {chrome.footer.ctaSecondary.label}
            </Link>
          </div>
          <span className="text-xs text-navy-500">{chrome.footer.copyright}</span>
        </div>
      </footer>
    </div>
  );
}
