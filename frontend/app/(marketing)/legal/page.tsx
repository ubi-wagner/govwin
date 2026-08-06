export const metadata = {
  title: 'Legal — RFP Pipeline',
  description: 'Terms of Service, Privacy Policy, Acceptable Use, and AI Disclosure for the RFP Pipeline platform.',
};

// Bare /legal is a conventional top-level URL a user may type or bookmark. Without a
// page it 404s (the four legal documents live one segment deeper). This index lands
// that path on a short directory of the legal documents, inheriting the layout nav.
const DOCS: Array<{ href: string; title: string; blurb: string }> = [
  { href: '/legal/terms', title: 'Terms of Service', blurb: 'The agreement governing your use of the RFP Pipeline platform.' },
  { href: '/legal/privacy', title: 'Privacy Policy', blurb: 'What data we collect, how we use it, and your choices.' },
  { href: '/legal/acceptable-use', title: 'Acceptable Use', blurb: 'The conduct and content rules that keep the platform safe.' },
  { href: '/legal/ai-disclosure', title: 'AI Disclosure', blurb: 'How AI assists drafting, review, and compliance — and its limits.' },
];

export default function LegalIndexPage() {
  return (
    <div>
      <h1 className="font-display text-3xl font-black text-navy-900 leading-tight mb-2">
        Legal
      </h1>
      <p className="text-sm text-navy-600 mb-8">
        The policies and agreements that govern RFP Pipeline.
      </p>

      <div className="grid gap-4 sm:grid-cols-2">
        {DOCS.map((d) => (
          <a
            key={d.href}
            href={d.href}
            className="block bg-white border border-cream-200 rounded-xl p-6 hover:border-navy-300 transition-colors"
          >
            <p className="text-base font-bold text-navy-900 mb-1">{d.title}</p>
            <p className="text-sm text-navy-600 leading-relaxed">{d.blurb}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
