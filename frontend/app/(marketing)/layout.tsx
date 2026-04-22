import Link from 'next/link';

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50 px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl font-bold text-brand-700 font-display">RFP Pipeline</span>
            <span className="text-[10px] font-medium text-brand-500 bg-brand-50 px-1.5 py-0.5 rounded">AI + Expert</span>
          </Link>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <Link href="/how-it-works" className="hover:text-brand-700 transition-colors">How It Works</Link>
            <Link href="/pricing" className="hover:text-brand-700 transition-colors">Pricing</Link>
            <Link href="/the-expert" className="hover:text-brand-700 transition-colors">The Expert</Link>
            <Link href="/security" className="hover:text-brand-700 transition-colors">Security</Link>
            <Link
              href="/apply"
              className="ml-2 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg shadow-sm transition-colors"
            >
              Apply Now
            </Link>
            <Link
              href="/login"
              className="px-4 py-2 border border-gray-300 hover:border-brand-400 text-gray-700 rounded-lg transition-colors"
            >
              Login
            </Link>
          </div>
        </nav>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-navy-900 text-gray-400 px-6 py-16">
        <div className="max-w-6xl mx-auto grid md:grid-cols-4 gap-8">
          <div>
            <span className="text-lg font-bold text-white font-display">RFP Pipeline</span>
            <p className="mt-3 text-sm leading-relaxed">
              AI-powered proposal intelligence backed by hands-on federal R&amp;D expertise.
              Built for small businesses pursuing SBIR, STTR, BAA, and OTA funding.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Product</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/how-it-works" className="hover:text-white transition-colors">How It Works</Link></li>
              <li><Link href="/pricing" className="hover:text-white transition-colors">Pricing</Link></li>
              <li><Link href="/security" className="hover:text-white transition-colors">Security</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Company</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/the-expert" className="hover:text-white transition-colors">About Eric</Link></li>
              <li><Link href="/apply" className="hover:text-white transition-colors">Apply</Link></li>
              <li><Link href="/legal/terms" className="hover:text-white transition-colors">Terms</Link></li>
              <li><Link href="/legal/privacy" className="hover:text-white transition-colors">Privacy</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-3">Contact</h4>
            <ul className="space-y-2 text-sm">
              <li>eric@rfppipeline.com</li>
              <li>Columbus, Ohio</li>
            </ul>
          </div>
        </div>
        <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-gray-800 text-center text-xs text-gray-500">
          &copy; {new Date().getFullYear()} RFP Pipeline. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
