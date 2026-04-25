import Link from 'next/link';
import { Wordmark } from '@/components/marketing/wordmark';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar — launch notice */}
      <div className="bg-navy-900 text-center py-2 px-4">
        <p className="text-xs text-cream-200 tracking-wide">
          <span className="text-citrus font-semibold uppercase tracking-widest">Now Accepting Applications</span>
          <span className="mx-2 text-navy-500">&middot;</span>
          Founding Cohort &middot; Platform launches June 2026
          <Link href="/apply" className="ml-3 text-citrus hover:text-citrus-300 underline">
            Apply
          </Link>
        </p>
      </div>

      <header className="border-b border-cream-200 bg-cream-50/90 backdrop-blur-sm sticky top-0 z-50 px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <Wordmark variant="light" size="sm" />
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-navy-600">
            <Link href="/about" className="hover:text-brand-600 transition-colors">About</Link>
            <Link href="/value" className="hover:text-brand-600 transition-colors">Value</Link>
            <Link href="/resources" className="hover:text-brand-600 transition-colors">Resources</Link>
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
            <Wordmark variant="dark" size="sm" showTagline />
            <p className="mt-5 text-sm leading-relaxed text-navy-400">
              A proposal engine, not a proposal gamble. Isolated AI + 25 years of federal R&amp;D expertise.
              Built for small businesses pursuing non-dilutive R&amp;D funding.
            </p>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Product</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/value" className="hover:text-cream transition-colors">Spotlight + Portals</Link></li>
              <li><Link href="/about" className="hover:text-cream transition-colors">About</Link></li>
              <li><Link href="/infosec" className="hover:text-cream transition-colors">Security &amp; Data</Link></li>
              <li><Link href="/resources" className="hover:text-cream transition-colors">Resources</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Engage</h4>
            <ul className="space-y-2.5 text-sm">
              <li><Link href="/apply" className="hover:text-cream transition-colors">Apply for Founding Cohort</Link></li>
              <li><Link href="/login" className="hover:text-cream transition-colors">Subscriber Login</Link></li>
              <li><Link href="/legal/terms" className="hover:text-cream transition-colors">Terms of Service</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-cream transition-colors">Privacy Policy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-xs font-semibold text-cream-200 uppercase tracking-widest mb-4">Contact</h4>
            <ul className="space-y-2.5 text-sm">
              <li className="text-cream-200 font-medium">Eric Wagner</li>
              <li>
                <a href="mailto:eric@rfppipeline.com" className="hover:text-cream transition-colors">
                  eric@rfppipeline.com
                </a>
              </li>
              <li>Columbus, Ohio</li>
              <li className="pt-2">
                <span className="text-xs text-navy-500 uppercase tracking-wider">Programs:</span>
                <br />
                <span className="text-xs">SBIR &middot; STTR &middot; BAA &middot; OTA &middot; CSO &middot; NOFO</span>
              </li>
              <li>
                <span className="text-xs text-navy-500 uppercase tracking-wider">Agencies:</span>
                <br />
                <span className="text-xs">DoD &middot; NSF &middot; DOE &middot; DARPA &middot; DOT</span>
              </li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-navy-800 flex flex-col md:flex-row items-center justify-between gap-4 text-xs text-navy-500">
          <span>&copy; {new Date().getFullYear()} RFP Pipeline. All rights reserved.</span>
          <span className="tracking-widest uppercase">Apply &middot; Curate &middot; Draft &middot; Win</span>
        </div>
      </footer>
    </div>
  );
}
