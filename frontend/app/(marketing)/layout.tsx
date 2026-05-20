import Link from 'next/link';
import { Wordmark } from '@/components/marketing/wordmark';
import { MobileMenu } from '@/components/marketing/mobile-menu';
import Tracker from '@/components/analytics/tracker';

const mobileNavLinks = [
  {
    href: '#',
    label: 'Platform',
    children: [
      { href: '/features', label: 'Features' },
      { href: '/engine', label: 'Engine' },
      { href: '/how-it-works', label: 'How It Works' },
      { href: '/the-expert', label: 'The Expert' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  { href: '/about', label: 'About' },
  { href: '/resources', label: 'Resources' },
  { href: '/blog', label: 'Blog' },
  { href: '/infosec', label: 'Security' },
];

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  // Migrations run automatically on deploy via entrypoint.sh → migrate.mjs
  return (
    <div className="min-h-screen flex flex-col">
      <Tracker />
      {/* Top bar — launch notice */}
      <div className="bg-navy-900 text-center py-2 px-4">
        <p className="text-xs text-cream-200 tracking-wide">
          <span className="text-citrus font-semibold uppercase tracking-widest">Now Accepting Applications</span>
          <span className="mx-2 text-navy-500">&middot;</span>
          Founding Cohort &middot; Platform launches July 2026
          <Link href="/apply" className="ml-3 text-citrus hover:text-citrus-300 underline">
            Apply
          </Link>
        </p>
      </div>

      <header className="border-b border-cream-200 bg-cream-50/90 backdrop-blur-sm sticky top-0 z-50 px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <Wordmark variant="light" size="sm" />
          <MobileMenu links={mobileNavLinks} />
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-navy-600">
            {/* Platform dropdown */}
            <div className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 hover:text-brand-600 transition-colors"
              >
                Platform
                <svg
                  className="w-3.5 h-3.5 text-navy-400 group-hover:text-brand-600 transition-colors"
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
                  <Link href="/features" className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                    Features
                  </Link>
                  <Link href="/engine" className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                    Engine
                  </Link>
                  <Link href="/how-it-works" className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                    How It Works
                  </Link>
                  <Link href="/the-expert" className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                    The Expert
                  </Link>
                  <Link href="/pricing" className="block px-4 py-2 text-sm text-navy-700 hover:bg-cream-50 hover:text-brand-600 transition-colors">
                    Pricing
                  </Link>
                </div>
              </div>
            </div>
            <Link href="/about" className="hover:text-brand-600 transition-colors">About</Link>
            <Link href="/resources" className="hover:text-brand-600 transition-colors">Resources</Link>
            <Link href="/blog" className="hover:text-brand-600 transition-colors">Blog</Link>
            <Link href="/infosec" className="hover:text-brand-600 transition-colors">Security</Link>
            <Link
              href="/apply"
              className="ml-2 px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg shadow-sm transition-colors font-semibold"
            >
              Apply Now
            </Link>
            <Link
              href="/login"
              className="px-4 py-2.5 border border-navy-200 hover:border-brand-400 text-navy-700 rounded-lg transition-colors"
            >
              Login
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-navy-900 text-navy-400 px-6 py-16">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-10">
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Platform</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/features" className="hover:text-cream transition-colors">Features</Link></li>
              <li><Link href="/engine" className="hover:text-cream transition-colors">Engine</Link></li>
              <li><Link href="/how-it-works" className="hover:text-cream transition-colors">How It Works</Link></li>
              <li><Link href="/the-expert" className="hover:text-cream transition-colors">The Expert</Link></li>
              <li><Link href="/pricing" className="hover:text-cream transition-colors">Pricing</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Company</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/about" className="hover:text-cream transition-colors">About</Link></li>
              <li><Link href="/team" className="hover:text-cream transition-colors">Team</Link></li>
              <li><Link href="/customers" className="hover:text-cream transition-colors">Customers</Link></li>
              <li><Link href="/value" className="hover:text-cream transition-colors">Value</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Resources</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/resources" className="hover:text-cream transition-colors">Resources</Link></li>
              <li><Link href="/blog" className="hover:text-cream transition-colors">Blog</Link></li>
              <li><Link href="/infosec" className="hover:text-cream transition-colors">Security &amp; Data</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Legal</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/legal/terms" className="hover:text-cream transition-colors">Terms of Service</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-cream transition-colors">Privacy Policy</Link></li>
              <li><Link href="/legal/acceptable-use" className="hover:text-cream transition-colors">Acceptable Use</Link></li>
              <li><Link href="/legal/ai-disclosure" className="hover:text-cream transition-colors">AI Disclosure</Link></li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-navy-800 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/apply"
              className="px-5 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg shadow-sm transition-colors text-sm font-semibold"
            >
              Apply for Founding Cohort
            </Link>
            <Link
              href="/login"
              className="px-4 py-2.5 border border-navy-600 hover:border-brand-400 text-navy-300 hover:text-cream rounded-lg transition-colors text-sm"
            >
              Subscriber Login
            </Link>
          </div>
          <span className="text-xs text-navy-500">&copy; 2026 RFP Pipeline. All rights reserved.</span>
        </div>
      </footer>
    </div>
  );
}
