export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b px-6 py-4">
        <nav className="max-w-6xl mx-auto flex items-center justify-between">
          <span className="text-xl font-bold text-brand-700">RFP Pipeline</span>
          <div className="flex gap-6 text-sm">
            <a href="/features">Features</a>
            <a href="/pricing">Pricing</a>
            <a href="/about">About</a>
            <a href="/login" className="px-4 py-2 bg-brand-600 text-white rounded">Login</a>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t px-6 py-8 text-center text-sm text-gray-500">
        &copy; 2026 RFP Pipeline. All rights reserved.
      </footer>
    </div>
  );
}
