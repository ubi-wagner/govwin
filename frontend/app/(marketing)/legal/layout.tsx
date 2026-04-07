export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto py-12 px-6">
      <nav className="flex gap-4 text-sm mb-8 border-b pb-4">
        <a href="/legal/terms">Terms</a>
        <a href="/legal/privacy">Privacy</a>
        <a href="/legal/acceptable-use">Acceptable Use</a>
        <a href="/legal/ai-disclosure">AI Disclosure</a>
      </nav>
      {children}
    </div>
  );
}
