import Link from 'next/link'

const legalNav = [
  { label: 'Terms of Service', href: '/legal/terms' },
  { label: 'Privacy Policy', href: '/legal/privacy' },
  { label: 'Acceptable Use', href: '/legal/acceptable-use' },
  { label: 'AI Disclosure', href: '/legal/ai-disclosure' },
]

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <nav className="mb-10 flex flex-wrap gap-2">
        {legalNav.map(link => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  )
}
